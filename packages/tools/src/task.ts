/**
 * Task tool - Spawns subagents to handle delegated tasks.
 * 
 * This is the primary interface for the LLM to delegate work to subagents.
 * Supports both synchronous (blocking) and asynchronous (fire-and-forget) modes.
 */

import { z } from "zod";
import type { ToolDefinition, ToolContext } from "@openmgr/agent-core";
import type { SubagentManagerInterface } from "@openmgr/agent-core";
import { agentTypeRegistry as globalAgentTypeRegistry } from "@openmgr/agent-core";

const BASE_DESCRIPTION = `Launch a new agent to handle complex, multistep tasks autonomously.

Both "description" and "prompt" are REQUIRED parameters and must always be provided.

Use this tool when:
- A task is complex and would benefit from focused, independent attention
- You want to delegate work while continuing with other tasks
- The task is self-contained and doesn't need back-and-forth with the user
- You need to run multiple tasks in parallel

The subagent will:
1. Work independently on the given task
2. Have access to tools (configurable via allowedTools/deniedTools)
3. Return a summary of what it accomplished

Configuration options:
- Set subagent_type to use a predefined agent configuration (recommended)
- Set async=true to run in background (returns immediately with session ID)
- Set model/provider to use a different LLM (e.g., cheaper model for simple tasks)
- Set allowedTools to restrict which tools the subagent can use
- Set deniedTools to block specific tools
- Set tokenBudget to limit cost
- Set workingDirectory to run in a different directory`;

/**
 * Build the full task tool description, including dynamically
 * listing all registered agent types.
 */
function getDescription(): string {
  // Uses the global registry for the description getter since ToolDefinition.description
  // is evaluated without access to a specific Agent instance. The global registry
  // is the same object as the Agent's instance registry by default.
  const agentTypeSection = globalAgentTypeRegistry.generateTaskToolDescription();
  return BASE_DESCRIPTION + agentTypeSection;
}

export const taskTool: ToolDefinition = {
  name: "task",
  get description() {
    return getDescription();
  },
  requiredCapabilities: ["subagent"],
  parameters: z.object({
    description: z
      .string()
      .describe("REQUIRED. A short (3-5 words) description of the task, used as the display label in the UI"),
    prompt: z
      .string()
      .describe("REQUIRED. The detailed task for the subagent to perform"),
    subagent_type: z
      .string()
      .optional()
      .describe("The type of subagent to use (for routing to specialized agents)"),
    async: z
      .boolean()
      .optional()
      .default(false)
      .describe("If true, run in background and return session ID immediately"),
    model: z
      .string()
      .optional()
      .describe("Override the model for this subagent (e.g., 'claude-haiku-4-20250514' for simple tasks)"),
    provider: z
      .string()
      .optional()
      .describe("Override the provider for this subagent"),
    workingDirectory: z
      .string()
      .optional()
      .describe("Override the working directory for this subagent"),
    allowedTools: z
      .array(z.string())
      .optional()
      .describe("Only allow these tools (e.g., ['read', 'glob', 'grep'] for read-only tasks)"),
    deniedTools: z
      .array(z.string())
      .optional()
      .describe("Block these tools (e.g., ['bash', 'write', 'edit'] for safe exploration)"),
    maxIterations: z
      .number()
      .optional()
      .describe("Maximum agent loop iterations before the subagent is terminated"),
    tokenBudget: z
      .number()
      .optional()
      .describe("Maximum total tokens (prompt + completion) the subagent can use"),
    worktreeBranch: z
      .string()
      .optional()
      .describe("Create a git worktree on this branch for isolated file changes"),
    worktreeBaseBranch: z
      .string()
      .optional()
      .describe("Base branch for the worktree (defaults to HEAD)"),
  }),
  async execute(params, ctx: ToolContext) {
    const {
      description,
      prompt,
      subagent_type: subagentType,
      async: runAsync,
      model,
      provider,
      workingDirectory,
      allowedTools,
      deniedTools,
      maxIterations,
      tokenBudget,
      worktreeBranch,
      worktreeBaseBranch,
    } = params as {
      description: string;
      prompt: string;
      subagent_type?: string;
      async: boolean;
      model?: string;
      provider?: string;
      workingDirectory?: string;
      allowedTools?: string[];
      deniedTools?: string[];
      maxIterations?: number;
      tokenBudget?: number;
      worktreeBranch?: string;
      worktreeBaseBranch?: string;
    };

    const parentSessionId = ctx.sessionId;
    const subagentManager = ctx.extensions?.subagentManager as SubagentManagerInterface | undefined;

    if (!subagentManager) {
      return {
        output: "Task tool requires SubagentManager. Ensure the subagent plugin is configured.",
        metadata: { error: true, description },
      };
    }

    if (!parentSessionId) {
      return {
        output: "Task tool requires a parent session ID. Cannot spawn subagent.",
        metadata: { error: true, description },
      };
    }

    try {
      const result = await subagentManager.spawn(
        {
          description,
          prompt,
          subagentType,
          async: runAsync,
          model,
          provider,
          workingDirectory,
          allowedTools,
          deniedTools,
          maxIterations,
          tokenBudget,
          worktreeBranch,
          worktreeBaseBranch,
        },
        parentSessionId
      );

      if (runAsync) {
        // Async mode: return info about the started subagent
        return {
          output: [
            `Subagent started in background.`,
            "",
            "<task_metadata>",
            `task_id: ${result.sessionId}`,
            `parent_session_id: ${parentSessionId}`,
            `description: ${description}`,
            `async: true`,
            "</task_metadata>",
            "",
            `Use the task_status tool with task_id "${result.sessionId}" to check on progress.`,
          ].join("\n"),
          metadata: {
            sessionId: result.sessionId,
            parentSessionId,
            description,
            async: true,
          },
        };
      }

      // Sync mode: return the result
      const syncResult = result as { sessionId: string; content: string; usage?: { totalTokens: number }; terminationReason?: string };
      return {
        output: [
          syncResult.content,
          "",
          "<task_metadata>",
          `task_id: ${syncResult.sessionId}`,
          `parent_session_id: ${parentSessionId}`,
          `description: ${description}`,
          ...(syncResult.usage ? [`tokens_used: ${syncResult.usage.totalTokens}`] : []),
          ...(syncResult.terminationReason && syncResult.terminationReason !== "completed"
            ? [`termination_reason: ${syncResult.terminationReason}`]
            : []),
          "</task_metadata>",
        ].join("\n"),
        metadata: {
          sessionId: syncResult.sessionId,
          parentSessionId,
          description,
          usage: syncResult.usage,
          terminationReason: syncResult.terminationReason,
        },
      };
    } catch (err) {
      return {
        output: `Task failed: ${(err as Error).message}`,
        metadata: { error: true, description },
      };
    }
  },
};
