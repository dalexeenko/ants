/**
 * Server worktree manager — uses the shared @openmgr/agent-worktree package.
 *
 * This module creates a ProjectWorktreeManager singleton with Node.js
 * filesystem and command executor implementations. The server's session
 * routes import this singleton.
 *
 * The full worktree implementation has been consolidated in the
 * @openmgr/agent-worktree package. This file is a thin adapter.
 */

import { spawn } from 'child_process';
import { readFile, writeFile, stat, mkdir, rm } from 'fs/promises';
import { resolve, dirname, basename, join } from 'path';
import { ProjectWorktreeManager } from '@openmgr/agent-worktree';
import type { CommandExecutor, WorktreeFilesystem, GitCommandResult } from '@openmgr/agent-worktree';
import { createLogger } from '../utils/logger.js';

const log = createLogger('WorktreeManager');

/** Node.js command executor using child_process.spawn */
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

/** Node.js filesystem implementation */
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

/** Module-level singleton for the server */
export const worktreeManager = new ProjectWorktreeManager(executor, filesystem, log);

// Re-export types for convenience
export { ProjectWorktreeManager } from '@openmgr/agent-worktree';
export type {
  WorktreeInfo,
  DiffResult,
  DiffFile,
  WorktreeOperationResult,
  WorktreeCreateOptions,
  WorktreeRemoveOptions,
  WorktreeLifecycleHooks,
} from '@openmgr/agent-worktree';
