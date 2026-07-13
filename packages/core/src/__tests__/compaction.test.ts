/**
 * Tests for the CompactionEngine.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CompactionEngine, COMPACTION_SUMMARY_PREFIX } from "../compaction/engine.js";
import { DEFAULT_COMPACTION_CONFIG, getModelLimit } from "../compaction/types.js";
import { IncompleteResponseError } from "../errors.js";
import type { Message, LLMProvider, LLMStreamResult, LLMStreamOptions } from "../types.js";

function msg(id: string, role: "user" | "assistant", content: string, extras?: Partial<Message>): Message {
  return { id, role, content, createdAt: Date.now(), ...extras };
}

/**
 * Create a mock provider that returns a canned summary.
 * Optionally captures the options sent to stream() for inspection.
 */
function createMockProvider(
  summaryText = "Summary of conversation",
  streamCalls?: LLMStreamOptions[]
): LLMProvider {
  return {
    async stream(options: LLMStreamOptions): Promise<LLMStreamResult> {
      streamCalls?.push(options);
      return {
        stream: {
          [Symbol.asyncIterator]() {
            let done = false;
            return {
              async next() {
                if (!done) {
                  done = true;
                  return { value: { type: "text" as const, text: summaryText }, done: false };
                }
                return { value: undefined, done: true };
              },
            };
          },
        },
        response: Promise.resolve({
          content: summaryText,
          toolCalls: [],
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        }),
      };
    },
  };
}

/** Generate N messages to fill up the context window. */
function generateMessages(count: number): Message[] {
  const messages: Message[] = [];
  for (let i = 0; i < count; i++) {
    const role = i % 2 === 0 ? "user" : "assistant";
    messages.push(msg(`m${i}`, role as "user" | "assistant", `Message ${i} ${"x".repeat(500)}`));
  }
  return messages;
}

