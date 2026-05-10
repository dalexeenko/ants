/**
 * Tests for the middleware stack.
 */
import { describe, it, expect, vi } from "vitest";
import {
  MiddlewareStack,
  createLoggingMiddleware,
  createRateLimitMiddleware,
  createCachingMiddleware,
  type MiddlewareContext,
  type Middleware,
} from "../middleware/index.js";
import type { Message } from "../types.js";

function makeCtx(message = "hello"): MiddlewareContext {
  return { message, metadata: {}, startedAt: Date.now() };
}

function makeMessage(content = "response"): Message {
  return { id: "1", role: "assistant", content, createdAt: Date.now() };
}

describe("MiddlewareStack", () => {
  it("should start empty", () => {
    const stack = new MiddlewareStack();
    expect(stack.size).toBe(0);
    expect(stack.getNames()).toEqual([]);
  });

  it("should add and track middleware", () => {
    const stack = new MiddlewareStack();
    stack.use({ name: "a", handler: async (ctx, next) => next(ctx) });
    stack.use({ name: "b", handler: async (ctx, next) => next(ctx) });
    expect(stack.size).toBe(2);
    expect(stack.getNames()).toEqual(["a", "b"]);
    expect(stack.has("a")).toBe(true);
    expect(stack.has("c")).toBe(false);
  });

  it("should replace middleware with same name", () => {
    const stack = new MiddlewareStack();
    const handler1 = vi.fn<Middleware>(async (ctx, next) => next(ctx));
    const handler2 = vi.fn<Middleware>(async (ctx, next) => next(ctx));
    stack.use({ name: "a", handler: handler1 });
    stack.use({ name: "a", handler: handler2 });
    expect(stack.size).toBe(1);
  });

  it("should remove middleware by name", () => {
    const stack = new MiddlewareStack();
    stack.use({ name: "a", handler: async (ctx, next) => next(ctx) });
    expect(stack.remove("a")).toBe(true);
    expect(stack.size).toBe(0);
    expect(stack.remove("nonexistent")).toBe(false);
  });

  it("should sort by priority (lower = first)", () => {
    const stack = new MiddlewareStack();
    stack.use({ name: "high", priority: 200, handler: async (ctx, next) => next(ctx) });
    stack.use({ name: "low", priority: 10, handler: async (ctx, next) => next(ctx) });
    stack.use({ name: "mid", priority: 100, handler: async (ctx, next) => next(ctx) });
    expect(stack.getNames()).toEqual(["low", "mid", "high"]);
  });

  it("should compose middleware in correct order", async () => {
    const stack = new MiddlewareStack();
    const order: string[] = [];

    stack.use({
      name: "first",
      priority: 1,
      handler: async (ctx, next) => {
        order.push("first-before");
        const result = await next(ctx);
        order.push("first-after");
        return result;
      },
    });

    stack.use({
      name: "second",
      priority: 2,
      handler: async (ctx, next) => {
        order.push("second-before");
        const result = await next(ctx);
        order.push("second-after");
        return result;
      },
    });

    const core = vi.fn(async () => {
      order.push("core");
      return makeMessage();
    });

    const composed = stack.compose(core);
    await composed(makeCtx());

    expect(order).toEqual(["first-before", "second-before", "core", "second-after", "first-after"]);
    expect(core).toHaveBeenCalledTimes(1);
  });

  it("should allow middleware to short-circuit", async () => {
    const stack = new MiddlewareStack();
    const cachedResponse = makeMessage("cached");

    stack.use({
      name: "cache",
      handler: async () => cachedResponse, // never calls next
    });

    const core = vi.fn(async () => makeMessage("from core"));
    const composed = stack.compose(core);
    const result = await composed(makeCtx());

    expect(result).toBe(cachedResponse);
    expect(core).not.toHaveBeenCalled();
  });

  it("should allow middleware to modify the context", async () => {
    const stack = new MiddlewareStack();

    stack.use({
      name: "transform",
      handler: async (ctx, next) => {
        ctx.message = ctx.message.toUpperCase();
        return next(ctx);
      },
    });

    const core = vi.fn(async (ctx: MiddlewareContext) => {
      return makeMessage(ctx.message);
    });

    const composed = stack.compose(core);
    const result = await composed(makeCtx("hello"));
    expect(result.content).toBe("HELLO");
  });

  it("should propagate errors through middleware", async () => {
    const stack = new MiddlewareStack();
    const errorLog: string[] = [];

    stack.use({
      name: "error-handler",
      handler: async (ctx, next) => {
        try {
          return await next(ctx);
        } catch (err) {
          errorLog.push((err as Error).message);
          throw err;
        }
      },
    });

    const core = vi.fn(async () => {
      throw new Error("core failure");
    });

    const composed = stack.compose(core);
    await expect(composed(makeCtx())).rejects.toThrow("core failure");
    expect(errorLog).toEqual(["core failure"]);
  });

  it("should clear all middleware", () => {
    const stack = new MiddlewareStack();
    stack.use({ name: "a", handler: async (ctx, next) => next(ctx) });
    stack.use({ name: "b", handler: async (ctx, next) => next(ctx) });
    stack.clear();
    expect(stack.size).toBe(0);
  });
});

