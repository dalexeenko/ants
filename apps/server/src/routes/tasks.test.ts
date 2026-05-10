import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createTaskRoutes } from './tasks.js';
import type { TaskScheduler } from '../services/task-scheduler.js';
import type { ProjectTaskStorage, ServerTaskMetadata } from '../services/project-task-storage.js';
import type { ScheduledTask, TaskRun } from '@openmgr/agent-scheduler';

describe('tasks routes', () => {
  let app: Hono;
  let mockStorage: Partial<ProjectTaskStorage>;
  let mockTaskScheduler: Partial<TaskScheduler>;
  const testProjectId = 'proj-1';

  const testTask: ScheduledTask = {
    id: 'task-1',
    name: 'Daily Backup',
    cronSchedule: '0 2 * * *',
    enabled: true,
    metadata: {
      projectId: testProjectId,
      prompt: 'Run the backup script and verify it completed successfully',
      sessionMode: 'newEachRun',
    } as ServerTaskMetadata,
    lastRunAt: new Date('2024-01-15T02:00:00.000Z'),
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-15T02:00:00.000Z'),
  };

  const testRunHistory: TaskRun[] = [
    {
      id: 'run-1',
      taskId: 'task-1',
      startedAt: new Date('2024-01-15T02:00:00.000Z'),
      completedAt: new Date('2024-01-15T02:05:00.000Z'),
      status: 'success',
      metadata: { sessionId: 'session-123' },
    },
    {
      id: 'run-2',
      taskId: 'task-1',
      startedAt: new Date('2024-01-14T02:00:00.000Z'),
      completedAt: new Date('2024-01-14T02:03:00.000Z'),
      status: 'success',
      metadata: { sessionId: 'session-122' },
    },
  ];

  const testRun: TaskRun = {
    id: 'run-new',
    taskId: 'task-1',
    startedAt: new Date(),
    status: 'running',
    metadata: { sessionId: 'session-new' },
  };

  beforeEach(() => {
    mockStorage = {
      listTasks: vi.fn().mockResolvedValue([
        testTask,
        {
          id: 'task-2',
          name: 'Weekly Report',
          cronSchedule: '0 9 * * 1',
          enabled: false,
          metadata: {
            projectId: testProjectId,
            prompt: 'Generate the weekly report',
            sessionMode: 'dedicatedSession',
            dedicatedSessionId: 'session-dedicated',
          } as ServerTaskMetadata,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as ScheduledTask,
      ]),
      getTask: vi.fn().mockResolvedValue(testTask),
      createTask: vi.fn().mockResolvedValue({
        id: 'task-new',
        name: 'New Task',
        cronSchedule: '*/5 * * * *',
        enabled: true,
        metadata: {
          projectId: testProjectId,
          prompt: 'Do something new',
          sessionMode: 'newEachRun',
        } as ServerTaskMetadata,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ScheduledTask),
      updateTask: vi.fn().mockResolvedValue({
        ...testTask,
        name: 'Updated Task',
        enabled: false,
      }),
      deleteTask: vi.fn().mockResolvedValue(true),
      getRunHistory: vi.fn().mockResolvedValue(testRunHistory),
    };

    mockTaskScheduler = {
      getStorageForProject: vi.fn().mockReturnValue(mockStorage),
      runTaskNow: vi.fn().mockResolvedValue(testRun),
    };

    app = new Hono();
    const taskRoutes = createTaskRoutes(mockTaskScheduler as TaskScheduler);
    app.route('/projects', taskRoutes);
  });

  describe('GET /projects/:projectId/tasks', () => {
    it('should list all tasks for a project', async () => {
      const res = await app.request(`/projects/${testProjectId}/tasks`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tasks).toHaveLength(2);
      expect(body.tasks[0].name).toBe('Daily Backup');
      expect(body.tasks[0].cronSchedule).toBe('0 2 * * *');
      expect(body.tasks[0].prompt).toBe('Run the backup script and verify it completed successfully');
      expect(body.tasks[1].name).toBe('Weekly Report');
      expect(mockTaskScheduler.getStorageForProject).toHaveBeenCalledWith(testProjectId);
      expect(mockStorage.listTasks).toHaveBeenCalled();
    });

    it('should return empty array when no tasks exist', async () => {
      (mockStorage.listTasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const res = await app.request(`/projects/${testProjectId}/tasks`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tasks).toEqual([]);
    });
  });

  describe('POST /projects/:projectId/tasks', () => {
    it('should create a new task', async () => {
      const res = await app.request(`/projects/${testProjectId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Task',
          prompt: 'Do something new',
          cronSchedule: '*/5 * * * *',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBe('task-new');
      expect(body.name).toBe('New Task');
      expect(body.enabled).toBe(true);
      expect(mockStorage.createTask).toHaveBeenCalledWith(expect.objectContaining({
        name: 'New Task',
        cronSchedule: '*/5 * * * *',
        metadata: expect.objectContaining({
          prompt: 'Do something new',
          projectId: testProjectId,
        }),
      }));
    });

    it('should return 400 when name is missing', async () => {
      const res = await app.request(`/projects/${testProjectId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Do something',
          cronSchedule: '* * * * *',
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('name is required');
    });

    it('should return 400 when prompt is missing', async () => {
      const res = await app.request(`/projects/${testProjectId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Task',
          cronSchedule: '* * * * *',
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('prompt is required');
    });

    it('should return 400 when cronSchedule is missing', async () => {
      const res = await app.request(`/projects/${testProjectId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Task',
          prompt: 'Do something',
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('cronSchedule is required');
    });
  });

  describe('GET /projects/:projectId/tasks/:taskId', () => {
    it('should get task by id', async () => {
      const res = await app.request(`/projects/${testProjectId}/tasks/task-1`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe('task-1');
      expect(body.name).toBe('Daily Backup');
      expect(body.cronSchedule).toBe('0 2 * * *');
      expect(body.enabled).toBe(true);
      expect(body.runHistory).toHaveLength(2);
      expect(mockStorage.getTask).toHaveBeenCalledWith('task-1');
    });

    it('should return 404 when task not found', async () => {
      (mockStorage.getTask as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request(`/projects/${testProjectId}/tasks/non-existent`);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Task not found');
    });
  });

  describe('PATCH /projects/:projectId/tasks/:taskId', () => {
    it('should update task name', async () => {
      const res = await app.request(`/projects/${testProjectId}/tasks/task-1`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Task' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('Updated Task');
      expect(mockStorage.updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
        name: 'Updated Task',
      }));
    });

    it('should toggle enabled status', async () => {
      const res = await app.request(`/projects/${testProjectId}/tasks/task-1`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });

      expect(res.status).toBe(200);
      expect(mockStorage.updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
        enabled: false,
      }));
    });

    it('should return 404 when task not found', async () => {
      (mockStorage.updateTask as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request(`/projects/${testProjectId}/tasks/non-existent`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Task not found');
    });
  });

  describe('DELETE /projects/:projectId/tasks/:taskId', () => {
    it('should delete task', async () => {
      const res = await app.request(`/projects/${testProjectId}/tasks/task-1`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(mockStorage.deleteTask).toHaveBeenCalledWith('task-1');
    });

    it('should return 404 when task not found', async () => {
      (mockStorage.deleteTask as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const res = await app.request(`/projects/${testProjectId}/tasks/non-existent`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Task not found');
    });
  });

  describe('POST /projects/:projectId/tasks/:taskId/run', () => {
    it('should run task immediately', async () => {
      const res = await app.request(`/projects/${testProjectId}/tasks/task-1/run`, {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe('run-new');
      expect(body.status).toBe('running');
      expect(body.sessionId).toBe('session-new');
      expect(mockTaskScheduler.runTaskNow).toHaveBeenCalledWith(testProjectId, 'task-1');
    });

    it('should return 400 when task not found', async () => {
      (mockTaskScheduler.runTaskNow as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Task not found')
      );

      const res = await app.request(`/projects/${testProjectId}/tasks/non-existent/run`, {
        method: 'POST',
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Task not found');
    });
  });

  describe('GET /projects/:projectId/tasks/:taskId/history', () => {
    it('should get task run history', async () => {
      const res = await app.request(`/projects/${testProjectId}/tasks/task-1/history`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.history).toHaveLength(2);
      expect(body.history[0].id).toBe('run-1');
      expect(body.history[0].status).toBe('success');
      expect(body.history[1].id).toBe('run-2');
    });

    it('should return empty history for new task', async () => {
      (mockStorage.getRunHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const res = await app.request(`/projects/${testProjectId}/tasks/task-1/history`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.history).toEqual([]);
    });

    it('should return 404 when task not found', async () => {
      (mockStorage.getTask as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request(`/projects/${testProjectId}/tasks/non-existent/history`);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Task not found');
    });
  });
});
