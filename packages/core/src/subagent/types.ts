/**
 * Subagent types and interfaces.
 * 
 * Defines the contract for spawning, managing, and communicating with subagents.
 */

import type { ToolPermissionConfig } from "../permissions.js";

// ============================================================================
// Subagent Configuration
// ============================================================================

/**
 * Options for spawning a new subagent.
 */
export interface SubagentSpawnOptions {
  /** Short description of the task (3-5 words) */
  description: string;

  /** The detailed prompt/task for the subagent */
  prompt: string;

  /** Named agent type from the agent type registry (e.g., "explore-code", "general-code") */
  subagentType?: string;

  /** If true, run in background and return session ID immediately */
  async?: boolean;

  /** Override the model for this subagent (defaults to parent's model) */
  model?: string;

  /** Override the provider for this subagent (defaults to parent's provider) */
  provider?: string;

  /** Override working directory (defaults to parent's working directory) */
  workingDirectory?: string;

  /** Tool allow list - only these tools will be available to the subagent */
  allowedTools?: string[];

  /** Tool deny list - these tools will be blocked for the subagent */
  deniedTools?: string[];

  /** Permission configuration override for the subagent */
  permissions?: ToolPermissionConfig;

  /** Maximum number of agent loop iterations before the subagent is killed */
  maxIterations?: number;

  /** Maximum token budget for the subagent (prompt + completion tokens) */
  tokenBudget?: number;

  /** Custom system prompt override (defaults to parent's system prompt) */
  systemPrompt?: string;

  /**
   * If set, create a git worktree for this subagent on the given branch name.
   * The subagent will work in an isolated copy of the repo.
   * Requires the worktree manager to be available via extensions.
   */
  worktreeBranch?: string;

  /**
   * Base branch for the worktree (defaults to HEAD).
   * Only used if worktreeBranch is set.
   */
  worktreeBaseBranch?: string;
}

/**
 * Result of a completed subagent execution.
 */
export interface SubagentResult {
  /** The subagent's session ID */
  sessionId: string;

  /** The parent session ID */
  parentSessionId: string;

  /** The task description */
  description: string;

  /** The subagent's final response content */
  content: string;

  /** Token usage for this subagent */
  usage?: SubagentUsage;

  /** Whether the subagent completed normally or was terminated */
  terminationReason?: "completed" | "max_iterations" | "token_budget" | "cancelled" | "error";
}

/**
 * Token usage tracking for a subagent.
 */
export interface SubagentUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// ============================================================================
// Subagent Status
// ============================================================================

export type SubagentStatus = "running" | "completed" | "failed" | "cancelled";

/**
 * Live status of a running or completed subagent.
 */
export interface SubagentInfo {
  /** The subagent's session ID */
  sessionId: string;

  /** The parent session ID */
  parentSessionId: string;

  /** Short description of the task */
  description: string;

  /** Current status */
  status: SubagentStatus;

  /** When the subagent was started */
  startedAt: number;

  /** When the subagent completed (if finished) */
  completedAt?: number;

  /** The result content (if completed) */
  result?: string;

  /** Error message (if failed) */
  error?: string;

  /** Token usage so far */
  usage?: SubagentUsage;
}

// ============================================================================
// SubagentManager Interface
// ============================================================================

/**
 * Interface for managing subagent lifecycle.
 * 
 * This is the contract that the task tool and other consumers use.
 * Implementations may vary (in-process, remote, etc.)
 */
export interface SubagentManagerInterface {
  /**
   * Spawn a new subagent.
   * 
   * In sync mode (default), waits for completion and returns the result.
   * In async mode, starts the subagent and returns immediately with its info.
   */
  spawn(options: SubagentSpawnOptions, parentSessionId: string): Promise<SubagentResult | SubagentInfo>;

  /**
   * Get the status of a subagent by session ID.
   */
  getStatus(sessionId: string): SubagentInfo | undefined;

  /**
   * Get all subagents for a parent session.
   */
  getChildren(parentSessionId: string): SubagentInfo[];

  /**
   * Cancel a running subagent.
   */
  cancel(sessionId: string): boolean;

  /**
   * Wait for an async subagent to complete.
   * Returns the result when done.
   */
  waitFor(sessionId: string): Promise<SubagentResult>;

  /**
   * Get IDs of all currently running subagents.
   */
  getRunningIds(): string[];
}
