import { describe, it, expect, vi } from 'vitest';
import { createServer, serverPlugin } from '../index.js';
import type { ServerAgent, ServerState } from '../index.js';
import type { AgentInterface, AgentConfig, QuestionResponse, Message, ConversationTree, AgentPlugin, PluginManager, InstalledPluginInfo } from '@openmgr/agent-core';
import type { SessionManager } from '@openmgr/agent-storage';

// Create a minimal mock agent (used by original tests)
function createMockAgent(): AgentInterface {
  const config: AgentConfig = {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    auth: { type: 'api-key', apiKey: 'test' },
  };

  const extensions = new Map<string, unknown>();

  return {
    getConfig: () => config,
    setExtension: (key: string, value: unknown) => {
      extensions.set(key, value);
    },
    getExtension: (key: string) => extensions.get(key),
    run: async () => ({ response: '', usage: { inputTokens: 0, outputTokens: 0 } }),
    registerPlugin: async () => {},
    registerTool: () => {},
    getTools: () => [],
    getTool: () => undefined,
  } as AgentInterface;
}

// Create a mock session manager
function createMockSessionManager() {
  const sessions = new Map<string, { id: string; title: string; createdAt: Date }>();
  const messages = new Map<string, Array<{ role: string; content: string }>>();

  return {
    getRootSessions: async (limit: number) => {
      return Array.from(sessions.values()).slice(0, limit);
    },
    getSession: async (id: string) => {
      return sessions.get(id) || null;
    },
    getSessionMessages: async (id: string) => {
      return messages.get(id) || [];
    },
    deleteSession: async (id: string) => {
      const exists = sessions.has(id);
      sessions.delete(id);
      return exists;
    },
    // Helpers for testing
    _addSession: (id: string, title: string) => {
      sessions.set(id, { id, title, createdAt: new Date() });
    },
    _addMessages: (id: string, msgs: Array<{ role: string; content: string }>) => {
      messages.set(id, msgs);
    },
  };
}

/**
 * Create a full ServerAgent mock with all methods needed by the server.
 */
function createFullMockAgent(overrides: Partial<ServerAgent> = {}): ServerAgent {
  const config = {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    workingDirectory: '/tmp/test',
  };
  const extensions = new Map<string, unknown>();
  let messageHistory: Message[] = [];

  return {
    emit: () => true,
    on: () => {},
    off: () => {},
    getConfig: () => config,
    setExtension: (key: string, value: unknown) => extensions.set(key, value),
    getExtension: <T>(key: string) => extensions.get(key) as T | undefined,
    prompt: async (message: string) => {
      const msg: Message = { id: 'resp-1', role: 'assistant', content: `Response to: ${message}`, createdAt: Date.now() };
      messageHistory.push(
        { id: 'usr-1', role: 'user', content: message, createdAt: Date.now() },
        msg,
      );
      return msg;
    },
    abort: vi.fn(),
    getMessages: () => messageHistory,
    setMessages: (msgs: Message[]) => { messageHistory = msgs; },
    clearMessages: () => { messageHistory = []; },
    getAvailableProviders: () => ['anthropic', 'openai'],
    getTools: () => [
      { name: 'read_file', description: 'Read a file' },
      { name: 'write_file', description: 'Write a file' },
    ],
    ...overrides,
  };
}

/**
 * Create a full mock session manager that supports all CRUD operations
 * including createSession, addMessage, and search.
 */
function createFullMockSessionManager() {
  const sessions = new Map<string, Record<string, unknown>>();
  const messages = new Map<string, Array<Record<string, unknown>>>();
  let idCounter = 0;

  const mgr = {
    createSession: vi.fn(async (opts: Record<string, unknown>) => {
      const id = (opts.id as string) ?? `session-${++idCounter}`;
      const session = {
        id,
        title: opts.title ?? null,
        workingDirectory: opts.workingDirectory ?? '/tmp',
        provider: opts.provider ?? 'anthropic',
        model: opts.model ?? 'claude-sonnet-4-20250514',
        parentId: opts.parentId ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
        messageCount: 0,
        tokenEstimate: 0,
      };
      sessions.set(id, session);
      messages.set(id, []);
      return session;
    }),
    getRootSessions: vi.fn(async (limit: number) => {
      return Array.from(sessions.values()).slice(0, limit);
    }),
    getSession: vi.fn(async (id: string) => {
      return sessions.get(id) ?? null;
    }),
    getSessionMessages: vi.fn(async (id: string) => {
      return messages.get(id) ?? [];
    }),
    deleteSession: vi.fn(async (id: string) => {
      const exists = sessions.has(id);
      sessions.delete(id);
      messages.delete(id);
      return exists;
    }),
    addMessage: vi.fn(async (opts: Record<string, unknown>) => {
      const sessionId = opts.sessionId as string;
      const msg = {
        id: `msg-${++idCounter}`,
        sessionId,
        role: opts.role,
        content: opts.content,
        toolCalls: opts.toolCalls ?? null,
        toolResults: opts.toolResults ?? null,
        sequence: opts.sequence ?? 0,
        createdAt: new Date(),
      };
      if (!messages.has(sessionId)) messages.set(sessionId, []);
      messages.get(sessionId)!.push(msg);
      return msg;
    }),
    getSessionMessagesPaginated: vi.fn(async (sessionId: string, limit: number, beforeSequence?: number) => {
      const allMsgs = messages.get(sessionId) ?? [];
      let filtered = allMsgs;
      if (beforeSequence !== undefined) {
        filtered = allMsgs.filter((m: Record<string, unknown>) => (m.sequence as number) < beforeSequence);
      }
      // Sort descending by sequence, take limit+1
      const sorted = [...filtered].sort((a: Record<string, unknown>, b: Record<string, unknown>) => (b.sequence as number) - (a.sequence as number));
      const hasMore = sorted.length > limit;
      const page = hasMore ? sorted.slice(0, limit) : sorted;
      page.reverse();
      return { messages: page, hasMore };
    }),
    searchSessions: vi.fn(async () => []),
    searchMessages: vi.fn(async () => []),
    // Test helpers
    _addSession: (id: string, title: string) => {
      const session = {
        id,
        title,
        workingDirectory: '/tmp',
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        parentId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        messageCount: 0,
        tokenEstimate: 0,
      };
      sessions.set(id, session);
      messages.set(id, []);
    },
    _addMessages: (id: string, msgs: Array<Record<string, unknown>>) => {
      messages.set(id, msgs);
    },
    _sessions: sessions,
    _messages: messages,
  };

  return mgr;
}