describe("createLoggingMiddleware", () => {
  it("should log prompt timing", async () => {
    const logs: string[] = [];
    const mw = createLoggingMiddleware((msg) => logs.push(msg));
    const stack = new MiddlewareStack();
    stack.use(mw);

    const core = vi.fn(async () => makeMessage());
    const composed = stack.compose(core);
    await composed(makeCtx("test prompt"));

    expect(logs.length).toBe(2);
    expect(logs[0]).toMatch(/Prompt started/);
    expect(logs[1]).toMatch(/Prompt completed in \d+ms/);
  });

  it("should log failures", async () => {
    const logs: string[] = [];
    const mw = createLoggingMiddleware((msg) => logs.push(msg));
    const stack = new MiddlewareStack();
    stack.use(mw);

    const composed = stack.compose(async () => { throw new Error("boom"); });
    await expect(composed(makeCtx())).rejects.toThrow("boom");
    expect(logs[1]).toMatch(/Prompt failed/);
  });
});

describe("createRateLimitMiddleware", () => {
  it("should allow requests within limit", async () => {
    const mw = createRateLimitMiddleware({ maxRequestsPerMinute: 5 });
    const stack = new MiddlewareStack();
    stack.use(mw);
    const core = vi.fn(async () => makeMessage());
    const composed = stack.compose(core);

    for (let i = 0; i < 5; i++) {
      await composed(makeCtx());
    }
    expect(core).toHaveBeenCalledTimes(5);
  });

  it("should reject requests over limit", async () => {
    const onLimit = vi.fn();
    const mw = createRateLimitMiddleware({ maxRequestsPerMinute: 2, onLimit });
    const stack = new MiddlewareStack();
    stack.use(mw);
    const core = vi.fn(async () => makeMessage());
    const composed = stack.compose(core);

    await composed(makeCtx());
    await composed(makeCtx());
    await expect(composed(makeCtx())).rejects.toThrow("Rate limit exceeded");
    expect(onLimit).toHaveBeenCalledTimes(1);
  });
});

describe("createCachingMiddleware", () => {
  it("should cache and return repeated prompts", async () => {
    const mw = createCachingMiddleware({ ttlMs: 60000 });
    const stack = new MiddlewareStack();
    stack.use(mw);

    const core = vi.fn(async () => makeMessage("fresh"));
    const composed = stack.compose(core);

    const r1 = await composed(makeCtx("same prompt"));
    const r2 = await composed(makeCtx("same prompt"));

    expect(core).toHaveBeenCalledTimes(1);
    expect(r1.content).toBe("fresh");
    expect(r2.content).toBe("fresh");
  });

  it("should not cache responses with tool calls", async () => {
    const mw = createCachingMiddleware();
    const stack = new MiddlewareStack();
    stack.use(mw);

    const core = vi.fn(async (): Promise<Message> => ({
      id: "1",
      role: "assistant",
      content: "used tools",
      toolCalls: [{ id: "tc1", name: "tool", arguments: {} }],
      createdAt: Date.now(),
    }));
    const composed = stack.compose(core);

    await composed(makeCtx("prompt"));
    await composed(makeCtx("prompt"));
    expect(core).toHaveBeenCalledTimes(2);
  });

  it("should respect TTL", async () => {
    const mw = createCachingMiddleware({ ttlMs: 10 });
    const stack = new MiddlewareStack();
    stack.use(mw);

    let callCount = 0;
    const core = vi.fn(async () => makeMessage(`call-${++callCount}`));
    const composed = stack.compose(core);

    await composed(makeCtx("prompt"));
    await new Promise((r) => setTimeout(r, 20));
    const r2 = await composed(makeCtx("prompt"));
    expect(r2.content).toBe("call-2");
  });

  it("should evict oldest entry when maxEntries exceeded", async () => {
    const mw = createCachingMiddleware({ maxEntries: 2 });
    const stack = new MiddlewareStack();
    stack.use(mw);

    const core = vi.fn(async (ctx: MiddlewareContext) => makeMessage(ctx.message));
    const composed = stack.compose(core);

    await composed(makeCtx("a"));
    await composed(makeCtx("b"));
    await composed(makeCtx("c"));

    // "a" should have been evicted, calling it again should hit core
    core.mockClear();
    await composed(makeCtx("a"));
    expect(core).toHaveBeenCalledTimes(1);
  });
});
