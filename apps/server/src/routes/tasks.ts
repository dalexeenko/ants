import { Hono } from 'hono';
import type { TaskScheduler } from '../services/task-scheduler.js';
import type { ServerTaskMetadata } from '../services/project-task-storage.js';
import type { ScheduledTask as LegacyScheduledTask } from '../models/task.js';
import type { ScheduledTask, TaskRun } from '@openmgr/agent-scheduler';
import type { AuthUser } from '../auth/provider.js';
import { getErrorMessage } from '../utils/errors.js';
import { parseBody } from '../utils/validation.js';
import { CreateTaskSchema, UpdateTaskSchema } from '../schemas/index.js';

/**
 * Convert a TaskRun to the legacy API format with string dates
 */
function toLegacyRun(run: TaskRun) {
  return {
    id: run.id,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString(),
    status: run.status as 'success' | 'error' | 'running',
    sessionId: (run.metadata?.sessionId as string) ?? '',
    error: run.error,
    webhookResults: run.webhookResults,
  };
}

/**
 * Convert the generic ScheduledTask to the legacy format expected by the API
 */
function toLegacyTask(task: ScheduledTask, runHistory: TaskRun[]): LegacyScheduledTask {
  const metadata = task.metadata as ServerTaskMetadata | undefined;
  const legacyHistory = runHistory.map(toLegacyRun);

  return {
    id: task.id,
    name: task.name,
    prompt: metadata?.prompt ?? '',
    cronSchedule: task.cronSchedule,
    enabled: task.enabled,
    sessionMode: metadata?.sessionMode ?? 'newEachRun',
    dedicatedSessionId: metadata?.dedicatedSessionId,
    model: metadata?.model,
    webhooks: task.webhooks,
    lastRunAt: task.lastRunAt?.toISOString(),
    lastRunStatus: legacyHistory[0]?.status,
    lastRunSessionId: legacyHistory[0]?.sessionId,
    runHistory: legacyHistory,
  };
}

export function createTaskRoutes(taskScheduler: TaskScheduler) {
  const app = new Hono();
  
  app.get('/:projectId/tasks', async (c) => {
    const projectId = c.req.param('projectId');
    const storage = taskScheduler.getStorageForProject(projectId);
    const tasks = await storage.listTasks();
    
    // Convert to legacy format with run history
    const legacyTasks = await Promise.all(
      tasks.map(async (task) => {
        const history = await storage.getRunHistory(task.id);
        return toLegacyTask(task, history);
      })
    );
    
    return c.json({ tasks: legacyTasks });
  });
  
  app.post('/:projectId/tasks', async (c) => {
    const projectId = c.req.param('projectId');
    const user = (c as any).get('user') as AuthUser | undefined;
    const body = await parseBody(c, CreateTaskSchema);

    const storage = taskScheduler.getStorageForProject(projectId);
    const task = await storage.createTask({
      name: body.name,
      cronSchedule: body.cronSchedule,
      enabled: body.enabled,
      webhooks: body.webhooks,
      metadata: {
        projectId,
        prompt: body.prompt,
        sessionMode: body.sessionMode,
        model: body.model,
        createdBy: user?.id || 'system',
      } as ServerTaskMetadata,
    });
    
    return c.json(toLegacyTask(task, []), 201);
  });
  
  app.get('/:projectId/tasks/:taskId', async (c) => {
    const projectId = c.req.param('projectId');
    const taskId = c.req.param('taskId');
    const storage = taskScheduler.getStorageForProject(projectId);
    const task = await storage.getTask(taskId);
    
    if (!task) {
      return c.json({ error: 'Task not found' }, 404);
    }
    
    const history = await storage.getRunHistory(taskId);
    return c.json(toLegacyTask(task, history));
  });
  
  app.patch('/:projectId/tasks/:taskId', async (c) => {
    const projectId = c.req.param('projectId');
    const taskId = c.req.param('taskId');
    const body = await parseBody(c, UpdateTaskSchema);
    
    const storage = taskScheduler.getStorageForProject(projectId);
    
    // Build metadata update if needed
    let metadataUpdate: Partial<ServerTaskMetadata> | undefined;
    if (body.prompt !== undefined || body.sessionMode !== undefined || body.model !== undefined) {
      metadataUpdate = {
        projectId,
        prompt: body.prompt,
        sessionMode: body.sessionMode,
        model: body.model,
      };
    }
    
    const task = await storage.updateTask(taskId, {
      name: body.name,
      cronSchedule: body.cronSchedule,
      enabled: body.enabled,
      webhooks: body.webhooks,
      metadata: metadataUpdate,
    });
    
    if (!task) {
      return c.json({ error: 'Task not found' }, 404);
    }
    
    const history = await storage.getRunHistory(taskId);
    return c.json(toLegacyTask(task, history));
  });
  
  app.delete('/:projectId/tasks/:taskId', async (c) => {
    const projectId = c.req.param('projectId');
    const taskId = c.req.param('taskId');
    const storage = taskScheduler.getStorageForProject(projectId);
    const deleted = await storage.deleteTask(taskId);
    
    if (!deleted) {
      return c.json({ error: 'Task not found' }, 404);
    }
    
    return c.json({ success: true });
  });
  
  app.post('/:projectId/tasks/:taskId/run', async (c) => {
    const projectId = c.req.param('projectId');
    const taskId = c.req.param('taskId');
    
    try {
      const run = await taskScheduler.runTaskNow(projectId, taskId);
      return c.json(toLegacyRun(run));
    } catch (err) {
      return c.json({ error: getErrorMessage(err, 'Unknown error') }, 400);
    }
  });
  
  app.get('/:projectId/tasks/:taskId/history', async (c) => {
    const projectId = c.req.param('projectId');
    const taskId = c.req.param('taskId');
    const storage = taskScheduler.getStorageForProject(projectId);
    const task = await storage.getTask(taskId);
    
    if (!task) {
      return c.json({ error: 'Task not found' }, 404);
    }
    
    const history = await storage.getRunHistory(taskId);
    return c.json({ history: history.map(toLegacyRun) });
  });
  
  return app;
}
