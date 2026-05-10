import { parseNextRun } from "./cron.js";
import type {
  ScheduledTask,
  TaskRun,
  TaskStorage,
  TaskExecutor,
  SchedulerOptions,
  TaskWebhook,
  WebhookResult,
} from "./types.js";

/**
 * Default ID generator using crypto.randomUUID
 */
function defaultGenerateId(): string {
  return crypto.randomUUID();
}

/**
 * Generic task scheduler with cron support.
 * 
 * Uses polling to check for tasks that need to run based on their cron schedules.
 * Task execution is delegated to a user-provided executor function.
 */
export class TaskScheduler {
  private storage: TaskStorage;
  private executor: TaskExecutor;
  private pollIntervalMs: number;
  private webhooksEnabled: boolean;
  private generateId: () => string;
  private onError: (task: ScheduledTask, error: Error) => void;
  private onSuccess: (task: ScheduledTask, run: TaskRun) => void;

  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastRunTimes: Map<string, Date> = new Map();

  constructor(options: SchedulerOptions) {
    this.storage = options.storage;
    this.executor = options.executor;
    this.pollIntervalMs = options.pollIntervalMs ?? 60000;
    this.webhooksEnabled = options.webhooksEnabled ?? true;
    this.generateId = options.generateId ?? defaultGenerateId;
    this.onError = options.onError ?? (() => {});
    this.onSuccess = options.onSuccess ?? (() => {});
  }

  /**
   * Start the scheduler polling loop
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.checkTasks(), this.pollIntervalMs);
  }

  /**
   * Stop the scheduler polling loop
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  /**
   * Check if the scheduler is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Manually trigger a task to run immediately
   */
  async runTaskNow(taskId: string): Promise<TaskRun> {
    const task = await this.storage.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return this.executeTask(task);
  }

  /**
   * Force an immediate check of all tasks (useful for testing)
   */
  async checkNow(): Promise<void> {
    await this.checkTasks();
  }

  /**
   * Get the in-memory last run time for a task (used for scheduling decisions)
   */
  getLastRunTime(taskId: string): Date | undefined {
    return this.lastRunTimes.get(taskId);
  }

  /**
   * Check all tasks and run any that are due
   */
  private async checkTasks(): Promise<void> {
    const now = new Date();
    const tasks = await this.storage.listTasks();

    for (const task of tasks) {
      if (!task.enabled) continue;

      if (this.shouldRunTask(task, now)) {
        // Fire-and-forget execution
        this.executeTask(task);
      }
    }
  }

  /**
   * Determine if a task should run based on its cron schedule
   */
  private shouldRunTask(task: ScheduledTask, now: Date): boolean {
    const lastRun =
      this.lastRunTimes.get(task.id) ?? task.lastRunAt ?? null;

    // If never run, find the next scheduled time from now
    // and run if it's in the past or present (edge case for immediate eligibility)
    if (!lastRun) {
      const nextRun = parseNextRun(task.cronSchedule, now);
      // For first run, we consider it due if there's a valid schedule
      // This allows tasks to run on their first check after creation
      return nextRun !== null;
    }

    // Find the next scheduled time after the last run
    const nextRunAfterLast = parseNextRun(task.cronSchedule, lastRun);
    if (!nextRunAfterLast) return false;

    // Run if the next scheduled time after last run has passed
    return nextRunAfterLast <= now;
  }

  /**
   * Execute a task
   */
  private async executeTask(task: ScheduledTask): Promise<TaskRun> {
    const now = new Date();
    this.lastRunTimes.set(task.id, now);

    const run: TaskRun = {
      id: this.generateId(),
      taskId: task.id,
      startedAt: now,
      status: "running",
    };

    // Record the run starting
    await this.storage.recordRun(run);
    await this.storage.updateLastRunAt(task.id, now);

    try {
      // Execute the task via the user-provided executor
      await this.executor(task, run);

      // Execute webhooks on success
      const webhookResults = this.webhooksEnabled
        ? await this.executeWebhooks(task, run, "success")
        : [];

      // Update run status
      const completedAt = new Date();
      await this.storage.updateRun(run.id, {
        status: "success",
        completedAt,
        webhookResults,
      });

      run.status = "success";
      run.completedAt = completedAt;
      run.webhookResults = webhookResults;

      // Call the success callback
      this.onSuccess(task, run);
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      const error = errorObj.message;

      // Call the error callback
      this.onError(task, errorObj);

      // Execute webhooks on error
      const webhookResults = this.webhooksEnabled
        ? await this.executeWebhooks(task, run, "error", error)
        : [];

      // Update run status
      const completedAt = new Date();
      await this.storage.updateRun(run.id, {
        status: "error",
        completedAt,
        error,
        webhookResults,
      });

      run.status = "error";
      run.error = error;
      run.completedAt = completedAt;
      run.webhookResults = webhookResults;
    }

    return run;
  }

  /**
   * Execute webhooks for a task run
   */
  private async executeWebhooks(
    task: ScheduledTask,
    run: TaskRun,
    status: "success" | "error",
    error?: string
  ): Promise<WebhookResult[]> {
    if (!task.webhooks || task.webhooks.length === 0) {
      return [];
    }

    const results: WebhookResult[] = [];

    for (const webhook of task.webhooks) {
      if (!this.shouldFireWebhook(webhook, status)) {
        continue;
      }

      const result = await this.fireWebhook(webhook, task, run, status, error);
      results.push(result);
    }

    return results;
  }

  /**
   * Check if a webhook should fire for a given status
   */
  private shouldFireWebhook(
    webhook: TaskWebhook,
    status: "success" | "error"
  ): boolean {
    return webhook.events.includes(status) || webhook.events.includes("complete");
  }

  /**
   * Fire a single webhook
   */
  private async fireWebhook(
    webhook: TaskWebhook,
    task: ScheduledTask,
    run: TaskRun,
    status: "success" | "error",
    error?: string
  ): Promise<WebhookResult> {
    const payload = {
      event: status,
      task: {
        id: task.id,
        name: task.name,
        metadata: task.metadata,
      },
      run: {
        id: run.id,
        startedAt: run.startedAt.toISOString(),
        status,
        error,
        metadata: run.metadata,
      },
      timestamp: new Date().toISOString(),
    };

    try {
      const response = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...webhook.headers,
        },
        body: JSON.stringify(payload),
      });

      return {
        url: webhook.url,
        status: response.ok ? "success" : "error",
        statusCode: response.status,
        error: response.ok ? undefined : `HTTP ${response.status}`,
      };
    } catch (err) {
      return {
        url: webhook.url,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
