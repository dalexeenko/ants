/**
 * Tests for compaction token estimation utilities.
 */
import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  estimateMessageTokens,
  estimateConversationTokens,
  estimatePayloadTokens,
  estimateLLMMessageTokens,
  estimateToolDefinitionTokens,
} from "../compaction/tokens.js";
import type { Message, LLMMessage, LLMTool } from "../types.js";
import { z } from "zod";

function msg(
  id: string,
  role: "user" | "assistant",
  content: string,
  extras?: Partial<Message>
): Message {
  return { id, role, content, createdAt: Date.now(), ...extras };
}

// Per-message overhead added to every message
const MSG_OVERHEAD = 4;

describe("estimateTokens", () => {
  it("should return ceil(length / 4) for simple text", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a")).toBe(1); // ceil(1/4) = 1
    expect(estimateTokens("abcd")).toBe(1); // ceil(4/4) = 1
    expect(estimateTokens("abcde")).toBe(2); // ceil(5/4) = 2
    expect(estimateTokens("x".repeat(100))).toBe(25);
  });

  it("should handle multi-byte characters by string length", () => {
    // JS .length counts UTF-16 code units, not bytes
    const text = "hello";
    expect(estimateTokens(text)).toBe(Math.ceil(text.length / 4));
  });
});

describe("estimateMessageTokens", () => {
  it("should estimate tokens from message content plus overhead", () => {
    const m = msg("1", "user", "Hello world!"); // 12 chars -> ceil(12/4) = 3
    expect(estimateMessageTokens(m)).toBe(MSG_OVERHEAD + 3);
  });

  it("should include tool call name and arguments in token count", () => {
    const m = msg("1", "assistant", "thinking...", {
      toolCalls: [
        { id: "tc1", name: "read_file", arguments: { path: "/foo/bar.ts" } },
      ],
    });

    const contentTokens = estimateTokens("thinking...");
    const nameTokens = estimateTokens("read_file");
    const argsTokens = estimateTokens(JSON.stringify({ path: "/foo/bar.ts" }));
    expect(estimateMessageTokens(m)).toBe(
      MSG_OVERHEAD + contentTokens + nameTokens + argsTokens
    );
  });

  it("should include multiple tool calls", () => {
    const m = msg("1", "assistant", "", {
      toolCalls: [
        { id: "tc1", name: "read_file", arguments: { path: "a.ts" } },
        { id: "tc2", name: "write_file", arguments: { path: "b.ts", content: "data" } },
      ],
    });

    const nameTokens1 = estimateTokens("read_file");
    const argsTokens1 = estimateTokens(JSON.stringify({ path: "a.ts" }));
    const nameTokens2 = estimateTokens("write_file");
    const argsTokens2 = estimateTokens(
      JSON.stringify({ path: "b.ts", content: "data" })
    );
    expect(estimateMessageTokens(m)).toBe(
      MSG_OVERHEAD + nameTokens1 + argsTokens1 + nameTokens2 + argsTokens2
    );
  });

  it("should include tool result names and results in token count", () => {
    const m = msg("1", "user", "", {
      toolResults: [
        { id: "tr1", name: "read_file", result: "file contents here" },
        { id: "tr2", name: "search", result: "found 3 results", isError: false },
      ],
    });

    const name1Tokens = estimateTokens("read_file");
    const tr1Tokens = estimateTokens("file contents here");
    const name2Tokens = estimateTokens("search");
    const tr2Tokens = estimateTokens("found 3 results");
    expect(estimateMessageTokens(m)).toBe(
      MSG_OVERHEAD + name1Tokens + tr1Tokens + name2Tokens + tr2Tokens
    );
  });

  it("should handle messages with both tool calls and tool results", () => {
    // A message shouldn't normally have both, but the function should handle it
    const m = msg("1", "assistant", "content", {
      toolCalls: [{ id: "tc1", name: "tool", arguments: {} }],
      toolResults: [{ id: "tr1", name: "tool", result: "result" }],
    });

    const contentTokens = estimateTokens("content");
    const callNameTokens = estimateTokens("tool");
    const callArgsTokens = estimateTokens(JSON.stringify({}));
    const resultNameTokens = estimateTokens("tool");
    const resultTokens = estimateTokens("result");

    expect(estimateMessageTokens(m)).toBe(
      MSG_OVERHEAD + contentTokens + callNameTokens + callArgsTokens + resultNameTokens + resultTokens
    );
  });

  it("should JSON-stringify non-string tool results instead of using String()", () => {
    const m = msg("1", "user", "", {
      toolResults: [
        { id: "tr1", name: "tool", result: { key: "value", count: 42 } },
      ],
    });

    // Should use JSON.stringify, not String() which would give "[object Object]"
    const nameTokens = estimateTokens("tool");
    const resultTokens = estimateTokens(JSON.stringify({ key: "value", count: 42 }));
    expect(estimateMessageTokens(m)).toBe(MSG_OVERHEAD + nameTokens + resultTokens);

    // Verify it's NOT using the old String() behavior
    const oldStringTokens = estimateTokens("[object Object]");
    expect(estimateMessageTokens(m)).not.toBe(MSG_OVERHEAD + nameTokens + oldStringTokens);
  });
});