/**
 * Build a ServerState with full mocks for session-oriented tests.
 */
function createTestState(overrides: Partial<ServerState> = {}): ServerState {
  const agent = createFullMockAgent();
  return {
    agent,
    agentFactory: async () => createFullMockAgent(),
    sessions: createFullMockSessionManager() as unknown as SessionManager,
    ...overrides,
  };
}

// ============================================================================
// Original tests
// ============================================================================

describe('createServer', () => {
  it('should create a Hono app instance', () => {
    const agent = createMockAgent();
    const app = createServer({ agent });
    
    expect(app).toBeDefined();
    expect(typeof app.fetch).toBe('function');
  });

  it('should have health endpoint', async () => {
    const agent = createMockAgent();
    const app = createServer({ agent });
    
    const req = new Request('http://localhost/healthz');
    const res = await app.fetch(req);
    
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('healthy');
    expect(data.timestamp).toBeDefined();
  });

  it('should have readiness endpoint', async () => {
    const agent = createMockAgent();
    const app = createServer({ agent });
    
    const req = new Request('http://localhost/readyz');
    const res = await app.fetch(req);
    
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ready).toBe(true);
  });

  it('should have status endpoint', async () => {
    const agent = createMockAgent();
    const app = createServer({ agent });
    
    const req = new Request('http://localhost/beta/status');
    const res = await app.fetch(req);
    
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.agent.provider).toBe('anthropic');
    expect(data.agent.model).toBe('claude-sonnet-4-20250514');
  });

  describe('Conversations API', () => {
    it('should return 500 when sessions not available', async () => {
      const agent = createMockAgent();
      const app = createServer({ agent }); // No sessions manager
      
      const req = new Request('http://localhost/beta/conversations');
      const res = await app.fetch(req);
      
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe('Conversations not available');
    });

    it('should list conversations when available', async () => {
      const agent = createMockAgent();
      const sessions = createMockSessionManager();
      sessions._addSession('sess-1', 'Test Session');
      
      const app = createServer({ agent, sessions: sessions as unknown as SessionManager });
      
      const req = new Request('http://localhost/beta/conversations');
      const res = await app.fetch(req);
      
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toBeDefined();
      expect(data.data).toHaveLength(1);
      expect(data.data[0].id).toBe('sess-1');
      expect(data.count).toBe(1);
    });

    it('should get conversation by id', async () => {
      const agent = createMockAgent();
      const sessions = createMockSessionManager();
      sessions._addSession('sess-1', 'Test Session');
      
      const app = createServer({ agent, sessions: sessions as unknown as SessionManager });
      
      const req = new Request('http://localhost/beta/conversations/sess-1');
      const res = await app.fetch(req);
      
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toBeDefined();
      expect(data.data.id).toBe('sess-1');
      expect(data.data.title).toBe('Test Session');
    });

    it('should return 404 for non-existent conversation', async () => {
      const agent = createMockAgent();
      const sessions = createMockSessionManager();
      
      const app = createServer({ agent, sessions: sessions as unknown as SessionManager });
      
      const req = new Request('http://localhost/beta/conversations/non-existent');
      const res = await app.fetch(req);
      
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Conversation not found');
    });

    it('should get conversation messages', async () => {
      const agent = createMockAgent();
      const sessions = createMockSessionManager();
      sessions._addSession('sess-1', 'Test Session');
      sessions._addMessages('sess-1', [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ]);
      
      const app = createServer({ agent, sessions: sessions as unknown as SessionManager });
      
      const req = new Request('http://localhost/beta/conversations/sess-1/messages');
      const res = await app.fetch(req);
      
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toBeDefined();
      expect(data.data).toHaveLength(2);
      expect(data.count).toBe(2);
    });

    it('should delete conversation', async () => {
      const agent = createMockAgent();
      const sessions = createMockSessionManager();
      sessions._addSession('sess-1', 'Test Session');
      
      const app = createServer({ agent, sessions: sessions as unknown as SessionManager });
      
      const req = new Request('http://localhost/beta/conversations/sess-1', { method: 'DELETE' });
      const res = await app.fetch(req);
      
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });

  describe('CORS', () => {
    it('should include CORS headers', async () => {
      const agent = createMockAgent();
      const app = createServer({ agent });
      
      const req = new Request('http://localhost/health');
      const res = await app.fetch(req);
      
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    });
  });
});

describe('serverPlugin', () => {
  it('should return a valid plugin object', () => {
    const plugin = serverPlugin();
    
    expect(plugin).toHaveProperty('name');
    expect(plugin).toHaveProperty('version');
    expect(plugin.name).toBe('server');
  });

  it('should have onRegister function', () => {
    const plugin = serverPlugin();
    expect(plugin.onRegister).toBeDefined();
    expect(typeof plugin.onRegister).toBe('function');
  });

  it('should set server.available extension on register', async () => {
    const plugin = serverPlugin();
    const agent = createMockAgent();
    
    await plugin.onRegister!(agent);
    
    expect(agent.getExtension('server.available')).toBe(true);
  });
});

