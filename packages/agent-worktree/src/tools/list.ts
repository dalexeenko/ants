import { z } from "zod";
import type { ToolDefinition, ToolContext } from "@ants/agent-core";
import type { WorktreeManager } from "../manager.js";

const WORKTREE_MANAGER_KEY = "worktree.manager";

export const worktreeListTool: ToolDefinition<Record<string, never>> = {
  name: "worktree_list",
  description: `List all git worktrees for the current repository.

Shows:
- Path to each worktree
- Branch checked out in each
- Current HEAD commit
- Which is the main worktree
- Which worktree you're currently in`,
  
  parameters: z.object({}),

  async execute(_params: Record<string, never>, ctx: ToolContext) {
    const manager = ctx.extensions[WORKTREE_MANAGER_KEY] as WorktreeManager | undefined;
    
    if (!manager) {
      return {
        output: "Worktree plugin not initialized. Make sure the worktree plugin is registered with the agent.",
        metadata: { error: true },
      };
    }

    try {
      const worktrees = await manager.list();
      const current = await manager.current();

      const formatted = worktrees.map(wt => ({
        path: wt.path,
        branch: wt.branch,
        head: wt.head?.substring(0, 8) ?? "unknown",
        isMain: wt.isMain,
        isCurrent: current?.path === wt.path,
      }));

      return {
        output: JSON.stringify({
          worktrees: formatted,
          count: worktrees.length,
          currentWorktree: current?.path ?? null,
        }, null, 2),
      };
    } catch (error) {
      return {
        output: `Failed to list worktrees: ${(error as Error).message}`,
        metadata: { error: true },
      };
    }
  },
};
