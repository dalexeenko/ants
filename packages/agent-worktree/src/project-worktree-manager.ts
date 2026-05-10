/**
 * ProjectWorktreeManager — standalone git worktree management.
 *
 * This is the core worktree manager that works with projectDir as a parameter.
 * It has NO agent or session manager dependency, making it usable from the
 * server, desktop, or agent contexts.
 *
 * Features:
 * - Create/list/remove worktrees
 * - JSON metadata persistence (.worktrees/metadata.json)
 * - Session association
 * - Diff between worktree branch and base branch
 * - Merge worktree branch back into base
 * - Discard worktree (remove without merging)
 * - Rename worktree branch
 * - Default branch detection
 * - System prompt generation for agents
 * - .gitignore management
 */

import type {
  WorktreeInfo,
  WorktreeCreateOptions,
  WorktreeRemoveOptions,
  DiffFile,
  DiffResult,
  WorktreeOperationResult,
  WorktreeMetadata,
  WorktreeMetadataEntry,
  CommandExecutor,
  WorktreeFilesystem,
  WorktreeLogger,
  WorktreeLifecycleHooks,
} from "./types.js";

const WORKTREES_DIR = ".worktrees";
const METADATA_FILE = "metadata.json";
const BRANCH_PREFIX = "ants/session-";

/** No-op logger */
const nullLogger: WorktreeLogger = {
  info() {},
  debug() {},
  warn() {},
  error() {},
};

export class ProjectWorktreeManager {
  private executor: CommandExecutor;
  private filesystem: WorktreeFilesystem;
  private log: WorktreeLogger;
  private hooks: WorktreeLifecycleHooks;

  constructor(
    executor: CommandExecutor,
    filesystem: WorktreeFilesystem,
    logger?: WorktreeLogger,
    hooks?: WorktreeLifecycleHooks,
  ) {
    this.executor = executor;
    this.filesystem = filesystem;
    this.log = logger ?? nullLogger;
    this.hooks = hooks ?? {};
  }

  /**
   * Set or replace lifecycle hooks.
   * This allows wiring up Docker or other integrations after construction.
   */
  setHooks(hooks: WorktreeLifecycleHooks): void {
    this.hooks = hooks;
  }

  // ─── Git helpers ──────────────────────────────────────────────────

  /**
   * Execute a git command and return stdout. Throws on failure.
   */
  private async execGit(args: string, cwd: string): Promise<string> {
    const result = await this.executor.exec(`git ${args}`, cwd);
    if (result.exitCode !== 0) {
      throw new Error(`git ${args} failed: ${result.stderr}`);
    }
    return result.stdout.trim();
  }

  /**
   * Execute a git command, returning null on failure.
   */
  private async execGitSafe(args: string, cwd: string): Promise<string | null> {
    try {
      return await this.execGit(args, cwd);
    } catch {
      return null;
    }
  }

  // ─── Repository queries ───────────────────────────────────────────

  /**
   * Check if a directory is a git repository.
   */
  async isGitRepo(projectDir: string): Promise<boolean> {
    const result = await this.execGitSafe("rev-parse --git-dir", projectDir);
    return result !== null;
  }

  /**
   * Get the git repository root directory.
   */
  async getRepoRoot(projectDir: string): Promise<string> {
    const root = await this.execGit("rev-parse --show-toplevel", projectDir);
    return root;
  }

  /**
   * Get the current branch name.
   */
  async getCurrentBranch(projectDir: string): Promise<string> {
    return this.execGit("rev-parse --abbrev-ref HEAD", projectDir);
  }

  /**
   * Get the default branch (main or master).
   */
  async getDefaultBranch(projectDir: string): Promise<string> {
    // Try remote HEAD
    try {
      const refs = await this.execGit(
        "symbolic-ref refs/remotes/origin/HEAD",
        projectDir,
      );
      return refs.replace("refs/remotes/origin/", "");
    } catch {
      // Fall back to main/master detection
    }

    if (await this.branchExists(projectDir, "main")) return "main";
    if (await this.branchExists(projectDir, "master")) return "master";

    // Ultimate fallback: current branch
    return this.getCurrentBranch(projectDir);
  }

  /**
   * Check if a branch exists.
   */
  async branchExists(projectDir: string, branchName: string): Promise<boolean> {
    const result = await this.execGitSafe(
      `show-ref --verify --quiet refs/heads/${branchName}`,
      projectDir,
    );
    return result !== null;
  }