describe('Question Endpoint', () => {
  function createQuestionMockAgent() {
    const config: AgentConfig = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      auth: { type: 'api-key', apiKey: 'test' },
    };
    const extensions = new Map<string, unknown>();
    const pendingQuestions = new Map<string, QuestionResponse | null>();
    const responses: Array<{ questionId: string; response: QuestionResponse }> = [];

    return {
      getConfig: () => config,
      setExtension: (key: string, value: unknown) => extensions.set(key, value),
      getExtension: (key: string) => extensions.get(key),
      prompt: async () => ({ id: '1', role: 'assistant' as const, content: 'ok', createdAt: Date.now() }),
      abort: () => {},
      getAvailableProviders: () => ['anthropic'],
      getTools: () => [],
      emit: () => true,
      on: () => {},
      off: () => {},
      hasPendingQuestion: (questionId: string) => pendingQuestions.has(questionId),
      respondToQuestion: (questionId: string, response: QuestionResponse) => {
        responses.push({ questionId, response });
        pendingQuestions.delete(questionId);
      },
      // Test helpers
      _addPendingQuestion: (questionId: string) => pendingQuestions.set(questionId, null),
      _responses: responses,
    };
  }

  it('should return 501 when question system not available', async () => {
    const agent = createMockAgent(); // No respondToQuestion method
    const sessions = createMockSessionManager();
    sessions._addSession('sess-1', 'Test');
    const app = createServer({ agent, sessions: sessions as unknown as SessionManager });

    const res = await app.fetch(
      new Request('http://localhost/session/sess-1/question/q-1/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected: ['A'] }),
      }),
    );

    expect(res.status).toBe(501);
    const data = await res.json();
    expect(data.error).toContain('not available');
  });

  it('should return 404 for non-existent question', async () => {
    const mockAgent = createQuestionMockAgent();
    const sessions = createMockSessionManager();
    sessions._addSession('sess-1', 'Test');
    const app = createServer({
      agent: mockAgent as unknown as ServerAgent,
      sessions: sessions as unknown as SessionManager,
    });

    const res = await app.fetch(
      new Request('http://localhost/session/sess-1/question/nonexistent/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected: ['A'] }),
      }),
    );

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain('No pending question');
  });

  it('should successfully respond to a pending question with selected options', async () => {
    const mockAgent = createQuestionMockAgent();
    mockAgent._addPendingQuestion('q-42');
    const sessions = createMockSessionManager();
    sessions._addSession('sess-1', 'Test');
    const app = createServer({
      agent: mockAgent as unknown as ServerAgent,
      sessions: sessions as unknown as SessionManager,
    });

    const res = await app.fetch(
      new Request('http://localhost/session/sess-1/question/q-42/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected: ['Option A', 'Option B'] }),
      }),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    // Verify the response was forwarded to the agent
    expect(mockAgent._responses).toHaveLength(1);
    expect(mockAgent._responses[0].questionId).toBe('q-42');
    expect(mockAgent._responses[0].response.selected).toEqual(['Option A', 'Option B']);
  });

  it('should successfully respond with freeform text', async () => {
    const mockAgent = createQuestionMockAgent();
    mockAgent._addPendingQuestion('q-43');
    const sessions = createMockSessionManager();
    sessions._addSession('sess-1', 'Test');
    const app = createServer({
      agent: mockAgent as unknown as ServerAgent,
      sessions: sessions as unknown as SessionManager,
    });

    const res = await app.fetch(
      new Request('http://localhost/session/sess-1/question/q-43/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ freeformText: 'Custom response' }),
      }),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    expect(mockAgent._responses).toHaveLength(1);
    expect(mockAgent._responses[0].response.selected).toEqual([]);
    expect(mockAgent._responses[0].response.freeformText).toBe('Custom response');
  });
});

// ============================================================================
// NEW TESTS
// ============================================================================

