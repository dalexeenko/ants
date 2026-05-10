import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AntsServerClient } from './client.js';

describe('AntsServerClient', () => {
  let client: AntsServerClient;
  let mockFetch: ReturnType<typeof vi.fn>;
  
  beforeEach(() => {
    client = new AntsServerClient({
      baseUrl: 'http://localhost:6647',
      secret: 'test-secret',
    });
    
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });
  
  describe('health', () => {
    it('should return health status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ok' }),
      });
      
      const result = await client.health();
      
      expect(result).toEqual({ status: 'ok' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:6647/health',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-secret',
          }),
        })
      );
    });
  });
  
  describe('info', () => {
    it('should return server info', async () => {
      const serverInfo = {
        version: '0.1.0',
        dataDir: '/data',
        workspacesDir: '/workspaces',
      };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => serverInfo,
      });
      
      const result = await client.info();
      
      expect(result).toEqual(serverInfo);
    });
  });
  
  describe('projects', () => {
    it('should list projects', async () => {
      const projects = [
        { id: 'project-1', name: 'Test Project', workingDirectory: '/test', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      ];
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects }),
      });
      
      const result = await client.listProjects();
      
      expect(result.projects).toEqual(projects);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:6647/projects',
        expect.objectContaining({ method: 'GET' })
      );
    });
    
    it('should get project by id', async () => {
      const project = { id: 'project-1', name: 'Test Project', workingDirectory: '/test', createdAt: '2024-01-01', updatedAt: '2024-01-01' };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => project,
      });
      
      const result = await client.getProject('project-1');
      
      expect(result).toEqual(project);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:6647/projects/project-1',
        expect.objectContaining({ method: 'GET' })
      );
    });
    
    it('should create project', async () => {
      const newProject = { id: 'project-2', name: 'New Project', workingDirectory: '/new', createdAt: '2024-01-01', updatedAt: '2024-01-01' };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => newProject,
      });
      
      const result = await client.createProject({ name: 'New Project' });
      
      expect(result).toEqual(newProject);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:6647/projects',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'New Project' }),
        })
      );
    });
    
    it('should update project', async () => {
      const updated = { id: 'project-1', name: 'Updated Project', workingDirectory: '/test', createdAt: '2024-01-01', updatedAt: '2024-01-02' };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => updated,
      });
      
      const result = await client.updateProject('project-1', { name: 'Updated Project' });
      
      expect(result).toEqual(updated);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:6647/projects/project-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ name: 'Updated Project' }),
        })
      );
    });
    
    it('should delete project', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });
      
      const result = await client.deleteProject('project-1');
      
      expect(result).toEqual({ success: true });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:6647/projects/project-1',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
    
    it('should restart project', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ port: 19900, pid: 12345 }),
      });
      
      const result = await client.restartProject('project-1');
      
      expect(result).toEqual({ port: 19900, pid: 12345 });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:6647/projects/project-1/restart',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
  
  describe('tasks', () => {
    it('should list tasks for project', async () => {
      const tasks = [
        { id: 'task-1', projectId: 'project-1', name: 'Daily Task', prompt: 'Do something', cronSchedule: '0 9 * * *', enabled: true, sessionMode: 'newEachRun', runHistory: [], createdAt: '2024-01-01', updatedAt: '2024-01-01' },
      ];
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tasks }),
      });
      
      const result = await client.listTasks('project-1');
      
      expect(result.tasks).toEqual(tasks);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:6647/projects/project-1/tasks',
        expect.objectContaining({ method: 'GET' })
      );
    });
    
    it('should get task by id', async () => {
      const task = { id: 'task-1', projectId: 'project-1', name: 'Daily Task', prompt: 'Do something', cronSchedule: '0 9 * * *', enabled: true, sessionMode: 'newEachRun', runHistory: [], createdAt: '2024-01-01', updatedAt: '2024-01-01' };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => task,
      });
      
      const result = await client.getTask('project-1', 'task-1');
      
      expect(result).toEqual(task);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:6647/projects/project-1/tasks/task-1',
        expect.objectContaining({ method: 'GET' })
      );
    });
    
    it('should create task', async () => {
      const newTask = { id: 'task-2', projectId: 'project-1', name: 'New Task', prompt: 'New prompt', cronSchedule: '0 * * * *', enabled: true, sessionMode: 'newEachRun', runHistory: [], createdAt: '2024-01-01', updatedAt: '2024-01-01' };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => newTask,
      });
      
      const result = await client.createTask('project-1', {
        name: 'New Task',
        prompt: 'New prompt',
        cronSchedule: '0 * * * *',
      });
      
      expect(result).toEqual(newTask);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:6647/projects/project-1/tasks',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            name: 'New Task',
            prompt: 'New prompt',
            cronSchedule: '0 * * * *',
          }),
        })
      );
    });
    
    it('should update task', async () => {
      const updated = { id: 'task-1', projectId: 'project-1', name: 'Updated Task', prompt: 'Do something', cronSchedule: '0 9 * * *', enabled: false, sessionMode: 'newEachRun', runHistory: [], createdAt: '2024-01-01', updatedAt: '2024-01-02' };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => updated,
      });
      
      const result = await client.updateTask('project-1', 'task-1', { enabled: false });
      
      expect(result).toEqual(updated);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:6647/projects/project-1/tasks/task-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ enabled: false }),
        })
      );
    });
    
    it('should delete task', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });
      
      const result = await client.deleteTask('project-1', 'task-1');
      
      expect(result).toEqual({ success: true });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:6647/projects/project-1/tasks/task-1',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
    
    it('should run task immediately', async () => {
      const run = { id: 'run-1', startedAt: '2024-01-01T10:00:00Z', status: 'running' };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => run,
      });
      
      const result = await client.runTask('project-1', 'task-1');
      
      expect(result).toEqual(run);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:6647/projects/project-1/tasks/task-1/run',
        expect.objectContaining({ method: 'POST' })
      );
    });
    
    it('should get task history', async () => {
      const history = [
        { id: 'run-1', startedAt: '2024-01-01T10:00:00Z', completedAt: '2024-01-01T10:05:00Z', status: 'completed' },
      ];
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ history }),
      });
      
      const result = await client.getTaskHistory('project-1', 'task-1');
      
      expect(result.history).toEqual(history);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:6647/projects/project-1/tasks/task-1/history',
        expect.objectContaining({ method: 'GET' })
      );
    });
  });
  
  describe('error handling', () => {
    it('should throw on HTTP error with JSON error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ error: 'Project not found' }),
      });
      
      await expect(client.getProject('nonexistent')).rejects.toThrow('HTTP 404: Project not found');
    });
    
    it('should throw on HTTP error with plain text', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });
      
      await expect(client.health()).rejects.toThrow('HTTP 500: Internal Server Error');
    });
  });
});
