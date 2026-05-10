import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenMgrAgentClient } from './openmgr-agent-client.js';

const BASE_URL = 'http://127.0.0.1:9999';

function mockFetchOk(body: unknown = {}) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function mockFetchFail(status: number, text: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(text),
  });
}

function mockFetchNetworkError() {
  return vi.fn().mockRejectedValue(new TypeError('fetch failed'));
}

describe('OpenMgrAgentClient', () => {
  let client: OpenMgrAgentClient;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    client = new OpenMgrAgentClient(BASE_URL);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ─── Construction ────────────────────────────────────────────────────

  describe('construction', () => {
    it('should store the base URL and use it in requests', async () => {
      const customUrl = 'http://localhost:1234';
      const c = new OpenMgrAgentClient(customUrl);
      globalThis.fetch = mockFetchOk({ data: [] });

      await c.listSessions();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining(customUrl),
        expect.any(Object),
      );
    });
  });

  // ─── Health check ────────────────────────────────────────────────────

  describe('isHealthy', () => {
    it('should return true when server responds with ok', async () => {
      globalThis.fetch = mockFetchOk();
      expect(await client.isHealthy()).toBe(true);
    });

    it('should call GET /health', async () => {
      globalThis.fetch = mockFetchOk();
      await client.isHealthy();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/health`,
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('should return false when server responds with non-ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
      expect(await client.isHealthy()).toBe(false);
    });

    it('should return false when fetch throws (network error)', async () => {
      globalThis.fetch = mockFetchNetworkError();
      expect(await client.isHealthy()).toBe(false);
    });
  });

  // ─── Sessions ────────────────────────────────────────────────────────

  describe('listSessions', () => {
    it('should call GET /beta/conversations', async () => {
      globalThis.fetch = mockFetchOk({ data: [{ id: '1' }], count: 1 });

      const sessions = await client.listSessions();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/beta/conversations`,
        expect.objectContaining({ method: 'GET' }),
      );
      expect(sessions).toEqual([{ id: '1' }]);
    });

    it('should return empty array when data is missing', async () => {
      globalThis.fetch = mockFetchOk({});
      const sessions = await client.listSessions();
      expect(sessions).toEqual([]);
    });

    it('should apply client-side limit', async () => {
      const items = Array.from({ length: 10 }, (_, i) => ({ id: String(i) }));
      globalThis.fetch = mockFetchOk({ data: items });

      const sessions = await client.listSessions(3);
      expect(sessions).toHaveLength(3);
    });

    it('should default limit to 50', async () => {
      const items = Array.from({ length: 60 }, (_, i) => ({ id: String(i) }));
      globalThis.fetch = mockFetchOk({ data: items });

      const sessions = await client.listSessions();
      expect(sessions).toHaveLength(50);
    });
  });

  describe('createSession', () => {
    it('should call POST /session with options', async () => {
      const options = { id: 's1', workingDirectory: '/tmp', title: 'Test', parentId: 'p1' };
      globalThis.fetch = mockFetchOk({ id: 's1' });

      await client.createSession(options);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/session`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(options),
        }),
      );
    });

    it('should call POST /session with empty object when no options', async () => {
      globalThis.fetch = mockFetchOk({ id: 's1' });

      await client.createSession();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/session`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({}),
        }),
      );
    });
  });

  describe('getSession', () => {
    it('should call GET /session/:id', async () => {
      globalThis.fetch = mockFetchOk({ id: 'abc' });

      const result = await client.getSession('abc');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/session/abc`,
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual({ id: 'abc' });
    });
  });

  describe('sendPromptAsync', () => {
    it('should call POST /session/:id/prompt_async with prompt body', async () => {
      globalThis.fetch = mockFetchOk({ status: 'queued' });

      await client.sendPromptAsync('s1', 'hello world');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/session/s1/prompt_async`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ prompt: 'hello world' }),
        }),
      );
    });
  });

  describe('getPromptStreamUrl', () => {
    it('should return the correct SSE stream URL', () => {
      expect(client.getPromptStreamUrl('sess-1')).toBe(
        `${BASE_URL}/session/sess-1/prompt_stream`,
      );
    });
  });

  describe('deleteSession', () => {
    it('should call DELETE /session/:id', async () => {
      globalThis.fetch = mockFetchOk({ success: true });

      await client.deleteSession('s1');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/session/s1`,
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  // ─── Messages ────────────────────────────────────────────────────────

  describe('getMessages', () => {
    it('should call GET /session/:id/message', async () => {
      const messages = { messages: [{ role: 'user', content: 'hi' }] };
      globalThis.fetch = mockFetchOk(messages);

      const result = await client.getMessages('s1');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/session/s1/message`,
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual(messages);
    });
  });

  // ─── Tools ───────────────────────────────────────────────────────────

  describe('getTools', () => {
    it('should return tools from the response', async () => {
      const tools = [
        { name: 'bash', description: 'Run bash commands', available: true },
        { name: 'read', description: 'Read files', available: true },
      ];
      globalThis.fetch = mockFetchOk({ tools });

      const result = await client.getTools();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/tools`,
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual(tools);
    });

    it('should return empty array when tools is missing', async () => {
      globalThis.fetch = mockFetchOk({});
      const result = await client.getTools();
      expect(result).toEqual([]);
    });
  });

  // ─── Providers ───────────────────────────────────────────────────────

  describe('getProviders', () => {
    it('should call GET /provider', async () => {
      globalThis.fetch = mockFetchOk({ providers: [] });

      await client.getProviders();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/provider`,
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  // ─── Abort ───────────────────────────────────────────────────────────

  describe('abortSession', () => {
    it('should call POST /session/:id/abort', async () => {
      globalThis.fetch = mockFetchOk({ success: true });

      const result = await client.abortSession('s1');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/session/s1/abort`,
        expect.objectContaining({ method: 'POST' }),
      );
      expect(result).toEqual({ success: true });
    });
  });

  // ─── Branches ────────────────────────────────────────────────────────

  describe('getBranches', () => {
    it('should call GET /session/:id/branches and return branches array', async () => {
      const branches = [{ id: 'b1', name: 'main' }];
      globalThis.fetch = mockFetchOk({ branches });

      const result = await client.getBranches('s1');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/session/s1/branches`,
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual(branches);
    });
  });

  describe('createBranch', () => {
    it('should call POST /session/:id/branches with name', async () => {
      globalThis.fetch = mockFetchOk({ id: 'b1', name: 'feature' });

      await client.createBranch('s1', 'feature');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/session/s1/branches`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'feature', messageId: undefined }),
        }),
      );
    });

    it('should include messageId when provided', async () => {
      globalThis.fetch = mockFetchOk({ id: 'b1' });

      await client.createBranch('s1', 'feature', 'msg-42');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/session/s1/branches`,
        expect.objectContaining({
          body: JSON.stringify({ name: 'feature', messageId: 'msg-42' }),
        }),
      );
    });
  });

  describe('switchBranch', () => {
    it('should call POST /session/:id/branches/:branchId/switch', async () => {
      globalThis.fetch = mockFetchOk({ success: true });

      await client.switchBranch('s1', 'b1');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/session/s1/branches/b1/switch`,
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should encode branchId in the URL', async () => {
      globalThis.fetch = mockFetchOk({ success: true });

      await client.switchBranch('s1', 'feature/branch name');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/session/s1/branches/${encodeURIComponent('feature/branch name')}/switch`,
        expect.any(Object),
      );
    });
  });

  describe('deleteBranch', () => {
    it('should call DELETE /session/:id/branches/:branchId', async () => {
      globalThis.fetch = mockFetchOk({ success: true });

      await client.deleteBranch('s1', 'b1');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/session/s1/branches/b1`,
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('should encode branchId in the URL', async () => {
      globalThis.fetch = mockFetchOk({});

      await client.deleteBranch('s1', 'my/branch');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/session/s1/branches/${encodeURIComponent('my/branch')}`,
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  // ─── Rollback ────────────────────────────────────────────────────────

  describe('rollback', () => {
    it('should call POST /session/:id/rollback with count', async () => {
      globalThis.fetch = mockFetchOk({ success: true });

      await client.rollback('s1', 3);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/session/s1/rollback`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ count: 3 }),
        }),
      );
    });
  });

  // ─── Permission & Question responses ─────────────────────────────────

  describe('respondToPermission', () => {
    it('should call POST /session/:id/permission/:toolCallId/respond', async () => {
      globalThis.fetch = mockFetchOk({ success: true });

      await client.respondToPermission('s1', 'tc-1', 'allow');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/session/s1/permission/tc-1/respond`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ response: 'allow' }),
        }),
      );
    });

    it('should encode toolCallId in the URL', async () => {
      globalThis.fetch = mockFetchOk({});

      await client.respondToPermission('s1', 'tool/call id', 'deny');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/session/s1/permission/${encodeURIComponent('tool/call id')}/respond`,
        expect.any(Object),
      );
    });
  });

  describe('respondToQuestion', () => {
    it('should call POST /session/:id/question/:questionId/respond with selected', async () => {
      globalThis.fetch = mockFetchOk({ success: true });
      const response = { selected: ['option1', 'option2'] };

      await client.respondToQuestion('s1', 'q1', response);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/session/s1/question/q1/respond`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(response),
        }),
      );
    });

    it('should call POST with freeformText', async () => {
      globalThis.fetch = mockFetchOk({});
      const response = { freeformText: 'my answer' };

      await client.respondToQuestion('s1', 'q1', response);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/session/s1/question/q1/respond`,
        expect.objectContaining({
          body: JSON.stringify(response),
        }),
      );
    });

    it('should encode questionId in the URL', async () => {
      globalThis.fetch = mockFetchOk({});

      await client.respondToQuestion('s1', 'q/id', { selected: [] });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/session/s1/question/${encodeURIComponent('q/id')}/respond`,
        expect.any(Object),
      );
    });
  });

  // ─── Search ──────────────────────────────────────────────────────────

  describe('searchSessions', () => {
    it('should call GET /search/sessions with query params', async () => {
      const searchResult = { results: [], pagination: { limit: 20, offset: 0, count: 0 } };
      globalThis.fetch = mockFetchOk(searchResult);

      await client.searchSessions({
        query: 'test',
        provider: 'anthropic',
        model: 'claude',
        workingDirectory: '/tmp',
        includeMessages: true,
        rootOnly: true,
        limit: 20,
        offset: 5,
        orderBy: 'createdAt',
        orderDirection: 'desc',
      });

      const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      const url = new URL(calledUrl);
      expect(url.pathname).toBe('/search/sessions');
      expect(url.searchParams.get('q')).toBe('test');
      expect(url.searchParams.get('provider')).toBe('anthropic');
      expect(url.searchParams.get('model')).toBe('claude');
      expect(url.searchParams.get('workingDirectory')).toBe('/tmp');
      expect(url.searchParams.get('includeMessages')).toBe('true');
      expect(url.searchParams.get('rootOnly')).toBe('true');
      expect(url.searchParams.get('limit')).toBe('20');
      expect(url.searchParams.get('offset')).toBe('5');
      expect(url.searchParams.get('orderBy')).toBe('createdAt');
      expect(url.searchParams.get('orderDirection')).toBe('desc');
    });

    it('should omit undefined params', async () => {
      globalThis.fetch = mockFetchOk({ results: [], pagination: { limit: 50, offset: 0, count: 0 } });

      await client.searchSessions({ query: 'test' });

      const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      const url = new URL(calledUrl);
      expect(url.searchParams.get('q')).toBe('test');
      expect(url.searchParams.has('provider')).toBe(false);
      expect(url.searchParams.has('model')).toBe(false);
      expect(url.searchParams.has('limit')).toBe(false);
    });

    it('should handle empty params', async () => {
      globalThis.fetch = mockFetchOk({ results: [], pagination: { limit: 50, offset: 0, count: 0 } });

      await client.searchSessions({});

      const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(calledUrl).toContain('/search/sessions');
    });
  });

  describe('searchMessages', () => {
    it('should call GET /search/messages with query params', async () => {
      const searchResult = { results: [], pagination: { limit: 20, offset: 0, count: 0 } };
      globalThis.fetch = mockFetchOk(searchResult);

      await client.searchMessages({
        query: 'hello',
        sessionId: 's1',
        role: 'user',
        limit: 10,
        offset: 0,
      });

      const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      const url = new URL(calledUrl);
      expect(url.pathname).toBe('/search/messages');
      expect(url.searchParams.get('q')).toBe('hello');
      expect(url.searchParams.get('sessionId')).toBe('s1');
      expect(url.searchParams.get('role')).toBe('user');
      expect(url.searchParams.get('limit')).toBe('10');
      expect(url.searchParams.get('offset')).toBe('0');
    });

    it('should omit optional params when not provided', async () => {
      globalThis.fetch = mockFetchOk({ results: [], pagination: { limit: 50, offset: 0, count: 0 } });

      await client.searchMessages({ query: 'foo' });

      const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      const url = new URL(calledUrl);
      expect(url.searchParams.get('q')).toBe('foo');
      expect(url.searchParams.has('sessionId')).toBe(false);
      expect(url.searchParams.has('role')).toBe(false);
    });
  });

  // ─── Plugins ─────────────────────────────────────────────────────────

  describe('getPlugins', () => {
    it('should call GET /plugins', async () => {
      const data = { installed: [{ name: 'plugin-a' }], registered: ['plugin-b'] };
      globalThis.fetch = mockFetchOk(data);

      const result = await client.getPlugins();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/plugins`,
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual(data);
    });
  });

  describe('installPlugin', () => {
    it('should call POST /plugins/install with packageSpec', async () => {
      globalThis.fetch = mockFetchOk({ success: true });

      await client.installPlugin('@openmgr/plugin-git');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/plugins/install`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ packageSpec: '@openmgr/plugin-git' }),
        }),
      );
    });
  });

  describe('uninstallPlugin', () => {
    it('should call POST /plugins/uninstall with packageName', async () => {
      globalThis.fetch = mockFetchOk({ success: true });

      await client.uninstallPlugin('@openmgr/plugin-git');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/plugins/uninstall`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ packageName: '@openmgr/plugin-git' }),
        }),
      );
    });
  });

  // ─── Error handling ──────────────────────────────────────────────────

  describe('error handling', () => {
    it('should throw on non-ok response with status and body text', async () => {
      globalThis.fetch = mockFetchFail(404, 'Not Found');

      await expect(client.getSession('bad-id')).rejects.toThrow(
        'Failed GET /session/bad-id: 404 - Not Found',
      );
    });

    it('should throw on 500 server error', async () => {
      globalThis.fetch = mockFetchFail(500, 'Internal Server Error');

      await expect(client.listSessions()).rejects.toThrow(
        'Failed GET /beta/conversations: 500 - Internal Server Error',
      );
    });

    it('should throw on network error for non-health methods', async () => {
      globalThis.fetch = mockFetchNetworkError();

      await expect(client.getSession('s1')).rejects.toThrow('fetch failed');
    });

    it('should propagate network error on createSession', async () => {
      globalThis.fetch = mockFetchNetworkError();

      await expect(client.createSession()).rejects.toThrow('fetch failed');
    });

    it('should throw on non-ok response for POST methods', async () => {
      globalThis.fetch = mockFetchFail(403, 'Forbidden');

      await expect(client.sendPromptAsync('s1', 'hi')).rejects.toThrow(
        'Failed POST /session/s1/prompt_async: 403 - Forbidden',
      );
    });

    it('should throw on non-ok response for DELETE methods', async () => {
      globalThis.fetch = mockFetchFail(409, 'Conflict');

      await expect(client.deleteSession('s1')).rejects.toThrow(
        'Failed DELETE /session/s1: 409 - Conflict',
      );
    });
  });

  // ─── Headers ─────────────────────────────────────────────────────────

  describe('request headers', () => {
    it('should send Accept and Content-Type JSON headers', async () => {
      globalThis.fetch = mockFetchOk({});

      await client.getProviders();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
        }),
      );
    });

    it('should send JSON headers for health checks too', async () => {
      globalThis.fetch = mockFetchOk();

      await client.isHealthy();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
        }),
      );
    });
  });

  // ─── Body serialization ──────────────────────────────────────────────

  describe('body serialization', () => {
    it('should not send body for GET requests', async () => {
      globalThis.fetch = mockFetchOk({ data: [] });

      await client.listSessions();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ body: undefined }),
      );
    });

    it('should JSON-stringify body for POST requests', async () => {
      globalThis.fetch = mockFetchOk({});

      await client.rollback('s1', 5);

      const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body).toEqual({ count: 5 });
    });
  });
});
