import { v4 as uuidv4 } from 'uuid';
import {
  TaskScheduler as GenericTaskScheduler,
  parseNextRun,
  describeCron,
  type ScheduledTask,
  type TaskRun,
  type TaskExecutor,
} from '@ants/agent-scheduler';
import type { ProjectManager } from './project-manager.js';
import { ProjectTaskStorage, type ServerTaskMetadata } from './project-task-storage.js';
import type { DrizzleDB } from '../db/index.js';
import type { PushNotificationService } from './push-notification.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('TaskScheduler');

// Re-export cron utilities for backward compatibility
export { parseNextRun, describeCron };

/**
 * Server-specific task scheduler that manages schedulers for each project.
 * Uses the generic @ants/agent-scheduler under the hood.
 */
export class TaskScheduler {
  private projectManager: ProjectManager;
  private db: DrizzleDB;
  private pushService: PushNotificationService | null;
  private schedulers: Map<string, GenericTaskScheduler> = new Map();
  private storages: Map<string, ProjectTaskStorage> = new Map();
  private running = false;

  constructor(projectManager: ProjectManager, db: DrizzleDB, pushService?: PushNotificationService) {
    this.projectManager = projectManager;
    this.db = db;
    this.pushService = pushService ?? null;
  }

  /**
   * Start the scheduler for all projects
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Initialize schedulers for all existing projects
    const projects = await this.projectManager.listProjects();
    for (const project of projects) {
      await this.ensureSchedulerForProject(project.id);
    }

    log.info('Started');
  }

  /**
   * Stop all project schedulers
   */
  stop(): void {
    for (const scheduler of this.schedulers.values()) {
      scheduler.stop();
    }
    this.schedulers.clear();
    this.storages.clear();
    this.running = false;
    log.info('Stopped');
  }

  /**
   * Get or create a storage adapter for a project
   */
  getStorageForProject(projectId: string): ProjectTaskStorage {
    let storage = this.storages.get(projectId);
    if (!storage) {
      storage = new ProjectTaskStorage(this.db, projectId);
      this.storages.set(projectId, storage);
    }
    return storage;
  }

  /**
   * Ensure a scheduler exists for a project and start it
   */
  private async ensureSchedulerForProject(projectId: string): Promise<GenericTaskScheduler> {
    let scheduler = this.schedulers.get(projectId);
    if (scheduler) {
      return scheduler;
    }

    const storage = this.getStorageForProject(projectId);
    const executor = this.createExecutorForProject(projectId);

    scheduler = new GenericTaskScheduler({
      storage,
      executor,
      pollIntervalMs: 60000,
      webhooksEnabled: true,
      generateId: () => uuidv4(),
      onError: (task, error) => {
        log.error(`Error running task "${task.name}" in project "${projectId}":`, error);
        // Send push notification for task failure
        if (this.pushService) {
          const metadata = task.metadata as ServerTaskMetadata | undefined;
          const sessionId = metadata?.dedicatedSessionId || '';
          this.pushService.notifyTaskComplete(projectId, task.name, sessionId, false).catch((e) => {
            log.warn('Failed to send task failure push notification:', e);
          });
        }
      },
      onSuccess: (task, run) => {
        log.info(`Task "${task.name}" completed successfully in project "${projectId}"`);
        // Send push notification for task success
        if (this.pushService) {
          const sessionId = (run.metadata as { sessionId?: string })?.sessionId || '';
          this.pushService.notifyTaskComplete(projectId, task.name, sessionId, true).catch((e) => {
            log.warn('Failed to send task success push notification:', e);
          });
        }
      },
    });

    scheduler.start();
    this.schedulers.set(projectId, scheduler);

    return scheduler;
  }

  /**
   * Create an executor function for a specific project
   */
  private createExecutorForProject(projectId: string): TaskExecutor {
    return async (task: ScheduledTask, run: TaskRun) => {
      const client = await this.projectManager.getClient(projectId);
      if (!client) {
        throw new Error('Could not get agent client for project');
      }

      const project = await this.projectManager.getProject(projectId);
      if (!project) {
        throw new Error('Project not found');
      }

      const metadata = task.metadata as ServerTaskMetadata | undefined;
      const prompt = metadata?.prompt ?? '';
      const sessionMode = metadata?.sessionMode ?? 'newEachRun';
      const dedicatedSessionId = metadata?.dedicatedSessionId;

      let sessionId: string;

      if (sessionMode === 'dedicatedSession' && dedicatedSessionId) {
        sessionId = dedicatedSessionId;
      } else {
        // Create a new session using the agent API
        const session = (await client.createSession({
          workingDirectory: project.workingDirectory,
          title: `Task: ${task.name}`,
        })) as { id: string };
        sessionId = session.id;
      }

      // Store sessionId in run metadata for reference
      const storage = this.getStorageForProject(projectId);
      await storage.updateRun(run.id, {
        metadata: { sessionId },
      });

      // Send the prompt
      await client.sendPromptAsync(sessionId, prompt);
    };
  }

  /**
   * Manually trigger a task to run immediately
   */
  async runTaskNow(projectId: string, taskId: string): Promise<TaskRun> {
    const scheduler = await this.ensureSchedulerForProject(projectId);
    return scheduler.runTaskNow(taskId);
  }

  /**
   * Get run history for a task (for backward compatibility)
   */
  async getRunHistory(projectId: string, taskId: string, limit?: number): Promise<TaskRun[]> {
    const storage = this.getStorageForProject(projectId);
    return storage.getRunHistory(taskId, limit);
  }
}
