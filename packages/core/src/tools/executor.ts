/**
 * ToolExecutor — Manages tool execution including permission checks,
 * parallel/sequential execution, circuit breaker, and retry logic.
 * Extracted from the Agent class.
 */

import type { ToolRegistry } from "../registry/tools.js";
import type {
  AgentEvent,
  ToolCall,
  ToolResult,
  ToolContext,
} from "../types.js";
import type {
  ToolPermissionManager,
} from "../permissions.js";
import type { AgentPlugin } from "../plugin.js";
import { withRetry, type CircuitBreaker } from "../retry/index.js";
import type { RetryPolicy } from "../retry/index.js";

export interface ToolExecutorDeps {
  getPermissionManager: () => ToolPermissionManager;
  getRetryPolicy: () => RetryPolicy;
  getCircuitBreaker: () => CircuitBreaker;
  getPlugins: () => Iterable<AgentPlugin>;
  getToolRegistry: () => ToolRegistry;
  emitEvent: (event: AgentEvent) => void;
}

export class ToolExecutor {
  private deps: ToolExecutorDeps;

  constructor(deps: ToolExecutorDeps) {
    this.deps = deps;
  }

  /**
   * Execute a batch of tool calls, handling permissions, parallel execution
   * for pre-approved tools, and sequential execution for permission-required tools.
   */
  async executeTools(
    messageId: string,
    toolCalls: ToolCall[],
    ctx: ToolContext
  ): Promise<ToolResult[]> {
    const permissionManager = this.deps.getPermissionManager();

    // Separate tool calls into categories
    const permissionRequired: ToolCall[] = [];
    const preApproved: ToolCall[] = [];
    const unknownTools: ToolCall[] = [];
    const denied: ToolCall[] = [];

    const reg = this.deps.getToolRegistry();

    for (const toolCall of toolCalls) {
      const tool = reg.get(toolCall.name);
      if (!tool) {
        unknownTools.push(toolCall);
        continue;
      }

      const decision = permissionManager.getPermissionDecision(toolCall.name);
      if (decision === "deny") {
        denied.push(toolCall);
      } else if (decision === "ask") {
        permissionRequired.push(toolCall);
      } else {
        preApproved.push(toolCall);
      }
    }

    const results: ToolResult[] = [];

    // Handle unknown tools immediately
    for (const toolCall of unknownTools) {
      const result: ToolResult = {
        id: toolCall.id,
        name: toolCall.name,
        result: `Unknown tool: ${toolCall.name}`,
        isError: true,
      };
      results.push(result);
      this.deps.emitEvent({ type: "tool.complete", messageId, toolResult: result });
    }

    // Handle denied tools immediately
    for (const toolCall of denied) {
      this.deps.emitEvent({
        type: "tool.permission.denied",
        messageId,
        toolName: toolCall.name,
      });
      const result: ToolResult = {
        id: toolCall.id,
        name: toolCall.name,
        result: `Tool "${toolCall.name}" is not permitted`,
        isError: true,
      };
      results.push(result);
      this.deps.emitEvent({ type: "tool.complete", messageId, toolResult: result });
    }

    // Run pre-approved tools in parallel
    if (preApproved.length > 0) {
      // Call onBeforeToolExecute hooks for all pre-approved tools
      for (const plugin of this.deps.getPlugins()) {
        if (plugin.onBeforeToolExecute) {
          for (const toolCall of preApproved) {
            await plugin.onBeforeToolExecute(toolCall, ctx);
          }
        }
      }

      const parallelPromises = preApproved.map(async (toolCall) => {
        const tool = reg.get(toolCall.name)!;
        const result = await this.executeSingleTool(tool, toolCall, ctx);

        // Call onAfterToolExecute hooks
        for (const plugin of this.deps.getPlugins()) {
          if (plugin.onAfterToolExecute) {
            await plugin.onAfterToolExecute(toolCall, result, ctx);
          }
        }

        this.deps.emitEvent({ type: "tool.complete", messageId, toolResult: result });
        return result;
      });

      const parallelResults = await Promise.allSettled(parallelPromises);
      for (let i = 0; i < parallelResults.length; i++) {
        const settled = parallelResults[i]!;
        if (settled.status === "fulfilled") {
          results.push(settled.value);
        } else {
          const toolCall = preApproved[i]!;
          const result: ToolResult = {
            id: toolCall.id,
            name: toolCall.name,
            result: `Tool execution error: ${settled.reason?.message ?? "Unknown error"}`,
            isError: true,
          };
          results.push(result);
          this.deps.emitEvent({ type: "tool.complete", messageId, toolResult: result });
        }
      }
    }

    // Handle permission-required tools sequentially (need user interaction)
    for (const toolCall of permissionRequired) {
      this.deps.emitEvent({
        type: "tool.permission.request",
        messageId,
        toolCall,
      });

      const permitted = await permissionManager.checkPermission(toolCall);
      let result: ToolResult;

      if (permitted) {
        this.deps.emitEvent({
          type: "tool.permission.granted",
          messageId,
          toolName: toolCall.name,
          allowAlways: permissionManager.isAllowedForSession(toolCall.name),
        });

        // Call onBeforeToolExecute hooks
        for (const plugin of this.deps.getPlugins()) {
          if (plugin.onBeforeToolExecute) {
            await plugin.onBeforeToolExecute(toolCall, ctx);
          }
        }

        const tool = reg.get(toolCall.name)!;
        result = await this.executeSingleTool(tool, toolCall, ctx);

        // Call onAfterToolExecute hooks
        for (const plugin of this.deps.getPlugins()) {
          if (plugin.onAfterToolExecute) {
            await plugin.onAfterToolExecute(toolCall, result, ctx);
          }
        }
      } else {
        this.deps.emitEvent({
          type: "tool.permission.denied",
          messageId,
          toolName: toolCall.name,
        });
        result = {
          id: toolCall.id,
          name: toolCall.name,
          result: `Tool "${toolCall.name}" execution denied by user`,
          isError: true,
        };
      }

      results.push(result);
      this.deps.emitEvent({ type: "tool.complete", messageId, toolResult: result });
    }

    // Return results in the original tool call order
    const orderedResults: ToolResult[] = [];
    for (const toolCall of toolCalls) {
      const result = results.find((r) => r.id === toolCall.id);
      if (result) {
        orderedResults.push(result);
      }
    }

    return orderedResults;
  }

