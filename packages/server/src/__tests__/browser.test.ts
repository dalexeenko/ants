import { describe, it, expect, vi } from 'vitest';
import { createServer } from '../index.js';
import type { ServerAgent } from '../index.js';
import type { Message } from '@openmgr/agent-core';
import type { BrowserController, BrowserInstance } from '@openmgr/agent-browser-core';
import { isScreencastUrl } from '../routes/screencast.js';

// ============ Helpers ============

function createMockBrowserInstance(id: string, overrides: Partial<BrowserInstance> = {}): BrowserInstance {
  return {
    id,
    url: 'https://example.com',
    title: 'Example Page',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    view: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

function createMockBrowserController(browsers: BrowserInstance[] = []): BrowserController {
  const browserMap = new Map(browsers.map((b) => [b.id, b]));

  return {
    platform: 'sandbox',
    create: vi.fn(),
    close: vi.fn(),
    closeAll: vi.fn(),
    get: (id: string) => browserMap.get(id),
    getAll: () => [...browserMap.values()],
    navigate: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    click: vi.fn(),
    type: vi.fn(),
    screenshot: vi.fn(),
    evaluate: vi.fn(),
    getContent: vi.fn(),
    waitForSelector: vi.fn(),
    scrollTo: vi.fn(),
    setViewportSize: vi.fn(),
    getViewportSize: vi.fn(),
    hover: vi.fn(),
    selectOption: vi.fn(),
    fill: vi.fn(),
    press: vi.fn(),
    onNavigated: vi.fn(),
    onConsole: vi.fn(),
    onError: vi.fn(),
  };
}

function createMockAgent(overrides: Partial<ServerAgent> = {}): ServerAgent {
  const extensions = new Map<string, unknown>();

  return {
    emit: () => true,
    on: () => {},
    off: () => {},
    getConfig: () => ({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      workingDirectory: '/tmp/test',
    }),
    setExtension: (key: string, value: unknown) => extensions.set(key, value),
    getExtension: <T>(key: string) => extensions.get(key) as T | undefined,
    prompt: async () => ({ id: 'r', role: 'assistant', content: '', createdAt: Date.now() } as Message),
    abort: vi.fn(),
    getMessages: () => [],
    setMessages: () => {},
    clearMessages: () => {},
    getAvailableProviders: () => ['anthropic'],
    getTools: () => [],
    ...overrides,
  };
}

// ============ Tests ============

describe('isScreencastUrl', () => {
  it('should match valid screencast URLs', () => {
    expect(isScreencastUrl('/session/abc-123/browser/brw-456/screencast')).toBe(true);
    expect(isScreencastUrl('/session/sess1/browser/b1/screencast')).toBe(true);
  });

  it('should not match non-screencast URLs', () => {
    expect(isScreencastUrl('/session/abc/browser/b1')).toBe(false);
    expect(isScreencastUrl('/session/abc/browser')).toBe(false);
    expect(isScreencastUrl('/health')).toBe(false);
    expect(isScreencastUrl('/session/abc/prompt')).toBe(false);
    expect(isScreencastUrl('')).toBe(false);
  });

  it('should not match partial screencast paths', () => {
    expect(isScreencastUrl('/session/abc/browser/b1/screencast/extra')).toBe(false);
    expect(isScreencastUrl('/prefix/session/abc/browser/b1/screencast')).toBe(false);
  });
});

describe('Browser REST Routes', () => {
  const browser1 = createMockBrowserInstance('brw-1', { url: 'https://example.com', title: 'Example' });
  const browser2 = createMockBrowserInstance('brw-2', { url: 'https://github.com', title: 'GitHub' });

  function createAppWithBrowsers(browsers: BrowserInstance[] = []) {
    const controller = createMockBrowserController(browsers);
    const agent = createMockAgent();
    agent.setExtension('sandboxBrowserController', controller);

    // Session agent factory that returns the same agent
    const agentFactory = async () => agent;

    const sessions = {
      createSession: vi.fn(),
      getSession: vi.fn(),
      getRootSessions: vi.fn().mockResolvedValue([]),
      getSessionMessages: vi.fn().mockResolvedValue([]),
      deleteSession: vi.fn(),
    };

    const result = createServer({
      agent: agent as any,
      agentFactory,
      sessions: sessions as any,
    });

    return { app: result, agent, controller };
  }

  describe('GET /session/:sessionId/browser', () => {
    it('should list all browser instances', async () => {
      const { app } = createAppWithBrowsers([browser1, browser2]);

      const res = await app.fetch(
        new Request('http://localhost/session/sess-1/browser'),
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.browsers).toHaveLength(2);
      expect(data.browsers[0].id).toBe('brw-1');
      expect(data.browsers[0].url).toBe('https://example.com');
      expect(data.browsers[1].id).toBe('brw-2');
      expect(data.browsers[1].url).toBe('https://github.com');
    });

    it('should return empty array when no browsers exist', async () => {
      const { app } = createAppWithBrowsers([]);

      const res = await app.fetch(
        new Request('http://localhost/session/sess-1/browser'),
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.browsers).toHaveLength(0);
    });

    it('should return empty array when no browser controller exists', async () => {
      const agent = createMockAgent();
      // No browser controller set

      const result = createServer({
        agent: agent as any,
        agentFactory: async () => agent,
        sessions: {
          createSession: vi.fn(),
          getSession: vi.fn(),
          getRootSessions: vi.fn().mockResolvedValue([]),
          getSessionMessages: vi.fn().mockResolvedValue([]),
          deleteSession: vi.fn(),
        } as any,
      });

      const res = await result.fetch(
        new Request('http://localhost/session/sess-1/browser'),
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.browsers).toHaveLength(0);
    });
  });

  describe('GET /session/:sessionId/browser/:browserId', () => {
    it('should return a specific browser instance', async () => {
      const { app } = createAppWithBrowsers([browser1, browser2]);

      const res = await app.fetch(
        new Request('http://localhost/session/sess-1/browser/brw-1'),
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe('brw-1');
      expect(data.url).toBe('https://example.com');
      expect(data.title).toBe('Example');
    });

    it('should return 404 for non-existent browser', async () => {
      const { app } = createAppWithBrowsers([browser1]);

      const res = await app.fetch(
        new Request('http://localhost/session/sess-1/browser/nonexistent'),
      );

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Browser not found');
    });

    it('should return 404 when no browser controller exists', async () => {
      const agent = createMockAgent();

      const result = createServer({
        agent: agent as any,
        agentFactory: async () => agent,
        sessions: {
          createSession: vi.fn(),
          getSession: vi.fn(),
          getRootSessions: vi.fn().mockResolvedValue([]),
          getSessionMessages: vi.fn().mockResolvedValue([]),
          deleteSession: vi.fn(),
        } as any,
      });

      const res = await result.fetch(
        new Request('http://localhost/session/sess-1/browser/brw-1'),
      );

      expect(res.status).toBe(404);
    });
  });
});
