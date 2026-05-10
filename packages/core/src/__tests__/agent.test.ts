/**
 * Tests for the Agent class core functionality.
 *
 * Covers: construction, prompt loop, tool execution, permissions,
 * questions, compaction integration, state management, abort, shutdown.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "../agent.js";
import { toolRegistry } from "../registry/tools.js";
import { providerRegistry } from "../registry/providers.js";
import { defineTool, definePlugin } from "../plugin.js";
import type { AgentEvent, LLMProvider, LLMStreamResult, Message } from "../types.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal mock LLM provider that returns canned responses. */
function createMockProvider(
  responses: Array<{
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  }>
): LLMProvider {
  let callIndex = 0;
  return {
    async stream(): Promise<LLMStreamResult> {
      const resp = responses[callIndex] ?? responses[responses.length - 1]!;
      callIndex++;
      const chunks: Array<{ type: "text" | "tool_call"; text?: string; toolCall?: { id: string; name: string; arguments: Record<string, unknown> } }> = [];
      if (resp.content) {
        chunks.push({ type: "text" as const, text: resp.content });
      }
      if (resp.toolCalls) {
        for (const tc of resp.toolCalls) {
          chunks.push({ type: "tool_call" as const, toolCall: tc });
        }
      }
      let i = 0;
      return {
        stream: {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                if (i < chunks.length) {
                  return { value: chunks[i++], done: false };
                }
                return { value: undefined, done: true };
              },
            };
          },
        },
        response: Promise.resolve({
          content: resp.content,
          toolCalls: resp.toolCalls ?? [],
          usage: resp.usage ?? { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        }),
      };
    },
  };
}

/** Register a simple test provider so the Agent constructor can resolve it. */
function registerTestProvider(provider: LLMProvider): void {
  if (!providerRegistry.has("test-provider")) {
    providerRegistry.register({
      name: "test-provider",
      factory: () => provider,
    });
  }
}

function createTestAgent(provider: LLMProvider, opts: Record<string, unknown> = {}): Agent {
  return new Agent({
    provider: "test-provider",
    model: "test-model",
    auth: { type: "api-key", apiKey: "test" },
    workingDirectory: "/tmp/test",
    ...opts,
  });
}

