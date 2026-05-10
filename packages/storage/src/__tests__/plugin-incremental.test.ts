import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createInMemoryDatabase, SessionManager } from "../index.js";
import type { NodeDatabaseConnection } from "../index.js";
import { storagePlugin } from "../plugin.js";
import type { AgentInterface } from "@openmgr/agent-core";
import type { Message } from "@openmgr/agent-core";

/**
 * Create a minimal mock AgentInterface that satisfies the storage plugin.
 */
function createMockAgent(overrides: {
  sessionId: string;
  sessionManager: SessionManager;
}): AgentInterface {
  const extensions = new Map<string, unknown>();
  const mockUsageTracker = {
    record: vi.fn(),
    setOnRecordCallback: vi.fn(),
    hydrate: vi.fn(),
    getSummary: () => ({ total: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0, requestCount: 0 }, sessions: [] }),
  };
  return {
    emit: vi.fn(() => true),
    getConfig: () => ({ provider: "anthropic", model: "claude-3-opus" }),
    getProvider: () => null,
    setExtension: (key: string, value: unknown) => extensions.set(key, value),
    getExtension: <T>(key: string): T | undefined => extensions.get(key) as T | undefined,
    setWorkingDirectory: vi.fn(),
    getWorkingDirectory: () => "/test",
    getMessages: () => [],
    getSessionContext: () => ({
      sessionId: overrides.sessionId,
      sessionManager: overrides.sessionManager,
    }),
    getUsageTracker: () => mockUsageTracker as any,
  };
}

function makeMessage(partial: Partial<Message> & { role: Message["role"] }): Message {
  return {
    id: partial.id ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: partial.role,
    content: partial.content ?? "",
    createdAt: partial.createdAt ?? Date.now(),
    toolCalls: partial.toolCalls,
    toolResults: partial.toolResults,
  };
}

