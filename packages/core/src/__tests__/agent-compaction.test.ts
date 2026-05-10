/**
 * Tests for Agent-level compaction integration.
 *
 * Covers: runCompaction(), shouldCompact(), compaction config management,
 * plugin getContextSummary() hook, compaction engine recreation on provider change.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "../agent.js";
import { providerRegistry } from "../registry/providers.js";
import { definePlugin } from "../plugin.js";
import type { AgentEvent, LLMProvider, LLMStreamResult, Message } from "../types.js";
import { DEFAULT_COMPACTION_CONFIG } from "../compaction/types.js";
import { COMPACTION_SUMMARY_PREFIX } from "../compaction/engine.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockProvider(
  summaryText = "Summary of conversation"
): LLMProvider {
  return {
    async stream(): Promise<LLMStreamResult> {
      return {
        stream: {
          [Symbol.asyncIterator]() {
            let done = false;
            return {
              async next() {
                if (!done) {
                  done = true;
                  return {
                    value: { type: "text" as const, text: summaryText },
                    done: false,
                  };
                }
                return { value: undefined, done: true };
              },
            };
          },
        },
        response: Promise.resolve({
          content: summaryText,
          toolCalls: [],
          usage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          },
        }),
      };
    },
  };
}

function registerTestProvider(provider: LLMProvider): void {
  if (!providerRegistry.has("test-compaction-provider")) {
    providerRegistry.register({
      name: "test-compaction-provider",
      factory: () => provider,
    });
  }
}

function createTestAgent(
  provider: LLMProvider,
  compactionConfig?: Record<string, unknown>
): Agent {
  return new Agent(
    {
      provider: "test-compaction-provider",
      model: "test-model",
      auth: { type: "api-key", apiKey: "test" },
      workingDirectory: "/tmp/test",
    },
    {
      ...DEFAULT_COMPACTION_CONFIG,
      ...compactionConfig,
    }
  );
}

function msg(
  id: string,
  role: "user" | "assistant",
  content: string
): Message {
  return { id, role, content, createdAt: Date.now() };
}

/** Generate N messages padded to be large enough to trigger compaction. */
function generateMessages(count: number): Message[] {
  const messages: Message[] = [];
  for (let i = 0; i < count; i++) {
    const role = i % 2 === 0 ? "user" : "assistant";
    messages.push(
      msg(`m${i}`, role as "user" | "assistant", `Message ${i} ${"x".repeat(500)}`)
    );
  }
  return messages;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Agent compaction integration", () => {
  let mockProvider: LLMProvider;

  beforeEach(() => {
    mockProvider = createMockProvider();
    registerTestProvider(mockProvider);
  });

  describe("compaction engine lifecycle", () => {
    it("should create a compaction engine when compaction is enabled", () => {
      const agent = createTestAgent(mockProvider, { enabled: true });
      expect(agent.getCompactionEngine()).not.toBeNull();
    });

    it("should not create a compaction engine when compaction is disabled", () => {
      const agent = createTestAgent(mockProvider, { enabled: false });
      expect(agent.getCompactionEngine()).toBeNull();
    });

    it("should recreate compaction engine when provider instance changes", () => {
      const agent = createTestAgent(mockProvider, { enabled: true });
      const engine1 = agent.getCompactionEngine();

      const newProvider = createMockProvider("new summary");
      agent.setProviderInstance(newProvider, "test-compaction-provider");

      const engine2 = agent.getCompactionEngine();
      expect(engine2).not.toBeNull();
      expect(engine2).not.toBe(engine1);
    });

    it("should recreate compaction engine when provider is set by name", () => {
      const agent = createTestAgent(mockProvider, { enabled: true });
      const engine1 = agent.getCompactionEngine();

      agent.setProvider("test-compaction-provider");

      const engine2 = agent.getCompactionEngine();
      expect(engine2).not.toBeNull();
      expect(engine2).not.toBe(engine1);
    });
  });

  describe("compaction config management", () => {
    it("should return the current compaction config", () => {
      const agent = createTestAgent(mockProvider, {
        enabled: true,
        tokenThreshold: 0.75,
      });
      const config = agent.getCompactionConfig();
      expect(config.enabled).toBe(true);
      expect(config.tokenThreshold).toBe(0.75);
    });

    it("should update the compaction config", () => {
      const agent = createTestAgent(mockProvider, { enabled: true });
      agent.updateCompactionConfig({ tokenThreshold: 0.5 });
      const config = agent.getCompactionConfig();
      expect(config.tokenThreshold).toBe(0.5);
    });

    it("should propagate config updates to the compaction engine", () => {
      const agent = createTestAgent(mockProvider, { enabled: true });
      agent.updateCompactionConfig({ tokenThreshold: 0.3 });
      const engineConfig = agent.getCompactionEngine()!.getConfig();
      expect(engineConfig.tokenThreshold).toBe(0.3);
    });

    it("should return a copy from getCompactionConfig (no mutation)", () => {
      const agent = createTestAgent(mockProvider);
      const config1 = agent.getCompactionConfig();
      config1.enabled = false;
      const config2 = agent.getCompactionConfig();
      expect(config2.enabled).toBe(true);
    });
  });

  describe("shouldCompact()", () => {
    it("should return false when compaction engine is null", () => {
      const agent = createTestAgent(mockProvider, { enabled: false });
      expect(agent.shouldCompact()).toBe(false);
    });

    it("should return false when below threshold", () => {
      const agent = createTestAgent(mockProvider, { enabled: true });
      agent.setMessages([msg("1", "user", "Hi"), msg("2", "assistant", "Hello")]);
      expect(agent.shouldCompact()).toBe(false);
    });

    it("should return true when above threshold", () => {
      const agent = createTestAgent(mockProvider, {
        enabled: true,
        tokenThreshold: 0.001,
      });
      agent.setMessages(generateMessages(20));
      expect(agent.shouldCompact()).toBe(true);
    });
  });

  describe("runCompaction()", () => {
    it("should throw when compaction engine is null", async () => {
      const agent = createTestAgent(mockProvider, { enabled: false });
      await expect(agent.runCompaction()).rejects.toThrow(
        "Compaction not enabled"
      );
    });

    it("should append a summary message to the conversation", async () => {
      const agent = createTestAgent(mockProvider, {
        enabled: true,
      });

      const originalMessages = generateMessages(10);
      agent.setMessages(originalMessages);

      const result = await agent.runCompaction();

      expect(result.messagesPruned).toBe(10);
      expect(result.summary).toBe("Summary of conversation");

      // Messages should have the original + the appended summary
      const newMessages = agent.getMessages();
      expect(newMessages.length).toBe(originalMessages.length + 1);

      // Last message should be the summary
      const summaryMsg = newMessages[newMessages.length - 1]!;
      expect(summaryMsg.content).toContain(COMPACTION_SUMMARY_PREFIX);
      expect(summaryMsg.content).toContain("Summary of conversation");
      expect(summaryMsg.role).toBe("user");
    });

    it("should return valid compression stats", async () => {
      const agent = createTestAgent(mockProvider, {
        enabled: true,
      });
      agent.setMessages(generateMessages(10));

      const result = await agent.runCompaction();
      expect(result.compactionId).toBeTruthy();
      expect(result.originalTokens).toBeGreaterThan(0);
      expect(result.compactedTokens).toBeGreaterThan(0);
      expect(result.compressionRatio).toBeGreaterThan(0);
      expect(result.compressionRatio).toBeLessThan(1);
    });
  });

  describe("getWorkingWindow()", () => {
    it("should return all messages when no compaction has occurred", () => {
      const agent = createTestAgent(mockProvider, { enabled: true });
      const messages = generateMessages(5);
      agent.setMessages(messages);

      const window = agent.getWorkingWindow();
      expect(window).toHaveLength(5);
    });

    it("should return messages from the last summary onward after compaction", async () => {
      const agent = createTestAgent(mockProvider, { enabled: true });
      agent.setMessages(generateMessages(10));

      await agent.runCompaction();

      const window = agent.getWorkingWindow();
      // Working window should just be the summary message (which is at the end)
      expect(window).toHaveLength(1);
      expect(window[0]!.content).toContain(COMPACTION_SUMMARY_PREFIX);
    });
  });

  describe("plugin getContextSummary() hook", () => {
    it("should append plugin context to the compaction summary", async () => {
      const agent = createTestAgent(mockProvider, {
        enabled: true,
      });

      await agent.use(
        definePlugin({
          name: "background-tasks-plugin",
          onRegister: async () => {},
        })
      );

      const plugin = agent.getPlugin("background-tasks-plugin")!;
      (plugin as unknown as { getContextSummary: () => string }).getContextSummary =
        () => "## Background Tasks\n- Build running on commit abc123";

      agent.setMessages(generateMessages(10));
      await agent.runCompaction();

      const messages = agent.getMessages();
      const summaryMsg = messages.find((m) =>
        m.content.includes(COMPACTION_SUMMARY_PREFIX)
      );
      expect(summaryMsg).toBeDefined();
      expect(summaryMsg!.content).toContain("Background Tasks");
      expect(summaryMsg!.content).toContain("Build running on commit abc123");
    });

    it("should handle plugins that return empty context", async () => {
      const agent = createTestAgent(mockProvider, {
        enabled: true,
      });

      await agent.use(definePlugin({ name: "empty-context-plugin" }));
      const plugin = agent.getPlugin("empty-context-plugin")!;
      (plugin as unknown as { getContextSummary: () => string }).getContextSummary =
        () => "";

      agent.setMessages(generateMessages(10));
      await agent.runCompaction();

      const messages = agent.getMessages();
      const summaryMsg = messages.find((m) =>
        m.content.includes(COMPACTION_SUMMARY_PREFIX)
      );
      expect(summaryMsg).toBeDefined();
      expect(summaryMsg!.content).toBe(
        `${COMPACTION_SUMMARY_PREFIX}\n\nSummary of conversation`
      );
    });

    it("should aggregate context from multiple plugins", async () => {
      const agent = createTestAgent(mockProvider, {
        enabled: true,
      });

      await agent.use(definePlugin({ name: "plugin-a" }));
      await agent.use(definePlugin({ name: "plugin-b" }));

      const pluginA = agent.getPlugin("plugin-a")!;
      (pluginA as unknown as { getContextSummary: () => string }).getContextSummary =
        () => "Context from A";

      const pluginB = agent.getPlugin("plugin-b")!;
      (pluginB as unknown as { getContextSummary: () => string }).getContextSummary =
        () => "Context from B";

      agent.setMessages(generateMessages(10));
      await agent.runCompaction();

      const messages = agent.getMessages();
      const summaryMsg = messages.find((m) =>
        m.content.includes(COMPACTION_SUMMARY_PREFIX)
      );
      expect(summaryMsg).toBeDefined();
      expect(summaryMsg!.content).toContain("Context from A");
      expect(summaryMsg!.content).toContain("Context from B");
    });
  });

  describe("auto-compaction events via prompt()", () => {
    it("should emit compaction events when auto-compaction triggers during prompt", async () => {
      const provider = createMockProvider("response text");
      registerTestProvider(provider);

      const agent = createTestAgent(provider, {
        enabled: true,
        autoCompact: true,
        tokenThreshold: 0.001, // very low to trigger
      });
      agent.setProviderInstance(provider);

      // Seed enough messages to trigger compaction
      agent.setMessages(generateMessages(20));

      const events: AgentEvent[] = [];
      agent.on("event", (e) => events.push(e));

      await agent.prompt("Continue working");

      const compactionStart = events.find(
        (e) => e.type === "compaction.start"
      );
      const compactionComplete = events.find(
        (e) => e.type === "compaction.complete"
      );

      expect(compactionStart).toBeDefined();
      expect(compactionComplete).toBeDefined();
    });
  });
});
