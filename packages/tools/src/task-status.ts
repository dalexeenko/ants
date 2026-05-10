/**
 * Task Status tool - Check the status of running or completed subagents.
 */

import { z } from "zod";
import type { ToolDefinition, ToolContext } from "@ants/agent-core";
import type { SubagentManagerInterface } from "@ants/agent-core";

const DESCRIPTION = `Check the status of a subagent task.

Use this tool to:
- Check if an async subagent has completed
- Get the result of a completed subagent
- See all subagents spawned in this session
- Wait for a specific subagent to finish

Pass a task_id to check a specific subagent, or omit it to list all subagents for the current session.`;

export const taskStatusTool: ToolDefinition = {
  name: "task_status",
  description: DESCRIPTION,
  requiredCapabilities: ["subagent"],
  parameters: z.object({
    task_id: z
      .string()
      .optional()
      .describe("The task/session ID to check. Omit to list all subagents."),
    wait: z
      .boolean()
      .optional()
      .default(false)
      .describe("If true, block until the subagent completes and return its result"),
  }),
  async execute(params, ctx: ToolContext) {
    const { task_id: taskId, wait: shouldWait } = params as {
      task_id?: string;
      wait: boolean;
    };

    const subagentManager = ctx.extensions?.subagentManager as SubagentManagerInterface | undefined;

    if (!subagentManager) {
      return {
        output: "Task status tool requires SubagentManager. Ensure the subagent plugin is configured.",
        metadata: { error: true },
      };
    }

    // If a specific task ID is provided
    if (taskId) {
      // If wait mode, block until completion
      if (shouldWait) {
        try {
          const result = await subagentManager.waitFor(taskId);
          return {
            output: [
              `Task "${result.description}" completed.`,
              "",
              result.content,
              "",
              "<task_metadata>",
              `task_id: ${result.sessionId}`,
              `status: completed`,
              ...(result.usage ? [`tokens_used: ${result.usage.totalTokens}`] : []),
              ...(result.terminationReason && result.terminationReason !== "completed"
                ? [`termination_reason: ${result.terminationReason}`]
                : []),
              "</task_metadata>",
            ].join("\n"),
            metadata: {
              sessionId: result.sessionId,
              status: "completed",
              usage: result.usage,
            },
          };
        } catch (err) {
          return {
            output: `Failed to wait for task: ${(err as Error).message}`,
            metadata: { error: true, taskId },
          };
        }
      }

      // Just get status
      const info = subagentManager.getStatus(taskId);
      if (!info) {
        return {
          output: `No subagent found with task_id: ${taskId}`,
          metadata: { error: true, taskId },
        };
      }

      const lines = [
        `Task: ${info.description}`,
        `Status: ${info.status}`,
        `Started: ${new Date(info.startedAt).toISOString()}`,
      ];

      if (info.completedAt) {
        lines.push(`Completed: ${new Date(info.completedAt).toISOString()}`);
        const durationMs = info.completedAt - info.startedAt;
        lines.push(`Duration: ${(durationMs / 1000).toFixed(1)}s`);
      }

      if (info.usage) {
        lines.push(`Tokens used: ${info.usage.totalTokens}`);
      }

      if (info.result) {
        lines.push("", "Result:", info.result);
      }

      if (info.error) {
        lines.push("", "Error:", info.error);
      }

      return {
        output: lines.join("\n"),
        metadata: {
          sessionId: info.sessionId,
          status: info.status,
          usage: info.usage,
        },
      };
    }

    // No task ID: list all subagents for this session
    const parentSessionId = ctx.sessionId;
    if (!parentSessionId) {
      return {
        output: "No session context available.",
        metadata: { error: true },
      };
    }

    const children = subagentManager.getChildren(parentSessionId);
    const runningIds = subagentManager.getRunningIds();

    if (children.length === 0) {
      return {
        output: "No subagents have been spawned in this session.",
        metadata: { count: 0 },
      };
    }

    const lines = [`Subagents (${children.length} total, ${runningIds.length} running):`, ""];

    for (const child of children) {
      const status = child.status === "running" ? "RUNNING" : child.status.toUpperCase();
      const duration = child.completedAt
        ? `${((child.completedAt - child.startedAt) / 1000).toFixed(1)}s`
        : `${((Date.now() - child.startedAt) / 1000).toFixed(1)}s (running)`;

      lines.push(`  [${status}] ${child.description} (${child.sessionId})`);
      lines.push(`    Duration: ${duration}`);

      if (child.usage) {
        lines.push(`    Tokens: ${child.usage.totalTokens}`);
      }

      if (child.error) {
        lines.push(`    Error: ${child.error}`);
      }

      lines.push("");
    }

    return {
      output: lines.join("\n"),
      metadata: {
        count: children.length,
        running: runningIds.length,
      },
    };
  },
};
