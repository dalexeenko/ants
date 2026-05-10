import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createToolsRoutes } from './tools.js';
import type { ProjectManager } from '../services/project-manager.js';

describe('tools routes', () => {
  let app: Hono;
  let mockProjectManager: Partial<ProjectManager>;
  let mockAgentClient: any;

  const testTools = [
    { name: 'bash', description: 'Run bash commands' },
    { name: 'read', description: 'Read files' },
  ];

  beforeEach(() => {
    mockAgentClient = {
      getTools: vi.fn().mockResolvedValue(testTools),
      getDisabledTools: vi.fn().mockResolvedValue({ disabledTools: ['bash'] }),
      setDisabledTools: vi.fn().mockResolvedValue({ disabledTools: ['bash', 'write'] }),
      disableTool: vi.fn().mockResolvedValue({ success: true }),
      enableTool: vi.fn().mockResolvedValue({ success: true }),
    };

    mockProjectManager = {
      getProject: vi.fn().mockResolvedValue({ id: 'proj-1', name: 'Test' }),
      getClient: vi.fn().mockResolvedValue(mockAgentClient),
    };

    app = new Hono();
    const routes = createToolsRoutes(mockProjectManager as ProjectManager);
    app.route('/api', routes);
  });

  describe('GET /:projectId/tools', () => {
    it('should return tools for a project', async () => {
      const res = await app.request('/api/proj-1/tools');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tools).toHaveLength(2);
      expect(body.tools[0].name).toBe('bash');
    });

    it('should return 404 when project not found', async () => {
      (mockProjectManager.getProject as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/non-existent/tools');

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Project not found');
    });

    it('should return 503 when agent client not available', async () => {
      (mockProjectManager.getClient as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/proj-1/tools');

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe('Agent client not available for project');
    });

    it('should return 500 when getTools throws', async () => {
      mockAgentClient.getTools.mockRejectedValue(new Error('Connection refused'));

      const res = await app.request('/api/proj-1/tools');

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Connection refused');
    });
  });

  describe('GET /:projectId/tools/disabled', () => {
    it('should return disabled tools for a project', async () => {
      const res = await app.request('/api/proj-1/tools/disabled');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.disabledTools).toEqual(['bash']);
    });

    it('should return 404 when project not found', async () => {
      (mockProjectManager.getProject as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/non-existent/tools/disabled');

      expect(res.status).toBe(404);
    });

    it('should return 503 when agent client not available', async () => {
      (mockProjectManager.getClient as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/proj-1/tools/disabled');

      expect(res.status).toBe(503);
    });

    it('should return 500 when getDisabledTools throws', async () => {
      mockAgentClient.getDisabledTools.mockRejectedValue(new Error('Failed'));

      const res = await app.request('/api/proj-1/tools/disabled');

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Failed');
    });
  });

  describe('PUT /:projectId/tools/disabled', () => {
    it('should set disabled tools for a project', async () => {
      const res = await app.request('/api/proj-1/tools/disabled', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tools: ['bash', 'write'] }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.disabledTools).toEqual(['bash', 'write']);
      expect(mockAgentClient.setDisabledTools).toHaveBeenCalledWith(['bash', 'write']);
    });

    it('should return 400 when tools is missing', async () => {
      const res = await app.request('/api/proj-1/tools/disabled', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('tools array is required');
    });

    it('should return 404 when project not found', async () => {
      (mockProjectManager.getProject as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/non-existent/tools/disabled', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tools: ['bash'] }),
      });

      expect(res.status).toBe(404);
    });

    it('should return 503 when agent client not available', async () => {
      (mockProjectManager.getClient as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/proj-1/tools/disabled', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tools: ['bash'] }),
      });

      expect(res.status).toBe(503);
    });

    it('should return 500 when setDisabledTools throws', async () => {
      mockAgentClient.setDisabledTools.mockRejectedValue(new Error('Set failed'));

      const res = await app.request('/api/proj-1/tools/disabled', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tools: ['bad'] }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Set failed');
    });
  });

  describe('POST /:projectId/tools/:name/disable', () => {
    it('should disable a specific tool', async () => {
      const res = await app.request('/api/proj-1/tools/bash/disable', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      expect(mockAgentClient.disableTool).toHaveBeenCalledWith('bash');
    });

    it('should return 404 when project not found', async () => {
      (mockProjectManager.getProject as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/non-existent/tools/bash/disable', {
        method: 'POST',
      });

      expect(res.status).toBe(404);
    });

    it('should return 503 when agent client not available', async () => {
      (mockProjectManager.getClient as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/proj-1/tools/bash/disable', {
        method: 'POST',
      });

      expect(res.status).toBe(503);
    });

    it('should return 500 when disableTool throws', async () => {
      mockAgentClient.disableTool.mockRejectedValue(new Error('Disable failed'));

      const res = await app.request('/api/proj-1/tools/bash/disable', {
        method: 'POST',
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Disable failed');
    });
  });

  describe('POST /:projectId/tools/:name/enable', () => {
    it('should enable a specific tool', async () => {
      const res = await app.request('/api/proj-1/tools/bash/enable', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      expect(mockAgentClient.enableTool).toHaveBeenCalledWith('bash');
    });

    it('should return 404 when project not found', async () => {
      (mockProjectManager.getProject as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/non-existent/tools/bash/enable', {
        method: 'POST',
      });

      expect(res.status).toBe(404);
    });

    it('should return 503 when agent client not available', async () => {
      (mockProjectManager.getClient as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/proj-1/tools/bash/enable', {
        method: 'POST',
      });

      expect(res.status).toBe(503);
    });

    it('should return 500 when enableTool throws', async () => {
      mockAgentClient.enableTool.mockRejectedValue(new Error('Enable failed'));

      const res = await app.request('/api/proj-1/tools/bash/enable', {
        method: 'POST',
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Enable failed');
    });
  });
});
