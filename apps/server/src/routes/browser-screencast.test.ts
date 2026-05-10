import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createBrowserScreencastRoutes } from './browser-screencast.js';
import type { ProjectManager } from '../services/project-manager.js';
import type { OpenMgrAgentManager } from '../services/openmgr-agent-manager.js';

describe('browser-screencast routes', () => {
  let app: Hono;
  let mockProjectManager: Partial<ProjectManager>;
  let mockAgentManager: Partial<OpenMgrAgentManager>;
  let mockFetch: ReturnType<typeof vi.fn>;

  const testBrowsers = [
    { id: 'brw-1', url: 'https://example.com', title: 'Example', loading: false, createdAt: Date.now() },
    { id: 'brw-2', url: 'https://github.com', title: 'GitHub', loading: false, createdAt: Date.now() },
  ];

  beforeEach(() => {
    mockProjectManager = {
      getProject: vi.fn().mockResolvedValue({
        id: 'proj-1',
        name: 'Test Project',
        workingDirectory: '/tmp/test',
      }),
      getClient: vi.fn().mockResolvedValue({}),
    };

    mockAgentManager = {
      getServerPort: vi.fn().mockReturnValue(6700),
    };

    // Mock global fetch for proxy requests
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    app = new Hono();
    const routes = createBrowserScreencastRoutes({
      projectManager: mockProjectManager as ProjectManager,
      agentManager: mockAgentManager as OpenMgrAgentManager,
      upgradeWebSocket: vi.fn(),
      secret: 'test-secret',
    });
    app.route('/projects', routes);
  });

  describe('GET /projects/:projectId/sessions/:sessionId/browser', () => {
    it('should proxy browser list from agent-server', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ browsers: testBrowsers }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const res = await app.request('/projects/proj-1/sessions/sess-1/browser');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.browsers).toHaveLength(2);
      expect(body.browsers[0].id).toBe('brw-1');
      expect(body.browsers[1].id).toBe('brw-2');

      // Verify the fetch was called with the correct upstream URL
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:6700/session/sess-1/browser',
      );
    });

    it('should return empty array when project not found', async () => {
      (mockProjectManager.getProject as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/projects/non-existent/sessions/sess-1/browser');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.browsers).toHaveLength(0);
    });

    it('should return empty array when agent-server not running', async () => {
      (mockAgentManager.getServerPort as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

      const res = await app.request('/projects/proj-1/sessions/sess-1/browser');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.browsers).toHaveLength(0);
    });

    it('should return empty array when upstream fetch fails', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const res = await app.request('/projects/proj-1/sessions/sess-1/browser');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.browsers).toHaveLength(0);
    });

    it('should return empty array when upstream returns error status', async () => {
      mockFetch.mockResolvedValue(
        new Response('Internal Server Error', { status: 500 }),
      );

      const res = await app.request('/projects/proj-1/sessions/sess-1/browser');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.browsers).toHaveLength(0);
    });
  });

  describe('GET /projects/:projectId/sessions/:sessionId/browser/:browserId', () => {
    it('should proxy individual browser details from agent-server', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(testBrowsers[0]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const res = await app.request('/projects/proj-1/sessions/sess-1/browser/brw-1');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe('brw-1');
      expect(body.url).toBe('https://example.com');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:6700/session/sess-1/browser/brw-1',
      );
    });

    it('should return 404 when project not found', async () => {
      (mockProjectManager.getProject as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/projects/non-existent/sessions/sess-1/browser/brw-1');

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Project not found');
    });

    it('should return 503 when agent-server not running', async () => {
      (mockAgentManager.getServerPort as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

      const res = await app.request('/projects/proj-1/sessions/sess-1/browser/brw-1');

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe('Agent server not running');
    });

    it('should forward upstream 404 status', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }),
      );

      const res = await app.request('/projects/proj-1/sessions/sess-1/browser/brw-999');

      expect(res.status).toBe(404);
    });

    it('should return 503 when upstream fetch fails', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const res = await app.request('/projects/proj-1/sessions/sess-1/browser/brw-1');

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe('Failed to reach agent server');
    });
  });
});
