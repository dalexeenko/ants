import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createPermissionRoutes } from './permissions.js';
import type { ProjectManager } from '../services/project-manager.js';

describe('permission routes', () => {
  let app: Hono;
  let mockProjectManager: Partial<ProjectManager>;
  let mockAgentClient: any;

  const testConfig = {
    defaultMode: 'ask',
    alwaysAllow: ['read_file'],
    alwaysDeny: ['delete_file'],
    allowAll: false,
  };

  beforeEach(() => {
    mockAgentClient = {
      getPermissionConfig: vi.fn().mockResolvedValue(testConfig),
      updatePermissionConfig: vi.fn().mockResolvedValue(testConfig),
    };

    mockProjectManager = {
      getProject: vi.fn().mockResolvedValue({ id: 'proj-1', name: 'Test' }),
      getClient: vi.fn().mockResolvedValue(mockAgentClient),
    };

    app = new Hono();
    const routes = createPermissionRoutes(mockProjectManager as ProjectManager);
    app.route('/api', routes);
  });

  describe('GET /:projectId/permissions/config', () => {
    it('should return permission config for a project', async () => {
      const res = await app.request('/api/proj-1/permissions/config');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.defaultMode).toBe('ask');
      expect(body.alwaysAllow).toEqual(['read_file']);
      expect(body.alwaysDeny).toEqual(['delete_file']);
      expect(body.allowAll).toBe(false);
    });

    it('should return 404 when project not found', async () => {
      (mockProjectManager.getProject as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/non-existent/permissions/config');

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Project not found');
    });

    it('should return 503 when agent client not available', async () => {
      (mockProjectManager.getClient as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/proj-1/permissions/config');

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe('Agent client not available for project');
    });

    it('should return 500 when getPermissionConfig throws', async () => {
      mockAgentClient.getPermissionConfig.mockRejectedValue(new Error('Connection refused'));

      const res = await app.request('/api/proj-1/permissions/config');

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Connection refused');
    });
  });

  describe('PUT /:projectId/permissions/config', () => {
    it('should update permission config for a project', async () => {
      const newConfig = { defaultMode: 'allow', alwaysAllow: ['bash'], alwaysDeny: [], allowAll: true };
      mockAgentClient.updatePermissionConfig.mockResolvedValue(newConfig);

      const res = await app.request('/api/proj-1/permissions/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.defaultMode).toBe('allow');
      expect(mockAgentClient.updatePermissionConfig).toHaveBeenCalledWith(newConfig);
    });

    it('should return 404 when project not found', async () => {
      (mockProjectManager.getProject as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/non-existent/permissions/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowAll: true }),
      });

      expect(res.status).toBe(404);
    });

    it('should return 503 when agent client not available', async () => {
      (mockProjectManager.getClient as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/proj-1/permissions/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowAll: true }),
      });

      expect(res.status).toBe(503);
    });

    it('should return 500 when updatePermissionConfig throws', async () => {
      mockAgentClient.updatePermissionConfig.mockRejectedValue(new Error('Update failed'));

      const res = await app.request('/api/proj-1/permissions/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowAll: true }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Update failed');
    });
  });
});
