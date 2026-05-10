import { v4 as uuidv4 } from 'uuid';
import { eq, and } from 'drizzle-orm';
import type {
  TaskStorage,
  ScheduledTask,
  TaskRun,
  CreateTaskInput,
  UpdateTaskInput,
  TaskStatus,
  WebhookResult,
} from '@openmgr/agent-scheduler';
import type { DrizzleDB } from '../db/index.js';
import { tasks } from '../db/schema.js';

/**
 * Server-specific task metadata stored in the generic metadata field.
 */
export interface ServerTaskMetadata extends Record<string, unknown> {
  projectId: string;
  prompt: string;
  sessionMode?: 'newEachRun' | 'dedicatedSession';
  dedicatedSessionId?: string;
  model?: string;
}

/**
 * TaskStorage implementation that wraps the server's existing database schema.
 * This adapter allows using the generic @openmgr/agent-scheduler with the
 * server's project-scoped task system.
 */
export class ProjectTaskStorage implements TaskStorage {
  private db: DrizzleDB;
  private projectId: string;
  private runHistory: Map<string, TaskRun[]> = new Map();
  private runIndex: Map<string, TaskRun> = new Map();
  private maxRunsPerTask = 100;

  constructor(db: DrizzleDB, projectId: string) {
    this.db = db;
    this.projectId = projectId;
  }

  // ============================================================================
  // Task CRUD
  // ============================================================================

  async listTasks(): Promise<ScheduledTask[]> {
    const rows = this.db
      .select()
      .from(tasks)
      .where(eq(tasks.projectId, this.projectId))
      .all();

    return rows.map((row) => this.rowToTask(row)).sort((a, b) => a.name.localeCompare(b.name));
  }

  async getTask(taskId: string): Promise<ScheduledTask | null> {
    const rows = this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.projectId, this.projectId)))
      .all();

    if (rows.length === 0) {
      return null;
    }

    return this.rowToTask(rows[0]!);
  }

  async createTask(input: CreateTaskInput): Promise<ScheduledTask> {
    const id = input.id ?? uuidv4();
    const now = new Date();
    const metadata = input.metadata as ServerTaskMetadata | undefined;

    this.db
      .insert(tasks)
      .values({
        id,
        projectId: this.projectId,
        name: input.name,
        prompt: metadata?.prompt ?? '',
        schedule: input.cronSchedule,
        webhookUrl: input.webhooks?.[0]?.url,
        enabled: input.enabled ?? true,
        createdBy: (metadata?.createdBy as string) || null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const task: ScheduledTask = {
      id,
      name: input.name,
      cronSchedule: input.cronSchedule,
      enabled: input.enabled ?? true,
      metadata: {
        ...metadata,
        projectId: this.projectId,
      },
      webhooks: input.webhooks,
      createdAt: now,
      updatedAt: now,
    };

    this.runHistory.set(id, []);
    return task;
  }

  async updateTask(taskId: string, input: UpdateTaskInput): Promise<ScheduledTask | null> {
    const task = await this.getTask(taskId);
    if (!task) {
      return null;
    }

    const updateData: Partial<typeof tasks.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (input.name !== undefined) {
      updateData.name = input.name;
    }
    if (input.cronSchedule !== undefined) {
      updateData.schedule = input.cronSchedule;
    }
    if (input.enabled !== undefined) {
      updateData.enabled = input.enabled;
    }
    if (input.webhooks !== undefined) {
      updateData.webhookUrl = input.webhooks?.[0]?.url;
    }
    if (input.metadata !== undefined) {
      const metadata = input.metadata as Partial<ServerTaskMetadata>;
      if (metadata.prompt !== undefined) {
        updateData.prompt = metadata.prompt;
      }
    }

    this.db
      .update(tasks)
      .set(updateData)
      .where(and(eq(tasks.id, taskId), eq(tasks.projectId, this.projectId)))
      .run();

    // Return updated task
    return this.getTask(taskId);
  }

  async deleteTask(taskId: string): Promise<boolean> {
    const task = await this.getTask(taskId);
    if (!task) {
      return false;
    }

    this.db
      .delete(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.projectId, this.projectId)))
      .run();

    // Clean up run history
    const history = this.runHistory.get(taskId) ?? [];
    for (const run of history) {
      this.runIndex.delete(run.id);
    }
    this.runHistory.delete(taskId);

    return true;
  }

  async updateLastRunAt(taskId: string, lastRunAt: Date): Promise<void> {
    this.db
      .update(tasks)
      .set({
        lastRunAt,
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.projectId, this.projectId)))
      .run();
  }

  // ============================================================================
  // Run History
  // ============================================================================

  async recordRun(run: TaskRun): Promise<void> {
    const history = this.runHistory.get(run.taskId) ?? [];

    // Add to front (most recent first)
    history.unshift(run);

    // Prune if over limit
    while (history.length > this.maxRunsPerTask) {
      const removed = history.pop();
      if (removed) {
        this.runIndex.delete(removed.id);
      }
    }

    this.runHistory.set(run.taskId, history);
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
    const history = this.runHistory.get(taskId) ?? [];
    if (limit !== undefined && limit > 0) {
      return history.slice(0, limit);
    }
    return [...history];
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private rowToTask(row: typeof tasks.$inferSelect): ScheduledTask {
    const metadata: ServerTaskMetadata = {
      projectId: row.projectId,
      prompt: row.prompt,
      sessionMode: 'newEachRun',
    };

    return {
      id: row.id,
      name: row.name,
      cronSchedule: row.schedule ?? '',
      enabled: row.enabled,
      metadata,
      webhooks: row.webhookUrl
        ? [{ url: row.webhookUrl, events: ['complete' as const] }]
        : undefined,
      lastRunAt: row.lastRunAt ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
