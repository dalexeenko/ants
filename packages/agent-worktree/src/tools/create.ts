import { z } from "zod";
import type { ToolDefinition, ToolContext } from "@ants/agent-core";
import type { WorktreeManager } from "../manager.js";

const WORKTREE_MANAGER_KEY = "worktree.manager";

export const worktreeCreateTool: ToolDefinition<{
  branch: string;
  baseBranch?: string;
  createBranch?: boolean;
}> = {
  name: "worktree_create",
  description: `Create a git worktree for isolated branch work. Creates the worktree in .worktrees/{repo}-{branch}/ and switches to it.

This tool:
1. Ensures .worktrees is in .gitignore
2. Creates a new worktree directory
3. Checks out or creates the specified branch
4. Switches the working directory to the new worktree

Use this when you need to:
- Work on a feature branch without affecting your current work
- Test changes in isolation
- Work on multiple branches simultaneously`,
  
  parameters: z.object({
    branch: z.string().describe("Branch name to checkout or create"),
    baseBranch: z.string().optional().describe("Base branch for new branches (defaults to current branch/HEAD)"),
    createBranch: z.boolean().optional().default(true).describe("Create the branch if it doesn't exist"),
  }),

  async execute(params, ctx: ToolContext) {
    const manager = ctx.extensions[WORKTREE_MANAGER_KEY] as WorktreeManager | undefined;
    
    if (!manager) {
      return {
        output: "Worktree plugin not initialized. Make sure the worktree plugin is registered with the agent.",
        metadata: { error: true },
      };
    }

    try {
      // Create the worktree
      const worktree = await manager.create({
        branch: params.branch,
        baseBranch: params.baseBranch,
        createBranch: params.createBranch ?? true,
      });

      // Switch to the new worktree
      await manager.switch(worktree.path);

      return {
        output: JSON.stringify({
          success: true,
          message: `Created and switched to worktree for branch '${params.branch}'`,
          worktree: {
            path: worktree.path,
            branch: worktree.branch,
            head: worktree.head,
          },
          gitignore: "Ensured .worktrees/ is in .gitignore",
        }, null, 2),
      };
    } catch (error) {
      return {
        output: `Failed to create worktree: ${(error as Error).message}`,
        metadata: { error: true },
      };
    }
  },
};
