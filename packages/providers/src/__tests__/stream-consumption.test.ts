/**
 * Regression tests: stream + response promise must not race on the same
 * async generator. The caller iterates the stream; the response promise
 * waits for stream completion via shared state, then returns aggregated text
 * and tool calls. Every text delta and every tool call must arrive exactly
 * once on the stream, and the response must reflect the full aggregate.
 */

import { describe, it, expect } from "vitest";
import { AnthropicClient } from "../anthropic-client.js";
import { OpenAIClient } from "../openai-client.js";
import { GoogleClient } from "../google-client.js";
import type { LLMStreamChunk } from "@ants/agent-core";

function sseResponse(events: string[]): Response {
  const body = events.map((e) => `data: ${e}\n\n`).join("");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Push each event as its own chunk so the parser sees realistic boundaries.
      const encoder = new TextEncoder();
      for (const e of events) {
        controller.enqueue(encoder.encode(`data: ${e}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
  // Note: body var unused; kept for documentation of wire format.
  void body;
}

function mockFetch(response: Response): typeof fetch {
  return (async () => response) as unknown as typeof fetch;
}

describe("Anthropic client: stream and response do not race", () => {
  it("delivers every text delta and tool call exactly once when caller iterates then awaits response", async () => {
    const events = [
      JSON.stringify({
        type: "message_start",
        message: { id: "m1", usage: { input_tokens: 5, output_tokens: 0 } },
      }),
      JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } }),
      JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " " } }),
      JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } }),
      JSON.stringify({ type: "content_block_stop", index: 0 }),
      JSON.stringify({
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "tu_1", name: "search", input: "" },
      }),
      JSON.stringify({
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"q":"' },
      }),
      JSON.stringify({
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: 'cats"}' },
      }),
      JSON.stringify({ type: "content_block_stop", index: 1 }),
      JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } }),
      JSON.stringify({ type: "message_stop" }),
    ];

    const client = new AnthropicClient({ fetch: mockFetch(sseResponse(events)) });
    const { stream, response } = await client.stream(
      { type: "api-key", apiKey: "test" },
      { model: "claude-3-5-sonnet", messages: [{ role: "user", content: "hi" }] }
    );

    const chunks: LLMStreamChunk[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    const final = await response;

    const textChunks = chunks.filter((c) => c.type === "text");
    expect(textChunks.map((c) => (c as { text: string }).text)).toEqual(["Hello", " ", "world"]);

    const toolCalls = chunks.filter((c) => c.type === "tool_call");
    expect(toolCalls).toHaveLength(1);
    expect((toolCalls[0] as { toolCall: { name: string; arguments: unknown } }).toolCall).toEqual({
      id: "tu_1",
      name: "search",
      arguments: { q: "cats" },
    });

    expect(final.content).toBe("Hello world");
    expect(final.toolCalls).toHaveLength(1);
    expect(final.toolCalls[0]).toEqual({ id: "tu_1", name: "search", arguments: { q: "cats" } });
  });
});

describe("OpenAI client: stream and response do not race", () => {
  it("delivers every text delta and tool call exactly once", async () => {
    const events = [
      JSON.stringify({
        id: "c1",
        object: "chat.completion.chunk",
        created: 1,
        model: "gpt-4",
        choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
      }),
      JSON.stringify({
        id: "c1",
        object: "chat.completion.chunk",
        created: 1,
        model: "gpt-4",
        choices: [{ index: 0, delta: { content: " " }, finish_reason: null }],
      }),
      JSON.stringify({
        id: "c1",
        object: "chat.completion.chunk",
        created: 1,
        model: "gpt-4",
        choices: [{ index: 0, delta: { content: "world" }, finish_reason: null }],
      }),
      JSON.stringify({
        id: "c1",
        object: "chat.completion.chunk",
        created: 1,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: "call_1", type: "function", function: { name: "search", arguments: '{"q":"' } },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
      JSON.stringify({
        id: "c1",
        object: "chat.completion.chunk",
        created: 1,
        model: "gpt-4",
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { arguments: 'cats"}' } }] },
            finish_reason: null,
          },
        ],
      }),
      JSON.stringify({
        id: "c1",
        object: "chat.completion.chunk",
        created: 1,
        model: "gpt-4",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
      }),
      "[DONE]",
    ];

    const client = new OpenAIClient({ fetch: mockFetch(sseResponse(events)) });
    const { stream, response } = await client.stream(
      { apiKey: "test" },
      { model: "gpt-4", messages: [{ role: "user", content: "hi" }] }
    );

    const chunks: LLMStreamChunk[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    const final = await response;

    const textChunks = chunks.filter((c) => c.type === "text");
    expect(textChunks.map((c) => (c as { text: string }).text)).toEqual(["Hello", " ", "world"]);

    const toolCalls = chunks.filter((c) => c.type === "tool_call");
    expect(toolCalls).toHaveLength(1);
    expect((toolCalls[0] as { toolCall: { name: string; arguments: unknown } }).toolCall).toEqual({
      id: "call_1",
      name: "search",
      arguments: { q: "cats" },
    });

    expect(final.content).toBe("Hello world");
    expect(final.toolCalls).toHaveLength(1);
    expect(final.toolCalls[0]).toEqual({ id: "call_1", name: "search", arguments: { q: "cats" } });
  });
});

describe("Google client: stream and response do not race", () => {
  it("delivers every text delta and tool call exactly once", async () => {
    const events = [
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: "Hello" }] } }],
      }),
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: " " }] } }],
      }),
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: "world" }] } }],
      }),
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: "search", args: { q: "cats" } } }],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7, totalTokenCount: 12 },
      }),
    ];

    const client = new GoogleClient({ fetch: mockFetch(sseResponse(events)) });
    const { stream, response } = await client.stream(
      { apiKey: "test" },
      { model: "gemini-1.5-pro", messages: [{ role: "user", content: "hi" }] }
    );

    const chunks: LLMStreamChunk[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    const final = await response;

    const textChunks = chunks.filter((c) => c.type === "text");
    expect(textChunks.map((c) => (c as { text: string }).text)).toEqual(["Hello", " ", "world"]);

    const toolCalls = chunks.filter((c) => c.type === "tool_call");
    expect(toolCalls).toHaveLength(1);
    expect((toolCalls[0] as { toolCall: { name: string; arguments: unknown } }).toolCall).toMatchObject({
      name: "search",
      arguments: { q: "cats" },
    });

    expect(final.content).toBe("Hello world");
    expect(final.toolCalls).toHaveLength(1);
    expect(final.toolCalls[0]).toMatchObject({ name: "search", arguments: { q: "cats" } });
  });
});
