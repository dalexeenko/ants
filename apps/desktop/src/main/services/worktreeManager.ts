/**
 * Desktop WorktreeManager — thin adapter around the shared
 * @openmgr/agent-worktree ProjectWorktreeManager.
 *
 * This wraps the shared package with the desktop-specific interface:
 * - Methods take (sessionId, projectId, projectDir) matching the old API
 * - Automatically associates sessions with worktrees on creation
 * - Provides getDiff/merge/discard by sessionId
 * - Maintains a minimal in-memory map for getWorktree(sessionId)
 *
 * Persistence of worktree metadata is handled by ProjectWorktreeManager
 * via .worktrees/metadata.json, so data survives restarts.
 */

import { spawn } from 'child_process';
import { readFile, writeFile, stat, mkdir, rm } from 'fs/promises';
import { resolve, dirname, basename, join } from 'path';
import { ProjectWorktreeManager } from '@openmgr/agent-worktree';
import type {
  CommandExecutor,
  WorktreeFilesystem,
  GitCommandResult,
  WorktreeInfo as PackageWorktreeInfo,
} from '@openmgr/agent-worktree';
import { createLogger } from '@openmgr/ui';

const log = createLogger('WorktreeManager');

// ── Node.js implementations for the package's interfaces ──────────────

const executor: CommandExecutor = {
  async exec(command: string, cwd: string): Promise<GitCommandResult> {
    return new Promise((resolvePromise) => {
      const proc = spawn('sh', ['-c', command], {
        cwd,
        env: { ...process.env, TERM: 'dumb', GIT_TERMINAL_PROMPT: '0' },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code: number | null) => {
        resolvePromise({ stdout, stderr, exitCode: code ?? 1 });
      });

      proc.on('error', (err: Error) => {
        resolvePromise({ stdout, stderr: stderr + err.message, exitCode: 1 });
      });
    });
  },
};

const filesystem: WorktreeFilesystem = {
  async readFile(path: string): Promise<string> {
    return readFile(path, 'utf-8');
  },
  async writeFile(path: string, content: string): Promise<void> {
    await writeFile(path, content, 'utf-8');
  },
  async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  },
  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await mkdir(path, options);
  },
  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    await rm(path, options);
  },
  resolve: (...paths: string[]) => resolve(...paths),
  dirname,
  basename,
  join,
};

// ── Desktop-friendly wrapper ──────────────────────────────────────────

/**
 * Lightweight record tracked in memory, mapping sessionId → worktree info.
 * This mirrors the old API shape so callers in desktopBridge.ts can do
 * `worktreeManager.getWorktree(sessionId)` synchronously.
 */
export interface WorktreeRecord {
  sessionId: string;
  projectId: string;
  branch: string;
  baseBranch: string;
  worktreePath: string;
  status: 'active' | 'merged' | 'discarded';
  createdAt: Date;
}

export interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  diff: string;
}

export interface DiffResult {
  files: DiffFile[];
  additions: number;
  deletions: number;
  filesChanged: number;
}

export class WorktreeManager {
  private manager = new ProjectWorktreeManager(executor, filesystem, log);

  /**
   * Tracks sessionId → { worktreeId, projectDir } so we can bridge the
   * session-based desktop API to the worktreeId-based package API.
   */
  private sessions = new Map<string, { worktreeId: string; projectDir: string; record: WorktreeRecord }>();

  /**
   * Check if a directory is a git repository.
   */
  async isGitRepo(projectDir: string): Promise<boolean> {
    return this.manager.isGitRepo(projectDir);
  }

  /**
   * Get the current branch name.
   */
  async getCurrentBranch(projectDir: string): Promise<string> {
    return this.manager.getCurrentBranch(projectDir);
  }

  /**
   * Get the default branch (main or master).
   */
  async getDefaultBranch(projectDir: string): Promise<string> {
    return this.manager.getDefaultBranch(projectDir);
  }