// Cleanup helper for tools registered in tests
const toolsToClean: string[] = [];
function registerTestTool(name: string, execute: (...args: unknown[]) => Promise<{ output: string; metadata?: Record<string, unknown> }>) {
  const tool = defineTool({
    name,
    description: `Test tool: ${name}`,
    parameters: z.object({ input: z.string().optional() }),
    execute: execute as never,
  });
  toolRegistry.register(tool);
  toolsToClean.push(name);
  return tool;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Agent", () => {
  let mockProvider: LLMProvider;

  beforeEach(() => {
    mockProvider = createMockProvider([{ content: "Hello!" }]);
    registerTestProvider(mockProvider);
  });

  afterEach(() => {
    for (const name of toolsToClean) {
      if (toolRegistry.has(name)) toolRegistry.unregister(name);
    }
    toolsToClean.length = 0;
  });

  // =========================================================================
  // Construction & Config
  // =========================================================================

  describe("construction", () => {
    it("should create an agent with default system prompt when none provided", () => {
      const agent = createTestAgent(mockProvider);
      const config = agent.getConfig();
      expect(config.systemPrompt).toBeDefined();
      expect(config.systemPrompt!.length).toBeGreaterThan(0);
    });

    it("should respect a custom system prompt", () => {
      const agent = createTestAgent(mockProvider, { systemPrompt: "Custom prompt" });
      expect(agent.getConfig().systemPrompt).toBe("Custom prompt");
    });

    it("should store working directory", () => {
      const agent = createTestAgent(mockProvider);
      expect(agent.getWorkingDirectory()).toBe("/tmp/test");
    });

    it("should start with empty messages", () => {
      const agent = createTestAgent(mockProvider);
      expect(agent.getMessages()).toHaveLength(0);
    });
  });

  // =========================================================================
  // Isolated tool registry
  // =========================================================================

  describe("useIsolatedToolRegistry", () => {
    it("should default to the global tool registry", () => {
      const agent = createTestAgent(mockProvider);
      // By default, agent uses the global singleton
      expect(agent.getToolRegistry()).toBe(toolRegistry);
    });

    it("should create a separate registry after calling useIsolatedToolRegistry", () => {
      const agent = createTestAgent(mockProvider);
      agent.useIsolatedToolRegistry();
      // Now the agent's registry should NOT be the global singleton
      expect(agent.getToolRegistry()).not.toBe(toolRegistry);
    });

    it("should not leak tools between isolated agents", async () => {
      // Register a tool on agent1's isolated registry
      const agent1 = createTestAgent(mockProvider);
      agent1.useIsolatedToolRegistry();

      const tool = defineTool({
        name: "isolated_test_tool",
        description: "A tool only for agent1",
        parameters: z.object({}),
        execute: async () => ({ output: "ok" }),
      });
      agent1.getToolRegistry().register(tool);

      // agent2 also isolated — should NOT see agent1's tool
      const agent2 = createTestAgent(mockProvider);
      agent2.useIsolatedToolRegistry();

      expect(agent1.getToolRegistry().has("isolated_test_tool")).toBe(true);
      expect(agent2.getToolRegistry().has("isolated_test_tool")).toBe(false);
      // Global registry should also NOT have the tool
      expect(toolRegistry.has("isolated_test_tool")).toBe(false);
    });

    it("should not pollute the global registry with plugin tools", async () => {
      const agent = createTestAgent(mockProvider);
      agent.useIsolatedToolRegistry();

      const plugin = definePlugin({
        name: "test-isolated-plugin",
        version: "1.0.0",
        tools: [
          defineTool({
            name: "plugin_isolated_tool",
            description: "Registered via plugin",
            parameters: z.object({}),
            execute: async () => ({ output: "ok" }),
          }),
        ],
      });
      await agent.use(plugin);

      // Tool visible on agent's isolated registry
      expect(agent.getToolRegistry().has("plugin_isolated_tool")).toBe(true);
      // NOT visible on global registry
      expect(toolRegistry.has("plugin_isolated_tool")).toBe(false);
    });
  });

  // =========================================================================
  // State management
  // =========================================================================

  describe("state management", () => {
    it("should set and get messages", () => {
      const agent = createTestAgent(mockProvider);
      const msgs: Message[] = [
        { id: "1", role: "user", content: "Hi", createdAt: 1 },
        { id: "2", role: "assistant", content: "Hey", createdAt: 2 },
      ];
      agent.setMessages(msgs);
      expect(agent.getMessages()).toHaveLength(2);
      // setMessages should create a copy
      msgs.push({ id: "3", role: "user", content: "X", createdAt: 3 });
      expect(agent.getMessages()).toHaveLength(2);
    });

    it("should clear messages", () => {
      const agent = createTestAgent(mockProvider);
      agent.setMessages([{ id: "1", role: "user", content: "Hi", createdAt: 1 }]);
      agent.clearMessages();
      expect(agent.getMessages()).toHaveLength(0);
    });

    it("should manage todos", () => {
      const agent = createTestAgent(mockProvider);
      agent.setTodos([{ id: "t1", content: "Task", status: "pending", priority: "high" }]);
      expect(agent.getTodos()).toHaveLength(1);
      agent.clearTodos();
      expect(agent.getTodos()).toHaveLength(0);
    });

    it("should manage phases", () => {
      const agent = createTestAgent(mockProvider);
      agent.setPhases([{ id: "p1", content: "Phase 1", status: "pending" }]);
      expect(agent.getPhases()).toHaveLength(1);
      agent.clearPhases();
      expect(agent.getPhases()).toHaveLength(0);
    });

    it("should manage session context", () => {
      const agent = createTestAgent(mockProvider);
      expect(agent.getSessionContext()).toBeNull();
      agent.setSessionContext({ sessionId: "s1", sessionManager: null });
      expect(agent.getSessionContext()?.sessionId).toBe("s1");
    });

    it("should set and get extensions", () => {
      const agent = createTestAgent(mockProvider);
      agent.setExtension("foo", { bar: 42 });
      expect(agent.getExtension<{ bar: number }>("foo")?.bar).toBe(42);
      expect(agent.getExtension("missing")).toBeUndefined();
    });

    it("should update working directory and emit event", () => {
      const agent = createTestAgent(mockProvider);
      const events: AgentEvent[] = [];
      agent.on("event", (e) => events.push(e));
      agent.setWorkingDirectory("/new/dir");
      expect(agent.getWorkingDirectory()).toBe("/new/dir");
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("agent.workingDirectory.changed");
    });
  });

  // =========================================================================
  // Prompt loop
  // =========================================================================

  describe("prompt", () => {
    it("should produce an assistant response for a simple prompt", async () => {
      const provider = createMockProvider([{ content: "I can help!" }]);
      registerTestProvider(provider);
      const agent = createTestAgent(provider);
      // Need to set provider instance since registry caches the old one
      agent.setProviderInstance(provider);

      const response = await agent.prompt("Help me");
      expect(response.role).toBe("assistant");
      expect(response.content).toBe("I can help!");
      // Messages should include user + assistant
      expect(agent.getMessages()).toHaveLength(2);
    });

    it("should emit events during prompt cycle", async () => {
      const provider = createMockProvider([{ content: "Hi" }]);
      const agent = createTestAgent(provider);
      agent.setProviderInstance(provider);

      const events: string[] = [];
      agent.on("event", (e) => events.push(e.type));

      await agent.prompt("Hello");

      expect(events).toContain("user.message");
      expect(events).toContain("message.start");
      expect(events).toContain("message.delta");
      expect(events).toContain("message.complete");
    });

    it("should execute tools when provider returns tool calls", async () => {
      const executeMock = vi.fn().mockResolvedValue({ output: "tool result" });
      registerTestTool("test_exec_tool", executeMock);

      const provider = createMockProvider([
        {
          content: "",
          toolCalls: [{ id: "tc1", name: "test_exec_tool", arguments: { input: "data" } }],
        },
        { content: "Done!" },
      ]);
      const agent = createTestAgent(provider);
      agent.setProviderInstance(provider);
      // Allow all tools so permission doesn't block execution
      agent.updatePermissionConfig({ allowAll: true });

      const response = await agent.prompt("Do something");
      expect(executeMock).toHaveBeenCalled();
      expect(response.content).toBe("Done!");
    });

    it("should handle unknown tools gracefully", async () => {
      const provider = createMockProvider([
        {
          content: "",
          toolCalls: [{ id: "tc1", name: "nonexistent_tool", arguments: {} }],
        },
        { content: "I see the error" },
      ]);
      const agent = createTestAgent(provider);
      agent.setProviderInstance(provider);

      const response = await agent.prompt("Use missing tool");
      // Should get back a response (the agent loop should continue after the error)
      expect(response.content).toBe("I see the error");
    });

    it("should throw when no provider is available", async () => {
      const agent = new Agent({
        provider: "nonexistent",
        model: "test",
        auth: { type: "api-key", apiKey: "x" },
      });
      await expect(agent.prompt("Hello")).rejects.toThrow("No provider available");
    });

    it("should detect infinite loops", async () => {
      const executeMock = vi.fn().mockResolvedValue({ output: "ok" });
      registerTestTool("loop_tool", executeMock);

      // Provider always returns the same tool call
      const provider = createMockProvider(
        Array.from({ length: 10 }, () => ({
          content: "",
          toolCalls: [{ id: "tc1", name: "loop_tool", arguments: { input: "same" } }],
        }))
      );
      const agent = createTestAgent(provider);
      agent.setProviderInstance(provider);
      agent.updatePermissionConfig({ allowAll: true });

      await expect(agent.prompt("Go")).rejects.toThrow("Agent stuck in loop");
    });
  });

  // =========================================================================
  // Slash commands
  // =========================================================================

  describe("slash commands", () => {
    it("should handle /help command", async () => {
      const agent = createTestAgent(mockProvider);
      const response = await agent.prompt("/help");
      expect(response.content).toBeDefined();
      expect(response.content.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Plugin lifecycle
  // =========================================================================

  describe("plugins", () => {
    it("should register and track plugins", async () => {
      const agent = createTestAgent(mockProvider);
      const plugin = definePlugin({ name: "test-plugin", version: "1.0.0" });
      await agent.use(plugin);
      expect(agent.getPluginNames()).toContain("test-plugin");
      expect(agent.getPlugin("test-plugin")).toBeDefined();
    });

    it("should reject duplicate plugin registration", async () => {
      const agent = createTestAgent(mockProvider);
      await agent.use(definePlugin({ name: "dup-plugin" }));
      await expect(
        agent.use(definePlugin({ name: "dup-plugin" }))
      ).rejects.toThrow("Plugin already registered");
    });

    it("should unregister plugins", async () => {
      const shutdownMock = vi.fn();
      const agent = createTestAgent(mockProvider);
      await agent.use(
        definePlugin({
          name: "removable",
          tools: [
            defineTool({
              name: "removable_tool",
              description: "Test",
              parameters: z.object({}),
              execute: async () => ({ output: "x" }),
            }),
          ],
          onShutdown: shutdownMock,
        })
      );
      expect(toolRegistry.has("removable_tool")).toBe(true);

      await agent.unuse("removable");
      expect(shutdownMock).toHaveBeenCalled();
      expect(toolRegistry.has("removable_tool")).toBe(false);
      expect(agent.getPluginNames()).not.toContain("removable");
    });

    it("should call onBeforePrompt and onAfterPrompt hooks", async () => {
      const provider = createMockProvider([{ content: "Response" }]);
      const agent = createTestAgent(provider);
      agent.setProviderInstance(provider);

      const hooks: string[] = [];
      await agent.use(
        definePlugin({
          name: "hooks-plugin",
          onBeforePrompt: async (msg) => {
            hooks.push("before");
            return msg;
          },
          onAfterPrompt: async () => {
            hooks.push("after");
          },
        })
      );

      await agent.prompt("test");
      expect(hooks).toEqual(["before", "after"]);
    });

    it("should call onMessageAdded for user and assistant messages", async () => {
      const provider = createMockProvider([{ content: "Hello back!" }]);
      const agent = createTestAgent(provider);
      agent.setProviderInstance(provider);

      const addedMessages: Array<{ role: string; content: string }> = [];
      await agent.use(
        definePlugin({
          name: "message-tracker",
          onMessageAdded: async (msg) => {
            addedMessages.push({ role: msg.role, content: msg.content });
          },
        })
      );

      await agent.prompt("Hi");
      // Should have received the user message and the assistant response
      expect(addedMessages).toHaveLength(2);
      expect(addedMessages[0]).toEqual({ role: "user", content: "Hi" });
      expect(addedMessages[1]).toEqual({ role: "assistant", content: "Hello back!" });
    });

    it("should call onMessageAdded for tool-result messages during multi-turn", async () => {
      const executeMock = vi.fn().mockResolvedValue({ output: "tool output" });
      registerTestTool("tracked_tool", executeMock);

      const provider = createMockProvider([
        // First turn: assistant calls a tool
        {
          content: "",
          toolCalls: [{ id: "tc1", name: "tracked_tool", arguments: { input: "x" } }],
        },
        // Second turn: assistant responds with final text
        { content: "All done" },
      ]);
      const agent = createTestAgent(provider);
      agent.setProviderInstance(provider);
      agent.updatePermissionConfig({ allowAll: true });

      const addedRoles: string[] = [];
      await agent.use(
        definePlugin({
          name: "message-tracker-tools",
          onMessageAdded: async (msg) => {
            addedRoles.push(msg.role);
          },
        })
      );

      await agent.prompt("Use the tool");
      // Expected sequence:
      // 1. user message ("Use the tool")
      // 2. assistant message (tool call)
      // 3. user message (tool results)
      // 4. assistant message ("All done")
      expect(addedRoles).toEqual(["user", "assistant", "user", "assistant"]);
    });

    it("should await onMessageAdded before continuing the agent loop", async () => {
      const executeMock = vi.fn().mockResolvedValue({ output: "result" });
      registerTestTool("order_tool", executeMock);

      const provider = createMockProvider([
        {
          content: "",
          toolCalls: [{ id: "tc1", name: "order_tool", arguments: {} }],
        },
        { content: "Done" },
      ]);
      const agent = createTestAgent(provider);
      agent.setProviderInstance(provider);
      agent.updatePermissionConfig({ allowAll: true });

      const events: string[] = [];
      await agent.use(
        definePlugin({
          name: "ordering-plugin",
          onMessageAdded: async (msg) => {
            // Simulate async work (like a DB write)
            await new Promise((r) => setTimeout(r, 10));
            if (msg.toolCalls?.length) {
              events.push("hook:assistant-with-tools");
            } else if (msg.toolResults?.length) {
              events.push("hook:tool-results");
            } else if (msg.role === "assistant") {
              events.push("hook:assistant-final");
            } else {
              events.push("hook:user");
            }
          },
          onBeforeToolExecute: async () => {
            events.push("tool:before");
          },
          onAfterToolExecute: async () => {
            events.push("tool:after");
          },
        })
      );

      await agent.prompt("Go");
      // The hook for the assistant message with tool calls must complete
      // BEFORE tool execution starts
      expect(events.indexOf("hook:assistant-with-tools")).toBeLessThan(
        events.indexOf("tool:before")
      );
      // The hook for the tool results must complete BEFORE the next
      // LLM call produces the final assistant message
      expect(events.indexOf("hook:tool-results")).toBeLessThan(
        events.indexOf("hook:assistant-final")
      );
    });
  });

  // =========================================================================
  // Permission system (remote)
  // =========================================================================

  describe("remote permissions", () => {
    it("should register and resolve permission resolvers", async () => {
      const agent = createTestAgent(mockProvider);
      agent.setupRemotePermissions();

      expect(agent.hasPendingPermission("tc-x")).toBe(false);

      // Simulate a pending permission
      const promise = new Promise<{ granted: boolean }>((resolve) => {
        // Access the internal permissionResolvers via the public API
        // by triggering the remote permission flow
      });

      // Direct resolver test
      let resolved = false;
      const directPromise = new Promise<void>((resolve) => {
        // We test the respond mechanism
        // Register a dummy resolver to validate the flow
        (agent as unknown as { permissionResolvers: Map<string, (r: { granted: boolean }) => void> })
          .permissionResolvers.set("tc-1", () => {
            resolved = true;
            resolve();
          });
      });

      expect(agent.hasPendingPermission("tc-1")).toBe(true);
      agent.respondToPermission("tc-1", { granted: true });
      await directPromise;
      expect(resolved).toBe(true);
      expect(agent.hasPendingPermission("tc-1")).toBe(false);
    });

    it("should silently ignore responses for unknown permission IDs", () => {
      const agent = createTestAgent(mockProvider);
      // Should not throw
      agent.respondToPermission("nonexistent", { granted: true });
    });
  });

  // =========================================================================
  // Provider management
  // =========================================================================

  describe("provider management", () => {
    it("should switch provider via setProvider", () => {
      const agent = createTestAgent(mockProvider);
      expect(agent.getConfig().provider).toBe("test-provider");

      // Register another provider
      if (!providerRegistry.has("alt-provider")) {
        providerRegistry.register({
          name: "alt-provider",
          factory: () =>
            createMockProvider([{ content: "alt" }]),
        });
      }
      agent.setProvider("alt-provider");
      expect(agent.getConfig().provider).toBe("alt-provider");
      expect(agent.getProvider()).not.toBeNull();
    });

    it("should set provider instance directly", () => {
      const agent = createTestAgent(mockProvider);
      const newProvider = createMockProvider([{ content: "direct" }]);
      agent.setProviderInstance(newProvider, "direct-provider");
      expect(agent.getConfig().provider).toBe("direct-provider");
      expect(agent.getProvider()).toBe(newProvider);
    });

    it("should set model and update provider", () => {
      const agent = createTestAgent(mockProvider);
      agent.setModel("test-provider", "new-model");
      expect(agent.getConfig().model).toBe("new-model");
    });
  });

  // =========================================================================
  // Abort
  // =========================================================================

  describe("abort", () => {
    it("should not throw when aborting with no active prompt", () => {
      const agent = createTestAgent(mockProvider);
      expect(() => agent.abort()).not.toThrow();
    });
  });

  // =========================================================================
  // Shutdown
  // =========================================================================

  describe("shutdown", () => {
    it("should call onShutdown on all plugins", async () => {
      const shutdowns: string[] = [];
      const agent = createTestAgent(mockProvider);

      await agent.use(
        definePlugin({ name: "p1", onShutdown: async () => { shutdowns.push("p1"); } })
      );
      await agent.use(
        definePlugin({ name: "p2", onShutdown: async () => { shutdowns.push("p2"); } })
      );

      await agent.shutdown();
      expect(shutdowns).toContain("p1");
      expect(shutdowns).toContain("p2");
    });
  });

  // =========================================================================
  // Usage tracking
  // =========================================================================

  describe("usage tracking", () => {
    it("should track usage after prompt", async () => {
      const provider = createMockProvider([
        { content: "Hi", usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } },
      ]);
      const agent = createTestAgent(provider);
      agent.setProviderInstance(provider);

      await agent.prompt("Test");

      const summary = agent.getUsageSummary();
      expect(summary.total.totalTokens).toBeGreaterThan(0);
      expect(summary.total.promptTokens).toBe(100);
      expect(summary.total.completionTokens).toBe(50);
    });

    it("should return token usage for session", () => {
      const agent = createTestAgent(mockProvider);
      const usage = agent.getTokenUsage();
      expect(usage).toBeDefined();
    });
  });

  // =========================================================================
  // Static factory
  // =========================================================================

  describe("Agent.create", () => {
    it("should create agent with defaults", async () => {
      const agent = await Agent.create({ skipConfigLoad: true });
      expect(agent).toBeInstanceOf(Agent);
    });

    it("should create agent with explicit config", async () => {
      const agent = await Agent.create({
        provider: "test-provider",
        model: "test-model",
        apiKey: "key",
        workingDirectory: "/test",
        skipConfigLoad: true,
      });
      const config = agent.getConfig();
      expect(config.provider).toBe("test-provider");
      expect(config.model).toBe("test-model");
    });
  });
});
