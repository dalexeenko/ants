/**
 * @ants/agent-worktree
 * 
 * Git worktree support for @ants/agent.
 * 
 * This package provides two levels of worktree management:
 * 
 * 1. **ProjectWorktreeManager** — standalone manager that takes projectDir
 *    as a parameter. No agent dependencies. Use this from the server or
 *    desktop app for worktree CRUD, diff, merge, discard, etc.
 * 
 * 2. **WorktreeManager** — agent-aware wrapper that uses the agent's working
 *    directory and updates session state on switch. Used by the plugin.
 * 
 * 3. **worktreePlugin** — agent plugin that registers tools and the
 *    WorktreeManager as an extension.
 * 
 * @example
 * ```ts
 * // Server/Desktop: use ProjectWorktreeManager directly
 * import { ProjectWorktreeManager } from "@ants/agent-worktree";
 * 
 * const manager = new ProjectWorktreeManager(executor, filesystem, logger);
 * const wt = await manager.createWorktree("/path/to/project");
 * const diff = await manager.diff("/path/to/project", wt.id);
 * ```
 * 
 * @example
 * ```ts
 * // Agent: use the plugin
 * import { worktreePlugin } from "@ants/agent-worktree";
 * 
 * const agent = await createAgent({ ... });
 * await agent.use(worktreePlugin());
 * ```
 */

// Plugin
export { worktreePlugin, type WorktreePluginOptions } from "./plugin.js";
export { default } from "./plugin.js";

// Managers
export { WorktreeManager } from "./manager.js";
export { ProjectWorktreeManager } from "./project-worktree-manager.js";

// Tools
export {
  worktreeCreateTool,
  worktreeListTool,
  worktreeSwitchTool,
  worktreeRemoveTool,
} from "./tools/index.js";

// Types
export type {
  WorktreeInfo,
  WorktreeCreateOptions,
  WorktreeRemoveOptions,
  DiffFile,
  DiffResult,
  WorktreeOperationResult,
  WorktreeMetadata,
  WorktreeMetadataEntry,
  GitCommandResult,
  CommandExecutor,
  WorktreeFilesystem,
  WorktreeLogger,
  WorktreeLifecycleHooks,
} from "./types.js";
