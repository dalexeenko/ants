/**
 * Task Cancel tool - Cancel a running subagent.
 */

import { z } from "zod";
import type { ToolDefinition, ToolContext } from "@openmgr/agent-core";
import type { SubagentManagerInterface } from "@openmgr/agent-core";

const DESCRIPTION = `Cancel a running subagent task.

Use this tool when:
- A subagent is taking too long
- You no longer need the result of an async subagent
- A subagent appears to be stuck

The subagent will be aborted and its resources cleaned up.`;

export const taskCancelTool: ToolDefinition = {
  name: "task_cancel",
  description: DESCRIPTION,
  requiredCapabilities: ["subagent"],
  parameters: z.object({
    task_id: z
      .string()
      .describe("The task/session ID of the subagent to cancel"),
  }),
  async execute(params, ctx: ToolContext) {
    const { task_id: taskId } = params as { task_id: string };

    const subagentManager = ctx.extensions?.subagentManager as SubagentManagerInterface | undefined;

    if (!subagentManager) {
      return {
        output: "Task cancel tool requires SubagentManager. Ensure the subagent plugin is configured.",
        metadata: { error: true },
      };
    }

    const info = subagentManager.getStatus(taskId);
    if (!info) {
      return {
        output: `No subagent found with task_id: ${taskId}`,
        metadata: { error: true, taskId },
      };
    }

    if (info.status !== "running") {
      return {
        output: `Subagent "${info.description}" is already ${info.status}. Cannot cancel.`,
        metadata: { taskId, status: info.status },
      };
    }

    const cancelled = subagentManager.cancel(taskId);

    if (cancelled) {
      return {
        output: `Subagent "${info.description}" (${taskId}) has been cancelled.`,
        metadata: { taskId, status: "cancelled" },
      };
    }

    return {
      output: `Failed to cancel subagent "${info.description}" (${taskId}).`,
      metadata: { error: true, taskId },
    };
  },
};
