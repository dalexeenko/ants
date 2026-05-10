/**
 * Task execution status
 */
export type TaskStatus = "pending" | "running" | "success" | "error";

/**
 * Events that can trigger webhooks
 */
export type WebhookEvent = "success" | "error" | "complete";

/**
 * Webhook configuration for task notifications
 */
export interface TaskWebhook {
  url: string;
  events: WebhookEvent[];
  headers?: Record<string, string>;
}

/**
 * Result of a webhook execution
 */
export interface WebhookResult {
  url: string;
  status: "success" | "error";
  statusCode?: number;
  error?: string;
}

/**
 * A single execution run of a scheduled task
 */
export interface TaskRun {
  id: string;
  taskId: string;
  startedAt: Date;
  completedAt?: Date;
  status: TaskStatus;
  error?: string;
  /** Generic metadata for execution context (e.g., sessionId, output) */
  metadata?: Record<string, unknown>;
  webhookResults?: WebhookResult[];
}

/**
 * A scheduled task definition
 */
export interface ScheduledTask {
  id: string;
  name: string;
  cronSchedule: string;
  enabled: boolean;
  /** Generic metadata for task-specific data (e.g., prompt, sessionMode) */
  metadata?: Record<string, unknown>;
  webhooks?: TaskWebhook[];
  lastRunAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating a new task
 */
export interface CreateTaskInput {
  id?: string;
  name: string;
  cronSchedule: string;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
  webhooks?: TaskWebhook[];
}

/**
 * Input for updating an existing task
 */
export interface UpdateTaskInput {
  name?: string;
  cronSchedule?: string;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
  webhooks?: TaskWebhook[];
}

/**
 * Callback function that executes a task.
 * Implementations should perform the actual work and throw on error.
 */
export type TaskExecutor = (task: ScheduledTask, run: TaskRun) => Promise<void>;

/**
 * Options for configuring the TaskScheduler
 */
export interface SchedulerOptions {
  /** Polling interval in milliseconds (default: 60000) */
  pollIntervalMs?: number;
  /** Function that executes tasks */
  executor: TaskExecutor;
  /** Storage backend for tasks and run history */
  storage: TaskStorage;
  /** Callback for handling execution errors */
  onError?: (task: ScheduledTask, error: Error) => void;
  /** Callback for handling successful task completion */
  onSuccess?: (task: ScheduledTask, run: TaskRun) => void;
  /** Whether to execute webhooks (default: true) */
  webhooksEnabled?: boolean;
  /** Custom ID generator function (default: crypto.randomUUID) */
  generateId?: () => string;
}

/**
 * Storage interface for task persistence.
 * Implement this interface to provide custom storage backends.
 */
export interface TaskStorage {
  // Task CRUD
  listTasks(): Promise<ScheduledTask[]>;
  getTask(taskId: string): Promise<ScheduledTask | null>;
  createTask(input: CreateTaskInput): Promise<ScheduledTask>;
  updateTask(taskId: string, input: UpdateTaskInput): Promise<ScheduledTask | null>;
  deleteTask(taskId: string): Promise<boolean>;
  updateLastRunAt(taskId: string, lastRunAt: Date): Promise<void>;

  // Run history
  recordRun(run: TaskRun): Promise<void>;
  updateRun(
    runId: string,
    updates: {
      status?: TaskStatus;
      completedAt?: Date;
      error?: string;
      metadata?: Record<string, unknown>;
      webhookResults?: WebhookResult[];
    }
  ): Promise<void>;
  getRunHistory(taskId: string, limit?: number): Promise<TaskRun[]>;
}
