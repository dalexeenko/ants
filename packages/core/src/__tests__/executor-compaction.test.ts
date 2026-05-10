/**
 * Tests for PromptExecutor auto-compaction behavior.
 *
 * Verifies that the executor checks compaction thresholds at each loop
 * iteration, emits the correct events, and handles errors gracefully.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PromptExecutor } from "../prompt/executor.js";
import type { PromptExecutorDeps } from "../prompt/executor.js";
import type { AgentEvent, Message, LLMStreamResult, LLMProvider } from "../types.js";
import { ToolRegistry } from "../registry/tools.js";
import { UsageTracker } from "../usage/tracker.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function msg(
  id: string,
  role: "user" | "assistant",
  content: string
): Message {
  return { id, role, content, createdAt: Date.now() };
}

/**
 * Create a mock LLM provider that returns canned responses.
 * Each call to stream() returns the next response in the list.
 */
function createMockProvider(
  responses: Array<{
    content: string;
    toolCalls?: Array<{
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }>;
  }>
): LLMProvider {
  let callIndex = 0;
  return {
    async stream(): Promise<LLMStreamResult> {
      const resp =
        responses[callIndex] ?? responses[responses.length - 1]!;
      callIndex++;
      const chunks: Array<{
        type: "text" | "tool_call";
        text?: string;
        toolCall?: {
          id: string;
          name: string;
          arguments: Record<string, unknown>;
        };
      }> = [];
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
          usage: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
          },
        }),
      };
    },
  };
}

