import { z } from "zod";
import type { ToolDefinition, ToolContext } from "@ants/agent-core";
import type { WorktreeManager } from "../manager.js";

const WORKTREE_MANAGER_KEY = "worktree.manager";

export const worktreeSwitchTool: ToolDefinition<{
  path: string;
}> = {
  name: "worktree_switch",
  description: `Switch to an existing worktree, changing the working directory for all subsequent operations.

Use this to:
- Return to the main repository after working in a worktree
- Switch between different worktrees
- Continue work on a previously created worktree

After switching, all file operations (Read, Write, Edit, Bash, etc.) will operate in the new directory.`,
  
  parameters: z.object({
    path: z.string().describe("Path to the worktree (absolute or relative to repo root). Use worktree_list to see available paths."),
  }),

  async execute(params: { path: string }, ctx: ToolContext) {
    const manager = ctx.extensions[WORKTREE_MANAGER_KEY] as WorktreeManager | undefined;
    
    if (!manager) {
      return {
        output: "Worktree plugin not initialized. Make sure the worktree plugin is registered with the agent.",
        metadata: { error: true },
      };
    }

    try {
      const worktree = await manager.switch(params.path);

      return {
        output: JSON.stringify({
          success: true,
          message: `Switched to worktree '${worktree.branch}'`,
          worktree: {
            path: worktree.path,
            branch: worktree.branch,
            head: worktree.head?.substring(0, 8) ?? "unknown",
            isMain: worktree.isMain,
          },
        }, null, 2),
      };
    } catch (error) {
      return {
        output: `Failed to switch worktree: ${(error as Error).message}`,
        metadata: { error: true },
      };
    }
  },
};