  /**
   * Sanitize a string to be used as a git branch name.
   */
  sanitizeBranchName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);
  }

  // ─── Metadata persistence ─────────────────────────────────────────

  private metadataPath(projectDir: string): string {
    return this.filesystem.join(projectDir, WORKTREES_DIR, METADATA_FILE);
  }

  private async ensureWorktreesDir(projectDir: string): Promise<string> {
    const dir = this.filesystem.join(projectDir, WORKTREES_DIR);
    await this.filesystem.mkdir(dir, { recursive: true });
    return dir;
  }

  private async readMetadata(projectDir: string): Promise<WorktreeMetadata> {
    const path = this.metadataPath(projectDir);
    try {
      if (!(await this.filesystem.exists(path))) {
        return { version: 1, worktrees: [] };
      }
      const content = await this.filesystem.readFile(path);
      return JSON.parse(content) as WorktreeMetadata;
    } catch {
      return { version: 1, worktrees: [] };
    }
  }

  private async writeMetadata(
    projectDir: string,
    metadata: WorktreeMetadata,
  ): Promise<void> {
    await this.ensureWorktreesDir(projectDir);
    const path = this.metadataPath(projectDir);
    await this.filesystem.writeFile(path, JSON.stringify(metadata, null, 2));
  }

  private entryToInfo(entry: WorktreeMetadataEntry): WorktreeInfo {
    return {
      id: entry.id,
      path: entry.path,
      branch: entry.branchName,
      baseBranch: entry.baseBranch,
      head: "", // Will be populated by git query if needed
      isMain: false,
      sessionId: entry.sessionId,
      createdAt: new Date(entry.createdAt),
      updatedAt: new Date(entry.updatedAt),
    };
  }

  // ─── .gitignore management ────────────────────────────────────────

  /**
   * Ensure .worktrees is in .gitignore.
   */
  async ensureGitignore(projectDir: string): Promise<{ added: boolean; message: string }> {
    const repoRoot = await this.getRepoRoot(projectDir);
    const gitignorePath = this.filesystem.join(repoRoot, ".gitignore");

    let content = "";
    let exists = false;

    try {
      if (await this.filesystem.exists(gitignorePath)) {
        content = await this.filesystem.readFile(gitignorePath);
        exists = true;
      }
    } catch {
      // File doesn't exist
    }

    const lines = content.split("\n").map((line) => line.trim());
    if (lines.includes(".worktrees") || lines.includes(".worktrees/")) {
      return { added: false, message: ".worktrees already in .gitignore" };
    }

    const newContent = content.trim()
      ? `${content.trim()}\n\n# Git worktrees managed by ants agent\n.worktrees/\n`
      : "# Git worktrees managed by ants agent\n.worktrees/\n";

    await this.filesystem.writeFile(gitignorePath, newContent);

    return {
      added: true,
      message: exists
        ? "Added .worktrees/ to .gitignore"
        : "Created .gitignore with .worktrees/",
    };
  }

  // ─── Worktree CRUD ────────────────────────────────────────────────

  /**
   * Generate a UUID-like ID.
   * Simple implementation that doesn't require external deps.
   */
  private generateId(): string {
    const hex = () => Math.random().toString(16).substring(2, 10);
    return `${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`.substring(0, 36);
  }

  /**
   * Create a new worktree for a project.
   *
   * If options.branch is not provided, generates an ants/session-{uuid} branch.
   */
  async createWorktree(
    projectDir: string,
    options: Partial<WorktreeCreateOptions> = {},
  ): Promise<WorktreeInfo> {
    if (!(await this.isGitRepo(projectDir))) {
      throw new Error("Not a git repository");
    }

    const id = this.generateId();
    const baseBranch = options.baseBranch ?? await this.getDefaultBranch(projectDir);
    const branch = options.branch ?? `${BRANCH_PREFIX}${id}`;
    const worktreePath =
      options.path ??
      this.filesystem.join(projectDir, WORKTREES_DIR, id);

    // Ensure .worktrees is in .gitignore
    await this.ensureGitignore(projectDir);

    // Create the worktree with a new branch
    const createBranch = options.createBranch !== false;
    if (createBranch) {
      const exists = await this.branchExists(projectDir, branch);
      if (exists) {
        await this.execGit(
          `worktree add "${worktreePath}" "${branch}"`,
          projectDir,
        );
      } else {
        await this.execGit(
          `worktree add -b "${branch}" "${worktreePath}" "${baseBranch}"`,
          projectDir,
        );
      }
    } else {
      await this.execGit(
        `worktree add "${worktreePath}" "${branch}"`,
        projectDir,
      );
    }

    // Enable receive-pack so pushes to this worktree work
    await this.execGitSafe(
      "config receive.denyCurrentBranch updateInstead",
      worktreePath,
    );

    // Get HEAD commit
    const head = await this.execGitSafe("rev-parse HEAD", worktreePath) ?? "";

    const now = new Date();
    const info: WorktreeInfo = {
      id,
      path: worktreePath,
      branch,
      baseBranch,
      head,
      isMain: false,
      sessionId: options.sessionId,
      createdAt: now,
      updatedAt: now,
    };

    // Persist metadata
    const metadata = await this.readMetadata(projectDir);
    metadata.worktrees.push({
      id,
      sessionId: options.sessionId,
      path: worktreePath,
      branchName: branch,
      baseBranch,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    await this.writeMetadata(projectDir, metadata);

    this.log.info(
      `Created worktree ${id}: branch=${branch} path=${worktreePath}`,
    );

    // Invoke lifecycle hook (errors are logged, not thrown)
    if (this.hooks.onWorktreeCreated) {
      try {
        await this.hooks.onWorktreeCreated(projectDir, info);
      } catch (e) {
        this.log.warn(
          `onWorktreeCreated hook failed for ${id}:`,
          String(e),
        );
      }
    }

    return info;
  }

  /**
   * List all worktrees for a project.
   * Validates against both git and metadata, cleaning up stale entries.
   */
  async listWorktrees(projectDir: string): Promise<WorktreeInfo[]> {
    const metadata = await this.readMetadata(projectDir);
    const validWorktrees: WorktreeInfo[] = [];
    let needsCleanup = false;

    for (const entry of metadata.worktrees) {
      try {
        if (await this.filesystem.exists(entry.path)) {
          const info = this.entryToInfo(entry);
          // Try to get current HEAD
          info.head =
            (await this.execGitSafe("rev-parse HEAD", entry.path)) ?? "";
          validWorktrees.push(info);
        } else {
          needsCleanup = true;
        }
      } catch {
        needsCleanup = true;
      }
    }

    if (needsCleanup) {
      const validIds = new Set(validWorktrees.map((w) => w.id));
      metadata.worktrees = metadata.worktrees.filter((e) => validIds.has(e.id));
      await this.writeMetadata(projectDir, metadata);
      // Prune stale git worktree references
      await this.execGitSafe("worktree prune", projectDir);
    }

    return validWorktrees;
  }

  /**
   * Get a specific worktree by ID.
   */
  async getWorktree(
    projectDir: string,
    worktreeId: string,
  ): Promise<WorktreeInfo | null> {
    const worktrees = await this.listWorktrees(projectDir);
    return worktrees.find((w) => w.id === worktreeId) ?? null;
  }

  /**
   * Get a worktree by its associated session ID.
   */
  async getWorktreeBySession(
    projectDir: string,
    sessionId: string,
  ): Promise<WorktreeInfo | null> {
    const worktrees = await this.listWorktrees(projectDir);
    return worktrees.find((w) => w.sessionId === sessionId) ?? null;
  }

  /**
   * Associate a session with a worktree.
   */
  async associateSession(
    projectDir: string,
    worktreeId: string,
    sessionId: string,
  ): Promise<void> {
    const metadata = await this.readMetadata(projectDir);
    const entry = metadata.worktrees.find((e) => e.id === worktreeId);
    if (!entry) {
      throw new Error("Worktree not found");
    }
    entry.sessionId = sessionId;
    entry.updatedAt = new Date().toISOString();
    await this.writeMetadata(projectDir, metadata);
  }

  /**
   * Remove a worktree and optionally its branch.
   */
  async removeWorktree(
    projectDir: string,
    worktreeId: string,
    options: WorktreeRemoveOptions = {},
  ): Promise<void> {
    const worktree = await this.getWorktree(projectDir, worktreeId);
    if (!worktree) {
      throw new Error("Worktree not found");
    }

    // Invoke pre-removal hook (e.g., stop Docker container)
    if (this.hooks.onWorktreeRemoving) {
      try {
        await this.hooks.onWorktreeRemoving(projectDir, worktree);
      } catch (e) {
        this.log.warn(
          `onWorktreeRemoving hook failed for ${worktreeId}:`,
          String(e),
        );
      }
    }

    // Try git worktree remove first
    try {
      const forceFlag = options.force ? "--force " : "";
      await this.execGit(
        `worktree remove ${forceFlag}"${worktree.path}"`,
        projectDir,
      );
    } catch {
      // Fall back to manual cleanup
      this.log.warn(
        `git worktree remove failed for ${worktreeId}, trying manual cleanup`,
      );
      try {
        await this.filesystem.rm(worktree.path, {
          recursive: true,
          force: true,
        });
        await this.execGitSafe("worktree prune", projectDir);
      } catch (e2) {
        this.log.error("Manual cleanup also failed:", String(e2));
      }
    }

    // Delete the branch if requested
    if (options.deleteBranch !== false) {
      try {
        await this.execGit(`branch -D "${worktree.branch}"`, projectDir);
      } catch {
        // Branch may already be deleted or merged
      }
    }

    // Update metadata
    const metadata = await this.readMetadata(projectDir);
    metadata.worktrees = metadata.worktrees.filter((e) => e.id !== worktreeId);
    await this.writeMetadata(projectDir, metadata);

    this.log.info(`Removed worktree ${worktreeId}`);

    // Invoke post-removal hook
    if (this.hooks.onWorktreeRemoved) {
      try {
        await this.hooks.onWorktreeRemoved(projectDir, worktreeId);
      } catch (e) {
        this.log.warn(
          `onWorktreeRemoved hook failed for ${worktreeId}:`,
          String(e),
        );
      }
    }
  }

  /**
   * Rename a worktree's branch.
   */
  async renameWorktreeBranch(
    projectDir: string,
    worktreeId: string,
    newName: string,
  ): Promise<WorktreeInfo> {
    const worktree = await this.getWorktree(projectDir, worktreeId);
    if (!worktree) {
      throw new Error("Worktree not found");
    }

    const sanitized = this.sanitizeBranchName(newName);
    const newBranchName = `ants/${sanitized}`;

    if (newBranchName === worktree.branch) {
      return worktree;
    }

    if (await this.branchExists(projectDir, newBranchName)) {
      throw new Error(`Branch ${newBranchName} already exists`);
    }

    await this.execGit(
      `branch -m "${worktree.branch}" "${newBranchName}"`,
      worktree.path,
    );

    // Update metadata
    const metadata = await this.readMetadata(projectDir);
    const entry = metadata.worktrees.find((e) => e.id === worktreeId);
    if (entry) {
      entry.branchName = newBranchName;
      entry.updatedAt = new Date().toISOString();
      await this.writeMetadata(projectDir, metadata);
    }

    return { ...worktree, branch: newBranchName };
  }

  // ─── Diff / Merge / Discard ───────────────────────────────────────

  /**
   * Get the diff between a worktree's branch and its base branch.
   */
  async diff(projectDir: string, worktreeId: string): Promise<DiffResult | null> {
    const worktree = await this.getWorktree(projectDir, worktreeId);
    if (!worktree) return null;

    return this.diffBranches(worktree.path, worktree.baseBranch, worktree.branch);
  }

  /**
   * Get the diff between a worktree (looked up by session) and its base branch.
   */
  async diffBySession(
    projectDir: string,
    sessionId: string,
  ): Promise<DiffResult | null> {
    const worktree = await this.getWorktreeBySession(projectDir, sessionId);
    if (!worktree) return null;

    return this.diffBranches(worktree.path, worktree.baseBranch, worktree.branch);
  }

  /**
   * Low-level diff between two branch references.
   */
  private async diffBranches(
    cwd: string,
    baseBranch: string,
    branch: string,
  ): Promise<DiffResult> {
    const numstatOutput =
      (await this.execGitSafe(
        `diff ${baseBranch}...${branch} --numstat`,
        cwd,
      )) ?? "";

    const nameStatus =
      (await this.execGitSafe(
        `diff ${baseBranch}...${branch} --name-status`,
        cwd,
      )) ?? "";

    const rawDiff =
      (await this.execGitSafe(`diff ${baseBranch}...${branch}`, cwd)) ?? "";

    const files: DiffFile[] = [];
    let totalAdditions = 0;
    let totalDeletions = 0;

    const numstatLines = numstatOutput.split("\n").filter(Boolean);
    const statusLines = nameStatus.split("\n").filter(Boolean);
    const fileDiffs = rawDiff
      .split(/^diff --git/m)
      .filter(Boolean)
      .map((d) => "diff --git" + d);

    for (let i = 0; i < numstatLines.length; i++) {
      const numParts = numstatLines[i]!.split("\t");
      if (numParts.length < 3) continue;

      const additions = numParts[0] === "-" ? 0 : parseInt(numParts[0]!, 10);
      const deletions = numParts[1] === "-" ? 0 : parseInt(numParts[1]!, 10);
      const filePath = numParts[2]!;

      let status: DiffFile["status"] = "modified";
      const statusLine = statusLines[i];
      if (statusLine) {
        switch (statusLine[0]) {
          case "A":
            status = "added";
            break;
          case "D":
            status = "deleted";
            break;
          case "R":
            status = "renamed";
            break;
        }
      }

      totalAdditions += additions;
      totalDeletions += deletions;

      files.push({
        path: filePath,
        status,
        additions,
        deletions,
        diff: fileDiffs[i] ?? "",
      });
    }

    return {
      files,
      additions: totalAdditions,
      deletions: totalDeletions,
      filesChanged: files.length,
    };
  }

  /**
   * Merge a worktree's branch back into its base branch.
   */
  async merge(
    projectDir: string,
    worktreeId: string,
  ): Promise<WorktreeOperationResult> {
    const worktree = await this.getWorktree(projectDir, worktreeId);
    if (!worktree) {
      return { success: false, message: "Worktree not found" };
    }

    try {
      // Checkout base branch in the main repo
      await this.execGit(`checkout ${worktree.baseBranch}`, projectDir);

      // Merge the worktree branch
      const result = await this.execGit(
        `merge ${worktree.branch} --no-ff -m "Merge worktree branch ${worktree.branch}"`,
        projectDir,
      );

      // Clean up worktree (don't delete the branch since it's now merged)
      await this.removeWorktree(projectDir, worktreeId, {
        force: true,
        deleteBranch: false,
      });

      this.log.info(
        `Merged worktree ${worktreeId}: ${worktree.branch} -> ${worktree.baseBranch}`,
      );

      return { success: true, message: result || "Merge successful" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.error("Merge failed:", msg);
      return { success: false, message: msg };
    }
  }

  /**
   * Merge a worktree looked up by session ID.
   */
  async mergeBySession(
    projectDir: string,
    sessionId: string,
  ): Promise<WorktreeOperationResult> {
    const worktree = await this.getWorktreeBySession(projectDir, sessionId);
    if (!worktree) {
      return { success: false, message: "Worktree not found for session" };
    }
    return this.merge(projectDir, worktree.id);
  }

  /**
   * Discard a worktree (remove without merging, delete the branch).
   */
  async discard(
    projectDir: string,
    worktreeId: string,
  ): Promise<WorktreeOperationResult> {
    const worktree = await this.getWorktree(projectDir, worktreeId);
    if (!worktree) {
      return { success: false, message: "Worktree not found" };
    }

    try {
      await this.removeWorktree(projectDir, worktreeId, {
        force: true,
        deleteBranch: true,
      });

      this.log.info(`Discarded worktree ${worktreeId}: ${worktree.branch}`);
      return { success: true, message: "Worktree discarded" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.error("Discard failed:", msg);
      return { success: false, message: msg };
    }
  }

  /**
   * Discard a worktree looked up by session ID.
   */
  async discardBySession(
    projectDir: string,
    sessionId: string,
  ): Promise<WorktreeOperationResult> {
    const worktree = await this.getWorktreeBySession(projectDir, sessionId);
    if (!worktree) {
      return { success: false, message: "Worktree not found for session" };
    }
    return this.discard(projectDir, worktree.id);
  }

  // ─── System prompt ────────────────────────────────────────────────

  /**
   * Generate a system prompt section for an agent working in a worktree.
   */
  getSystemPrompt(worktree: WorktreeInfo): string {
    return `
# Git Worktree Mode

You are working in an isolated git worktree. Your changes are on a separate branch and will NOT affect the main codebase until explicitly merged.

**Worktree Details:**
- Branch: \`${worktree.branch}\`
- Base branch: \`${worktree.baseBranch}\`
- Working directory: \`${worktree.path}\`

**Guidelines:**
1. Work freely — your changes are isolated on the \`${worktree.branch}\` branch.
2. Commit your work regularly with descriptive commit messages.
3. When you're done with your task, summarize what you changed and ask the user if they want to merge your changes back into \`${worktree.baseBranch}\`.
4. Do NOT merge the branch yourself — the user will handle that through the UI.
`;
  }
}
