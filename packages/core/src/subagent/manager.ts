/**
 * SubagentManager - Manages the lifecycle of subagent instances.
 * 
 * This is the core implementation that bridges the Agent class with the
 * task tool. It handles:
 * - Creating child Agent instances with proper configuration
 * - Running subagents synchronously or asynchronously
 * - Tracking running subagents and their status
 * - Token budget enforcement
 * - Cancellation via AbortController
 */

import type { Agent } from "../agent.js";
import type { AgentEvent, ToolCall } from "../types.js";
import type { PermissionResponse } from "../permissions.js";
import type {
  SubagentSpawnOptions,
  SubagentResult,
  SubagentInfo,
  SubagentStatus,
  SubagentUsage,
  SubagentManagerInterface,
} from "./types.js";
import { agentTypeRegistry as globalAgentTypeRegistry } from "../registry/agent-types.js";

/**
 * Internal tracking state for a running subagent.
 */
interface RunningSubagent {
  info: SubagentInfo;
  promise: Promise<SubagentResult>;
  abortController: AbortController;
  agent?: Agent;
}

/**
 * Factory function type for creating child Agent instances.
 * This decouples the SubagentManager from the Agent constructor,
 * allowing different environments to provide their own agent creation logic.
 */
export type AgentFactory = (options: {
  provider: string;
  model: string;
  systemPrompt?: string;
  workingDirectory: string;
  tools?: string[];
  maxTokens?: number;
  temperature?: number;
  parentAgent: Agent;
}) => Promise<Agent>;

export interface SubagentManagerOptions {
  /**
   * Factory for creating child Agent instances.
   * If not provided, uses the parent agent's configuration to create children.
   */
  agentFactory?: AgentFactory;

  /**
   * Default max iterations for subagents (default: 100).
   */
  defaultMaxIterations?: number;

  /**
   * Default token budget for subagents (default: unlimited).
   */
  defaultTokenBudget?: number;
}

export class SubagentManager implements SubagentManagerInterface {
  private running: Map<string, RunningSubagent> = new Map();
  private completed: Map<string, SubagentInfo> = new Map();
  private agentFactory: AgentFactory;
  private defaultMaxIterations: number;
  private defaultTokenBudget?: number;

  constructor(
    private parentAgent: Agent,
    options: SubagentManagerOptions = {}
  ) {
    this.agentFactory = options.agentFactory ?? this.defaultAgentFactory.bind(this);
    this.defaultMaxIterations = options.defaultMaxIterations ?? 100;
    this.defaultTokenBudget = options.defaultTokenBudget;
  }

  /**
   * Default factory that creates a child agent using the parent's configuration.
   */
  private async defaultAgentFactory(options: {
    provider: string;
    model: string;
    systemPrompt?: string;
    workingDirectory: string;
    tools?: string[];
    parentAgent: Agent;
  }): Promise<Agent> {
    // Dynamic import to avoid circular dependency
    const { Agent: AgentClass } = await import("../agent.js");

    const parentConfig = options.parentAgent.getConfig();
    
    const child = new AgentClass(
      {
        provider: options.provider,
        model: options.model,
        auth: parentConfig.auth,
        systemPrompt: options.systemPrompt ?? parentConfig.systemPrompt,
        workingDirectory: options.workingDirectory,
        tools: options.tools ?? parentConfig.tools,
        maxTokens: parentConfig.maxTokens,
        temperature: parentConfig.temperature,
      },
      options.parentAgent.getCompactionConfig(),
      undefined, // permissions will be set separately
      undefined, // mcpClientFactory
      options.parentAgent.getSkillManager() ?? undefined,
    );

    return child;
  }

  // ============================================================================
  // Spawn
  // ============================================================================

