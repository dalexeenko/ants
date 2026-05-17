/**
 * Tests for PromptExecutor finishReason handling.
 *
 * Verifies that the executor treats only `stop` / `tool_calls` as terminal,
 * and surfaces non-terminal finish reasons (max_tokens, content_filter,
 * refusal) as IncompleteResponseError rather than silently returning a
 * truncated/blocked response as completion.
 */
import { describe, it, expect, vi } from "vitest";
import { PromptExecutor } from "../prompt/executor.js";
import type { PromptExecutorDeps } from "../prompt/executor.js";
import { IncompleteResponseError } from "../errors.js";
import type {
  AgentEvent,
  FinishReason,
  Message,
  LLMStreamResult,
  LLMProvider,
} from "../types.js";
import { ToolRegistry } from "../registry/tools.js";
import { UsageTracker } from "../usage/tracker.js";

function msg(id: string, role: "user" | "assistant", content: string): Message {
  return { id, role, content, createdAt: Date.now() };
}

/**
 * Mock provider that returns a single canned response with a controllable
 * finishReason. Each stream() call returns the next response.
 */
function createMockProvider(
  responses: Array<{
    content: string;
    finishReason?: FinishReason;
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
      const resp = responses[callIndex] ?? responses[responses.length - 1]!;
      callIndex++;
      const chunks: Array<{
        type: "text" | "tool_call";
        text?: string;
        toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
      }> = [];
      if (resp.content) chunks.push({ type: "text", text: resp.content });
      for (const tc of resp.toolCalls ?? []) {
        chunks.push({ type: "tool_call", toolCall: tc });
      }
      let i = 0;
      return {
        stream: {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                if (i < chunks.length) return { value: chunks[i++], done: false };
                return { value: undefined, done: true };
              },
            };
          },
        },
        response: Promise.resolve({
          content: resp.content,
          toolCalls: resp.toolCalls ?? [],
          finishReason: resp.finishReason,
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        }),
      };
    },
  };
}

function createDeps(overrides?: Partial<PromptExecutorDeps>): PromptExecutorDeps {
  const messages: Message[] = [msg("m1", "user", "Hello")];
  return {
    getProvider: () => createMockProvider([{ content: "ok", finishReason: "stop" }]),
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
    runCompaction: vi.fn(),
    getWorkingWindow: () => messages,
    executeTools: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("PromptExecutor finishReason handling", () => {
  it("returns cleanly when finishReason is 'stop' and no tool calls", async () => {
    const provider = createMockProvider([
      { content: "all done", finishReason: "stop" },
    ]);
    const executor = new PromptExecutor(createDeps({ getProvider: () => provider }));
    const result = await executor.runAgentLoop();
    expect(result.role).toBe("assistant");
    expect(result.content).toBe("all done");
    expect(result.finishReason).toBe("stop");
  });

  it("returns cleanly when finishReason is missing (legacy provider)", async () => {
    // Older provider mocks may not report a finishReason — preserve back-compat.
    const provider = createMockProvider([{ content: "legacy" }]);
    const executor = new PromptExecutor(createDeps({ getProvider: () => provider }));
    const result = await executor.runAgentLoop();
    expect(result.content).toBe("legacy");
    expect(result.finishReason).toBeUndefined();
  });

  it("throws IncompleteResponseError when finishReason is 'max_tokens' with no tool calls", async () => {
    const provider = createMockProvider([
      { content: "partial plan...", finishReason: "max_tokens" },
    ]);
    const executor = new PromptExecutor(createDeps({ getProvider: () => provider }));
    await expect(executor.runAgentLoop()).rejects.toThrow(IncompleteResponseError);

    // Reset state and run again to inspect the error payload.
    const provider2 = createMockProvider([
      { content: "partial plan...", finishReason: "max_tokens" },
    ]);
    const exec2 = new PromptExecutor(createDeps({ getProvider: () => provider2 }));
    try {
      await exec2.runAgentLoop();
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(IncompleteResponseError);
      const e = err as IncompleteResponseError;
      expect(e.finishReason).toBe("max_tokens");
      expect(e.content).toBe("partial plan...");
    }
  });

  it("throws IncompleteResponseError when finishReason is 'content_filter'", async () => {
    const provider = createMockProvider([
      { content: "", finishReason: "content_filter" },
    ]);
    const executor = new PromptExecutor(createDeps({ getProvider: () => provider }));
    await expect(executor.runAgentLoop()).rejects.toBeInstanceOf(IncompleteResponseError);
  });

  it("throws IncompleteResponseError when finishReason is 'refusal'", async () => {
    const provider = createMockProvider([
      { content: "I can't help with that.", finishReason: "refusal" },
    ]);
    const executor = new PromptExecutor(createDeps({ getProvider: () => provider }));
    await expect(executor.runAgentLoop()).rejects.toBeInstanceOf(IncompleteResponseError);
  });

  it("continues the loop when finishReason is 'tool_calls'", async () => {
    const provider = createMockProvider([
      {
        content: "",
        finishReason: "tool_calls",
        toolCalls: [{ id: "tc1", name: "test_tool", arguments: {} }],
      },
      { content: "done after tool", finishReason: "stop" },
    ]);
    const executeTools = vi
      .fn()
      .mockResolvedValue([{ id: "tc1", name: "test_tool", result: "ok" }]);
    const executor = new PromptExecutor(
      createDeps({ getProvider: () => provider, executeTools })
    );
    const result = await executor.runAgentLoop();
    expect(executeTools).toHaveBeenCalledTimes(1);
    expect(result.content).toBe("done after tool");
    expect(result.finishReason).toBe("stop");
  });

  it("emits message.complete event carrying finishReason", async () => {
    const emitEvent = vi.fn();
    const provider = createMockProvider([
      { content: "done", finishReason: "stop" },
    ]);
    const executor = new PromptExecutor(
      createDeps({ getProvider: () => provider, emitEvent })
    );
    await executor.runAgentLoop();
    const events = (emitEvent as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0] as AgentEvent
    );
    const complete = events.find((e) => e.type === "message.complete") as
      | { type: "message.complete"; finishReason?: FinishReason }
      | undefined;
    expect(complete).toBeDefined();
    expect(complete!.finishReason).toBe("stop");
  });
});