  /**
   * Execute a single tool with circuit breaker, validation, and retry.
   */
  async executeSingleTool(
    tool: { parameters: { safeParse: (args: unknown) => { success: boolean; data?: unknown; error?: { message: string } } }; execute: (data: unknown, ctx: ToolContext) => Promise<{ output: unknown; metadata?: { error?: boolean } }> },
    toolCall: ToolCall,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const circuitBreaker = this.deps.getCircuitBreaker();
    const retryPolicy = this.deps.getRetryPolicy();

    // Check circuit breaker
    if (!circuitBreaker.canExecute(toolCall.name)) {
      const state = circuitBreaker.getState(toolCall.name);
      return {
        id: toolCall.id,
        name: toolCall.name,
        result: `Tool "${toolCall.name}" is temporarily unavailable (circuit breaker open after ${state.failureCount} consecutive failures). Will retry automatically after cooldown.`,
        isError: true,
      };
    }

    try {
      const parseResult = tool.parameters.safeParse(toolCall.arguments);
      if (!parseResult.success) {
        return {
          id: toolCall.id,
          name: toolCall.name,
          result: `Invalid parameters: ${parseResult.error?.message}`,
          isError: true,
        };
      }

      // Execute with retry policy
      const execResult = await withRetry(
        () => tool.execute(parseResult.data, ctx),
        retryPolicy,
        ctx.abortSignal
      );

      // Record success for circuit breaker
      circuitBreaker.recordSuccess(toolCall.name);

      // Separate the error flag from the rest of metadata
      const { error: _error, ...extraMetadata } = execResult.metadata ?? {};
      return {
        id: toolCall.id,
        name: toolCall.name,
        result: execResult.output,
        isError: !!execResult.metadata?.error,
        ...(Object.keys(extraMetadata).length > 0 ? { metadata: extraMetadata } : {}),
      };
    } catch (err) {
      // Record failure for circuit breaker
      circuitBreaker.recordFailure(toolCall.name);

      return {
        id: toolCall.id,
        name: toolCall.name,
        result: `Tool execution error: ${(err as Error).message}`,
        isError: true,
      };
    }
  }
}