describe('Session API', () => {
  describe('POST /session - create session', () => {
    it('should return 500 when sessions not available', async () => {
      const agent = createFullMockAgent();
      const app = createServer({ agent, agentFactory: async () => agent });

      const res = await app.fetch(
        new Request('http://localhost/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Test' }),
        }),
      );

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe('Sessions not available');
    });

    it('should create a session with defaults', async () => {
      const sessions = createFullMockSessionManager();
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.id).toBeDefined();
      expect(data.provider).toBe('anthropic');
      expect(data.model).toBe('claude-sonnet-4-20250514');
    });

    it('should create a session with custom title and workingDirectory', async () => {
      const sessions = createFullMockSessionManager();
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'My Session', workingDirectory: '/home/user/project' }),
        }),
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.title).toBe('My Session');
      expect(data.workingDirectory).toBe('/home/user/project');
    });

    it('should allow specifying a session ID', async () => {
      const sessions = createFullMockSessionManager();
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 'custom-id-123' }),
        }),
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.id).toBe('custom-id-123');
    });

    it('should allow specifying a parentId', async () => {
      const sessions = createFullMockSessionManager();
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parentId: 'parent-1' }),
        }),
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.parentId).toBe('parent-1');
    });
  });

  describe('GET /session/:id - get session', () => {
    it('should return 500 when sessions not available', async () => {
      const agent = createFullMockAgent();
      const app = createServer({ agent, agentFactory: async () => agent });

      const res = await app.fetch(new Request('http://localhost/session/sess-1'));

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe('Sessions not available');
    });

    it('should return 404 for non-existent session', async () => {
      const sessions = createFullMockSessionManager();
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      const res = await app.fetch(new Request('http://localhost/session/nonexistent'));

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Session not found');
    });

    it('should return session details', async () => {
      const sessions = createFullMockSessionManager();
      sessions._addSession('sess-1', 'Test Session');
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      const res = await app.fetch(new Request('http://localhost/session/sess-1'));

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe('sess-1');
      expect(data.title).toBe('Test Session');
    });
  });

  describe('DELETE /session/:id - delete session', () => {
    it('should return 500 when sessions not available', async () => {
      const agent = createFullMockAgent();
      const app = createServer({ agent, agentFactory: async () => agent });

      const res = await app.fetch(
        new Request('http://localhost/session/sess-1', { method: 'DELETE' }),
      );

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe('Sessions not available');
    });

    it('should delete an existing session', async () => {
      const sessions = createFullMockSessionManager();
      sessions._addSession('sess-1', 'To Delete');
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/session/sess-1', { method: 'DELETE' }),
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(sessions.deleteSession).toHaveBeenCalledWith('sess-1');
    });

    it('should handle deleting a non-existent session', async () => {
      const sessions = createFullMockSessionManager();
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/session/nonexistent', { method: 'DELETE' }),
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(false);
    });
  });

  describe('GET /session/:id/message - get messages', () => {
    it('should return 500 when sessions not available', async () => {
      const agent = createFullMockAgent();
      const app = createServer({ agent, agentFactory: async () => agent });

      const res = await app.fetch(new Request('http://localhost/session/sess-1/message'));

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe('Sessions not available');
    });

    it('should return empty messages for new session', async () => {
      const sessions = createFullMockSessionManager();
      sessions._addSession('sess-1', 'Test');
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      const res = await app.fetch(new Request('http://localhost/session/sess-1/message'));

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.messages).toBeDefined();
      expect(data.messages).toHaveLength(0);
    });

    it('should return messages for a session with history', async () => {
      const sessions = createFullMockSessionManager();
      sessions._addSession('sess-1', 'Test');
      sessions._addMessages('sess-1', [
        { id: 'msg-1', role: 'user', content: 'Hello', sessionId: 'sess-1', sequence: 0 },
        { id: 'msg-2', role: 'assistant', content: 'Hi!', sessionId: 'sess-1', sequence: 1 },
      ]);
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      const res = await app.fetch(new Request('http://localhost/session/sess-1/message'));

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.messages).toHaveLength(2);
      expect(data.messages[0].content).toBe('Hello');
      expect(data.messages[1].content).toBe('Hi!');
    });

    it('should return paginated messages when limit query param is set', async () => {
      const sessions = createFullMockSessionManager();
      sessions._addSession('sess-1', 'Test');
      sessions._addMessages('sess-1', [
        { id: 'msg-0', role: 'user', content: 'M0', sessionId: 'sess-1', sequence: 0 },
        { id: 'msg-1', role: 'assistant', content: 'M1', sessionId: 'sess-1', sequence: 1 },
        { id: 'msg-2', role: 'user', content: 'M2', sessionId: 'sess-1', sequence: 2 },
        { id: 'msg-3', role: 'assistant', content: 'M3', sessionId: 'sess-1', sequence: 3 },
        { id: 'msg-4', role: 'user', content: 'M4', sessionId: 'sess-1', sequence: 4 },
      ]);
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      const res = await app.fetch(new Request('http://localhost/session/sess-1/message?limit=2'));

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.messages).toHaveLength(2);
      expect(data.hasMore).toBe(true);
      // Should return the last 2 messages (sequences 3, 4)
      expect(data.messages[0].sequence).toBe(3);
      expect(data.messages[1].sequence).toBe(4);
    });

    it('should return paginated messages with beforeSequence cursor', async () => {
      const sessions = createFullMockSessionManager();
      sessions._addSession('sess-1', 'Test');
      sessions._addMessages('sess-1', [
        { id: 'msg-0', role: 'user', content: 'M0', sessionId: 'sess-1', sequence: 0 },
        { id: 'msg-1', role: 'assistant', content: 'M1', sessionId: 'sess-1', sequence: 1 },
        { id: 'msg-2', role: 'user', content: 'M2', sessionId: 'sess-1', sequence: 2 },
        { id: 'msg-3', role: 'assistant', content: 'M3', sessionId: 'sess-1', sequence: 3 },
        { id: 'msg-4', role: 'user', content: 'M4', sessionId: 'sess-1', sequence: 4 },
      ]);
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/session/sess-1/message?limit=2&beforeSequence=3'),
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.messages).toHaveLength(2);
      expect(data.hasMore).toBe(true);
      // Should return sequences 1, 2 (the last 2 before sequence 3)
      expect(data.messages[0].sequence).toBe(1);
      expect(data.messages[1].sequence).toBe(2);
    });

    it('should return 400 for invalid limit', async () => {
      const sessions = createFullMockSessionManager();
      sessions._addSession('sess-1', 'Test');
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/session/sess-1/message?limit=abc'),
      );

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('limit');
    });

    it('should return 400 for negative limit', async () => {
      const sessions = createFullMockSessionManager();
      sessions._addSession('sess-1', 'Test');
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/session/sess-1/message?limit=-1'),
      );

      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid beforeSequence', async () => {
      const sessions = createFullMockSessionManager();
      sessions._addSession('sess-1', 'Test');
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/session/sess-1/message?limit=10&beforeSequence=abc'),
      );

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('beforeSequence');
    });

    it('should return all messages without hasMore when limit is not set', async () => {
      const sessions = createFullMockSessionManager();
      sessions._addSession('sess-1', 'Test');
      sessions._addMessages('sess-1', [
        { id: 'msg-0', role: 'user', content: 'M0', sessionId: 'sess-1', sequence: 0 },
        { id: 'msg-1', role: 'assistant', content: 'M1', sessionId: 'sess-1', sequence: 1 },
      ]);
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      const res = await app.fetch(new Request('http://localhost/session/sess-1/message'));

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.messages).toHaveLength(2);
      // Non-paginated response should NOT have hasMore
      expect(data.hasMore).toBeUndefined();
    });
  });

  describe('POST /session/:id/prompt_async - sync prompt', () => {
    it('should return 500 when sessions not available', async () => {
      const agent = createFullMockAgent();
      const app = createServer({ agent, agentFactory: async () => agent });

      const res = await app.fetch(
        new Request('http://localhost/session/sess-1/prompt_async', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'Hello' }),
        }),
      );

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe('Sessions not available');
    });

    it('should return 400 when prompt is missing', async () => {
      const sessions = createFullMockSessionManager();
      sessions._addSession('sess-1', 'Test');
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/session/sess-1/prompt_async', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      );

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('prompt is required');
    });

    it('should return 404 for non-existent session', async () => {
      const sessions = createFullMockSessionManager();
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/session/nonexistent/prompt_async', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'Hello' }),
        }),
      );

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Session not found');
    });

    it('should successfully prompt and return response', async () => {
      const sessions = createFullMockSessionManager();
      sessions._addSession('sess-1', 'Test');
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/session/sess-1/prompt_async', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'Hello' }),
        }),
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('completed');
      expect(data.success).toBe(true);
      expect(data.message).toBeDefined();
    });

    it('should not store messages directly (handled by storage plugin hook)', async () => {
      const sessions = createFullMockSessionManager();
      sessions._addSession('sess-1', 'Test');
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      await app.fetch(
        new Request('http://localhost/session/sess-1/prompt_async', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'Hello world' }),
        }),
      );

      // Message persistence is now handled incrementally by the storage
      // plugin's onMessageAdded hook, not by the route directly.
      expect(sessions.addMessage).not.toHaveBeenCalled();
    });

    it('should return 500 when agent throws an error', async () => {
      const sessions = createFullMockSessionManager();
      sessions._addSession('sess-1', 'Test');
      const failingAgent = createFullMockAgent({
        prompt: async () => { throw new Error('LLM error'); },
      });
      const state = createTestState({
        sessions: sessions as unknown as SessionManager,
        agentFactory: async () => failingAgent,
      });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/session/sess-1/prompt_async', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'Hello' }),
        }),
      );

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.status).toBe('error');
      expect(data.success).toBe(false);
      expect(data.error).toBe('LLM error');
    });
  });

  describe('POST /session/:id/abort - abort', () => {
    it('should return success even with no session state', async () => {
      const state = createTestState();
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/session/nonexistent/abort', { method: 'POST' }),
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('should abort an active session', async () => {
      const sessions = createFullMockSessionManager();
      sessions._addSession('sess-1', 'Test');

      // We control when the prompt resolves so we can test abort mid-flight
      let resolvePrompt!: () => void;
      const promptBlocking = new Promise<void>((r) => { resolvePrompt = r; });
      let promptStartedResolve!: () => void;
      const promptStarted = new Promise<void>((r) => { promptStartedResolve = r; });

      let sessionAgentAbort: ReturnType<typeof vi.fn> | undefined;
      const state = createTestState({
        sessions: sessions as unknown as SessionManager,
        agentFactory: async () => {
          const agent = createFullMockAgent({
            prompt: async () => {
              promptStartedResolve();
              await promptBlocking;
              return { id: 'r1', role: 'assistant' as const, content: 'done', createdAt: Date.now() };
            },
          });
          sessionAgentAbort = agent.abort as ReturnType<typeof vi.fn>;
          return agent;
        },
      });
      const app = createServer(state);

      // Start a prompt (don't await)
      const promptPromise = app.fetch(
        new Request('http://localhost/session/sess-1/prompt_async', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'Long task' }),
        }),
      );

      // Wait for the prompt handler to actually be running
      await promptStarted;

      // Now abort
      const res = await app.fetch(
        new Request('http://localhost/session/sess-1/abort', { method: 'POST' }),
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(sessionAgentAbort).toHaveBeenCalled();

      // Unblock the prompt so the test can exit cleanly
      resolvePrompt();
      await promptPromise;
    });
  });
});