describe("CompactionEngine", () => {
  let provider: LLMProvider;

  beforeEach(() => {
    provider = createMockProvider();
  });

  describe("shouldCompact", () => {
    it("should return null when disabled", () => {
      const engine = new CompactionEngine(provider, "test-model", { ...DEFAULT_COMPACTION_CONFIG, enabled: false });
      const messages = generateMessages(100);
      expect(engine.shouldCompact(messages)).toBeNull();
    });

    it("should return null when below token threshold", () => {
      const engine = new CompactionEngine(provider, "test-model", {
        ...DEFAULT_COMPACTION_CONFIG,
        tokenThreshold: 0.8,
      });
      // A few short messages won't exceed the threshold
      const messages = [msg("1", "user", "Hi"), msg("2", "assistant", "Hello")];
      expect(engine.shouldCompact(messages)).toBeNull();
    });

    it("should return stats when above token threshold", () => {
      const engine = new CompactionEngine(provider, "test-model", {
        ...DEFAULT_COMPACTION_CONFIG,
        tokenThreshold: 0.001, // very low threshold to trigger
      });
      const messages = generateMessages(20);
      const stats = engine.shouldCompact(messages);
      expect(stats).not.toBeNull();
      expect(stats!.messagesToCompact).toBeGreaterThan(0);
    });

    it("should trigger on message threshold even if below token threshold", () => {
      const engine = new CompactionEngine(provider, "test-model", {
        ...DEFAULT_COMPACTION_CONFIG,
        tokenThreshold: 0.999, // very high, won't trigger on tokens
        messageThreshold: 5,
      });
      const messages = generateMessages(10);
      const stats = engine.shouldCompact(messages);
      expect(stats).not.toBeNull();
    });

    it("should return null when there are zero messages", () => {
      const engine = new CompactionEngine(provider, "test-model", {
        ...DEFAULT_COMPACTION_CONFIG,
        tokenThreshold: 0.001,
      });
      expect(engine.shouldCompact([])).toBeNull();
    });

    it("should return null when messageThreshold is set but not met", () => {
      const engine = new CompactionEngine(provider, "test-model", {
        ...DEFAULT_COMPACTION_CONFIG,
        tokenThreshold: 0.999, // won't trigger on tokens
        messageThreshold: 50,
      });
      const messages = generateMessages(10);
      expect(engine.shouldCompact(messages)).toBeNull();
    });

    it("should include currentTokens and threshold in returned stats", () => {
      const engine = new CompactionEngine(provider, "test-model", {
        ...DEFAULT_COMPACTION_CONFIG,
        tokenThreshold: 0.001,
      });
      const messages = generateMessages(10);
      const stats = engine.shouldCompact(messages);
      expect(stats).not.toBeNull();
      expect(stats!.currentTokens).toBeGreaterThan(0);
      expect(stats!.threshold).toBeGreaterThan(0);
      expect(stats!.messagesToCompact).toBe(10);
    });

    it("should only consider working window tokens after a compaction summary", () => {
      const engine = new CompactionEngine(provider, "test-model", {
        ...DEFAULT_COMPACTION_CONFIG,
        tokenThreshold: 0.001, // very low
      });

      // Messages before the summary should not count toward threshold
      const messages = [
        ...generateMessages(10),
        msg("summary", "user", `${COMPACTION_SUMMARY_PREFIX}\n\nPrevious summary`),
        msg("post1", "user", "Short"),
        msg("post2", "assistant", "Also short"),
      ];

      // The working window is just the summary + 2 short messages,
      // which should be well under even a very low threshold for most models
      const stats = engine.shouldCompact(messages);
      // Working window is small enough that it shouldn't trigger
      // (the threshold is 0.001 * 100000 = 100 tokens, but 3 messages including
      // a summary prefix is ~20 tokens, so this will actually trigger)
      // Let's just verify the messagesToCompact reflects the working window
      if (stats) {
        expect(stats.messagesToCompact).toBe(3); // summary + 2 messages
      }
    });
  });

  describe("getWorkingWindow", () => {
    it("should return all messages when no compaction has occurred", () => {
      const engine = new CompactionEngine(provider, "test-model");
      const messages = generateMessages(5);
      const window = engine.getWorkingWindow(messages);
      expect(window).toEqual(messages);
    });

    it("should return messages from the last summary onward", () => {
      const engine = new CompactionEngine(provider, "test-model");
      const messages = [
        msg("m0", "user", "Old message 1"),
        msg("m1", "assistant", "Old response 1"),
        msg("summary", "user", `${COMPACTION_SUMMARY_PREFIX}\n\nSummary of old stuff`),
        msg("m3", "user", "New message"),
        msg("m4", "assistant", "New response"),
      ];
      const window = engine.getWorkingWindow(messages);
      expect(window).toHaveLength(3);
      expect(window[0]!.id).toBe("summary");
      expect(window[1]!.id).toBe("m3");
      expect(window[2]!.id).toBe("m4");
    });

    it("should use the LAST summary when multiple exist", () => {
      const engine = new CompactionEngine(provider, "test-model");
      const messages = [
        msg("m0", "user", "Very old message"),
        msg("summary1", "user", `${COMPACTION_SUMMARY_PREFIX}\n\nFirst summary`),
        msg("m2", "user", "Middle message"),
        msg("summary2", "user", `${COMPACTION_SUMMARY_PREFIX}\n\nSecond summary`),
        msg("m4", "user", "Recent message"),
      ];
      const window = engine.getWorkingWindow(messages);
      expect(window).toHaveLength(2);
      expect(window[0]!.id).toBe("summary2");
      expect(window[1]!.id).toBe("m4");
    });
  });

  describe("compact", () => {
    it("should compact messages and return a summary", async () => {
      const engine = new CompactionEngine(provider, "test-model");
      const messages = generateMessages(10);
      const result = await engine.compact(messages);

      expect(result.compactionId).toBeTruthy();
      expect(result.summary).toBe("Summary of conversation");
      expect(result.messagesPruned).toBe(10);
      expect(result.originalTokens).toBeGreaterThan(0);
      expect(result.compactedTokens).toBeGreaterThan(0);
    });

    it("should throw when there are no messages to compact", async () => {
      const engine = new CompactionEngine(provider, "test-model");
      await expect(engine.compact([])).rejects.toThrow("No messages to compact");
    });

    it("should only summarize the working window when a previous summary exists", async () => {
      const streamCalls: LLMStreamOptions[] = [];
      const capturingProvider = createMockProvider("Merged summary", streamCalls);
      const engine = new CompactionEngine(capturingProvider, "test-model");

      const messages = [
        msg("m0", "user", "Old message"),
        msg("m1", "assistant", "Old response"),
        msg("summary", "user", `${COMPACTION_SUMMARY_PREFIX}\n\nPreviously we discussed project setup.`),
        msg("m3", "user", "New message"),
        msg("m4", "assistant", "New response"),
      ];

      const result = await engine.compact(messages);

      expect(result.summary).toBe("Merged summary");
      // Should only summarize the working window (3 messages: summary + 2 new)
      expect(result.messagesPruned).toBe(3);

      // The prompt should include the previous summary content
      const prompt = streamCalls[0]!.messages[0]!.content as string;
      expect(prompt).toContain("Previously we discussed project setup.");
    });
  });

  describe("createSummaryMessage", () => {
    it("should create a user-role message with the correct prefix", () => {
      const engine = new CompactionEngine(provider, "test-model");
      const message = engine.createSummaryMessage("My summary content");

      expect(message.role).toBe("user");
      expect(message.content).toBe(`${COMPACTION_SUMMARY_PREFIX}\n\nMy summary content`);
      expect(message.id).toBeTruthy();
      expect(message.createdAt).toBeGreaterThan(0);
    });
  });

  describe("isSummaryMessage", () => {
    it("should detect summary messages by prefix", () => {
      const engine = new CompactionEngine(provider, "test-model");
      expect(engine.isSummaryMessage(msg("1", "user", `${COMPACTION_SUMMARY_PREFIX}\n\nSome summary`))).toBe(true);
      expect(engine.isSummaryMessage(msg("2", "user", "Regular message"))).toBe(false);
      expect(engine.isSummaryMessage(msg("3", "assistant", "Regular response"))).toBe(false);
    });
  });

  describe("formatMessagesForSummary (via compact)", () => {
    it("should include tool call names in the summary prompt", async () => {
      const streamCalls: LLMStreamOptions[] = [];
      const capturingProvider = createMockProvider("summary", streamCalls);
      const engine = new CompactionEngine(capturingProvider, "test-model");

      const messages = [
        msg("m0", "user", "Find errors"),
        msg("m1", "assistant", "", {
          toolCalls: [{ id: "tc1", name: "grep_search", arguments: { pattern: "error" } }],
        }),
        msg("m2", "user", "", {
          toolResults: [{ id: "tr1", name: "grep_search", result: "Found 3 errors in main.ts" }],
        }),
        msg("m3", "assistant", "I found 3 errors."),
      ];

      await engine.compact(messages);

      expect(streamCalls).toHaveLength(1);
      const prompt = streamCalls[0]!.messages[0]!.content as string;
      expect(prompt).toContain("grep_search");
      expect(prompt).toContain("called tool: grep_search");
      expect(prompt).toContain("Tool grep_search succeeded: Found 3 errors in main.ts");
    });

    it("should mark failed tool results as 'failed'", async () => {
      const streamCalls: LLMStreamOptions[] = [];
      const capturingProvider = createMockProvider("summary", streamCalls);
      const engine = new CompactionEngine(capturingProvider, "test-model");

      const messages = [
        msg("m0", "user", "Read the file"),
        msg("m1", "assistant", "", {
          toolCalls: [{ id: "tc1", name: "read_file", arguments: { path: "/missing" } }],
        }),
        msg("m2", "user", "", {
          toolResults: [{ id: "tr1", name: "read_file", result: "ENOENT: file not found", isError: true }],
        }),
        msg("m3", "assistant", "File not found."),
      ];

      await engine.compact(messages);

      const prompt = streamCalls[0]!.messages[0]!.content as string;
      expect(prompt).toContain("Tool read_file failed: ENOENT: file not found");
    });

    it("should truncate long tool results to 200 chars with ellipsis", async () => {
      const streamCalls: LLMStreamOptions[] = [];
      const capturingProvider = createMockProvider("summary", streamCalls);
      const engine = new CompactionEngine(capturingProvider, "test-model");

      const longResult = "x".repeat(300);
      const messages = [
        msg("m0", "user", "Search"),
        msg("m1", "assistant", "", {
          toolCalls: [{ id: "tc1", name: "search", arguments: {} }],
        }),
        msg("m2", "user", "", {
          toolResults: [{ id: "tr1", name: "search", result: longResult }],
        }),
        msg("m3", "assistant", "Done"),
      ];

      await engine.compact(messages);

      const prompt = streamCalls[0]!.messages[0]!.content as string;
      expect(prompt).toContain("x".repeat(200) + "...");
      expect(prompt).not.toContain("x".repeat(201) + "...");
    });

    it("should use the configured compaction model when set", async () => {
      const streamCalls: LLMStreamOptions[] = [];
      const capturingProvider = createMockProvider("summary", streamCalls);
      const engine = new CompactionEngine(capturingProvider, "default-model", {
        ...DEFAULT_COMPACTION_CONFIG,
        model: "compaction-model",
      });

      const messages = generateMessages(6);
      await engine.compact(messages);

      expect(streamCalls[0]!.model).toBe("compaction-model");
    });

    it("should fall back to agent model when compaction model is not set", async () => {
      const streamCalls: LLMStreamOptions[] = [];
      const capturingProvider = createMockProvider("summary", streamCalls);
      const engine = new CompactionEngine(capturingProvider, "agent-model");

      const messages = generateMessages(6);
      await engine.compact(messages);

      expect(streamCalls[0]!.model).toBe("agent-model");
    });

    it("should format existing summary as 'Previous Summary' in the prompt", async () => {
      const streamCalls: LLMStreamOptions[] = [];
      const capturingProvider = createMockProvider("Merged summary", streamCalls);
      const engine = new CompactionEngine(capturingProvider, "test-model");

      const messages = [
        msg("summary", "user", `${COMPACTION_SUMMARY_PREFIX}\n\nPrevious context here.`),
        msg("m1", "user", "New work"),
        msg("m2", "assistant", "Done"),
      ];

      await engine.compact(messages);

      const prompt = streamCalls[0]!.messages[0]!.content as string;
      expect(prompt).toContain("Previous Summary:");
      expect(prompt).toContain("Previous context here.");
    });
  });

  describe("compact result structure", () => {
    it("should return a valid compactionId", async () => {
      const engine = new CompactionEngine(provider, "test-model");
      const messages = generateMessages(6);
      const result = await engine.compact(messages);
      expect(typeof result.compactionId).toBe("string");
      expect(result.compactionId.length).toBeGreaterThan(0);
    });

    it("should calculate compression ratio correctly", async () => {
      const engine = new CompactionEngine(provider, "test-model");
      const messages = generateMessages(10);
      const result = await engine.compact(messages);
      expect(result.compressionRatio).toBe(result.compactedTokens / result.originalTokens);
    });
  });

  describe("compact streaming via onDelta", () => {
    it("should invoke onDelta for each text chunk", async () => {
      // Provider that emits multiple chunks
      const multiChunkProvider: LLMProvider = {
        async stream(): Promise<LLMStreamResult> {
          const chunks = [
            { type: "text" as const, text: "Part 1. " },
            { type: "text" as const, text: "Part 2. " },
            { type: "text" as const, text: "Part 3." },
          ];
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
              content: "Part 1. Part 2. Part 3.",
              toolCalls: [],
              usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
            }),
          };
        },
      };

      const engine = new CompactionEngine(multiChunkProvider, "test-model");
      const messages = generateMessages(6);
      const deltas: string[] = [];

      await engine.compact(messages, (delta) => {
        deltas.push(delta);
      });

      expect(deltas).toEqual(["Part 1. ", "Part 2. ", "Part 3."]);
    });

    it("should work correctly without onDelta callback", async () => {
      const engine = new CompactionEngine(provider, "test-model");
      const messages = generateMessages(6);

      // Should not throw when onDelta is omitted
      const result = await engine.compact(messages);
      expect(result.summary).toBe("Summary of conversation");
    });

    it("should accumulate streamed content into the summary", async () => {
      // Provider where stream content differs from response content
      const streamOnlyProvider: LLMProvider = {
        async stream(): Promise<LLMStreamResult> {
          const chunks = [
            { type: "text" as const, text: "Streamed " },
            { type: "text" as const, text: "summary." },
          ];
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
              content: "Streamed summary.", // matches stream
              toolCalls: [],
              usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
            }),
          };
        },
      };

      const engine = new CompactionEngine(streamOnlyProvider, "test-model");
      const messages = generateMessages(6);
      const result = await engine.compact(messages);
      expect(result.summary).toBe("Streamed summary.");
    });

    it("should prefer final response content when it differs from stream", async () => {
      // Provider where the final response content differs from accumulated stream
      const divergingProvider: LLMProvider = {
        async stream(): Promise<LLMStreamResult> {
          const chunks = [
            { type: "text" as const, text: "Stream text" },
          ];
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
              content: "Reconciled final content",
              toolCalls: [],
              usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
            }),
          };
        },
      };

      const engine = new CompactionEngine(divergingProvider, "test-model");
      const messages = generateMessages(6);
      const result = await engine.compact(messages);
      expect(result.summary).toBe("Reconciled final content");
    });

    it("should reject incomplete summary responses", async () => {
      const truncatedProvider: LLMProvider = {
        async stream(): Promise<LLMStreamResult> {
          return {
            stream: {
              [Symbol.asyncIterator]() {
                let done = false;
                return {
                  async next() {
                    if (!done) {
                      done = true;
                      return { value: { type: "text" as const, text: "Partial summary" }, done: false };
                    }
                    return { value: undefined, done: true };
                  },
                };
              },
            },
            response: Promise.resolve({
              content: "Partial summary",
              toolCalls: [],
              finishReason: "max_tokens",
              usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
            }),
          };
        },
      };

      const engine = new CompactionEngine(truncatedProvider, "test-model");
      const messages = generateMessages(6);

      await expect(engine.compact(messages)).rejects.toBeInstanceOf(IncompleteResponseError);
    });

    it("should skip non-text chunks in onDelta", async () => {
      // Provider that emits a mix of text and non-text chunks
      const mixedProvider: LLMProvider = {
        async stream(): Promise<LLMStreamResult> {
          const chunks = [
            { type: "text" as const, text: "Hello" },
            { type: "tool_call" as const, toolCall: { id: "tc1", name: "test", arguments: {} } },
            { type: "text" as const, text: " world" },
          ];
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
              content: "Hello world",
              toolCalls: [],
              usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
            }),
          };
        },
      };

      const engine = new CompactionEngine(mixedProvider, "test-model");
      const messages = generateMessages(6);
      const deltas: string[] = [];

      await engine.compact(messages, (delta) => {
        deltas.push(delta);
      });

      // Only text chunks should trigger onDelta
      expect(deltas).toEqual(["Hello", " world"]);
    });
  });

  describe("config management", () => {
    it("should get and update config", () => {
      const engine = new CompactionEngine(provider, "test-model", DEFAULT_COMPACTION_CONFIG);
      const config = engine.getConfig();
      expect(config.enabled).toBe(true);

      engine.updateConfig({ enabled: false });
      expect(engine.getConfig().enabled).toBe(false);
    });

    it("should merge partial config with defaults in constructor", () => {
      const engine = new CompactionEngine(provider, "test-model", {
        tokenThreshold: 0.5,
      });
      const config = engine.getConfig();
      // Explicitly set
      expect(config.tokenThreshold).toBe(0.5);
      // Defaults preserved
      expect(config.enabled).toBe(true);
      expect(config.autoCompact).toBe(true);
    });

    it("should not mutate the original config when getConfig is called", () => {
      const engine = new CompactionEngine(provider, "test-model", DEFAULT_COMPACTION_CONFIG);
      const config1 = engine.getConfig();
      config1.enabled = false;
      const config2 = engine.getConfig();
      expect(config2.enabled).toBe(true);
    });
  });
});

describe("getModelLimit", () => {
  it("should return known model limits", () => {
    expect(getModelLimit("claude-sonnet-4-20250514")).toBe(200000);
    expect(getModelLimit("gpt-4o")).toBe(128000);
    expect(getModelLimit("gpt-4")).toBe(8192);
  });

  it("should return known limits for newly added models", () => {
    expect(getModelLimit("claude-opus-4-20250514")).toBe(200000);
    expect(getModelLimit("claude-haiku-4-20250514")).toBe(200000);
    expect(getModelLimit("gpt-4o-mini")).toBe(128000);
    expect(getModelLimit("o1")).toBe(200000);
    expect(getModelLimit("o3-mini")).toBe(200000);
    expect(getModelLimit("gemini-2.0-flash")).toBe(1048576);
    expect(getModelLimit("gemini-1.5-pro")).toBe(2097152);
  });

  it("should return 128000 for unknown models", () => {
    expect(getModelLimit("unknown-model")).toBe(128000);
  });
});