describe("estimateConversationTokens", () => {
  it("should return 0 for empty conversation", () => {
    expect(estimateConversationTokens([])).toBe(0);
  });

  it("should sum tokens across all messages", () => {
    const messages = [
      msg("1", "user", "Hello"),
      msg("2", "assistant", "Hi there!"),
    ];

    const expected =
      estimateMessageTokens(messages[0]!) + estimateMessageTokens(messages[1]!);
    expect(estimateConversationTokens(messages)).toBe(expected);
  });

  it("should handle conversation with tool calls", () => {
    const messages = [
      msg("1", "user", "search for errors"),
      msg("2", "assistant", "", {
        toolCalls: [
          { id: "tc1", name: "grep", arguments: { pattern: "error" } },
        ],
      }),
      msg("3", "user", "", {
        toolResults: [
          { id: "tr1", name: "grep", result: "found 5 errors" },
        ],
      }),
      msg("4", "assistant", "I found 5 errors in the codebase."),
    ];

    let expected = 0;
    for (const m of messages) {
      expected += estimateMessageTokens(m);
    }
    expect(estimateConversationTokens(messages)).toBe(expected);
  });
});

describe("estimateLLMMessageTokens", () => {
  it("should estimate tokens for LLM messages with string content", () => {
    const messages: LLMMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ];
    const expected =
      (MSG_OVERHEAD + estimateTokens("Hello")) +
      (MSG_OVERHEAD + estimateTokens("Hi there!"));
    expect(estimateLLMMessageTokens(messages)).toBe(expected);
  });

  it("should handle content parts array (multimodal)", () => {
    const messages: LLMMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          {
            type: "image",
            source: {
              type: "base64",
              mediaType: "image/png",
              data: "abc123",
            },
          },
        ],
      },
    ];
    // text tokens + 1600 for image + overhead
    const textTokens = estimateTokens("What is in this image?");
    const expected = MSG_OVERHEAD + textTokens + 1600;
    expect(estimateLLMMessageTokens(messages)).toBe(expected);
  });

  it("should include tool calls and tool results", () => {
    const messages: LLMMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tc1", name: "bash", arguments: { cmd: "ls" } }],
      },
      {
        role: "user",
        content: "",
        toolResults: [{ id: "tr1", name: "bash", result: "file1.ts\nfile2.ts" }],
      },
    ];
    const tc = MSG_OVERHEAD + estimateTokens("bash") + estimateTokens(JSON.stringify({ cmd: "ls" }));
    const tr = MSG_OVERHEAD + estimateTokens("bash") + estimateTokens("file1.ts\nfile2.ts");
    expect(estimateLLMMessageTokens(messages)).toBe(tc + tr);
  });
});

describe("estimateToolDefinitionTokens", () => {
  it("should return 0 for empty tool list", () => {
    expect(estimateToolDefinitionTokens([])).toBe(0);
  });

  it("should estimate tokens for tool definitions", () => {
    const tools: LLMTool[] = [
      {
        name: "read_file",
        description: "Read a file from the filesystem",
        parameters: z.object({ path: z.string() }),
      },
    ];
    const expected = estimateTokens("read_file") +
      estimateTokens("Read a file from the filesystem") + 50;
    expect(estimateToolDefinitionTokens(tools)).toBe(expected);
  });

  it("should sum across multiple tools", () => {
    const tools: LLMTool[] = [
      {
        name: "tool_a",
        description: "Does A",
        parameters: z.object({}),
      },
      {
        name: "tool_b",
        description: "Does B",
        parameters: z.object({}),
      },
    ];
    const expected =
      (estimateTokens("tool_a") + estimateTokens("Does A") + 50) +
      (estimateTokens("tool_b") + estimateTokens("Does B") + 50);
    expect(estimateToolDefinitionTokens(tools)).toBe(expected);
  });
});

describe("estimatePayloadTokens", () => {
  it("should combine system prompt, messages, tools, and base overhead", () => {
    const systemPrompt = "You are a helpful assistant.";
    const messages: LLMMessage[] = [
      { role: "user", content: "Hello" },
    ];
    const tools: LLMTool[] = [];

    const expected =
      estimateTokens(systemPrompt) +
      estimateLLMMessageTokens(messages) +
      estimateToolDefinitionTokens(tools) +
      100; // base overhead

    expect(estimatePayloadTokens(systemPrompt, messages, tools)).toBe(expected);
  });

  it("should account for a large system prompt", () => {
    const bigPrompt = "x".repeat(10000); // ~2500 tokens
    const messages: LLMMessage[] = [{ role: "user", content: "hi" }];
    const result = estimatePayloadTokens(bigPrompt, messages, []);
    // Should be at least the system prompt tokens
    expect(result).toBeGreaterThanOrEqual(2500);
  });

  it("should account for tool definitions", () => {
    const tools: LLMTool[] = Array.from({ length: 20 }, (_, i) => ({
      name: `tool_${i}`,
      description: `Description for tool ${i} that does something useful`,
      parameters: z.object({}),
    }));
    const withTools = estimatePayloadTokens("system", [{ role: "user", content: "hi" }], tools);
    const withoutTools = estimatePayloadTokens("system", [{ role: "user", content: "hi" }], []);
    // 20 tools should add a meaningful amount
    expect(withTools - withoutTools).toBeGreaterThan(100);
  });
});