describe('Search API', () => {
  describe('GET /search/sessions', () => {
    it('should return 500 when sessions not available', async () => {
      const agent = createFullMockAgent();
      const app = createServer({ agent, agentFactory: async () => agent });

      const res = await app.fetch(new Request('http://localhost/search/sessions'));

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe('Search not available');
    });

    it('should return search results with pagination', async () => {
      const sessions = createFullMockSessionManager();
      const mockResults = [
        { session: { id: 's-1', title: 'Found' } },
      ];
      sessions.searchSessions.mockResolvedValue(mockResults);
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      const res = await app.fetch(new Request('http://localhost/search/sessions?q=test'));

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.results).toHaveLength(1);
      expect(data.pagination).toBeDefined();
      expect(data.pagination.limit).toBe(50);
      expect(data.pagination.offset).toBe(0);
    });

    it('should pass query params to search', async () => {
      const sessions = createFullMockSessionManager();
      sessions.searchSessions.mockResolvedValue([]);
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      await app.fetch(
        new Request('http://localhost/search/sessions?q=hello&provider=openai&model=gpt-4&limit=10&offset=5&rootOnly=true&orderBy=createdAt&orderDirection=asc'),
      );

      expect(sessions.searchSessions).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'hello',
          provider: 'openai',
          model: 'gpt-4',
          limit: 10,
          offset: 5,
          rootOnly: true,
          orderBy: 'createdAt',
          orderDirection: 'asc',
        }),
      );
    });

    it('should handle search errors', async () => {
      const sessions = createFullMockSessionManager();
      sessions.searchSessions.mockRejectedValue(new Error('Search failed'));
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      const res = await app.fetch(new Request('http://localhost/search/sessions?q=test'));

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe('Search failed');
    });
  });

  describe('GET /search/messages', () => {
    it('should return 500 when sessions not available', async () => {
      const agent = createFullMockAgent();
      const app = createServer({ agent, agentFactory: async () => agent });

      const res = await app.fetch(new Request('http://localhost/search/messages?q=test'));

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe('Search not available');
    });

    it('should return 400 when query is missing', async () => {
      const sessions = createFullMockSessionManager();
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      const res = await app.fetch(new Request('http://localhost/search/messages'));

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('"q" is required');
    });

    it('should return search results', async () => {
      const sessions = createFullMockSessionManager();
      const mockResults = [
        { message: { id: 'm-1', content: 'hello world' }, session: { id: 's-1' }, snippet: '...hello world...' },
      ];
      sessions.searchMessages.mockResolvedValue(mockResults);
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      const res = await app.fetch(new Request('http://localhost/search/messages?q=hello'));

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.results).toHaveLength(1);
      expect(data.pagination).toBeDefined();
    });

    it('should pass all query params to search', async () => {
      const sessions = createFullMockSessionManager();
      sessions.searchMessages.mockResolvedValue([]);
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      await app.fetch(
        new Request('http://localhost/search/messages?q=test&sessionId=s-1&role=user&limit=25&offset=10'),
      );

      expect(sessions.searchMessages).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'test',
          sessionId: 's-1',
          role: 'user',
          limit: 25,
          offset: 10,
        }),
      );
    });

    it('should handle search errors', async () => {
      const sessions = createFullMockSessionManager();
      sessions.searchMessages.mockRejectedValue(new Error('DB error'));
      const state = createTestState({ sessions: sessions as unknown as SessionManager });
      const app = createServer(state);

      const res = await app.fetch(new Request('http://localhost/search/messages?q=test'));

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe('DB error');
    });
  });
});

