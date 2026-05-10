import { spawn } from "child_process";
import { resolve, dirname, basename, join } from "path";
import { readFile, writeFile, stat, mkdir, rm } from "fs/promises";
import type { AgentPlugin, AgentInterface, Filesystem } from "@openmgr/agent-core";
import type { SessionManager } from "@openmgr/agent-storage";
import { WorktreeManager } from "./manager.js";
import {
  worktreeCreateTool,
  worktreeListTool,
  worktreeSwitchTool,
  worktreeRemoveTool,
} from "./tools/index.js";
import type { CommandExecutor, WorktreeFilesystem, GitCommandResult, WorktreeLogger } from "./types.js";

const WORKTREE_MANAGER_KEY = "worktree.manager";
const FILESYSTEM_KEY = "filesystem";
const SESSION_MANAGER_KEY = "storage.sessions";

/**
 * Options for the worktree plugin.
 */
export interface WorktreePluginOptions {
  /**
   * Custom filesystem implementation.
   * If not provided, uses Node.js fs.
   */
  filesystem?: WorktreeFilesystem;
  
  /**
   * Custom command executor.
   * If not provided, uses Node.js child_process.spawn.
   */
  executor?: CommandExecutor;

  /**
   * Optional logger.
   */
  logger?: WorktreeLogger;
}

/**
 * Default command executor using Node.js child_process.
 */
function createDefaultExecutor(): CommandExecutor {
  return {
    async exec(command: string, cwd: string): Promise<GitCommandResult> {
      return new Promise((resolve) => {
        const proc = spawn("sh", ["-c", command], {
          cwd,
          env: { ...process.env, TERM: "dumb", GIT_TERMINAL_PROMPT: "0" },
        });

        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (data: Buffer) => {
          stdout += data.toString();
        });

        proc.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        proc.on("close", (code: number | null) => {
          resolve({
            stdout,
            stderr,
            exitCode: code ?? 1,
          });
        });

        proc.on("error", (err: Error) => {
          resolve({
            stdout,
            stderr: stderr + err.message,
            exitCode: 1,
          });
        });
      });
    },
  };
}

/**
 * Default filesystem implementation using Node.js fs.
 */
function createDefaultFilesystem(): WorktreeFilesystem {
  return {
    async readFile(path: string): Promise<string> {
      return readFile(path, "utf-8");
    },
    async writeFile(path: string, content: string): Promise<void> {
      await writeFile(path, content, "utf-8");
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
}

/**
 * Create a worktree plugin for git worktree management.
 * 
 * This plugin provides tools for:
 * - Creating isolated worktrees for branch work
 * - Switching between worktrees
 * - Listing available worktrees
 * - Removing worktrees
 * 
 * Worktrees are created in `.worktrees/{uuid}/` and the plugin
 * automatically ensures this directory is in `.gitignore`.
 * 
 * @example
 * ```ts
 * import { worktreePlugin } from "@openmgr/agent-worktree";
 * 
 * const agent = await createAgent({ ... });
 * await agent.use(worktreePlugin());
 * 
 * // The agent now has access to:
 * // - worktree_create
 * // - worktree_list
 * // - worktree_switch
 * // - worktree_remove
 * ```
 */
export function worktreePlugin(options: WorktreePluginOptions = {}): AgentPlugin {
  const executor = options.executor ?? createDefaultExecutor();
  const filesystem = options.filesystem ?? createDefaultFilesystem();
  
  return {
    name: "@openmgr/agent-worktree",
    version: "0.1.0",
    
    tools: [
      worktreeCreateTool,
      worktreeListTool,
      worktreeSwitchTool,
      worktreeRemoveTool,
    ] as AgentPlugin["tools"],

    onRegister(agent: AgentInterface) {
      // Get session manager (may not be available if storage plugin not registered)
      const getSessionManager = () => 
        agent.getExtension<SessionManager>(SESSION_MANAGER_KEY);

      // Create the worktree manager
      const manager = new WorktreeManager(
        () => agent,
        getSessionManager,
        filesystem,
        executor,
        options.logger,
      );

      // Register the manager as an extension
      // Tools will access it via ctx.extensions["worktree.manager"]
      agent.setExtension(WORKTREE_MANAGER_KEY, manager);
    },
    
    async onShutdown() {
      // Nothing to clean up
    },
  };
}

export default worktreePlugin;
