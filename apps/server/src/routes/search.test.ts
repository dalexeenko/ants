import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSearchRoutes } from './search.js';
import type { ProjectManager } from '../services/project-manager.js';
import type { IAgentClient } from '../services/openmgr-agent-manager.js';

describe('Search Routes', () => {
  let app: Hono;
  let mockProjectManager: Partial<ProjectManager>;
  let mockAgentClient: Partial<IAgentClient>;

  // Sample data matching what agent-server search endpoints return
  const sessionResults = [
    {
      session: {
        id: 'session-1',
        workingDirectory: '/projects/test-project',
        title: 'Test Session for Search',
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        updatedAt: '2026-02-11T00:00:00.000Z',
      },
    },
    {
      session: {
        id: 'session-2',
        workingDirectory: '/projects/another-project',
        title: 'Python Discussion',
        provider: 'openai',
        model: 'gpt-4',
        updatedAt: '2026-02-10T00:00:00.000Z',
      },
    },
  ];

  const messageResults = [
    {
      message: { id: 'msg-1', role: 'user', content: 'Hello, can you help me with TypeScript?', sessionId: 'session-1' },
      session: { id: 'session-1', title: 'Test Session for Search' },
      snippet: '...help me with TypeScript?...',
    },
    {
      message: { id: 'msg-2', role: 'assistant', content: 'Of course! I would be happy to help you with TypeScript.', sessionId: 'session-1' },
      session: { id: 'session-1', title: 'Test Session for Search' },
      snippet: '...help you with TypeScript...',
    },
  ];

  beforeEach(() => {
    mockAgentClient = {
      isHealthy: vi.fn().mockResolvedValue(true),
      searchSessions: vi.fn().mockResolvedValue({
        results: sessionResults,
        pagination: { limit: 50, offset: 0, count: 2 },
      }),
      searchMessages: vi.fn().mockResolvedValue({
        results: messageResults,
        pagination: { limit: 100, offset: 0, count: 2 },
      }),
    };

    mockProjectManager = {
      listProjects: vi.fn().mockResolvedValue([
        { id: 'project-1', name: 'Test Project', workingDirectory: '/projects/test-project' },
      ]),
      getClient: vi.fn().mockResolvedValue(mockAgentClient),
    };

    app = new Hono();
    const searchRoutes = createSearchRoutes(mockProjectManager as ProjectManager);
    app.route('/search', searchRoutes);
  });

  describe('GET /search/sessions', () => {
    it('should return all sessions when no query', async () => {
      const res = await app.request('/search/sessions');
      expect(res.status).toBe(200);

      const data = await res.json() as any;
      expect(data.results).toBeDefined();
      expect(data.results.length).toBe(2);
    });

    it('should pass query parameters to agent-server', async () => {
      const res = await app.request('/search/sessions?q=Python&provider=openai');
      expect(res.status).toBe(200);

      expect(mockAgentClient.searchSessions).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'Python',
          provider: 'openai',
        })
      );
    });

    it('should pass filtering parameters', async () => {
      const res = await app.request('/search/sessions?workingDirectory=/projects/test-project&rootOnly=true&includeMessages=true');
      expect(res.status).toBe(200);

      expect(mockAgentClient.searchSessions).toHaveBeenCalledWith(
        expect.objectContaining({
          workingDirectory: '/projects/test-project',
          rootOnly: true,
          includeMessages: true,
        })
      );
    });

    it('should respect limit parameter', async () => {
      const res = await app.request('/search/sessions?limit=1');
      expect(res.status).toBe(200);

      const data = await res.json() as any;
      expect(data.results.length).toBe(1);
      expect(data.pagination.limit).toBe(1);
    });

    it('should respect offset parameter', async () => {
      const res = await app.request('/search/sessions?limit=1&offset=1');
      expect(res.status).toBe(200);

      const data = await res.json() as any;
      expect(data.results.length).toBe(1);
      expect(data.pagination.offset).toBe(1);
    });

    it('should fan out to multiple projects', async () => {
      (mockProjectManager.listProjects as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'project-1', name: 'Project 1' },
        { id: 'project-2', name: 'Project 2' },
      ]);

      const res = await app.request('/search/sessions');
      expect(res.status).toBe(200);

      // getClient should be called for each project
      expect(mockProjectManager.getClient).toHaveBeenCalledTimes(2);
    });

    it('should handle agent-server errors gracefully', async () => {
      (mockProjectManager.getClient as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/search/sessions');
      expect(res.status).toBe(200);

      const data = await res.json() as any;
      expect(data.results).toEqual([]);
    });
  });

  describe('GET /search/messages', () => {
    it('should return 400 when query is missing', async () => {
      const res = await app.request('/search/messages');
      expect(res.status).toBe(400);

      const data = await res.json() as any;
      expect(data.error).toContain('required');
    });

    it('should search messages across projects', async () => {
      const res = await app.request('/search/messages?q=TypeScript');
      expect(res.status).toBe(200);

      const data = await res.json() as any;
      expect(data.results).toBeDefined();
      expect(data.results.length).toBe(2);
    });

    it('should pass parameters to agent-server', async () => {
      const res = await app.request('/search/messages?q=TypeScript&role=user&limit=10');
      expect(res.status).toBe(200);

      expect(mockAgentClient.searchMessages).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'TypeScript',
          role: 'user',
          limit: 10,
        })
      );
    });

    it('should include session context in results', async () => {
      const res = await app.request('/search/messages?q=TypeScript');
      expect(res.status).toBe(200);

      const data = await res.json() as any;
      for (const result of data.results) {
        expect(result.session).toBeDefined();
        expect(result.session.id).toBeDefined();
      }
    });

    it('should include snippets in results', async () => {
      const res = await app.request('/search/messages?q=TypeScript');
      expect(res.status).toBe(200);

      const data = await res.json() as any;
      for (const result of data.results) {
        expect(result.snippet).toBeDefined();
      }
    });

    it('should respect limit parameter', async () => {
      const res = await app.request('/search/messages?q=help&limit=1');
      expect(res.status).toBe(200);

      const data = await res.json() as any;
      expect(data.results.length).toBeLessThanOrEqual(1);
      expect(data.pagination.limit).toBe(1);
    });
  });

  describe('GET /search/messages/stream', () => {
    it('should return 400 when query is missing', async () => {
      const res = await app.request('/search/messages/stream');
      expect(res.status).toBe(400);
    });

    it('should return SSE stream with results', async () => {
      const res = await app.request('/search/messages/stream?q=TypeScript');
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/event-stream');

      const text = await res.text();
      // Should contain data events
      expect(text).toContain('data:');
      // Should contain done event
      expect(text).toContain('"type":"done"');
    });
  });
});