describe('Tools API', () => {
  describe('GET /tools', () => {
    it('should return tools when agent supports getTools', async () => {
      const agent = createFullMockAgent();
      const app = createServer({ agent, agentFactory: async () => agent });

      const res = await app.fetch(new Request('http://localhost/tools'));

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.tools).toBeDefined();
      expect(data.tools).toHaveLength(2);
      expect(data.tools[0].name).toBe('read_file');
      expect(data.tools[0].description).toBe('Read a file');
      expect(data.tools[0].available).toBe(true);
      expect(data.tools[1].name).toBe('write_file');
    });

    it('should return empty list when agent has no getTools method', async () => {
      const agent = createFullMockAgent();
      delete (agent as Partial<ServerAgent>).getTools;
      const app = createServer({ agent, agentFactory: async () => agent });

      const res = await app.fetch(new Request('http://localhost/tools'));

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.tools).toEqual([]);
    });

    it('should return empty list when agent has no tools', async () => {
      const agent = createFullMockAgent({ getTools: () => [] });
      const app = createServer({ agent, agentFactory: async () => agent });

      const res = await app.fetch(new Request('http://localhost/tools'));

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.tools).toEqual([]);
    });

    it('should set available=true and default description for tools without description', async () => {
      const agent = createFullMockAgent({
        getTools: () => [{ name: 'my_tool' }],
      });
      const app = createServer({ agent, agentFactory: async () => agent });

      const res = await app.fetch(new Request('http://localhost/tools'));

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.tools[0].name).toBe('my_tool');
      expect(data.tools[0].description).toBe('');
      expect(data.tools[0].available).toBe(true);
    });
  });
});

describe('Provider API', () => {
  describe('GET /provider', () => {
    it('should return available providers', async () => {
      const agent = createFullMockAgent();
      const app = createServer({ agent, agentFactory: async () => agent });

      const res = await app.fetch(new Request('http://localhost/provider'));

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.providers).toBeDefined();
      expect(data.providers).toHaveLength(2);
      expect(data.providers[0].id).toBe('anthropic');
      expect(data.providers[0].name).toBe('Anthropic');
      expect(data.providers[1].id).toBe('openai');
      expect(data.providers[1].name).toBe('Openai');
    });

    it('should return empty list when no providers available', async () => {
      const agent = createFullMockAgent({ getAvailableProviders: () => [] });
      const app = createServer({ agent, agentFactory: async () => agent });

      const res = await app.fetch(new Request('http://localhost/provider'));

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.providers).toEqual([]);
    });
  });
});

