import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createProjectRoutes } from './projects.js';
import type { ProjectManager } from '../services/project-manager.js';
import type { DrizzleDB } from '../db/index.js';
import type { ProjectConfig, AgentConfig } from '../models/project.js';

describe('projects routes', () => {
  let app: Hono;
  let mockProjectManager: Partial<ProjectManager>;
  const testProject: ProjectConfig = {
    id: 'proj-1',
    name: 'Test Project',
    workingDirectory: '/home/user/projects/test',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-15T00:00:00.000Z',
  };

  beforeEach(() => {
    mockProjectManager = {
      listProjects: vi.fn().mockResolvedValue([
        testProject,
        {
          id: 'proj-2',
          name: 'Another Project',
          workingDirectory: '/home/user/projects/another',
          createdAt: new Date('2024-02-01'),
          updatedAt: new Date('2024-02-01'),
        },
      ]),
      getProject: vi.fn().mockResolvedValue(testProject),
      createProject: vi.fn().mockResolvedValue({
        ...testProject,
        id: 'proj-new',
        name: 'New Project',
      }),
      updateProject: vi.fn().mockResolvedValue({
        ...testProject,
        name: 'Updated Project',
      }),
      deleteProject: vi.fn().mockResolvedValue(true),
      restartServer: vi.fn().mockResolvedValue({ port: 8080, pid: 12345 }),
      getAgentConfig: vi.fn().mockResolvedValue({
        model: 'claude-3-opus',
        maxTokens: 4096,
        systemPrompt: 'You are a helpful assistant.',
      }),
      updateAgentConfig: vi.fn().mockResolvedValue(true),
    };

    app = new Hono();
    const mockDb = {} as DrizzleDB;
    const projectRoutes = createProjectRoutes(mockProjectManager as ProjectManager, mockDb);
    app.route('/projects', projectRoutes);
  });

  describe('GET /projects', () => {
    it('should list all projects', async () => {
      const res = await app.request('/projects');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.projects).toHaveLength(2);
      expect(body.projects[0].name).toBe('Test Project');
      expect(body.projects[1].name).toBe('Another Project');
    });

    it('should return empty array when no projects exist', async () => {
      (mockProjectManager.listProjects as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const res = await app.request('/projects');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.projects).toEqual([]);
    });
  });

  describe('POST /projects', () => {
    it('should create a new project', async () => {
      const res = await app.request('/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Project',
          workingDirectory: '/home/user/projects/new',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBe('proj-new');
      expect(body.name).toBe('New Project');
      expect(mockProjectManager.createProject).toHaveBeenCalledWith({
        name: 'New Project',
        workingDirectory: '/home/user/projects/new',
      }, 'system');
    });

    it('should return 400 when name is missing', async () => {
      const res = await app.request('/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workingDirectory: '/some/path' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('name is required');
    });

    it('should create project with minimal data', async () => {
      const res = await app.request('/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Minimal Project' }),
      });

      expect(res.status).toBe(201);
      expect(mockProjectManager.createProject).toHaveBeenCalledWith({
        name: 'Minimal Project',
      }, 'system');
    });
  });

  describe('GET /projects/:id', () => {
    it('should get project by id', async () => {
      const res = await app.request('/projects/proj-1');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe('proj-1');
      expect(body.name).toBe('Test Project');
      expect(body.workingDirectory).toBe('/home/user/projects/test');
    });

    it('should return 404 when project not found', async () => {
      (mockProjectManager.getProject as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/projects/non-existent');

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Project not found');
    });
  });

  describe('PATCH /projects/:id', () => {
    it('should update project name', async () => {
      const res = await app.request('/projects/proj-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Project' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('Updated Project');
      expect(mockProjectManager.updateProject).toHaveBeenCalledWith('proj-1', {
        name: 'Updated Project',
      });
    });

    it('should update multiple fields', async () => {
      const res = await app.request('/projects/proj-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Updated Project',
          workingDirectory: '/new/path',
        }),
      });

      expect(res.status).toBe(200);
      expect(mockProjectManager.updateProject).toHaveBeenCalledWith('proj-1', {
        name: 'Updated Project',
        workingDirectory: '/new/path',
      });
    });

    it('should return 404 when project not found', async () => {
      (mockProjectManager.updateProject as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/projects/non-existent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Project not found');
    });
  });

  describe('PATCH /projects/:id (worktreeEnabled)', () => {
    it('should update worktreeEnabled', async () => {
      (mockProjectManager.updateProject as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...testProject,
        worktreeEnabled: true,
      });

      const res = await app.request('/projects/proj-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worktreeEnabled: true }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.worktreeEnabled).toBe(true);
      expect(mockProjectManager.updateProject).toHaveBeenCalledWith('proj-1', {
        worktreeEnabled: true,
      });
    });

    it('should accept worktreeEnabled: false', async () => {
      (mockProjectManager.updateProject as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...testProject,
        worktreeEnabled: false,
      });

      const res = await app.request('/projects/proj-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worktreeEnabled: false }),
      });

      expect(res.status).toBe(200);
      expect(mockProjectManager.updateProject).toHaveBeenCalledWith('proj-1', {
        worktreeEnabled: false,
      });
    });
  });

  describe('DELETE /projects/:id', () => {
    it('should delete project', async () => {
      const res = await app.request('/projects/proj-1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(mockProjectManager.deleteProject).toHaveBeenCalledWith('proj-1');
    });

    it('should return 404 when project not found', async () => {
      (mockProjectManager.deleteProject as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const res = await app.request('/projects/non-existent', { method: 'DELETE' });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Project not found');
    });
  });

  describe('POST /projects/:id/restart', () => {
    it('should restart project server', async () => {
      const res = await app.request('/projects/proj-1/restart', { method: 'POST' });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.port).toBe(8080);
      expect(body.pid).toBe(12345);
      expect(mockProjectManager.restartServer).toHaveBeenCalledWith('proj-1');
    });

    it('should return 404 when project not found', async () => {
      (mockProjectManager.restartServer as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/projects/non-existent/restart', { method: 'POST' });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Project not found');
    });
  });

  describe('GET /projects/:id/config', () => {
    it('should get agent config', async () => {
      const res = await app.request('/projects/proj-1/config');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.config).toBeDefined();
      expect(body.config.model).toBe('claude-3-opus');
      expect(body.config.maxTokens).toBe(4096);
      expect(body.config.systemPrompt).toBe('You are a helpful assistant.');
    });

    it('should return empty config when not set', async () => {
      (mockProjectManager.getAgentConfig as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const res = await app.request('/projects/proj-1/config');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.config).toEqual({});
    });

    it('should return 404 when project not found', async () => {
      (mockProjectManager.getAgentConfig as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/projects/non-existent/config');

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Project not found');
    });
  });

  describe('PUT /projects/:id/config', () => {
    it('should update agent config', async () => {
      const newConfig: AgentConfig = {
        model: 'claude-3-sonnet',
        maxTokens: 8192,
        temperature: 0.7,
      };

      const res = await app.request('/projects/proj-1/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(mockProjectManager.updateAgentConfig).toHaveBeenCalledWith('proj-1', newConfig);
    });

    it('should update partial config', async () => {
      const res = await app.request('/projects/proj-1/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4' }),
      });

      expect(res.status).toBe(200);
      expect(mockProjectManager.updateAgentConfig).toHaveBeenCalledWith('proj-1', {
        model: 'gpt-4',
      });
    });

    it('should return 404 when project not found', async () => {
      (mockProjectManager.updateAgentConfig as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const res = await app.request('/projects/non-existent/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'test' }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Project not found');
    });
  });
});
