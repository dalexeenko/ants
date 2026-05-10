import { describe, it, expect } from 'vitest';
import { worktreeManager, ProjectWorktreeManager } from './worktree-manager.js';
import type {
  WorktreeInfo,
  DiffResult,
  DiffFile,
  WorktreeOperationResult,
  WorktreeCreateOptions,
  WorktreeRemoveOptions,
} from './worktree-manager.js';

/**
 * Server worktree-manager adapter tests.
 *
 * The full ProjectWorktreeManager logic (create, list, remove, diff, merge,
 * discard, rename, associateSession, etc.) is tested in the
 * @ants/agent-worktree package (62 tests). These tests verify the server
 * adapter layer: singleton creation, class re-export, and type re-exports.
 */
describe('worktree-manager adapter', () => {
  it('should export a worktreeManager singleton', () => {
    expect(worktreeManager).toBeDefined();
    expect(worktreeManager).toBeInstanceOf(ProjectWorktreeManager);
  });

  it('should re-export ProjectWorktreeManager class', () => {
    expect(ProjectWorktreeManager).toBeDefined();
    expect(typeof ProjectWorktreeManager).toBe('function');
  });

  it('singleton should have all expected methods', () => {
    // Core CRUD
    expect(typeof worktreeManager.isGitRepo).toBe('function');
    expect(typeof worktreeManager.getRepoRoot).toBe('function');
    expect(typeof worktreeManager.getCurrentBranch).toBe('function');
    expect(typeof worktreeManager.getDefaultBranch).toBe('function');
    expect(typeof worktreeManager.createWorktree).toBe('function');
    expect(typeof worktreeManager.listWorktrees).toBe('function');
    expect(typeof worktreeManager.getWorktree).toBe('function');
    expect(typeof worktreeManager.removeWorktree).toBe('function');

    // Session association
    expect(typeof worktreeManager.associateSession).toBe('function');
    expect(typeof worktreeManager.getWorktreeBySession).toBe('function');

    // Diff / merge / discard
    expect(typeof worktreeManager.diff).toBe('function');
    expect(typeof worktreeManager.diffBySession).toBe('function');
    expect(typeof worktreeManager.merge).toBe('function');
    expect(typeof worktreeManager.mergeBySession).toBe('function');
    expect(typeof worktreeManager.discard).toBe('function');
    expect(typeof worktreeManager.discardBySession).toBe('function');

    // Branch operations
    expect(typeof worktreeManager.renameWorktreeBranch).toBe('function');
    expect(typeof worktreeManager.branchExists).toBe('function');
    expect(typeof worktreeManager.sanitizeBranchName).toBe('function');

    // Gitignore / prompt
    expect(typeof worktreeManager.ensureGitignore).toBe('function');
    expect(typeof worktreeManager.getSystemPrompt).toBe('function');
  });

  it('should re-export types correctly', () => {
    // These are compile-time checks — if they resolve, the type re-exports work.
    // We just need to verify the imports above don't error.
    const _info: WorktreeInfo | undefined = undefined;
    const _diff: DiffResult | undefined = undefined;
    const _file: DiffFile | undefined = undefined;
    const _result: WorktreeOperationResult | undefined = undefined;
    const _createOpts: WorktreeCreateOptions | undefined = undefined;
    const _removeOpts: WorktreeRemoveOptions | undefined = undefined;

    // Suppress unused variable warnings
    expect(_info).toBeUndefined();
    expect(_diff).toBeUndefined();
    expect(_file).toBeUndefined();
    expect(_result).toBeUndefined();
    expect(_createOpts).toBeUndefined();
    expect(_removeOpts).toBeUndefined();
  });
});
