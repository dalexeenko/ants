import type {
  TaskStorage,
  ScheduledTask,
  TaskRun,
  CreateTaskInput,
  UpdateTaskInput,
  TaskStatus,
  WebhookResult,
} from "../types.js";

/**
 * Options for InMemoryTaskStorage
 */
export interface InMemoryTaskStorageOptions {
  /** Maximum number of runs to keep per task (default: 100) */
  maxRunsPerTask?: number;
  /** Custom ID generator function (default: crypto.randomUUID) */
  generateId?: () => string;
}

/**
 * In-memory implementation of TaskStorage.
 * Useful for testing or ephemeral use cases.
 */
export class InMemoryTaskStorage implements TaskStorage {
  private tasks: Map<string, ScheduledTask> = new Map();
  private runs: Map<string, TaskRun[]> = new Map(); // taskId -> runs (most recent first)
  private runIndex: Map<string, TaskRun> = new Map(); // runId -> run (for fast lookup)
  private maxRunsPerTask: number;
  private generateId: () => string;

  constructor(options?: InMemoryTaskStorageOptions) {
    this.maxRunsPerTask = options?.maxRunsPerTask ?? 100;
    this.generateId = options?.generateId ?? (() => crypto.randomUUID());
  }

  // ============================================================================
  // Task CRUD
  // ============================================================================

  async listTasks(): Promise<ScheduledTask[]> {
    return Array.from(this.tasks.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  async getTask(taskId: string): Promise<ScheduledTask | null> {
    return this.tasks.get(taskId) ?? null;
  }

  async createTask(input: CreateTaskInput): Promise<ScheduledTask> {
    const now = new Date();
    const task: ScheduledTask = {
      id: input.id ?? this.generateId(),
      name: input.name,
      cronSchedule: input.cronSchedule,
      enabled: input.enabled ?? true,
      metadata: input.metadata,
      webhooks: input.webhooks,
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.set(task.id, task);
    this.runs.set(task.id, []);

    return task;
  }

  async updateTask(
    taskId: string,
    input: UpdateTaskInput
  ): Promise<ScheduledTask | null> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return null;
    }

    const updated: ScheduledTask = {
      ...task,
      ...(input.name !== undefined && { name: input.name }),
      ...(input.cronSchedule !== undefined && { cronSchedule: input.cronSchedule }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      ...(input.metadata !== undefined && { metadata: input.metadata }),
      ...(input.webhooks !== undefined && { webhooks: input.webhooks }),
      updatedAt: new Date(),
    };

    this.tasks.set(taskId, updated);
    return updated;
  }

  async deleteTask(taskId: string): Promise<boolean> {
    if (!this.tasks.has(taskId)) {
      return false;
    }

    // Clean up runs
    const taskRuns = this.runs.get(taskId) ?? [];
    for (const run of taskRuns) {
      this.runIndex.delete(run.id);
    }
    this.runs.delete(taskId);

    this.tasks.delete(taskId);
    return true;
  }

  async updateLastRunAt(taskId: string, lastRunAt: Date): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task) {
      task.lastRunAt = lastRunAt;
      task.updatedAt = new Date();
    }
  }

  // ============================================================================
  // Run History
  // ============================================================================

  async recordRun(run: TaskRun): Promise<void> {
    const taskRuns = this.runs.get(run.taskId);
    if (!taskRuns) {
      // Task doesn't exist, but we still record the run
      this.runs.set(run.taskId, [run]);
    } else {
      // Add to front (most recent first)
      taskRuns.unshift(run);

      // Prune if over limit
      while (taskRuns.length > this.maxRunsPerTask) {
        const removed = taskRuns.pop();
        if (removed) {
          this.runIndex.delete(removed.id);
        }
      }
    }

    this.runIndex.set(run.id, run);
  }

  async updateRun(
    runId: string,
    updates: {
      status?: TaskStatus;
      completedAt?: Date;
      error?: string;
      metadata?: Record<string, unknown>;
      webhookResults?: WebhookResult[];
    }
  ): Promise<void> {
    const run = this.runIndex.get(runId);
    if (!run) return;

    if (updates.status !== undefined) run.status = updates.status;
    if (updates.completedAt !== undefined) run.completedAt = updates.completedAt;
    if (updates.error !== undefined) run.error = updates.error;
    if (updates.metadata !== undefined) {
      run.metadata = { ...run.metadata, ...updates.metadata };
    }
    if (updates.webhookResults !== undefined) {
      run.webhookResults = updates.webhookResults;
    }
  }

  async getRunHistory(taskId: string, limit?: number): Promise<TaskRun[]> {
    const taskRuns = this.runs.get(taskId) ?? [];
    if (limit !== undefined && limit > 0) {
      return taskRuns.slice(0, limit);
    }
    return [...taskRuns];
  }

  // ============================================================================
  // Utility Methods (not part of interface)
  // ============================================================================

  /**
   * Clear all tasks and runs (useful for testing)
   */
  clear(): void {
    this.tasks.clear();
    this.runs.clear();
    this.runIndex.clear();
  }

  /**
   * Get the total number of tasks
   */
  getTaskCount(): number {
    return this.tasks.size;
  }

  /**
   * Get the total number of runs across all tasks
   */
  getRunCount(): number {
    return this.runIndex.size;
  }
}
