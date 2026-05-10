import type { AgentInterface } from "@openmgr/agent-core";
import type { SessionManager } from "@openmgr/agent-storage";
import { ProjectWorktreeManager } from "./project-worktree-manager.js";
import type {
  WorktreeInfo,
  WorktreeCreateOptions,
  WorktreeRemoveOptions,
  CommandExecutor,
  WorktreeFilesystem,
  WorktreeLogger,
} from "./types.js";

/**
 * Agent-aware worktree manager.
 *
 * Wraps ProjectWorktreeManager with agent integration:
 * - Uses agent.getWorkingDirectory() as the default project directory
 * - Updates agent working directory on switch
 * - Updates session working directory on switch
 *
 * For server/desktop use without agent dependencies, use
 * ProjectWorktreeManager directly.
 */
export class WorktreeManager {
  private projectManager: ProjectWorktreeManager;

  constructor(
    private getAgent: () => AgentInterface,
    private getSessionManager: () => SessionManager | undefined,
    private filesystem: WorktreeFilesystem,
    executor: CommandExecutor,
    logger?: WorktreeLogger,
  ) {
    this.projectManager = new ProjectWorktreeManager(executor, filesystem, logger);
  }

  /**
   * Get the underlying ProjectWorktreeManager for advanced usage.
   */
  getProjectManager(): ProjectWorktreeManager {
    return this.projectManager;
  }

  /**
   * Get the git repository root directory.
   */
  async getRepoRoot(): Promise<string> {
    const cwd = this.getAgent().getWorkingDirectory();
    return this.projectManager.getRepoRoot(cwd);
  }

  /**
   * Get the repository name from the repo root.
   */
  async getRepoName(): Promise<string> {
    const repoRoot = await this.getRepoRoot();
    return this.filesystem.basename(repoRoot);
  }

  /**
   * Check if currently in a worktree (not the main repo).
   */
  async isInWorktree(): Promise<boolean> {
    const cwd = this.getAgent().getWorkingDirectory();
    const result = await this.projectManager["executor"].exec(
      "git rev-parse --git-common-dir",
      cwd,
    );

    if (result.exitCode !== 0) {
      return false;
    }

    const gitCommonDir = result.stdout.trim();
    return gitCommonDir !== ".git" && !gitCommonDir.endsWith("/.git");
  }

  /**
   * Ensure .worktrees is in .gitignore.
   */
  async ensureGitignore(): Promise<{ added: boolean; message: string }> {
    const cwd = this.getAgent().getWorkingDirectory();
    return this.projectManager.ensureGitignore(cwd);
  }

  /**
   * Create a new worktree.
   */
  async create(options: WorktreeCreateOptions): Promise<WorktreeInfo> {
    const repoRoot = await this.getRepoRoot();
    return this.projectManager.createWorktree(repoRoot, options);
  }

  /**
   * List all worktrees for the current repository.
   */
  async list(): Promise<WorktreeInfo[]> {
    const repoRoot = await this.getRepoRoot();
    return this.projectManager.listWorktrees(repoRoot);
  }

  /**
   * Switch the agent's working directory to a worktree.
   */
  async switch(worktreePath: string): Promise<WorktreeInfo> {
    const repoRoot = await this.getRepoRoot();

    // Resolve path if relative
    const absolutePath = worktreePath.startsWith("/")
      ? worktreePath
      : this.filesystem.resolve(repoRoot, worktreePath);

    // Find the worktree
    const worktrees = await this.list();
    const worktree = worktrees.find((w) => w.path === absolutePath);

    if (!worktree) {
      throw new Error(`Not a valid worktree: ${absolutePath}`);
    }

    // Update agent's working directory
    const agent = this.getAgent();
    agent.setWorkingDirectory(absolutePath);

    // Update session if available
    const sessionManager = this.getSessionManager();
    if (sessionManager) {
      const sessionContext = (
        agent as unknown as {
          getSessionContext(): { sessionId: string } | null;
        }
      ).getSessionContext?.();
      if (sessionContext?.sessionId) {
        await sessionManager.updateSession(sessionContext.sessionId, {
          workingDirectory: absolutePath,
        });
      }
    }

    return worktree;
  }

  /**
   * Remove a worktree.
   */
  async remove(
    worktreePath: string,
    options: WorktreeRemoveOptions = {},
  ): Promise<void> {
    const cwd = this.getAgent().getWorkingDirectory();
    const repoRoot = await this.getRepoRoot();

    // Resolve path if relative
    const absolutePath = worktreePath.startsWith("/")
      ? worktreePath
      : this.filesystem.resolve(repoRoot, worktreePath);

    // Find the worktree by path to get its ID
    const worktrees = await this.list();
    const worktree = worktrees.find((w) => w.path === absolutePath);

    if (!worktree) {
      throw new Error(`Not a valid worktree: ${absolutePath}`);
    }

    if (worktree.isMain) {
      throw new Error("Cannot remove the main worktree");
    }

    // Check if we're currently in this worktree
    if (
      cwd === absolutePath ||
      cwd.startsWith(absolutePath + "/")
    ) {
      throw new Error(
        "Cannot remove the worktree you are currently in. Switch to another worktree first.",
      );
    }

    await this.projectManager.removeWorktree(
      await this.getRepoRoot(),
      worktree.id,
      options,
    );
  }

  /**
   * Get information about the current worktree (if in one).
   */
  async current(): Promise<WorktreeInfo | null> {
    const currentDir = this.getAgent().getWorkingDirectory();
    const worktrees = await this.list();

    let best: WorktreeInfo | null = null;
    for (const w of worktrees) {
      if (currentDir === w.path || currentDir.startsWith(w.path + "/")) {
        if (!best || w.path.length > best.path.length) {
          best = w;
        }
      }
    }
    return best;
  }
}
