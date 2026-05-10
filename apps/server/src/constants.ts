/**
 * Centralized constants for magic numbers and strings used across the codebase.
 */

// =============================================================================
// Server defaults
// =============================================================================

/** Default HTTP port for the OpenMgr server */
export const DEFAULT_PORT = 6647;

/** Default bind address */
export const DEFAULT_HOST = '127.0.0.1';

// =============================================================================
// Agent management
// =============================================================================

/** Starting port number for agent server instances */
export const AGENT_PORT_RANGE_START = 6700;

/** End of the port range to scan for orphaned agent servers (exclusive) */
export const AGENT_PORT_RANGE_END = 6800;

/** Maximum time (ms) to wait for an agent server to start and become healthy */
export const AGENT_STARTUP_TIMEOUT_MS = 30_000;

/** Default provider when none is specified */
export const DEFAULT_PROVIDER = 'anthropic';

/** Default model when none is specified */
export const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

// =============================================================================
// Terminal management
// =============================================================================

/** Time (ms) before an inactive terminal session is automatically cleaned up */
export const TERMINAL_SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/** Interval (ms) between terminal cleanup sweeps */
export const TERMINAL_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// =============================================================================
// Message queue
// =============================================================================

/** Time (ms) before a processing message is considered stuck */
export const MESSAGE_PROCESSING_TIMEOUT_MS = 60_000;

/** Maximum number of retries for failed messages */
export const MESSAGE_MAX_RETRIES = 3;

/** Interval (ms) between message processor polling cycles */
export const MESSAGE_POLL_INTERVAL_MS = 1_000;

/** Number of messages to dequeue in each processing batch */
export const MESSAGE_BATCH_SIZE = 5;

// =============================================================================
// Task scheduling
// =============================================================================

/** Interval (ms) between task scheduler polling cycles */
export const TASK_SCHEDULER_POLL_INTERVAL_MS = 60_000;

/** Maximum number of task run history entries to retain per task */
export const TASK_MAX_RUN_HISTORY = 100;

// =============================================================================
// Caching
// =============================================================================

/** Time (ms) before the models API cache is considered stale */
export const MODELS_CACHE_STALE_MS = 5 * 60 * 1000; // 5 minutes

// =============================================================================
// Security
// =============================================================================

/** Maximum age (seconds) for Slack request timestamps before they are rejected */
export const SLACK_TIMESTAMP_TOLERANCE_SECONDS = 300; // 5 minutes

/** Time (ms) before pending OAuth verifiers expire */
export const OAUTH_VERIFIER_TTL_MS = 10 * 60 * 1000; // 10 minutes
