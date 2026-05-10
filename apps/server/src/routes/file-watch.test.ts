import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createFileWatchRoutes } from './file-watch.js';
import type { ProjectManager } from '../services/project-manager.js';

describe('file-watch routes', () => {
  let app: Hono;
  let mockProjectManager: Partial<ProjectManager>;
  let mockAgentClient: any;

  beforeEach(() => {
    mockAgentClient = {
      watchFile: vi.fn().mockResolvedValue({ success: true }),
      unwatchFile: vi.fn().mockResolvedValue({ success: true }),
    };

    mockProjectManager = {
      getProject: vi.fn().mockResolvedValue({ id: 'proj-1', name: 'Test' }),
      getClient: vi.fn().mockResolvedValue(mockAgentClient),
    };

    app = new Hono();
    const routes = createFileWatchRoutes(mockProjectManager as ProjectManager);
    app.route('/api', routes);
  });

  describe('POST /:projectId/files/watch', () => {
    it('should watch a file path', async () => {
      const res = await app.request('/api/proj-1/files/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/src/index.ts' }),
      });

      expect(res.status).toBe(200);
      expect(mockAgentClient.watchFile).toHaveBeenCalledWith('/src/index.ts');
    });

    it('should return 400 when path is missing', async () => {
      const res = await app.request('/api/proj-1/files/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('path is required');
    });

    it('should return 404 when project not found', async () => {
      (mockProjectManager.getProject as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/non-existent/files/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/src/index.ts' }),
      });

      expect(res.status).toBe(404);
    });

    it('should return 503 when agent client not available', async () => {
      (mockProjectManager.getClient as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/proj-1/files/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/src/index.ts' }),
      });

      expect(res.status).toBe(503);
    });

    it('should return 500 when watchFile throws', async () => {
      mockAgentClient.watchFile.mockRejectedValue(new Error('Watch failed'));

      const res = await app.request('/api/proj-1/files/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/bad/path' }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Watch failed');
    });
  });

  describe('DELETE /:projectId/files/watch', () => {
    it('should unwatch a file path', async () => {
      const res = await app.request('/api/proj-1/files/watch', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/src/index.ts' }),
      });

      expect(res.status).toBe(200);
      expect(mockAgentClient.unwatchFile).toHaveBeenCalledWith('/src/index.ts');
    });

    it('should return 400 when path is missing', async () => {
      const res = await app.request('/api/proj-1/files/watch', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('path is required');
    });

    it('should return 404 when project not found', async () => {
      (mockProjectManager.getProject as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/non-existent/files/watch', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/src/index.ts' }),
      });

      expect(res.status).toBe(404);
    });

    it('should return 503 when agent client not available', async () => {
      (mockProjectManager.getClient as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/proj-1/files/watch', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/src/index.ts' }),
      });

      expect(res.status).toBe(503);
    });

    it('should return 500 when unwatchFile throws', async () => {
      mockAgentClient.unwatchFile.mockRejectedValue(new Error('Unwatch failed'));

      const res = await app.request('/api/proj-1/files/watch', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/bad/path' }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Unwatch failed');
    });
  });
});