describe("storagePlugin onMessageAdded", () => {
  let connection: NodeDatabaseConnection;
  let sessionManager: SessionManager;
  let sessionId: string;

  beforeEach(async () => {
    connection = createInMemoryDatabase();
    sessionManager = new SessionManager(connection.db);
    const session = await sessionManager.createSession({
      workingDirectory: "/test",
      provider: "anthropic",
      model: "claude-3-opus",
    });
    sessionId = session.id;
  });

  afterEach(() => {
    connection?.close();
  });

  it("persists a user message incrementally", async () => {
    const plugin = storagePlugin({ inMemory: true });
    const agent = createMockAgent({ sessionId, sessionManager });

    // Register so internal state is initialised (uses our pre-created connection
    // indirectly — the hook reads sessionManager from the agent's session context).
    // We manually wire the session manager into the agent mock above, but the
    // plugin also creates its own SessionManager on register. For this test we
    // skip onRegister and call onMessageAdded directly, which uses the
    // sessionManager from getSessionContext() — so we need to ensure the plugin's
    // internal state can handle that.
    //
    // Actually, onMessageAdded reads `sessionManager` from its closure (the one
    // created in onRegister), not from getSessionContext(). So we need to register
    // the plugin against a real in-memory DB first.

    // Register the plugin — it will create its own DB connection.
    // But we want it to use our in-memory DB. Since storagePlugin always creates
    // a new connection, let's instead test by creating the plugin with our DB path
    // and calling the hook. The simplest approach: just test the hook's behavior
    // by calling it directly with a plugin that has been properly registered.

    // For this test, we'll create a fresh in-memory plugin, register it against
    // the mock agent, and then call onMessageAdded. The plugin's internal
    // sessionManager will be different from ours, but its DB will also be
    // different. Instead, let's directly test the storagePlugin's onMessageAdded
    // by extracting it.

    // Simplest approach: create a standalone plugin that shares our DB.
    // We can do this by creating a plugin, registering it with an agent mock,
    // then using the plugin's own session manager (exposed via setExtension).

    // Register plugin — this creates its own DB connection + session manager
    await plugin.onRegister!(agent);

    // The plugin sets storage.sessions on the agent via setExtension
    const pluginSessionManager = agent.getExtension<SessionManager>("storage.sessions")!;
    expect(pluginSessionManager).toBeDefined();

    // Create a session in the plugin's own DB
    const pluginSession = await pluginSessionManager.createSession({
      workingDirectory: "/test",
      provider: "anthropic",
      model: "claude-3-opus",
    });

    // Update the mock to return the plugin's session context
    const pluginAgent = createMockAgent({
      sessionId: pluginSession.id,
      sessionManager: pluginSessionManager,
    });
    // Copy extensions from the registered agent
    pluginAgent.setExtension("storage.db", agent.getExtension("storage.db"));
    pluginAgent.setExtension("storage.sessions", pluginSessionManager);

    const userMsg = makeMessage({ role: "user", content: "Hello, agent!" });
    await plugin.onMessageAdded!(userMsg, pluginAgent);

    const stored = await pluginSessionManager.getSessionMessages(pluginSession.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.role).toBe("user");
    expect(stored[0]!.content).toBe("Hello, agent!");
    expect(stored[0]!.sequence).toBe(0);

    // Clean up
    await plugin.onShutdown!({} as AgentInterface);
  });

  it("assigns monotonically increasing sequence numbers", async () => {
    const plugin = storagePlugin({ inMemory: true });
    const agent = createMockAgent({ sessionId, sessionManager });
    await plugin.onRegister!(agent);

    const pluginSM = agent.getExtension<SessionManager>("storage.sessions")!;
    const session = await pluginSM.createSession({
      workingDirectory: "/test",
      provider: "anthropic",
      model: "claude-3-opus",
    });

    const pluginAgent = createMockAgent({ sessionId: session.id, sessionManager: pluginSM });

    // Simulate a multi-turn conversation
    const messages: Message[] = [
      makeMessage({ role: "user", content: "What is 2+2?" }),
      makeMessage({
        role: "assistant",
        content: "4",
        toolCalls: [{ id: "tc1", name: "calculator", arguments: { expr: "2+2" } }],
      }),
      makeMessage({
        role: "user",
        content: "",
        toolResults: [{ id: "tc1", name: "calculator", result: "4" }],
      }),
      makeMessage({ role: "assistant", content: "The answer is 4." }),
    ];

    for (const msg of messages) {
      await plugin.onMessageAdded!(msg, pluginAgent);
    }

    const stored = await pluginSM.getSessionMessages(session.id);
    expect(stored).toHaveLength(4);
    expect(stored.map((m) => m.sequence)).toEqual([0, 1, 2, 3]);

    await plugin.onShutdown!({} as AgentInterface);
  });

  it("persists tool calls and tool results correctly", async () => {
    const plugin = storagePlugin({ inMemory: true });
    const agent = createMockAgent({ sessionId, sessionManager });
    await plugin.onRegister!(agent);

    const pluginSM = agent.getExtension<SessionManager>("storage.sessions")!;
    const session = await pluginSM.createSession({
      workingDirectory: "/test",
      provider: "anthropic",
      model: "claude-3-opus",
    });

    const pluginAgent = createMockAgent({ sessionId: session.id, sessionManager: pluginSM });

    // Assistant message with tool calls
    const assistantMsg = makeMessage({
      role: "assistant",
      content: "Let me check that.",
      toolCalls: [
        { id: "tc-read", name: "read_file", arguments: { path: "/tmp/foo.txt" } },
        { id: "tc-list", name: "list_dir", arguments: { path: "/tmp" } },
      ],
    });
    await plugin.onMessageAdded!(assistantMsg, pluginAgent);

    // User message with tool results
    const toolResultMsg = makeMessage({
      role: "user",
      content: "",
      toolResults: [
        { id: "tc-read", name: "read_file", result: "file contents here" },
        { id: "tc-list", name: "list_dir", result: "foo.txt\nbar.txt", isError: false },
      ],
    });
    await plugin.onMessageAdded!(toolResultMsg, pluginAgent);

    const stored = await pluginSM.getSessionMessages(session.id);
    expect(stored).toHaveLength(2);

    // Check tool calls on assistant message
    const assistantStored = stored[0]!;
    expect(assistantStored.toolCalls).toBeDefined();
    expect(assistantStored.toolCalls).toHaveLength(2);
    expect(assistantStored.toolCalls![0]!.id).toBe("tc-read");
    expect(assistantStored.toolCalls![0]!.name).toBe("read_file");
    expect(assistantStored.toolCalls![0]!.arguments).toEqual({ path: "/tmp/foo.txt" });
    expect(assistantStored.toolCalls![1]!.id).toBe("tc-list");

    // Check tool results on user message
    const toolResultStored = stored[1]!;
    expect(toolResultStored.toolResults).toBeDefined();
    expect(toolResultStored.toolResults).toHaveLength(2);
    expect(toolResultStored.toolResults![0]!.toolCallId).toBe("tc-read");
    expect(toolResultStored.toolResults![0]!.content).toBe("file contents here");
    expect(toolResultStored.toolResults![1]!.toolCallId).toBe("tc-list");
    expect(toolResultStored.toolResults![1]!.isError).toBe(false);

    await plugin.onShutdown!({} as AgentInterface);
  });

  it("handles non-string content by JSON-stringifying", async () => {
    const plugin = storagePlugin({ inMemory: true });
    const agent = createMockAgent({ sessionId, sessionManager });
    await plugin.onRegister!(agent);

    const pluginSM = agent.getExtension<SessionManager>("storage.sessions")!;
    const session = await pluginSM.createSession({
      workingDirectory: "/test",
      provider: "anthropic",
      model: "claude-3-opus",
    });

    const pluginAgent = createMockAgent({ sessionId: session.id, sessionManager: pluginSM });

    // Message with non-string content (e.g. multimodal content blocks)
    const msg = {
      id: "msg-nonstring",
      role: "user" as const,
      content: [{ type: "text", text: "hello" }, { type: "image", url: "data:..." }] as unknown as string,
      createdAt: Date.now(),
    };

    await plugin.onMessageAdded!(msg, pluginAgent);

    const stored = await pluginSM.getSessionMessages(session.id);
    expect(stored).toHaveLength(1);
    // Non-string content should be JSON-stringified
    expect(stored[0]!.content).toBe(JSON.stringify([{ type: "text", text: "hello" }, { type: "image", url: "data:..." }]));

    await plugin.onShutdown!({} as AgentInterface);
  });

  it("does nothing when session context is missing", async () => {
    const plugin = storagePlugin({ inMemory: true });
    const agent = createMockAgent({ sessionId, sessionManager });
    await plugin.onRegister!(agent);

    // Agent with no session context
    const noCtxAgent: AgentInterface = {
      emit: vi.fn(() => true),
      getConfig: () => ({ provider: "anthropic", model: "claude-3-opus" }),
      getProvider: () => null,
      setExtension: vi.fn(),
      getExtension: () => undefined,
      setWorkingDirectory: vi.fn(),
      getWorkingDirectory: () => "/test",
      getMessages: () => [],
      getSessionContext: () => null,
    };

    const msg = makeMessage({ role: "user", content: "Should not be persisted" });

    // Should not throw
    await plugin.onMessageAdded!(msg, noCtxAgent);

    await plugin.onShutdown!({} as AgentInterface);
  });

  it("initialises sequence from existing messages in the session", async () => {
    const plugin = storagePlugin({ inMemory: true });
    const agent = createMockAgent({ sessionId, sessionManager });
    await plugin.onRegister!(agent);

    const pluginSM = agent.getExtension<SessionManager>("storage.sessions")!;
    const session = await pluginSM.createSession({
      workingDirectory: "/test",
      provider: "anthropic",
      model: "claude-3-opus",
    });

    // Pre-populate 3 messages directly via the session manager (simulating
    // messages that were persisted before the plugin was loaded, e.g. when
    // resuming a session)
    await pluginSM.addMessage({ sessionId: session.id, role: "user", content: "msg0", sequence: 0 });
    await pluginSM.addMessage({ sessionId: session.id, role: "assistant", content: "msg1", sequence: 1 });
    await pluginSM.addMessage({ sessionId: session.id, role: "user", content: "msg2", sequence: 2 });

    const pluginAgent = createMockAgent({ sessionId: session.id, sessionManager: pluginSM });

    // Now add a new message via the hook — it should get sequence 3
    const newMsg = makeMessage({ role: "assistant", content: "msg3 via hook" });
    await plugin.onMessageAdded!(newMsg, pluginAgent);

    const stored = await pluginSM.getSessionMessages(session.id);
    expect(stored).toHaveLength(4);
    expect(stored[3]!.sequence).toBe(3);
    expect(stored[3]!.content).toBe("msg3 via hook");

    await plugin.onShutdown!({} as AgentInterface);
  });

  it("tracks separate sequences for different sessions", async () => {
    const plugin = storagePlugin({ inMemory: true });
    const agent = createMockAgent({ sessionId, sessionManager });
    await plugin.onRegister!(agent);

    const pluginSM = agent.getExtension<SessionManager>("storage.sessions")!;

    // Create two sessions
    const session1 = await pluginSM.createSession({
      workingDirectory: "/test1",
      provider: "anthropic",
      model: "claude-3-opus",
    });
    const session2 = await pluginSM.createSession({
      workingDirectory: "/test2",
      provider: "anthropic",
      model: "claude-3-opus",
    });

    const agent1 = createMockAgent({ sessionId: session1.id, sessionManager: pluginSM });
    const agent2 = createMockAgent({ sessionId: session2.id, sessionManager: pluginSM });

    // Add messages to session 1
    await plugin.onMessageAdded!(makeMessage({ role: "user", content: "s1-m0" }), agent1);
    await plugin.onMessageAdded!(makeMessage({ role: "assistant", content: "s1-m1" }), agent1);

    // Add messages to session 2
    await plugin.onMessageAdded!(makeMessage({ role: "user", content: "s2-m0" }), agent2);

    // Add one more to session 1
    await plugin.onMessageAdded!(makeMessage({ role: "user", content: "s1-m2" }), agent1);

    const stored1 = await pluginSM.getSessionMessages(session1.id);
    const stored2 = await pluginSM.getSessionMessages(session2.id);

    expect(stored1).toHaveLength(3);
    expect(stored1.map((m) => m.sequence)).toEqual([0, 1, 2]);

    expect(stored2).toHaveLength(1);
    expect(stored2[0]!.sequence).toBe(0);

    await plugin.onShutdown!({} as AgentInterface);
  });

  it("updates session messageCount as messages are added", async () => {
    const plugin = storagePlugin({ inMemory: true });
    const agent = createMockAgent({ sessionId, sessionManager });
    await plugin.onRegister!(agent);

    const pluginSM = agent.getExtension<SessionManager>("storage.sessions")!;
    const session = await pluginSM.createSession({
      workingDirectory: "/test",
      provider: "anthropic",
      model: "claude-3-opus",
    });

    const pluginAgent = createMockAgent({ sessionId: session.id, sessionManager: pluginSM });

    await plugin.onMessageAdded!(makeMessage({ role: "user", content: "Hello" }), pluginAgent);
    await plugin.onMessageAdded!(makeMessage({ role: "assistant", content: "Hi!" }), pluginAgent);

    const updatedSession = await pluginSM.getSession(session.id);
    expect(updatedSession!.messageCount).toBe(2);

    await plugin.onShutdown!({} as AgentInterface);
  });
});
