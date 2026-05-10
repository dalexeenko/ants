import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createUsageRoutes } from './usage.js';
import type { ProjectManager } from '../services/project-manager.js';

describe('usage routes', () => {
  let app: Hono;
  let mockProjectManager: Partial<ProjectManager>;
  let mockAgentClient: any;

  const testUsage = {
    totalTokens: 1500,
    inputTokens: 1000,
    outputTokens: 500,
    sessions: [{ id: 'sess-1', tokens: 1500 }],
  };

  beforeEach(() => {
    mockAgentClient = {
      getUsage: vi.fn().mockResolvedValue(testUsage),
    };

    mockProjectManager = {
      getProject: vi.fn().mockResolvedValue({ id: 'proj-1', name: 'Test' }),
      getClient: vi.fn().mockResolvedValue(mockAgentClient),
    };

    app = new Hono();
    const routes = createUsageRoutes(mockProjectManager as ProjectManager);
    app.route('/api', routes);
  });

  describe('GET /:projectId/usage', () => {
    it('should return usage for a project', async () => {
      const res = await app.request('/api/proj-1/usage');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totalTokens).toBe(1500);
      expect(body.inputTokens).toBe(1000);
      expect(body.outputTokens).toBe(500);
    });

    it('should return 404 when project not found', async () => {
      (mockProjectManager.getProject as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/non-existent/usage');

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Project not found');
    });

    it('should return 503 when agent client not available', async () => {
      (mockProjectManager.getClient as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/proj-1/usage');

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe('Agent client not available for project');
    });

    it('should return 500 when getUsage throws', async () => {
      mockAgentClient.getUsage.mockRejectedValue(new Error('Usage unavailable'));

      const res = await app.request('/api/proj-1/usage');

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Usage unavailable');
    });
  });
});
