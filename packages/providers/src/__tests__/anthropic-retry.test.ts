/**
 * Pre-stream retry + error unwrapping for the Anthropic client.
 * Verifies that transient failures retry, terminal failures don't, and
 * Node's "fetch failed" wrapper is unwrapped to its real cause.
 */

import { describe, it, expect, vi } from "vitest";
import { AnthropicClient } from "../anthropic-client.js";

function emptyStreamResponse(): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            type: "message_start",
            message: { id: "m1", usage: { input_tokens: 1, output_tokens: 0 } },
          })}\n\n` +
          `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } })}\n\n` +
          `data: ${JSON.stringify({ type: "message_stop" })}\n\n`,
        ),
      );
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function consume(client: AnthropicClient): Promise<void> {
  const { stream, response } = await client.stream(
    { type: "api-key", apiKey: "test" },
    { model: "claude-3-5-sonnet", messages: [{ role: "user", content: "hi" }] },
  );
  for await (const _ of stream) void _;
  await response;
}

describe("AnthropicClient: pre-stream retry", () => {
  it("retries a transient network failure and succeeds on the second attempt", async () => {
    const fetchFn = vi.fn()
      .mockRejectedValueOnce(
        Object.assign(new TypeError("fetch failed"), {
          cause: Object.assign(new Error("getaddrinfo ENOTFOUND api.anthropic.com"), { code: "ENOTFOUND" }),
        }),
      )
      .mockResolvedValueOnce(emptyStreamResponse());

    const client = new AnthropicClient({ fetch: fetchFn as unknown as typeof fetch });
    await consume(client);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  }, 10000);

  it("retries 429 rate-limit responses", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, statusText: "Too Many Requests" }))
      .mockResolvedValueOnce(emptyStreamResponse());

    const client = new AnthropicClient({ fetch: fetchFn as unknown as typeof fetch });
    await consume(client);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  }, 10000);

  it("does NOT retry a 401 auth error", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), {
        status: 401,
        statusText: "Unauthorized",
      }),
    );

    const client = new AnthropicClient({ fetch: fetchFn as unknown as typeof fetch });
    await expect(consume(client)).rejects.toThrow(/401/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("unwraps Node fetch error so the message contains the real cause", async () => {
    const fetchFn = vi.fn().mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), {
        cause: new Error("connect ECONNREFUSED 127.0.0.1:443"),
      }),
    );

    const client = new AnthropicClient({ fetch: fetchFn as unknown as typeof fetch });
    await expect(consume(client)).rejects.toThrow(/ECONNREFUSED/);
    // Should have exhausted retries (3 total attempts: initial + 2 retries)
    expect(fetchFn).toHaveBeenCalledTimes(3);
  }, 20000);
});
