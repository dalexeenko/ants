import { z } from "zod";
import type { ToolDefinition, ToolContext } from "@openmgr/agent-core";
import type { WorktreeManager } from "../manager.js";

const WORKTREE_MANAGER_KEY = "worktree.manager";

export const worktreeRemoveTool: ToolDefinition<{
  path: string;
  force?: boolean;
}> = {
  name: "worktree_remove",
  description: `Remove a git worktree. Does not delete the associated session or branch.

Use this to clean up worktrees that are no longer needed.

Notes:
- Cannot remove the main worktree (the original repository)
- Cannot remove the worktree you're currently in (switch first)
- Use force=true to remove worktrees with uncommitted changes`,
  
  parameters: z.object({
    path: z.string().describe("Path to the worktree to remove. Use worktree_list to see available paths."),
    force: z.boolean().optional().describe("Force removal even with uncommitted changes"),
  }),

  async execute(params: { path: string; force?: boolean }, ctx: ToolContext) {
    const manager = ctx.extensions[WORKTREE_MANAGER_KEY] as WorktreeManager | undefined;
    
    if (!manager) {
      return {
        output: "Worktree plugin not initialized. Make sure the worktree plugin is registered with the agent.",
        metadata: { error: true },
      };
    }

    try {
      await manager.remove(params.path, { force: params.force });

      return {
        output: JSON.stringify({
          success: true,
          message: `Removed worktree at '${params.path}'`,
          note: "The branch and any associated session were not deleted.",
        }, null, 2),
      };
    } catch (error) {
      return {
        output: `Failed to remove worktree: ${(error as Error).message}`,
        metadata: { error: true },
      };
    }
  },
};