  async spawn(
    options: SubagentSpawnOptions,
    parentSessionId: string
  ): Promise<SubagentResult | SubagentInfo> {
    const parentConfig = this.parentAgent.getConfig();
    const sessionId = `subagent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    // Resolve agent type configuration if specified
    const agentTypeReg = (this.parentAgent as unknown as { getAgentTypeRegistry?: () => typeof globalAgentTypeRegistry })
      .getAgentTypeRegistry?.() ?? globalAgentTypeRegistry;
    const agentType = options.subagentType
      ? agentTypeReg.get(options.subagentType)
      : undefined;

    // Merge agent type defaults with explicit options (explicit options win)
    const resolvedOptions: SubagentSpawnOptions = agentType
      ? {
          ...options,
          model: options.model ?? agentType.model,
          provider: options.provider ?? agentType.provider,
          systemPrompt: options.systemPrompt ?? agentType.systemPrompt,
          allowedTools: options.allowedTools ?? agentType.allowedTools,
          deniedTools: options.deniedTools ?? agentType.deniedTools,
          maxIterations: options.maxIterations ?? agentType.maxIterations,
          tokenBudget: options.tokenBudget ?? agentType.tokenBudget,
        }
      : options;

    // Build tool filter list
    const tools = this.buildToolFilter(resolvedOptions);

    // Handle worktree creation if requested
    let workingDirectory = resolvedOptions.workingDirectory ?? this.parentAgent.getWorkingDirectory();
    let worktreePath: string | undefined;

    if (resolvedOptions.worktreeBranch) {
      const worktreeManager = this.parentAgent.getExtension<{
        create: (opts: { branch: string; baseBranch?: string; createBranch?: boolean }) => Promise<{ path: string }>;
      }>("worktree.manager");

      if (worktreeManager) {
        try {
          const worktree = await worktreeManager.create({
            branch: resolvedOptions.worktreeBranch,
            baseBranch: resolvedOptions.worktreeBaseBranch,
            createBranch: true,
          });
          workingDirectory = worktree.path;
          worktreePath = worktree.path;
        } catch (err) {
          // If worktree creation fails, fall back to parent's working directory
          // but log the error
          this.emitEvent({
            type: "error",
            error: `Failed to create worktree for subagent: ${(err as Error).message}`,
          });
        }
      }
    }

    // Create child agent with resolved temperature
    const factoryOptions: Parameters<AgentFactory>[0] = {
      provider: resolvedOptions.provider ?? parentConfig.provider,
      model: resolvedOptions.model ?? parentConfig.model,
      systemPrompt: resolvedOptions.systemPrompt,
      workingDirectory,
      tools,
      parentAgent: this.parentAgent,
    };
    if (agentType?.temperature !== undefined && resolvedOptions.model === undefined) {
      factoryOptions.temperature = agentType.temperature;
    }
    const childAgent = await this.agentFactory(factoryOptions);

    // Inherit parent's permission config and session-level grants to the child.
    // This ensures that if the user already approved e.g. "bash" for the parent,
    // the subagent won't re-ask for it.
    const parentPermManager = this.parentAgent.getPermissionManager();
    const parentPermConfig = parentPermManager.getConfig();
    const parentSessionAllowed = parentPermManager.getSessionAllowed();

    // Start with the parent's config as the base
    childAgent.updatePermissionConfig({
      defaultMode: parentPermConfig.defaultMode,
      alwaysAllow: parentPermConfig.alwaysAllow,
      alwaysDeny: parentPermConfig.alwaysDeny,
      allowAll: parentPermConfig.allowAll,
    });

    // Copy session-level "allow_always" grants from the parent
    for (const toolName of parentSessionAllowed) {
      childAgent.allowToolForSession(toolName);
    }

    // Apply explicit permission overrides on top (these win over inherited)
    if (resolvedOptions.permissions) {
      childAgent.updatePermissionConfig(resolvedOptions.permissions);
    } else if (resolvedOptions.deniedTools?.length) {
      childAgent.updatePermissionConfig({
        alwaysDeny: [
          ...(parentPermConfig.alwaysDeny ?? []),
          ...resolvedOptions.deniedTools,
        ],
      });
    }

    // Set up abort controller for cancellation
    const abortController = new AbortController();

    // Create info record
    const info: SubagentInfo = {
      sessionId,
      parentSessionId,
      description: resolvedOptions.description,
      status: "running",
      startedAt: now,
    };

    // Emit start event on parent
    this.emitEvent({
      type: "subagent.start",
      sessionId,
      parentSessionId,
      description: resolvedOptions.description,
      async: resolvedOptions.async ?? false,
    });

    // Create the execution promise
    const maxIterations = resolvedOptions.maxIterations ?? this.defaultMaxIterations;
    const tokenBudget = resolvedOptions.tokenBudget ?? this.defaultTokenBudget;

    const executionPromise = this.executeSubagent(
      childAgent,
      resolvedOptions.prompt,
      sessionId,
      parentSessionId,
      resolvedOptions.description,
      abortController,
      maxIterations,
      tokenBudget
    );

    // Store running state
    const runningState: RunningSubagent = {
      info,
      promise: executionPromise,
      abortController,
      agent: childAgent,
    };
    this.running.set(sessionId, runningState);

    // Set up cleanup
    executionPromise.finally(() => {
      const state = this.running.get(sessionId);
      if (state) {
        this.completed.set(sessionId, { ...state.info });
        this.running.delete(sessionId);
      }
    });

    // Sync or async mode
    if (resolvedOptions.async) {
      return { ...info };
    }

    // Sync mode: wait for completion
    return executionPromise;
  }

  // ============================================================================
  // Execution
  // ============================================================================

  private async executeSubagent(
    agent: Agent,
    prompt: string,
    sessionId: string,
    parentSessionId: string,
    description: string,
    abortController: AbortController,
    _maxIterations: number,
    _tokenBudget?: number,
  ): Promise<SubagentResult> {
    const state = () => this.running.get(sessionId);
    
    try {
      // Forward child agent events to parent with session context
      agent.on("event", (event: AgentEvent) => {
        // Track token usage from message completions
        if (event.type === "message.complete") {
          // Usage tracking happens via the response
        }
      });

      // Install a permission callback on the child agent that forwards
      // permission requests through the parent's callback, adding subagent
      // context. This means the parent's existing infrastructure (server's
      // permissionResolvers or desktop bridge's permissionResolvers) handles
      // the actual user interaction — we just annotate the event with the
      // subagent source so the UI can show where the request came from.
      const parentPermCallback = this.parentAgent.getPermissionManager().getRequestCallback();
      if (parentPermCallback) {
        agent.setPermissionRequestCallback(async (toolCall: ToolCall) => {
          // Emit a permission request event on the parent with subagent context.
          // This lets the UI know the request came from a subagent.
          this.emitEvent({
            type: "tool.permission.request",
            messageId: "",
            toolCall,
            subagentSessionId: sessionId,
            subagentDescription: description,
          });

          // Delegate to the parent's permission callback to handle the actual
          // user interaction (creating the pending promise, storing resolver, etc.)
          const response = await parentPermCallback(toolCall);

          // If the user said "allow_always", also grant on the child's
          // permission manager so it won't ask again for this tool.
          if (response === "allow_always") {
            agent.allowToolForSession(toolCall.name);
          }

          // Emit the result event on the parent
          if (response === "allow_once" || response === "allow_always") {
            this.emitEvent({
              type: "tool.permission.granted",
              messageId: "",
              toolName: toolCall.name,
              allowAlways: response === "allow_always",
            });
          } else {
            this.emitEvent({
              type: "tool.permission.denied",
              messageId: "",
              toolName: toolCall.name,
            });
          }

          return response;
        });
      }

      // Check abort before starting
      if (abortController.signal.aborted) {
        throw new Error("Subagent cancelled before execution");
      }

      // Run the prompt
      const response = await agent.prompt(prompt);
      const content = response.content || "Task completed with no output.";

      // Update status
      const s = state();
      if (s) {
        s.info.status = "completed";
        s.info.completedAt = Date.now();
        s.info.result = content;
      }

      // Emit completion event
      this.emitEvent({
        type: "subagent.complete",
        sessionId,
        parentSessionId,
        result: content,
      });

      // Shutdown child agent
      await agent.shutdown();

      return {
        sessionId,
        parentSessionId,
        description,
        content,
        terminationReason: "completed",
      };
    } catch (err) {
      const errorMsg = (err as Error).message;
      
      // Update status
      const s = state();
      if (s) {
        s.info.status = abortController.signal.aborted ? "cancelled" : "failed";
        s.info.completedAt = Date.now();
        s.info.error = errorMsg;
      }

      // Emit error event
      this.emitEvent({
        type: "subagent.error",
        sessionId,
        parentSessionId,
        error: errorMsg,
      });

      // Try to shutdown child agent
      try {
        await agent.shutdown();
      } catch {
        // Ignore shutdown errors
      }

      const terminationReason = abortController.signal.aborted ? "cancelled" : "error";

      return {
        sessionId,
        parentSessionId,
        description,
        content: `Task failed: ${errorMsg}`,
        terminationReason,
      };
    }
  }

  // ============================================================================
  // Status & Query
  // ============================================================================

  getStatus(sessionId: string): SubagentInfo | undefined {
    const running = this.running.get(sessionId);
    if (running) {
      return { ...running.info };
    }
    const completed = this.completed.get(sessionId);
    if (completed) {
      return { ...completed };
    }
    return undefined;
  }

  getChildren(parentSessionId: string): SubagentInfo[] {
    const results: SubagentInfo[] = [];

    for (const state of this.running.values()) {
      if (state.info.parentSessionId === parentSessionId) {
        results.push({ ...state.info });
      }
    }

    for (const info of this.completed.values()) {
      if (info.parentSessionId === parentSessionId) {
        results.push({ ...info });
      }
    }

    return results.sort((a, b) => a.startedAt - b.startedAt);
  }

  // ============================================================================
  // Cancellation
  // ============================================================================

  cancel(sessionId: string): boolean {
    const state = this.running.get(sessionId);
    if (!state) {
      return false;
    }

    state.abortController.abort();
    state.info.status = "cancelled";
    state.info.completedAt = Date.now();

    // Also abort the child agent
    if (state.agent) {
      state.agent.abort();
    }

    return true;
  }

  // ============================================================================
  // Wait
  // ============================================================================

  async waitFor(sessionId: string): Promise<SubagentResult> {
    const state = this.running.get(sessionId);
    if (state) {
      return state.promise;
    }

    const completed = this.completed.get(sessionId);
    if (completed) {
      return {
        sessionId: completed.sessionId,
        parentSessionId: completed.parentSessionId,
        description: completed.description,
        content: completed.result ?? completed.error ?? "No result available",
        terminationReason: completed.status === "completed" ? "completed" : "error",
      };
    }

    throw new Error(`Unknown subagent: ${sessionId}`);
  }

  // ============================================================================
  // Running
  // ============================================================================

  getRunningIds(): string[] {
    return Array.from(this.running.keys());
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private buildToolFilter(options: SubagentSpawnOptions): string[] | undefined {
    if (options.allowedTools?.length) {
      return options.allowedTools;
    }
    // If only denied tools, we don't filter at the tool level (handled by permissions)
    return undefined;
  }

  private emitEvent(event: AgentEvent): void {
    this.parentAgent.emit("event", event);
  }
}
