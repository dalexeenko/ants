/**
 * Integration test to verify core systems work together.
 *
 * NOTE: Provider-specific tests (export smoke tests, concrete provider creation)
 * live in @ants/agent-providers to avoid a cyclic dependency (core -> providers -> core).
 * This file tests core's ProviderRegistry and plugin system using mock providers.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { Agent, providerRegistry, toolRegistry, defineTool, definePlugin } from "../index.js";
import type { ProviderDefinition, LLMProvider } from "../index.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal mock LLM provider. */
function createMockLLMProvider(name: string): LLMProvider {
  return {
    _mockName: name,
    async stream() {
      return {
        stream: {
          [Symbol.asyncIterator]() {
            return { async next() { return { value: undefined, done: true }; } };
          },
        },
        response: Promise.resolve({
          content: "",
          toolCalls: [],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        }),
      };
    },
  } as unknown as LLMProvider;
}

/** Build a mock plugin that registers several providers, similar to @ants/agent-providers. */
function createMockProvidersPlugin() {
  const providerNames = ["mock-anthropic", "mock-openai", "mock-google"];
  const providers: ProviderDefinition[] = providerNames.map((name) => ({
    name,
    factory: (_opts: Record<string, unknown>) => createMockLLMProvider(name),
  }));
  return definePlugin({
    name: "mock-providers",
    version: "1.0.0",
    providers,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Core + Providers Integration", () => {
  afterEach(() => {
    // Clean up any providers registered during tests
    for (const name of providerRegistry.getNames()) {
      if (name.startsWith("mock-")) {
        providerRegistry.unregister(name);
      }
    }
  });

  it("should register providers via plugin", async () => {
    const agent = new Agent({
      provider: "mock-anthropic",
      model: "test-model",
      auth: { type: "api-key", apiKey: "test-key" },
    });

    const mockPlugin = createMockProvidersPlugin();
    await agent.use(mockPlugin);

    // Verify providers are registered
    expect(providerRegistry.has("mock-anthropic")).toBe(true);
    expect(providerRegistry.has("mock-openai")).toBe(true);
    expect(providerRegistry.has("mock-google")).toBe(true);
  });

  it("should create provider instances from registry", () => {
    const mockPlugin = createMockProvidersPlugin();

    // Register providers from plugin
    for (const provider of mockPlugin.providers!) {
      if (!providerRegistry.has(provider.name)) {
        providerRegistry.register(provider);
      }
    }

    const instance = providerRegistry.create("mock-anthropic", {
      apiKey: "test-key",
    });
    expect(instance).toBeDefined();
    expect(typeof instance.stream).toBe("function");
  });

  it("should throw when creating unknown provider", () => {
    expect(() => providerRegistry.create("nonexistent-provider")).toThrow(
      /not found/i
    );
  });

  it("should register and use custom tools", async () => {
    const mockExecute = vi.fn().mockResolvedValue({ output: "Hello, World!" });

    const greetTool = defineTool({
      name: "greet",
      description: "Greet a person",
      parameters: z.object({
        name: z.string().describe("Name to greet"),
      }),
      execute: mockExecute,
    });

    toolRegistry.register(greetTool);
    expect(toolRegistry.has("greet")).toBe(true);

    const tool = toolRegistry.get("greet");
    expect(tool).toBeDefined();
    expect(tool?.name).toBe("greet");

    // Execute the tool
    const result = await tool!.execute(
      { name: "Alice" },
      { workingDirectory: "/tmp", extensions: {} }
    );
    expect(result.output).toBe("Hello, World!");
    expect(mockExecute).toHaveBeenCalledWith(
      { name: "Alice" },
      expect.objectContaining({ workingDirectory: "/tmp" })
    );

    // Cleanup
    toolRegistry.unregister("greet");
  });

  it("should convert tools to LLM format", () => {
    const testTool = defineTool({
      name: "test_tool",
      description: "A test tool",
      parameters: z.object({
        input: z.string(),
      }),
      execute: async () => ({ output: "done" }),
    });

    toolRegistry.register(testTool);

    const llmTools = toolRegistry.toLLMTools(["test_tool"]);
    expect(llmTools).toHaveLength(1);
    expect(llmTools[0].name).toBe("test_tool");
    expect(llmTools[0].description).toBe("A test tool");

    toolRegistry.unregister("test_tool");
  });

  it("should handle agent configuration", () => {
    const agent = new Agent({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      auth: { type: "api-key", apiKey: "test-key" },
      systemPrompt: "You are a helpful assistant.",
      workingDirectory: "/test/dir",
    });

    const config = agent.getConfig();
    expect(config.provider).toBe("anthropic");
    expect(config.model).toBe("claude-sonnet-4-20250514");
    expect(config.systemPrompt).toBe("You are a helpful assistant.");
    expect(config.workingDirectory).toBe("/test/dir");
  });

  it("should manage messages", () => {
    const agent = new Agent({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      auth: { type: "api-key", apiKey: "test-key" },
    });

    expect(agent.getMessages()).toHaveLength(0);

    agent.setMessages([
      { id: "1", role: "user", content: "Hello", createdAt: Date.now() },
      { id: "2", role: "assistant", content: "Hi!", createdAt: Date.now() },
    ]);

    expect(agent.getMessages()).toHaveLength(2);

    agent.clearMessages();
    expect(agent.getMessages()).toHaveLength(0);
  });

  it("should manage todos", () => {
    const agent = new Agent({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      auth: { type: "api-key", apiKey: "test-key" },
    });

    expect(agent.getTodos()).toHaveLength(0);

    agent.setTodos([
      { id: "1", content: "Task 1", status: "pending", priority: "high" },
      { id: "2", content: "Task 2", status: "in_progress", priority: "medium" },
    ]);

    expect(agent.getTodos()).toHaveLength(2);

    agent.clearTodos();
    expect(agent.getTodos()).toHaveLength(0);
  });
});

describe("Agent Question System", () => {
  it("should register and resolve question resolvers", async () => {
    const agent = new Agent({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      auth: { type: "api-key", apiKey: "test-key" },
    });

    let resolvedResponse: { selected: string[]; freeformText?: string } | null = null;

    const promise = new Promise<{ selected: string[]; freeformText?: string }>((resolve) => {
      agent.registerQuestionResolver("q-1", resolve);
    });

    // Verify it's pending
    expect(agent.hasPendingQuestion("q-1")).toBe(true);
    expect(agent.hasPendingQuestion("q-nonexistent")).toBe(false);

    // Respond
    agent.respondToQuestion("q-1", { selected: ["Option A"] });

    resolvedResponse = await promise;
    expect(resolvedResponse).toEqual({ selected: ["Option A"] });

    // Resolver should be cleaned up
    expect(agent.hasPendingQuestion("q-1")).toBe(false);
  });

  it("should handle freeform text responses", async () => {
    const agent = new Agent({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      auth: { type: "api-key", apiKey: "test-key" },
    });

    const promise = new Promise<{ selected: string[]; freeformText?: string }>((resolve) => {
      agent.registerQuestionResolver("q-2", resolve);
    });

    agent.respondToQuestion("q-2", {
      selected: [],
      freeformText: "Custom answer",
    });

    const response = await promise;
    expect(response.selected).toEqual([]);
    expect(response.freeformText).toBe("Custom answer");
  });

  it("should handle multiple concurrent questions", async () => {
    const agent = new Agent({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      auth: { type: "api-key", apiKey: "test-key" },
    });

    const promise1 = new Promise<{ selected: string[] }>((resolve) => {
      agent.registerQuestionResolver("q-a", resolve);
    });

    const promise2 = new Promise<{ selected: string[] }>((resolve) => {
      agent.registerQuestionResolver("q-b", resolve);
    });

    expect(agent.hasPendingQuestion("q-a")).toBe(true);
    expect(agent.hasPendingQuestion("q-b")).toBe(true);

    agent.respondToQuestion("q-b", { selected: ["Second"] });
    agent.respondToQuestion("q-a", { selected: ["First"] });

    const [r1, r2] = await Promise.all([promise1, promise2]);
    expect(r1.selected).toEqual(["First"]);
    expect(r2.selected).toEqual(["Second"]);
  });

  it("should silently ignore responses for unknown question IDs", () => {
    const agent = new Agent({
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      auth: { type: "api-key", apiKey: "test-key" },
    });

    // Should not throw
    agent.respondToQuestion("nonexistent", { selected: ["X"] });
  });
});