  /**
   * Create a worktree for a session.
   * Matches the old desktop API: (sessionId, projectId, projectDir, branchName?)
   */
  async createWorktree(
    sessionId: string,
    projectId: string,
    projectDir: string,
    branchName?: string,
  ): Promise<WorktreeRecord> {
    const worktree = await this.manager.createWorktree(projectDir, {
      branch: branchName,
      sessionId,
    });

    const record: WorktreeRecord = {
      sessionId,
      projectId,
      branch: worktree.branch,
      baseBranch: worktree.baseBranch,
      worktreePath: worktree.path,
      status: 'active',
      createdAt: worktree.createdAt ?? new Date(),
    };

    this.sessions.set(sessionId, {
      worktreeId: worktree.id,
      projectDir,
      record,
    });

    return record;
  }

  /**
   * Get a worktree record by session ID (synchronous in-memory lookup).
   */
  getWorktree(sessionId: string): WorktreeRecord | null {
    const entry = this.sessions.get(sessionId);
    return entry?.record ?? null;
  }

  /**
   * Get the diff between a worktree's branch and the base branch.
   */
  async getDiff(sessionId: string): Promise<DiffResult | null> {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      // Try to find via metadata (in case app was restarted)
      return null;
    }

    const diff = await this.manager.diff(entry.projectDir, entry.worktreeId);
    return diff;
  }

  /**
   * Merge a worktree's branch back into the base branch.
   */
  async merge(sessionId: string, projectDir: string): Promise<{ success: boolean; message: string }> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return { success: false, message: 'Worktree not found' };
    if (entry.record.status !== 'active') {
      return { success: false, message: `Worktree already ${entry.record.status}` };
    }

    const result = await this.manager.merge(entry.projectDir, entry.worktreeId);
    if (result.success) {
      entry.record.status = 'merged';
      this.sessions.delete(sessionId);
    }
    return result;
  }

  /**
   * Discard a worktree (remove without merging).
   */
  async discard(sessionId: string, projectDir: string): Promise<{ success: boolean; message: string }> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return { success: false, message: 'Worktree not found' };
    if (entry.record.status !== 'active') {
      return { success: false, message: `Worktree already ${entry.record.status}` };
    }

    const result = await this.manager.discard(entry.projectDir, entry.worktreeId);
    if (result.success) {
      entry.record.status = 'discarded';
      this.sessions.delete(sessionId);
    }
    return result;
  }

  /**
   * Get the worktree system prompt section.
   */
  getWorktreeSystemPrompt(record: WorktreeRecord): string {
    // Build a WorktreeInfo-compatible object for the shared method
    const info: PackageWorktreeInfo = {
      id: '',
      path: record.worktreePath,
      branch: record.branch,
      baseBranch: record.baseBranch,
      head: '',
      isMain: false,
    };
    return this.manager.getSystemPrompt(info);
  }

  /**
   * Try to restore session mappings from on-disk metadata.
   * Call this at startup to recover worktree associations after restart.
   */
  async restoreSessions(projectDir: string, projectId: string): Promise<void> {
    try {
      const worktrees = await this.manager.listWorktrees(projectDir);
      for (const wt of worktrees) {
        if (wt.sessionId && !this.sessions.has(wt.sessionId)) {
          this.sessions.set(wt.sessionId, {
            worktreeId: wt.id,
            projectDir,
            record: {
              sessionId: wt.sessionId,
              projectId,
              branch: wt.branch,
              baseBranch: wt.baseBranch,
              worktreePath: wt.path,
              status: 'active',
              createdAt: wt.createdAt ?? new Date(),
            },
          });
        }
      }
    } catch {
      // Not a git repo or no worktrees — nothing to restore
    }
  }

  /**
   * Shut down and clear in-memory state.
   * Worktree metadata persists on disk via ProjectWorktreeManager.
   */
  async shutdown(): Promise<void> {
    this.sessions.clear();
  }
}