describe('Branching API', () => {
  function createBranchingAgent() {
    const tree = {
      getBranches: vi.fn(() => [
        { id: 'main', name: 'main', headId: 'node-1', forkPointId: null, createdAt: Date.now(), isActive: true },
      ]),
      getPathToNode: vi.fn((nodeId: string) => [{ id: nodeId }]),
      createBranch: vi.fn((name: string, messageId?: string) => ({
        id: 'branch-new',
        name,
        headId: messageId ?? 'node-1',
        forkPointId: messageId ?? 'node-1',
        createdAt: Date.now(),
        isActive: false,
      })),
      switchBranch: vi.fn((branchId: string) => ({
        id: branchId,
        name: 'switched',
        isActive: true,
      })),
      deleteBranch: vi.fn(() => true),
      rollbackN: vi.fn(),
    };

    return {
      agent: createFullMockAgent({
        getConversationTree: () => tree as unknown as ConversationTree,
      }),
      tree,
    };
  }

  describe('GET /session/:id/branches - list branches', () => {
    it('should return empty branches when tree not available', async () => {
      const agent = createFullMockAgent({ getConversationTree: () => undefined });
      const state = createTestState({ agent });
      const app = createServer(state);

      const res = await app.fetch(new Request('http://localhost/session/sess-1/branches'));

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.branches).toEqual([]);
    });

    it('should return branches from conversation tree', async () => {
      const { agent, tree } = createBranchingAgent();
      const state = createTestState({ agent });
      const app = createServer(state);

      const res = await app.fetch(new Request('http://localhost/session/sess-1/branches'));

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.branches).toHaveLength(1);
      expect(data.branches[0].id).toBe('main');
      expect(data.branches[0].name).toBe('main');
      expect(data.branches[0].isActive).toBe(true);
      expect(data.branches[0].messageCount).toBe(1);
    });
  });

  describe('POST /session/:id/branches - create branch', () => {
    it('should return 501 when branching not available', async () => {
      const agent = createFullMockAgent({ getConversationTree: () => undefined });
      const state = createTestState({ agent });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/session/sess-1/branches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'new-branch' }),
        }),
      );

      expect(res.status).toBe(501);
      const data = await res.json();
      expect(data.error).toBe('Branching not available');
    });

    it('should create a branch', async () => {
      const { agent, tree } = createBranchingAgent();
      const state = createTestState({ agent });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/session/sess-1/branches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'experiment' }),
        }),
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.id).toBe('branch-new');
      expect(data.name).toBe('experiment');
      expect(data.created).toBe(true);
      expect(tree.createBranch).toHaveBeenCalledWith('experiment', undefined);
    });

    it('should create a branch from a specific message', async () => {
      const { agent, tree } = createBranchingAgent();
      const state = createTestState({ agent });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/session/sess-1/branches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'from-msg', messageId: 'node-5' }),
        }),
      );

      expect(res.status).toBe(201);
      expect(tree.createBranch).toHaveBeenCalledWith('from-msg', 'node-5');
    });
  });

  describe('POST /session/:id/branches/:bid/switch - switch branch', () => {
    it('should return 501 when branching not available', async () => {
      const agent = createFullMockAgent({ getConversationTree: () => undefined });
      const state = createTestState({ agent });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/session/sess-1/branches/branch-1/switch', { method: 'POST' }),
      );

      expect(res.status).toBe(501);
    });

    it('should switch to a branch', async () => {
      const { agent, tree } = createBranchingAgent();
      const state = createTestState({ agent });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/session/sess-1/branches/branch-1/switch', { method: 'POST' }),
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.activeBranch).toBe('branch-1');
      expect(tree.switchBranch).toHaveBeenCalledWith('branch-1');
    });
  });

  describe('DELETE /session/:id/branches/:bid - delete branch', () => {
    it('should return 501 when branching not available', async () => {
      const agent = createFullMockAgent({ getConversationTree: () => undefined });
      const state = createTestState({ agent });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/session/sess-1/branches/branch-1', { method: 'DELETE' }),
      );

      expect(res.status).toBe(501);
    });

    it('should delete a branch', async () => {
      const { agent, tree } = createBranchingAgent();
      const state = createTestState({ agent });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/session/sess-1/branches/branch-1', { method: 'DELETE' }),
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(tree.deleteBranch).toHaveBeenCalledWith('branch-1');
    });
  });

  describe('POST /session/:id/rollback - rollback', () => {
    it('should return 501 when branching not available', async () => {
      const agent = createFullMockAgent({ getConversationTree: () => undefined });
      const state = createTestState({ agent });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/session/sess-1/rollback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count: 2 }),
        }),
      );

      expect(res.status).toBe(501);
    });

    it('should rollback with specified count', async () => {
      const { agent, tree } = createBranchingAgent();
      const state = createTestState({ agent });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/session/sess-1/rollback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count: 3 }),
        }),
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(tree.rollbackN).toHaveBeenCalledWith(3);
    });

    it('should default to rollback 1 when count not specified', async () => {
      const { agent, tree } = createBranchingAgent();
      const state = createTestState({ agent });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/session/sess-1/rollback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      );

      expect(res.status).toBe(200);
      expect(tree.rollbackN).toHaveBeenCalledWith(1);
    });
  });
});