/** Build a default set of PromptExecutorDeps with sensible defaults. */
function createDeps(overrides?: Partial<PromptExecutorDeps>): PromptExecutorDeps {
  const messages: Message[] = [msg("m1", "user", "Hello")];
  const provider = createMockProvider([{ content: "Hi there!" }]);

  return {
    getProvider: () => provider,
    getConfig: () => ({
      provider: "test",
      model: "test-model",
      auth: { type: "api-key" as const, apiKey: "test" },
    }),
    getMessages: () => messages,
    pushMessage: (m) => { messages.push(m); },
    getAbortSignal: () => undefined,
    emitEvent: vi.fn(),
    getSessionId: () => "session-1",
    getUsageTracker: () => new UsageTracker(),
    getToolRegistry: () => new ToolRegistry(),
    shouldAutoCompact: () => false,
    checkCompactionNeeded: () => null,
    runCompaction: vi.fn().mockResolvedValue({
      compactionId: "cmp-1",
      originalTokens: 5000,
      compactedTokens: 500,
      messagesPruned: 20,
      compressionRatio: 0.1,
    }),
    getWorkingWindow: () => messages,
    executeTools: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PromptExecutor auto-compaction", () => {
  describe("when auto-compaction is disabled", () => {
    it("should not check compaction or emit compaction events", async () => {
      const checkCompactionNeeded = vi.fn();
      const runCompaction = vi.fn();
      const emitEvent = vi.fn();

      const deps = createDeps({
        shouldAutoCompact: () => false,
        checkCompactionNeeded,
        runCompaction,
        emitEvent,
      });

      const executor = new PromptExecutor(deps);
      await executor.runAgentLoop();

      expect(checkCompactionNeeded).not.toHaveBeenCalled();
      expect(runCompaction).not.toHaveBeenCalled();

      const compactionEvents = (emitEvent as ReturnType<typeof vi.fn>).mock.calls
        .map((c: unknown[]) => (c[0] as AgentEvent).type)
        .filter((t: string) => t.startsWith("compaction."));
      expect(compactionEvents).toHaveLength(0);
    });
  });

  describe("when auto-compaction is enabled but threshold not reached", () => {
    it("should check but not trigger compaction", async () => {
      const checkCompactionNeeded = vi.fn().mockReturnValue(null);
      const runCompaction = vi.fn();
      const emitEvent = vi.fn();

      const deps = createDeps({
        shouldAutoCompact: () => true,
        checkCompactionNeeded,
        runCompaction,
        emitEvent,
      });

      const executor = new PromptExecutor(deps);
      await executor.runAgentLoop();

      expect(checkCompactionNeeded).toHaveBeenCalled();
      expect(runCompaction).not.toHaveBeenCalled();
    });
  });

  describe("when compaction threshold is reached", () => {
    it("should emit compaction.start and compaction.complete events", async () => {
      const emitEvent = vi.fn();
      const compactionResult = {
        compactionId: "cmp-42",
        originalTokens: 8000,
        compactedTokens: 800,
        messagesPruned: 15,
        compressionRatio: 0.1,
      };

      const deps = createDeps({
        shouldAutoCompact: () => true,
        checkCompactionNeeded: () => ({
          currentTokens: 8000,
          threshold: 5000,
          messagesToCompact: 15,
        }),
        runCompaction: vi.fn().mockResolvedValue(compactionResult),
        emitEvent,
      });

      const executor = new PromptExecutor(deps);
      await executor.runAgentLoop();

      const events = (emitEvent as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => c[0] as AgentEvent
      );

      const startEvent = events.find((e) => e.type === "compaction.start");
      expect(startEvent).toBeDefined();
      expect(startEvent).toEqual({
        type: "compaction.start",
        stats: {
          currentTokens: 8000,
          threshold: 5000,
          messagesToCompact: 15,
        },
      });

      const completeEvent = events.find(
        (e) => e.type === "compaction.complete"
      );
      expect(completeEvent).toBeDefined();
      expect(completeEvent).toEqual(expect.objectContaining({
        type: "compaction.complete",
        compactionId: "cmp-42",
        stats: {
          originalTokens: 8000,
          compactedTokens: 800,
          messagesPruned: 15,
          compressionRatio: 0.1,
        },
      }));
    });

    it("should run compaction before generating the LLM response", async () => {
      const callOrder: string[] = [];
      const provider: LLMProvider = {
        async stream(): Promise<LLMStreamResult> {
          callOrder.push("llm");
          return {
            stream: {
              [Symbol.asyncIterator]() {
                let done = false;
                return {
                  async next() {
                    if (!done) {
                      done = true;
                      return {
                        value: { type: "text" as const, text: "response" },
                        done: false,
                      };
                    }
                    return { value: undefined, done: true };
                  },
                };
              },
            },
            response: Promise.resolve({
              content: "response",
              toolCalls: [],
              usage: {
                promptTokens: 10,
                completionTokens: 5,
                totalTokens: 15,
              },
            }),
          };
        },
      };

      const deps = createDeps({
        getProvider: () => provider,
        shouldAutoCompact: () => true,
        checkCompactionNeeded: () => ({
          currentTokens: 8000,
          threshold: 5000,
          messagesToCompact: 10,
        }),
        runCompaction: vi.fn().mockImplementation(async () => {
          callOrder.push("compaction");
          return {
            compactionId: "cmp-1",
            originalTokens: 8000,
            compactedTokens: 800,
            messagesPruned: 10,
            compressionRatio: 0.1,
          };
        }),
      });

      const executor = new PromptExecutor(deps);
      await executor.runAgentLoop();

      expect(callOrder).toEqual(["compaction", "llm"]);
    });
  });

  describe("when compaction fails", () => {
    it("should emit compaction.error and continue the agent loop", async () => {
      const emitEvent = vi.fn();

      const deps = createDeps({
        shouldAutoCompact: () => true,
        checkCompactionNeeded: () => ({
          currentTokens: 8000,
          threshold: 5000,
          messagesToCompact: 10,
        }),
        runCompaction: vi.fn().mockRejectedValue(new Error("No messages to compact")),
        emitEvent,
      });

      const executor = new PromptExecutor(deps);
      // Should not throw - the error should be caught and emitted
      const result = await executor.runAgentLoop();

      const events = (emitEvent as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => c[0] as AgentEvent
      );

      const errorEvent = events.find((e) => e.type === "compaction.error");
      expect(errorEvent).toBeDefined();
      expect(errorEvent).toEqual({
        type: "compaction.error",
        error: "No messages to compact",
      });

      // The agent should still produce a response
      expect(result.role).toBe("assistant");
    });

    it("should still emit compaction.start before the error", async () => {
      const emitEvent = vi.fn();

      const deps = createDeps({
        shouldAutoCompact: () => true,
        checkCompactionNeeded: () => ({
          currentTokens: 8000,
          threshold: 5000,
          messagesToCompact: 10,
        }),
        runCompaction: vi.fn().mockRejectedValue(new Error("Provider error")),
        emitEvent,
      });

      const executor = new PromptExecutor(deps);
      await executor.runAgentLoop();

      const eventTypes = (emitEvent as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => (c[0] as AgentEvent).type
      );

      const startIdx = eventTypes.indexOf("compaction.start");
      const errorIdx = eventTypes.indexOf("compaction.error");
      expect(startIdx).toBeGreaterThanOrEqual(0);
      expect(errorIdx).toBeGreaterThan(startIdx);
    });
  });

  describe("compaction.delta event emission", () => {
    it("should emit compaction.delta events during compaction", async () => {
      const emitEvent = vi.fn();
      let deltaCallback: ((delta: string) => void) | undefined;

      const deps = createDeps({
        shouldAutoCompact: () => true,
        checkCompactionNeeded: () => ({
          currentTokens: 8000,
          threshold: 5000,
          messagesToCompact: 15,
        }),
        runCompaction: vi.fn().mockImplementation(async (onDelta) => {
          deltaCallback = onDelta;
          // Simulate streaming deltas
          onDelta?.("Part 1. ");
          onDelta?.("Part 2.");
          return {
            compactionId: "cmp-delta",
            originalTokens: 8000,
            compactedTokens: 800,
            messagesPruned: 15,
            compressionRatio: 0.1,
          };
        }),
        emitEvent,
      });

      const executor = new PromptExecutor(deps);
      await executor.runAgentLoop();

      const events = (emitEvent as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => c[0] as AgentEvent
      );

      const deltaEvents = events.filter((e) => e.type === "compaction.delta");
      expect(deltaEvents).toHaveLength(2);
      expect(deltaEvents[0]).toEqual({ type: "compaction.delta", delta: "Part 1. " });
      expect(deltaEvents[1]).toEqual({ type: "compaction.delta", delta: "Part 2." });
    });

    it("should emit deltas between compaction.start and compaction.complete", async () => {
      const emitEvent = vi.fn();

      const deps = createDeps({
        shouldAutoCompact: () => true,
        checkCompactionNeeded: () => ({
          currentTokens: 8000,
          threshold: 5000,
          messagesToCompact: 15,
        }),
        runCompaction: vi.fn().mockImplementation(async (onDelta) => {
          onDelta?.("delta chunk");
          return {
            compactionId: "cmp-order",
            originalTokens: 8000,
            compactedTokens: 800,
            messagesPruned: 15,
            compressionRatio: 0.1,
          };
        }),
        emitEvent,
      });

      const executor = new PromptExecutor(deps);
      await executor.runAgentLoop();

      const eventTypes = (emitEvent as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => (c[0] as AgentEvent).type
      );

      const startIdx = eventTypes.indexOf("compaction.start");
      const deltaIdx = eventTypes.indexOf("compaction.delta");
      const completeIdx = eventTypes.indexOf("compaction.complete");

      expect(startIdx).toBeGreaterThanOrEqual(0);
      expect(deltaIdx).toBeGreaterThan(startIdx);
      expect(completeIdx).toBeGreaterThan(deltaIdx);
    });
  });

  describe("contextUsage in events", () => {
    it("should include contextUsage in compaction.complete events", async () => {
      const emitEvent = vi.fn();

      const deps = createDeps({
        shouldAutoCompact: () => true,
        checkCompactionNeeded: () => ({
          currentTokens: 8000,
          threshold: 5000,
          messagesToCompact: 15,
        }),
        runCompaction: vi.fn().mockResolvedValue({
          compactionId: "cmp-ctx",
          originalTokens: 8000,
          compactedTokens: 800,
          messagesPruned: 15,
          compressionRatio: 0.1,
        }),
        emitEvent,
      });

      const executor = new PromptExecutor(deps);
      await executor.runAgentLoop();

      const events = (emitEvent as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => c[0] as AgentEvent
      );

      const completeEvent = events.find((e) => e.type === "compaction.complete") as
        | { type: "compaction.complete"; contextUsage?: { currentTokens: number; maxTokens: number } }
        | undefined;
      expect(completeEvent).toBeDefined();
      expect(completeEvent!.contextUsage).toBeDefined();
      expect(completeEvent!.contextUsage!.currentTokens).toBeGreaterThanOrEqual(0);
      expect(completeEvent!.contextUsage!.maxTokens).toBeGreaterThan(0);
    });

    it("should include contextUsage in message.complete events", async () => {
      const emitEvent = vi.fn();

      const deps = createDeps({
        emitEvent,
      });

      const executor = new PromptExecutor(deps);
      await executor.runAgentLoop();

      const events = (emitEvent as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => c[0] as AgentEvent
      );

      const msgComplete = events.find((e) => e.type === "message.complete") as
        | { type: "message.complete"; contextUsage?: { currentTokens: number; maxTokens: number } }
        | undefined;
      expect(msgComplete).toBeDefined();
      expect(msgComplete!.contextUsage).toBeDefined();
      expect(msgComplete!.contextUsage!.currentTokens).toBeGreaterThanOrEqual(0);
      expect(msgComplete!.contextUsage!.maxTokens).toBeGreaterThan(0);
    });
  });

  describe("compaction during multi-iteration loops", () => {
    it("should only check compaction on the first iteration (not mid-turn)", async () => {
      const checkCompactionNeeded = vi.fn().mockReturnValue(null);
      const provider = createMockProvider([
        {
          content: "",
          toolCalls: [{ id: "tc1", name: "test_tool", arguments: {} }],
        },
        { content: "Done" },
      ]);

      const deps = createDeps({
        getProvider: () => provider,
        shouldAutoCompact: () => true,
        checkCompactionNeeded,
        executeTools: vi.fn().mockResolvedValue([
          { id: "tr1", name: "test_tool", result: "ok" },
        ]),
      });

      const executor = new PromptExecutor(deps);
      await executor.runAgentLoop();

      // Auto-compaction is only checked on the first iteration to avoid
      // interrupting mid-turn tool execution flows.
      expect(checkCompactionNeeded).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Context overflow protection tests
// ---------------------------------------------------------------------------

describe("PromptExecutor context overflow protection", () => {
  describe("pre-send validation (Layer 2)", () => {
    it("should trigger emergency compaction when estimated tokens exceed model limit", async () => {
      const emitEvent = vi.fn();
      const runCompaction = vi.fn().mockResolvedValue({
        compactionId: "cmp-emergency",
        originalTokens: 200000,
        compactedTokens: 5000,
        messagesPruned: 50,
        compressionRatio: 0.025,
      });

      // Create messages with enough content to exceed model limit
      // test-model defaults to 128000 tokens. 95% safe limit = 121600
      // Each char is ~0.25 tokens, so 500k chars = ~125k tokens
      const bigContent = "x".repeat(500000);
      const messages: Message[] = [
        msg("m1", "user", bigContent),
      ];

      const deps = createDeps({
        getMessages: () => messages,
        getWorkingWindow: () => messages,
        runCompaction,
        emitEvent,
        shouldAutoCompact: () => false, // disable auto-compaction to isolate pre-send
      });

      const executor = new PromptExecutor(deps);
      await executor.runAgentLoop();

      // Emergency compaction should have been triggered
      expect(runCompaction).toHaveBeenCalled();

      // Should have emitted compaction events
      const events = (emitEvent as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => c[0] as AgentEvent
      );
      const compactionStart = events.find((e) => e.type === "compaction.start");
      expect(compactionStart).toBeDefined();
    });

    it("should not trigger emergency compaction when within model limit", async () => {
      const runCompaction = vi.fn();
      const messages: Message[] = [msg("m1", "user", "Hello")];

      const deps = createDeps({
        getMessages: () => messages,
        getWorkingWindow: () => messages,
        runCompaction,
        shouldAutoCompact: () => false,
      });

      const executor = new PromptExecutor(deps);
      await executor.runAgentLoop();

      // No compaction should be triggered for a small message
      expect(runCompaction).not.toHaveBeenCalled();
    });

    it("should truncate messages when compaction is insufficient", async () => {
      // Create many messages that are collectively too large
      const bigMessages: Message[] = [];
      for (let i = 0; i < 100; i++) {
        bigMessages.push(msg(`m${i}`, i % 2 === 0 ? "user" : "assistant", "x".repeat(6000)));
      }

      // After compaction, working window still returns the same big messages
      // (simulating compaction failure to reduce enough)
      const deps = createDeps({
        getMessages: () => bigMessages,
        getWorkingWindow: () => bigMessages,
        runCompaction: vi.fn().mockResolvedValue({
          compactionId: "cmp-1",
          originalTokens: 200000,
          compactedTokens: 190000, // barely reduced
          messagesPruned: 5,
          compressionRatio: 0.95,
        }),
        shouldAutoCompact: () => false,
      });

      const executor = new PromptExecutor(deps);
      // Should complete without throwing — truncation handles the overflow
      const result = await executor.runAgentLoop();
      expect(result.role).toBe("assistant");
    });
  });

  describe("reactive error handling (Layer 3)", () => {
    it("should retry once on context-length error from Anthropic", async () => {
      let callCount = 0;
      const provider: LLMProvider = {
        async stream(): Promise<LLMStreamResult> {
          callCount++;
          if (callCount === 1) {
            throw new Error("prompt is too long: 204801 tokens > 200000 maximum");
          }
          // Second call succeeds
          return {
            stream: {
              [Symbol.asyncIterator]() {
                let done = false;
                return {
                  async next() {
                    if (!done) {
                      done = true;
                      return {
                        value: { type: "text" as const, text: "recovered" },
                        done: false,
                      };
                    }
                    return { value: undefined, done: true };
                  },
                };
              },
            },
            response: Promise.resolve({
              content: "recovered",
              toolCalls: [],
              usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            }),
          };
        },
      };

      const deps = createDeps({
        getProvider: () => provider,
        runCompaction: vi.fn().mockResolvedValue({
          compactionId: "cmp-recovery",
          originalTokens: 200000,
          compactedTokens: 5000,
          messagesPruned: 50,
          compressionRatio: 0.025,
        }),
      });

      const executor = new PromptExecutor(deps);
      const result = await executor.runAgentLoop();

      expect(result.content).toBe("recovered");
      expect(callCount).toBe(2);
    });

    it("should retry once on context-length error from OpenAI", async () => {
      let callCount = 0;
      const provider: LLMProvider = {
        async stream(): Promise<LLMStreamResult> {
          callCount++;
          if (callCount === 1) {
            throw new Error(
              "This model's maximum context length is 128000 tokens. " +
              "However, your messages resulted in 130000 tokens."
            );
          }
          return {
            stream: {
              [Symbol.asyncIterator]() {
                let done = false;
                return {
                  async next() {
                    if (!done) {
                      done = true;
                      return {
                        value: { type: "text" as const, text: "ok" },
                        done: false,
                      };
                    }
                    return { value: undefined, done: true };
                  },
                };
              },
            },
            response: Promise.resolve({
              content: "ok",
              toolCalls: [],
              usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            }),
          };
        },
      };

      const deps = createDeps({
        getProvider: () => provider,
        runCompaction: vi.fn().mockResolvedValue({
          compactionId: "cmp-1",
          originalTokens: 130000,
          compactedTokens: 5000,
          messagesPruned: 50,
          compressionRatio: 0.04,
        }),
      });

      const executor = new PromptExecutor(deps);
      const result = await executor.runAgentLoop();

      expect(result.content).toBe("ok");
      expect(callCount).toBe(2);
    });

    it("should throw clear error when retry also fails with context-length error", async () => {
      const provider: LLMProvider = {
        async stream(): Promise<LLMStreamResult> {
          throw new Error("prompt is too long: 204801 tokens > 200000 maximum");
        },
      };

      const deps = createDeps({
        getProvider: () => provider,
        runCompaction: vi.fn().mockResolvedValue({
          compactionId: "cmp-1",
          originalTokens: 200000,
          compactedTokens: 190000,
          messagesPruned: 5,
          compressionRatio: 0.95,
        }),
      });

      const executor = new PromptExecutor(deps);
      await expect(executor.runAgentLoop()).rejects.toThrow(
        "Conversation exceeds model context limit even after compaction"
      );
    });

    it("should re-throw non-context-length errors without retry", async () => {
      const provider: LLMProvider = {
        async stream(): Promise<LLMStreamResult> {
          throw new Error("API key invalid");
        },
      };

      const runCompaction = vi.fn();
      const deps = createDeps({
        getProvider: () => provider,
        runCompaction,
      });

      const executor = new PromptExecutor(deps);
      await expect(executor.runAgentLoop()).rejects.toThrow("API key invalid");

      // Compaction should NOT be triggered for non-context errors
      expect(runCompaction).not.toHaveBeenCalled();
    });

    it("should handle compaction failure during reactive recovery", async () => {
      let callCount = 0;
      const provider: LLMProvider = {
        async stream(): Promise<LLMStreamResult> {
          callCount++;
          if (callCount === 1) {
            throw new Error("prompt is too long: 204801 tokens > 200000 maximum");
          }
          return {
            stream: {
              [Symbol.asyncIterator]() {
                let done = false;
                return {
                  async next() {
                    if (!done) {
                      done = true;
                      return {
                        value: { type: "text" as const, text: "ok" },
                        done: false,
                      };
                    }
                    return { value: undefined, done: true };
                  },
                };
              },
            },
            response: Promise.resolve({
              content: "ok",
              toolCalls: [],
              usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            }),
          };
        },
      };

      const emitEvent = vi.fn();
      const deps = createDeps({
        getProvider: () => provider,
        runCompaction: vi.fn().mockRejectedValue(new Error("No messages to compact")),
        emitEvent,
      });

      const executor = new PromptExecutor(deps);
      // Should still succeed on retry (with truncation instead of compaction)
      const result = await executor.runAgentLoop();
      expect(result.content).toBe("ok");

      // Should have emitted a compaction error
      const events = (emitEvent as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => c[0] as AgentEvent
      );
      const errorEvent = events.find((e) => e.type === "compaction.error");
      expect(errorEvent).toBeDefined();
    });
  });
});
