/**
 * Git command utilities for @ants/server.
 * 
 * Provides helper functions for common git operations including:
 * - Repository status checks
 * - Worktree management
 * - Branch operations
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Execute a git command and return stdout.
 * Throws an error if the command fails.
 */
export async function execGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execAsync(`git ${args.join(' ')}`, {
    cwd,
    maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
  });
  return stdout.trim();
}

/**
 * Execute a git command, returning null instead of throwing on failure.
 */
export async function execGitSafe(args: string[], cwd: string): Promise<string | null> {
  try {
    return await execGit(args, cwd);
  } catch {
    return null;
  }
}

/**
 * Check if a directory is a git repository.
 */
export async function isGitRepo(dir: string): Promise<boolean> {
  const result = await execGitSafe(['rev-parse', '--git-dir'], dir);
  return result !== null;
}

/**
 * Get the root directory of the git repository.
 */
export async function getRepoRoot(dir: string): Promise<string | null> {
  return execGitSafe(['rev-parse', '--show-toplevel'], dir);
}

/**
 * Get the current branch name.
 */
export async function getCurrentBranch(dir: string): Promise<string> {
  const branch = await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], dir);
  return branch;
}

/**
 * Get the current commit hash.
 */
export async function getCurrentCommit(dir: string): Promise<string> {
  return execGit(['rev-parse', 'HEAD'], dir);
}

/**
 * Check if a branch exists.
 */
export async function branchExists(dir: string, branchName: string): Promise<boolean> {
  const result = await execGitSafe(['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], dir);
  return result !== null;
}

/**
 * Create a new branch at the current HEAD.
 */
export async function createBranch(dir: string, branchName: string): Promise<void> {
  await execGit(['branch', branchName], dir);
}

/**
 * Delete a branch.
 * @param force - Use -D instead of -d to force delete
 */
export async function deleteBranch(dir: string, branchName: string, force = false): Promise<void> {
  const flag = force ? '-D' : '-d';
  await execGit(['branch', flag, branchName], dir);
}

/**
 * Rename a branch.
 */
export async function renameBranch(dir: string, oldName: string, newName: string): Promise<void> {
  await execGit(['branch', '-m', oldName, newName], dir);
}

/**
 * Sanitize a string to be used as a git branch name.
 * - Converts to lowercase
 * - Replaces spaces and special chars with hyphens
 * - Removes leading/trailing hyphens
 * - Limits length
 */
export function sanitizeBranchName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')  // Replace non-alphanumeric with hyphens
    .replace(/-+/g, '-')          // Collapse multiple hyphens
    .replace(/^-|-$/g, '')        // Remove leading/trailing hyphens
    .slice(0, 50);                // Limit length
}

// --- Worktree operations ---

/**
 * List all worktrees for a repository.
 */
export async function listWorktrees(dir: string): Promise<Array<{
  path: string;
  head: string;
  branch: string | null;
  bare: boolean;
}>> {
  const output = await execGit(['worktree', 'list', '--porcelain'], dir);
  const worktrees: Array<{ path: string; head: string; branch: string | null; bare: boolean }> = [];
  
  let current: { path: string; head: string; branch: string | null; bare: boolean } | null = null;
  
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) worktrees.push(current);
      current = { path: line.slice(9), head: '', branch: null, bare: false };
    } else if (line.startsWith('HEAD ') && current) {
      current.head = line.slice(5);
    } else if (line.startsWith('branch ') && current) {
      // Branch is in format refs/heads/branch-name
      current.branch = line.slice(7).replace('refs/heads/', '');
    } else if (line === 'bare' && current) {
      current.bare = true;
    }
  }
  
  if (current) worktrees.push(current);
  
  return worktrees;
}

/**
 * Create a new worktree with a new branch.
 */
export async function createWorktree(
  repoDir: string,
  worktreePath: string,
  branchName: string,
  baseBranch?: string
): Promise<void> {
  const args = ['worktree', 'add', '-b', branchName, worktreePath];
  if (baseBranch) {
    args.push(baseBranch);
  }
  await execGit(args, repoDir);
}

/**
 * Create a worktree for an existing branch.
 */
export async function createWorktreeForBranch(
  repoDir: string,
  worktreePath: string,
  branchName: string
): Promise<void> {
  await execGit(['worktree', 'add', worktreePath, branchName], repoDir);
}

/**
 * Remove a worktree.
 * @param force - Force removal even if worktree is dirty
 */
export async function removeWorktree(repoDir: string, worktreePath: string, force = false): Promise<void> {
  const args = ['worktree', 'remove', worktreePath];
  if (force) {
    args.splice(2, 0, '--force');
  }
  await execGit(args, repoDir);
}

/**
 * Prune worktree metadata for deleted worktrees.
 */
export async function pruneWorktrees(repoDir: string): Promise<void> {
  await execGit(['worktree', 'prune'], repoDir);
}

// --- Git HTTP helpers ---

/**
 * Spawn a git service process (git-upload-pack or git-receive-pack).
 * Returns the child process for streaming.
 */
export function spawnGitService(
  service: 'git-upload-pack' | 'git-receive-pack',
  repoDir: string,
  advertiseRefs = false
): ReturnType<typeof spawn> {
  const args = ['--stateless-rpc'];
  if (advertiseRefs) {
    args.push('--advertise-refs');
  }
  args.push(repoDir);
  
  return spawn(service, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Get the packet line prefix for git smart HTTP.
 * Format: 4 hex digits representing length + 4 for the prefix itself
 */
export function pktLine(data: string): string {
  const length = data.length + 4;
  return length.toString(16).padStart(4, '0') + data;
}

/**
 * Flush packet for git smart HTTP.
 */
export const pktFlush = '0000';

/**
 * Check if the repository has receive-pack enabled.
 * Bare repos have it enabled by default, non-bare repos need config.
 */
export async function isReceivePackEnabled(repoDir: string): Promise<boolean> {
  // Check if it's a bare repo (always allows receive-pack)
  const isBare = await execGitSafe(['rev-parse', '--is-bare-repository'], repoDir);
  if (isBare === 'true') return true;
  
  // Check config for non-bare repos
  const config = await execGitSafe(['config', '--get', 'receive.denyCurrentBranch'], repoDir);
  // If not set or set to 'ignore' or 'warn', receive-pack is allowed
  return config === null || config === 'ignore' || config === 'warn' || config === 'updateInstead';
}

/**
 * Enable receive-pack for a non-bare repository.
 * This allows pushing to the checked-out branch.
 */
export async function enableReceivePack(repoDir: string): Promise<void> {
  await execGit(['config', 'receive.denyCurrentBranch', 'updateInstead'], repoDir);
}