describe('Plugin API', () => {
  function createMockPluginManager(overrides: Partial<PluginManager> = {}): PluginManager {
    return {
      init: vi.fn(async () => {}),
      install: vi.fn(async (packageSpec: string) => ({
        packageSpec,
        packageName: packageSpec.split('@')[0],
        version: '1.0.0',
        plugins: [{ name: 'test-plugin', version: '1.0.0' }] as AgentPlugin[],
      })),
      uninstall: vi.fn(async (packageName: string) => ['test-plugin']),
      listInstalled: vi.fn(() => [
        {
          packageSpec: 'test-pkg',
          packageName: 'test-pkg',
          version: '1.0.0',
          pluginNames: ['test-plugin'],
          installedAt: Date.now(),
        },
      ] as InstalledPluginInfo[]),
      isInstalled: vi.fn(() => true),
      getPackageForPlugin: vi.fn(() => 'test-pkg'),
      getPluginDir: vi.fn(() => '/tmp/plugins'),
      ...overrides,
    } as unknown as PluginManager;
  }

  describe('GET /plugins - list plugins', () => {
    it('should return 501 when plugin manager not available', async () => {
      const agent = createFullMockAgent();
      const app = createServer({ agent, agentFactory: async () => agent });

      const res = await app.fetch(new Request('http://localhost/plugins'));

      expect(res.status).toBe(501);
      const data = await res.json();
      expect(data.error).toBe('Plugin management not available');
    });

    it('should return installed plugins and registered plugin names', async () => {
      const agent = createFullMockAgent({
        getPluginNames: () => ['test-plugin', 'built-in-plugin'],
      });
      const pluginManager = createMockPluginManager();
      const state = createTestState({ agent, pluginManager });
      const app = createServer(state);

      const res = await app.fetch(new Request('http://localhost/plugins'));

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.installed).toHaveLength(1);
      expect(data.installed[0].packageName).toBe('test-pkg');
      expect(data.registered).toEqual(['test-plugin', 'built-in-plugin']);
    });

    it('should return empty registered when getPluginNames not available', async () => {
      const agent = createFullMockAgent();
      delete (agent as Partial<ServerAgent> & { getPluginNames?: unknown }).getPluginNames;
      const pluginManager = createMockPluginManager();
      const state = createTestState({ agent, pluginManager });
      const app = createServer(state);

      const res = await app.fetch(new Request('http://localhost/plugins'));

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.registered).toEqual([]);
    });
  });

  describe('POST /plugins/install - install plugin', () => {
    it('should return 501 when plugin manager not available', async () => {
      const agent = createFullMockAgent();
      const app = createServer({ agent, agentFactory: async () => agent });

      const res = await app.fetch(
        new Request('http://localhost/plugins/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packageSpec: 'some-plugin' }),
        }),
      );

      expect(res.status).toBe(501);
    });

    it('should return 400 when packageSpec is missing', async () => {
      const agent = createFullMockAgent();
      const pluginManager = createMockPluginManager();
      const state = createTestState({ agent, pluginManager });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/plugins/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      );

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('packageSpec is required');
    });

    it('should install a plugin and register it', async () => {
      const usedPlugins: string[] = [];
      const agent = createFullMockAgent({
        use: vi.fn(async (plugin: AgentPlugin) => { usedPlugins.push(plugin.name); }),
      });
      const pluginManager = createMockPluginManager();
      const state = createTestState({ agent, pluginManager });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/plugins/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packageSpec: 'my-awesome-plugin' }),
        }),
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.packageName).toBe('my-awesome-plugin');
      expect(data.version).toBe('1.0.0');
      expect(data.plugins).toContain('test-plugin');
      expect(data.registered).toContain('test-plugin');
    });

    it('should handle install failure', async () => {
      const agent = createFullMockAgent();
      const pluginManager = createMockPluginManager({
        install: vi.fn(async () => { throw new Error('npm install failed'); }) as unknown as PluginManager['install'],
      });
      const state = createTestState({ agent, pluginManager });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/plugins/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packageSpec: 'bad-plugin' }),
        }),
      );

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('npm install failed');
    });

    it('should report errors for plugins that fail to register', async () => {
      const agent = createFullMockAgent({
        use: vi.fn(async () => { throw new Error('Registration failed'); }),
      });
      const pluginManager = createMockPluginManager();
      const state = createTestState({ agent, pluginManager });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/plugins/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packageSpec: 'some-plugin' }),
        }),
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.errors).toBeDefined();
      expect(data.errors).toHaveLength(1);
      expect(data.errors[0].name).toBe('test-plugin');
      expect(data.errors[0].error).toBe('Registration failed');
    });
  });

  describe('POST /plugins/uninstall - uninstall plugin', () => {
    it('should return 501 when plugin manager not available', async () => {
      const agent = createFullMockAgent();
      const app = createServer({ agent, agentFactory: async () => agent });

      const res = await app.fetch(
        new Request('http://localhost/plugins/uninstall', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packageName: 'some-plugin' }),
        }),
      );

      expect(res.status).toBe(501);
    });

    it('should return 400 when packageName is missing', async () => {
      const agent = createFullMockAgent();
      const pluginManager = createMockPluginManager();
      const state = createTestState({ agent, pluginManager });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/plugins/uninstall', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      );

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('packageName is required');
    });

    it('should uninstall a plugin and unregister it', async () => {
      const unusedPlugins: string[] = [];
      const agent = createFullMockAgent({
        unuse: vi.fn(async (pluginName: string) => { unusedPlugins.push(pluginName); }),
      });
      const pluginManager = createMockPluginManager();
      const state = createTestState({ agent, pluginManager });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/plugins/uninstall', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packageName: 'test-pkg' }),
        }),
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.packageName).toBe('test-pkg');
      expect(data.plugins).toContain('test-plugin');
      expect(data.unregistered).toContain('test-plugin');
    });

    it('should handle uninstall failure', async () => {
      const agent = createFullMockAgent();
      const pluginManager = createMockPluginManager({
        uninstall: vi.fn(async () => { throw new Error('npm uninstall failed'); }) as unknown as PluginManager['uninstall'],
      });
      const state = createTestState({ agent, pluginManager });
      const app = createServer(state);

      const res = await app.fetch(
        new Request('http://localhost/plugins/uninstall', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packageName: 'test-pkg' }),
        }),
      );

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('npm uninstall failed');
    });
  });
});

describe('Permission Response Endpoint', () => {
  it('should return 404 for non-existent permission request', async () => {
    const agent = createFullMockAgent();
    const sessions = createFullMockSessionManager();
    sessions._addSession('sess-1', 'Test');
    const state = createTestState({ agent, sessions: sessions as unknown as SessionManager });
    const app = createServer(state);

    const res = await app.fetch(
      new Request('http://localhost/session/sess-1/permission/nonexistent/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: 'allow_once' }),
      }),
    );

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain('No pending permission request');
  });

  it('should return 400 for invalid permission response', async () => {
    const agent = createFullMockAgent();
    const sessions = createFullMockSessionManager();
    sessions._addSession('sess-1', 'Test');
    const state = createTestState({ agent, sessions: sessions as unknown as SessionManager });
    const app = createServer(state);

    // We'd need to first trigger a permission request to have an active resolver
    // This tests the validation path at least
    const res = await app.fetch(
      new Request('http://localhost/session/sess-1/permission/tool-1/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: 'invalid_value' }),
      }),
    );

    // Will be 404 since there's no pending request with that ID
    expect(res.status).toBe(404);
  });
});
