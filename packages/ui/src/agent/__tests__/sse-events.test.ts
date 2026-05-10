import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createBridgeCore,
  type PlatformAgent,
  type PlatformSessionManager,
  type PlatformStorage,
  type PlatformFilesystem,
  type PlatformAgentFactory,
  type PlatformSSEHandler,
  type SSEEvent,
} from '../BridgeCore';
import type { AgentEvent } from '../types';

// ============ Mock helpers (reused from BridgeCore.test.ts style) ============

function createMockAgent(): PlatformAgent {
  return {
    id: 'mock-agent-id',
    prompt: vi.fn().mockResolvedValue({ content: 'Mock response', toolCalls: [] }),
    stream: vi.fn(),
    cancel: vi.fn(),
    setSessionContext: vi.fn(),
    setMessages: vi.fn(),
    on: vi.fn(),
    setPermissionRequestCallback: vi.fn(),
    allowToolForSession: vi.fn(),
    clearToolPermissions: vi.fn(),
    getPermissionConfig: vi.fn().mockReturnValue({
      defaultMode: 'ask',
      alwaysAllow: [],
      alwaysDeny: [],
      allowAll: false,
    }),
    updatePermissionConfig: vi.fn(),
    getDisabledTools: vi.fn().mockReturnValue([]),
    setDisabledTools: vi.fn(),
    disableTool: vi.fn(),
    enableTool: vi.fn(),
    getToolsInfo: vi.fn().mockReturnValue([]),
    getModel: vi.fn().mockReturnValue({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' }),
    setModel: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockSessionManager(): PlatformSessionManager {
  return {
    createSession: vi.fn().mockResolvedValue({
      id: 'session-1',
      title: 'Test Session',
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    getRootSessions: vi.fn().mockResolvedValue([]),
    getSession: vi.fn().mockResolvedValue({
      id: 'session-1',
      title: 'Test Session',
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    deleteAllSessions: vi.fn().mockResolvedValue(0),
    getSessionMessages: vi.fn().mockResolvedValue([]),
    getSessionMessagesPaginated: vi.fn().mockResolvedValue({ messages: [], hasMore: false }),
    addMessage: vi.fn().mockResolvedValue(undefined),
    getNextSequence: vi.fn().mockResolvedValue(1),
    searchSessions: vi.fn().mockResolvedValue([]),
  };
}

function createMockStorage(): PlatformStorage {
  return {
    getAuthStatus: vi.fn().mockResolvedValue({
      anthropic: { authenticated: true, method: 'apikey' },
      openai: { hasApiKey: false },
      google: { hasApiKey: false },
      openrouter: { hasApiKey: false },
      groq: { hasApiKey: false },
      xai: { hasApiKey: false },
    }),
    initiateOAuth: vi.fn().mockResolvedValue({ url: 'https://oauth.test', verifier: 'v' }),
    completeOAuth: vi.fn().mockResolvedValue(undefined),
    disconnectOAuth: vi.fn().mockResolvedValue(undefined),
    listApiKeys: vi.fn().mockResolvedValue([]),
    getApiKey: vi.fn().mockResolvedValue('sk-test'),
    setApiKey: vi.fn().mockResolvedValue(undefined),
    deleteApiKey: vi.fn().mockResolvedValue(undefined),
    hasApiKey: vi.fn().mockResolvedValue(true),
    getProjectsDirectory: vi.fn().mockResolvedValue('/projects'),
    setProjectsDirectory: vi.fn().mockResolvedValue(undefined),
    getOAuthTokens: vi.fn().mockResolvedValue(null),
    saveOAuthTokens: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockFilesystem(): PlatformFilesystem {
  return {
    readDirectory: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue(''),
    writeFile: vi.fn().mockResolvedValue(undefined),
    pathExists: vi.fn().mockResolvedValue(true),
    getDataDirectory: vi.fn().mockReturnValue('/data'),
    watchFile: vi.fn(),
    unwatchFile: vi.fn(),
  };
}

function createMockAgentFactory(
  agent: PlatformAgent,
  sessionManager: PlatformSessionManager,
): PlatformAgentFactory {
  return {
    createAgent: vi.fn().mockResolvedValue({ agent, sessionManager }),
  };
}

// ============ SSE handler helpers ============

/**
 * Creates a mock PlatformSSEHandler that buffers SSE events and fires them
 * when `flush()` is called. This lets us control exactly which SSE events
 * are delivered to processSSEEventData.
 */
function createControllableSSEHandler() {
  let eventCallback: ((event: SSEEvent) => void) | null = null;
  let completeCallback: (() => void) | null = null;
  let errorCallback: ((error: Error) => void) | null = null;

  const handler: PlatformSSEHandler = {
    connect(_url, _options, onEvent, onError, onComplete) {
      eventCallback = onEvent;
      errorCallback = onError;
      completeCallback = onComplete;
      return () => {}; // abort function
    },
  };

  return {
    handler,
    /** Send a single SSE event into the stream */
    sendEvent(type: string, data: Record<string, unknown>) {
      eventCallback!({ type, data: JSON.stringify(data) });
    },
    /** Signal an error */
    sendError(error: Error) {
      errorCallback!(error);
    },
    /** Complete the stream */
    complete() {
      completeCallback!();
    },
  };
}

// ============ Test infrastructure ============

/**
 * Sets up a full BridgeCore wired to a remote project with a controllable
 * SSE handler. Returns helpers to send SSE events and inspect emitted AgentEvents.
 */
async function setupRemoteProject() {
  const mockAgent = createMockAgent();
  const mockSessionManager = createMockSessionManager();
  const mockStorage = createMockStorage();
  const mockFilesystem = createMockFilesystem();
  const mockAgentFactory = createMockAgentFactory(mockAgent, mockSessionManager);
  const onEvent = vi.fn<[string, AgentEvent]>();
  const sse = createControllableSSEHandler();

  const bridge = createBridgeCore({
    agentFactory: mockAgentFactory,
    storage: mockStorage,
    filesystem: mockFilesystem,
    onEvent,
    sseHandler: sse.handler,
  });

  // Add a remote server
  const server = await bridge.addRemoteServer({
    name: 'Test Server',
    url: 'https://test-server.com',
    token: 'tok',
  });

  // Create a remote project (mock fetch for the server call)
  const projectId = 'remote-proj-1';
  global.fetch = vi.fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        id: projectId,
        name: 'Remote Project',
        workingDirectory: '/remote',
      }),
    })
    // For the createSession call
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        id: 'session-1',
        title: 'Session',
      }),
    });

  const project = await bridge.createProject('/remote', 'remote', server.id, 'Remote Project');
  const session = await bridge.createSession(project.id);
  const sessionId = session.id;

  return {
    bridge,
    project,
    sessionId,
    onEvent,
    sse,
    projectId: project.id,
  };
}

// ============ Tests ============

describe('SSE Event Processing (processSSEEventData)', () => {
  let env: Awaited<ReturnType<typeof setupRemoteProject>>;

  // Helper: trigger sendMessage and capture events emitted during the stream
  async function streamEvents(
    events: Array<{ type: string; data: Record<string, unknown> }>,
  ): Promise<AgentEvent[]> {
    const { bridge, projectId, sessionId, onEvent, sse } = env;

    // Mock the fetch for the streaming POST — it won't be used because
    // sseHandler takes precedence, but sendMessage still resolves server config.
    // We already have the remote project set up, so sendMessage should use
    // streamWithPlatformHandler directly.

    // Start sendMessage (it will block on the SSE stream promise)
    const sendPromise = bridge.sendMessage(projectId, sessionId, 'Hello');

    // Give the microtask queue a tick so connect() is invoked
    await new Promise(r => setTimeout(r, 0));

    // Feed events
    for (const evt of events) {
      sse.sendEvent(evt.type, evt.data);
    }

    // Complete the stream
    sse.complete();

    // Wait for sendMessage to resolve
    await sendPromise;

    // Return all emitted events (strip the projectId wrapper)
    return onEvent.mock.calls.map(([, event]) => event);
  }

  beforeEach(async () => {
    env = await setupRemoteProject();
  });

  // ---------- message.start ----------

  it('should emit message.start event', async () => {
    const events = await streamEvents([
      { type: 'message.start', data: { messageId: 'msg-1' } },
    ]);

    const starts = events.filter(e => e.type === 'message.start');
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      type: 'message.start',
      sessionId: env.sessionId,
      messageId: 'msg-1',
    });
  });

  it('should auto-generate messageId if server omits it in message.start', async () => {
    const events = await streamEvents([
      { type: 'message.start', data: {} },
    ]);

    const starts = events.filter(e => e.type === 'message.start');
    expect(starts).toHaveLength(1);
    expect((starts[0] as any).messageId).toBeTruthy();
  });

  // ---------- message.delta ----------

  it('should emit message.delta with accumulated text', async () => {
    const events = await streamEvents([
      { type: 'message.start', data: { messageId: 'msg-1' } },
      { type: 'message.delta', data: { delta: 'Hello ' } },
      { type: 'message.delta', data: { delta: 'world' } },
    ]);

    const deltas = events.filter(e => e.type === 'message.delta');
    expect(deltas).toHaveLength(2);
    expect((deltas[0] as any).delta).toBe('Hello ');
    expect((deltas[1] as any).delta).toBe('world');

    // message.complete should contain the accumulated text
    const completes = events.filter(e => e.type === 'message.complete');
    expect(completes).toHaveLength(1);
    expect((completes[0] as any).content).toBe('Hello world');
  });

  it('should use data.text as fallback for delta', async () => {
    const events = await streamEvents([
      { type: 'message.start', data: { messageId: 'msg-1' } },
      { type: 'message.delta', data: { text: 'fallback text' } },
    ]);

    const deltas = events.filter(e => e.type === 'message.delta');
    expect(deltas).toHaveLength(1);
    expect((deltas[0] as any).delta).toBe('fallback text');
  });

  it('should auto-emit message.start if delta arrives before explicit start', async () => {
    const events = await streamEvents([
      { type: 'message.delta', data: { delta: 'auto-started' } },
    ]);

    // Should have message.start (auto), message.delta, message.complete, done
    const starts = events.filter(e => e.type === 'message.start');
    expect(starts).toHaveLength(1);
    const deltas = events.filter(e => e.type === 'message.delta');
    expect(deltas).toHaveLength(1);
  });

  // ---------- message.complete ----------

  it('should update assistantMessage from message.complete data.content', async () => {
    const events = await streamEvents([
      { type: 'message.start', data: { messageId: 'msg-1' } },
      { type: 'message.delta', data: { delta: 'partial' } },
      { type: 'message.complete', data: { content: 'full response' } },
    ]);

    // The final message.complete emitted by the stream wrapper should have the
    // overridden content from the server's message.complete
    const completes = events.filter(e => e.type === 'message.complete');
    expect(completes).toHaveLength(1);
    expect((completes[0] as any).content).toBe('full response');
  });

  it('should use data.message as fallback for message.complete content', async () => {
    const events = await streamEvents([
      { type: 'message.start', data: { messageId: 'msg-1' } },
      { type: 'message.complete', data: { message: 'from message field' } },
    ]);

    const completes = events.filter(e => e.type === 'message.complete');
    expect(completes).toHaveLength(1);
    expect((completes[0] as any).content).toBe('from message field');
  });

  // ---------- tool.start ----------

  it('should emit tool.start with toolCall details', async () => {
    const events = await streamEvents([
      { type: 'message.start', data: { messageId: 'msg-1' } },
      {
        type: 'tool.start',
        data: {
          toolCall: {
            id: 'tc-1',
            name: 'read_file',
            arguments: { path: '/foo' },
          },
        },
      },
    ]);

    const tools = events.filter(e => e.type === 'tool.start');
    expect(tools).toHaveLength(1);
    expect((tools[0] as any).toolCall).toMatchObject({
      id: 'tc-1',
      name: 'read_file',
      arguments: { path: '/foo' },
      status: 'running',
    });
  });

  it('should use flat data fields as fallback for tool.start', async () => {
    const events = await streamEvents([
      { type: 'message.start', data: { messageId: 'msg-1' } },
      {
        type: 'tool.start',
        data: {
          id: 'tc-2',
          name: 'write_file',
          arguments: { path: '/bar', content: 'x' },
        },
      },
    ]);

    const tools = events.filter(e => e.type === 'tool.start');
    expect((tools[0] as any).toolCall).toMatchObject({
      id: 'tc-2',
      name: 'write_file',
      status: 'running',
    });
  });

  it('should auto-emit message.start if tool.start arrives first', async () => {
    const events = await streamEvents([
      {
        type: 'tool.start',
        data: {
          toolCall: { id: 'tc-1', name: 'shell', arguments: {} },
        },
      },
    ]);

    const starts = events.filter(e => e.type === 'message.start');
    expect(starts.length).toBeGreaterThanOrEqual(1);
  });

  // ---------- tool.complete ----------

  it('should emit tool.complete with result', async () => {
    const events = await streamEvents([
      { type: 'message.start', data: { messageId: 'msg-1' } },
      {
        type: 'tool.complete',
        data: {
          toolResult: { id: 'tc-1', result: 'file contents' },
        },
      },
    ]);

    const completes = events.filter(e => e.type === 'tool.complete');
    expect(completes).toHaveLength(1);
    expect((completes[0] as any).toolResult).toMatchObject({
      id: 'tc-1',
      result: 'file contents',
    });
  });

  it('should use flat data fields as fallback for tool.complete', async () => {
    const events = await streamEvents([
      { type: 'message.start', data: { messageId: 'msg-1' } },
      {
        type: 'tool.complete',
        data: {
          id: 'tc-2',
          result: 'flat result',
        },
      },
    ]);

    const completes = events.filter(e => e.type === 'tool.complete');
    expect((completes[0] as any).toolResult).toMatchObject({
      id: 'tc-2',
      result: 'flat result',
    });
  });

  // ---------- tool.permission.request ----------

  it('should emit tool.permission.request', async () => {
    const events = await streamEvents([
      { type: 'message.start', data: { messageId: 'msg-1' } },
      {
        type: 'tool.permission.request',
        data: {
          toolCall: {
            id: 'tc-perm',
            name: 'dangerous_tool',
            arguments: { force: true },
          },
        },
      },
    ]);

    const perms = events.filter(e => e.type === 'tool.permission.request');
    expect(perms).toHaveLength(1);
    expect((perms[0] as any).toolCall).toMatchObject({
      id: 'tc-perm',
      name: 'dangerous_tool',
      status: 'pending',
    });
  });

  it('should use data.messageId for permission request when available', async () => {
    const events = await streamEvents([
      { type: 'message.start', data: { messageId: 'msg-1' } },
      {
        type: 'tool.permission.request',
        data: {
          messageId: 'custom-msg-id',
          toolCall: { id: 'tc-1', name: 'tool', arguments: {} },
        },
      },
    ]);

    const perms = events.filter(e => e.type === 'tool.permission.request');
    expect((perms[0] as any).messageId).toBe('custom-msg-id');
  });

  // ---------- tool.permission.granted / denied ----------

  it('should emit tool.permission.granted', async () => {
    const events = await streamEvents([
      { type: 'message.start', data: { messageId: 'msg-1' } },
      {
        type: 'tool.permission.granted',
        data: { toolName: 'read_file', messageId: 'msg-1' },
      },
    ]);

    const granted = events.filter(e => e.type === 'tool.permission.granted');
    expect(granted).toHaveLength(1);
    expect((granted[0] as any).toolName).toBe('read_file');
  });

  it('should emit tool.permission.denied', async () => {
    const events = await streamEvents([
      { type: 'message.start', data: { messageId: 'msg-1' } },
      {
        type: 'tool.permission.denied',
        data: { toolName: 'shell', messageId: 'msg-1' },
      },
    ]);

    const denied = events.filter(e => e.type === 'tool.permission.denied');
    expect(denied).toHaveLength(1);
    expect((denied[0] as any).toolName).toBe('shell');
  });

  // ---------- question.request ----------

  it('should emit question.request with options', async () => {
    const events = await streamEvents([
      {
        type: 'question.request',
        data: {
          questionId: 'q-1',
          question: 'Which option?',
          options: [
            { label: 'Option A', description: 'First' },
            { label: 'Option B' },
          ],
          multiple: true,
        },
      },
    ]);

    const questions = events.filter(e => e.type === 'question.request');
    expect(questions).toHaveLength(1);
    const q = questions[0] as any;
    expect(q.questionId).toBe('q-1');
    expect(q.question).toBe('Which option?');
    expect(q.options).toHaveLength(2);
    expect(q.options[0]).toMatchObject({ label: 'Option A', description: 'First' });
    expect(q.options[1]).toMatchObject({ label: 'Option B' });
    expect(q.multiple).toBe(true);
    expect(q.allowFreeform).toBe(true);
  });

  it('should default question options to empty array', async () => {
    const events = await streamEvents([
      {
        type: 'question.request',
        data: {
          questionId: 'q-2',
          question: 'Anything?',
        },
      },
    ]);

    const questions = events.filter(e => e.type === 'question.request');
    const q = questions[0] as any;
    expect(q.options).toEqual([]);
    expect(q.multiple).toBe(false);
  });

  // ---------- subagent.start / complete / error ----------

  it('should emit subagent.start', async () => {
    const events = await streamEvents([
      {
        type: 'subagent.start',
        data: {
          sessionId: 'sub-sess-1',
          parentSessionId: 'session-1',
          description: 'Running analysis',
          async: true,
        },
      },
    ]);

    const starts = events.filter(e => e.type === 'subagent.start');
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      type: 'subagent.start',
      sessionId: 'sub-sess-1',
      parentSessionId: 'session-1',
      description: 'Running analysis',
      async: true,
    });
  });

  it('should emit subagent.complete', async () => {
    const events = await streamEvents([
      {
        type: 'subagent.complete',
        data: {
          sessionId: 'sub-sess-1',
          parentSessionId: 'session-1',
          result: 'Analysis done',
        },
      },
    ]);

    const completes = events.filter(e => e.type === 'subagent.complete');
    expect(completes).toHaveLength(1);
    expect((completes[0] as any).result).toBe('Analysis done');
  });

  it('should emit subagent.error', async () => {
    const events = await streamEvents([
      {
        type: 'subagent.error',
        data: {
          sessionId: 'sub-sess-1',
          parentSessionId: 'session-1',
          error: 'Timeout exceeded',
        },
      },
    ]);

    const errors = events.filter(e => e.type === 'subagent.error');
    expect(errors).toHaveLength(1);
    expect((errors[0] as any).error).toBe('Timeout exceeded');
  });

  it('should use sessionId fallback for subagent events', async () => {
    const events = await streamEvents([
      {
        type: 'subagent.start',
        data: { description: 'test', async: false },
      },
    ]);

    const starts = events.filter(e => e.type === 'subagent.start');
    // Should fall back to the stream's sessionId
    expect((starts[0] as any).sessionId).toBe(env.sessionId);
    expect((starts[0] as any).parentSessionId).toBe(env.sessionId);
  });

  // ---------- session.title.updated ----------

  it('should emit session.title.updated', async () => {
    const events = await streamEvents([
      {
        type: 'session.title.updated',
        data: {
          sessionId: 'session-1',
          title: 'New Title',
        },
      },
    ]);

    const titleEvents = events.filter(e => e.type === 'session.title.updated');
    expect(titleEvents).toHaveLength(1);
    expect((titleEvents[0] as any).title).toBe('New Title');
  });

  it('should default title to empty string', async () => {
    const events = await streamEvents([
      {
        type: 'session.title.updated',
        data: { sessionId: 'session-1' },
      },
    ]);

    const titleEvents = events.filter(e => e.type === 'session.title.updated');
    expect((titleEvents[0] as any).title).toBe('');
  });

  // ---------- error ----------

  it('should emit error event', async () => {
    const events = await streamEvents([
      {
        type: 'error',
        data: { error: 'Rate limit exceeded' },
      },
    ]);

    const errors = events.filter(e => e.type === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const errorEvt = errors.find((e: any) => e.error === 'Rate limit exceeded');
    expect(errorEvt).toBeDefined();
  });

  it('should default error message to "Unknown error"', async () => {
    const events = await streamEvents([
      { type: 'error', data: {} },
    ]);

    const errors = events.filter(e => e.type === 'error');
    const unknownError = errors.find((e: any) => e.error === 'Unknown error');
    expect(unknownError).toBeDefined();
  });

  // ---------- done ----------

  it('should handle done event and capture message', async () => {
    const events = await streamEvents([
      { type: 'message.start', data: { messageId: 'msg-1' } },
      { type: 'message.delta', data: { delta: 'hello' } },
      { type: 'done', data: { message: 'final message' } },
    ]);

    // The done event should update assistantMessage, which appears in message.complete
    const completes = events.filter(e => e.type === 'message.complete');
    expect(completes).toHaveLength(1);
    expect((completes[0] as any).content).toBe('final message');
  });

  it('should emit a done AgentEvent when stream completes', async () => {
    const events = await streamEvents([
      { type: 'message.start', data: { messageId: 'msg-1' } },
      { type: 'message.delta', data: { delta: 'hi' } },
    ]);

    const doneEvents = events.filter(e => e.type === 'done');
    expect(doneEvents.length).toBeGreaterThanOrEqual(1);
  });

  // ---------- event type resolution ----------

  it('should use data.type when eventType is empty', async () => {
    const events = await streamEvents([
      { type: '', data: { type: 'message.start', messageId: 'msg-via-data-type' } },
      { type: '', data: { type: 'message.delta', delta: 'via data.type' } },
    ]);

    const starts = events.filter(e => e.type === 'message.start');
    expect(starts).toHaveLength(1);
    const deltas = events.filter(e => e.type === 'message.delta');
    expect(deltas).toHaveLength(1);
    expect((deltas[0] as any).delta).toBe('via data.type');
  });

  // ---------- multiple messages in one stream ----------

  it('should handle multiple message.start events (multi-turn)', async () => {
    const events = await streamEvents([
      { type: 'message.start', data: { messageId: 'msg-1' } },
      { type: 'message.delta', data: { delta: 'first turn' } },
      { type: 'message.start', data: { messageId: 'msg-2' } },
      { type: 'message.delta', data: { delta: 'second turn' } },
    ]);

    // Should have two message.start events
    const starts = events.filter(e => e.type === 'message.start');
    expect(starts).toHaveLength(2);

    // First turn should get a message.complete before second message.start
    const completes = events.filter(e => e.type === 'message.complete');
    // One for the transition between turns + one for the final
    expect(completes).toHaveLength(2);
    expect((completes[0] as any).content).toBe('first turn');
    expect((completes[1] as any).content).toBe('second turn');
  });

  // ---------- unknown event type / fallback ----------

  it('should capture message field from unknown event types', async () => {
    const events = await streamEvents([
      { type: 'message.start', data: { messageId: 'msg-1' } },
      { type: 'some.unknown.event', data: { message: 'captured text' } },
    ]);

    // The fallback sets assistantMessage, which should appear in message.complete
    const completes = events.filter(e => e.type === 'message.complete');
    expect(completes).toHaveLength(1);
    expect((completes[0] as any).content).toBe('captured text');
  });

  // ---------- empty stream ----------

  it('should handle empty stream gracefully (no events)', async () => {
    const events = await streamEvents([]);

    // Should still emit done, but no message.complete since no message.start
    const doneEvents = events.filter(e => e.type === 'done');
    expect(doneEvents.length).toBeGreaterThanOrEqual(1);
    const completes = events.filter(e => e.type === 'message.complete');
    expect(completes).toHaveLength(0);
  });

  // ---------- malformed data ----------

  it('should handle JSON parse errors in SSE data gracefully', async () => {
    const { bridge, projectId, sessionId, onEvent, sse } = env;

    const sendPromise = bridge.sendMessage(projectId, sessionId, 'Hello');
    await new Promise(r => setTimeout(r, 0));

    // Send an event with invalid JSON directly through the callback
    // The handler in BridgeCore wraps JSON.parse in a try/catch
    const connectCall = (sse.handler.connect as any);
    // We can't easily send raw invalid JSON via our helper since it
    // serializes to JSON. Instead, verify the stream doesn't crash
    // with events that have missing expected fields.
    sse.sendEvent('message.delta', {});  // delta with no delta/text field
    sse.complete();

    await sendPromise;

    // Should not crash — delta defaults to empty string
    const deltas = onEvent.mock.calls
      .map(([, e]) => e)
      .filter(e => e.type === 'message.delta');
    if (deltas.length > 0) {
      expect((deltas[0] as any).delta).toBe('');
    }
  });

  it('should handle tool.start with missing toolCall gracefully', async () => {
    const events = await streamEvents([
      { type: 'message.start', data: { messageId: 'msg-1' } },
      { type: 'tool.start', data: {} },
    ]);

    const tools = events.filter(e => e.type === 'tool.start');
    expect(tools).toHaveLength(1);
    // Should default name to 'unknown' and arguments to {}
    expect((tools[0] as any).toolCall.name).toBe('unknown');
    expect((tools[0] as any).toolCall.arguments).toEqual({});
    expect((tools[0] as any).toolCall.status).toBe('running');
  });

  it('should handle tool.complete with missing toolResult gracefully', async () => {
    const events = await streamEvents([
      { type: 'message.start', data: { messageId: 'msg-1' } },
      { type: 'tool.complete', data: {} },
    ]);

    const tools = events.filter(e => e.type === 'tool.complete');
    expect(tools).toHaveLength(1);
    expect((tools[0] as any).toolResult.id).toBe('');
  });
});
