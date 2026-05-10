/**
 * Information about a git worktree.
 */
export interface WorktreeInfo {
  /** Unique ID for this worktree (UUID) */
  id: string;
  /** Absolute path to the worktree directory */
  path: string;
  /** Branch checked out in this worktree */
  branch: string;
  /** The branch this worktree was created from */
  baseBranch: string;
  /** Current commit SHA */
  head: string;
  /** Whether this is the main worktree (the original repo) */
  isMain: boolean;
  /** Associated session ID, if any */
  sessionId?: string;
  /** When the worktree was created */
  createdAt?: Date;
  /** When the worktree metadata was last updated */
  updatedAt?: Date;
}

/**
 * Options for creating a new worktree.
 */
export interface WorktreeCreateOptions {
  /** Branch name to checkout or create */
  branch: string;
  /** Base branch for new branches (defaults to current branch) */
  baseBranch?: string;
  /** Create the branch if it doesn't exist (default: true) */
  createBranch?: boolean;
  /** Override the default worktree path */
  path?: string;
  /** Session ID to associate with this worktree */
  sessionId?: string;
}

/**
 * Options for removing a worktree.
 */
export interface WorktreeRemoveOptions {
  /** Force removal even with uncommitted changes */
  force?: boolean;
  /** Also delete the branch (default: true for discard, false for merge) */
  deleteBranch?: boolean;
}

/**
 * A single file in a diff result.
 */
export interface DiffFile {
  /** File path relative to repo root */
  path: string;
  /** Type of change */
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  /** Number of lines added */
  additions: number;
  /** Number of lines deleted */
  deletions: number;
  /** Raw unified diff for this file */
  diff: string;
}

/**
 * Result of diffing a worktree against its base branch.
 */
export interface DiffResult {
  /** Changed files */
  files: DiffFile[];
  /** Total lines added */
  additions: number;
  /** Total lines deleted */
  deletions: number;
  /** Number of files changed */
  filesChanged: number;
}

/**
 * Result of a merge or discard operation.
 */
export interface WorktreeOperationResult {
  success: boolean;
  message: string;
}

/**
 * Persisted metadata for worktrees in a project.
 */
export interface WorktreeMetadata {
  version: 1;
  worktrees: WorktreeMetadataEntry[];
}

/**
 * A single worktree entry in the metadata file.
 */
export interface WorktreeMetadataEntry {
  id: string;
  sessionId?: string;
  path: string;
  branchName: string;
  baseBranch: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/**
 * Result of executing a git command.
 */
export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Interface for executing shell commands.
 * This abstraction allows the worktree manager to work with different execution backends.
 */
export interface CommandExecutor {
  exec(command: string, cwd: string): Promise<GitCommandResult>;
}

/**
 * Interface for filesystem operations needed by the worktree manager.
 */
export interface WorktreeFilesystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  resolve(...paths: string[]): string;
  dirname(path: string): string;
  basename(path: string): string;
  join(...paths: string[]): string;
}

/**
 * Logger interface for the worktree manager.
 */
export interface WorktreeLogger {
  info(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Lifecycle hooks for worktree creation/removal.
 *
 * These are called by ProjectWorktreeManager after the core git operations
 * succeed. Use them to wire up Docker containers, notifications, or any
 * other side-effects.
 *
 * Hook errors are logged but do NOT fail the worktree operation — the git
 * worktree will still be created/removed even if the hook throws.
 */
export interface WorktreeLifecycleHooks {
  /**
   * Called after a worktree is successfully created.
   * Receives the project directory and the new worktree info.
   */
  onWorktreeCreated?(projectDir: string, worktree: WorktreeInfo): Promise<void>;

  /**
   * Called before a worktree is removed (but after validation).
   * Receives the project directory and the worktree about to be removed.
   * Use this for cleanup (e.g., stop Docker containers).
   */
  onWorktreeRemoving?(projectDir: string, worktree: WorktreeInfo): Promise<void>;

  /**
   * Called after a worktree is successfully removed.
   * Receives the project directory and the ID of the removed worktree.
   */
  onWorktreeRemoved?(projectDir: string, worktreeId: string): Promise<void>;
}
