/**
 * @openmgr/agent-scheduler
 *
 * Generic task scheduler with cron support.
 * Platform-agnostic and can be used with any storage backend.
 */

// Types
export type {
  TaskStatus,
  WebhookEvent,
  TaskWebhook,
  WebhookResult,
  TaskRun,
  ScheduledTask,
  CreateTaskInput,
  UpdateTaskInput,
  TaskExecutor,
  SchedulerOptions,
  TaskStorage,
} from "./types.js";

// Scheduler
export { TaskScheduler } from "./scheduler.js";

// Storage implementations
export { InMemoryTaskStorage, type InMemoryTaskStorageOptions } from "./storage/memory.js";

// Cron utilities
export { parseNextRun, describeCron, isValidCron } from "./cron.js";
