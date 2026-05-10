/**
 * Agent Middleware Stack
 * 
 * Provides a composable middleware pattern (similar to Express/Koa) that
 * wraps the agent loop. Each middleware can:
 * - Inspect/modify the incoming message before the agent processes it
 * - Inspect/modify the outgoing response
 * - Short-circuit the agent loop (e.g., cached response)
 * - Add timing/logging around the entire prompt cycle
 * - Implement cross-cutting concerns without modifying the agent itself
 * 
 * Middleware executes in order (first registered = outermost wrapper).
 */

import type { Message } from "../types.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Context passed through the middleware chain.
 */
export interface MiddlewareContext {
  /** The user's input message */
  message: string;

  /** The session ID (if available) */
  sessionId?: string;

  /** Metadata that middleware can attach for downstream use */
  metadata: Record<string, unknown>;

  /** Timestamp when the middleware chain started */
  startedAt: number;
}

/**
 * The next function in the middleware chain.
 * Calling it passes control to the next middleware (or the agent).
 */
export type NextFunction = (ctx: MiddlewareContext) => Promise<Message>;

/**
 * A middleware function.
 * 
 * @param ctx - The middleware context
 * @param next - Call this to proceed to the next middleware/agent
 * @returns The response message (possibly modified)
 */
export type Middleware = (
  ctx: MiddlewareContext,
  next: NextFunction
) => Promise<Message>;

/**
 * Named middleware with optional priority for ordering.
 */
export interface NamedMiddleware {
  /** Unique name for this middleware */
  name: string;
  /** The middleware function */
  handler: Middleware;
  /** Priority (lower = executes first, outermost wrapper). Default: 100 */
  priority?: number;
}

// ============================================================================
// Middleware Stack
// ============================================================================

export class MiddlewareStack {
  private middlewares: NamedMiddleware[] = [];

  /**
   * Add a middleware to the stack.
   */
  use(middleware: NamedMiddleware): void {
    // Remove existing middleware with same name
    this.middlewares = this.middlewares.filter((m) => m.name !== middleware.name);
    this.middlewares.push(middleware);
    // Re-sort by priority
    this.middlewares.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  /**
   * Remove a middleware by name.
   */
  remove(name: string): boolean {
    const before = this.middlewares.length;
    this.middlewares = this.middlewares.filter((m) => m.name !== name);
    return this.middlewares.length < before;
  }

  /**
   * Get all registered middleware names (in execution order).
   */
  getNames(): string[] {
    return this.middlewares.map((m) => m.name);
  }

  /**
   * Check if a middleware is registered.
   */
  has(name: string): boolean {
    return this.middlewares.some((m) => m.name === name);
  }

  /**
   * Build the composed middleware chain.
   * Returns a function that takes the "core" handler (agent.prompt)
   * and returns a wrapped handler.
   * 
   * @param core - The core prompt handler (innermost)
   */
  compose(core: NextFunction): NextFunction {
    // Build chain from inside out
    let chain = core;

    // Iterate in reverse so the first middleware wraps the outermost
    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      const mw = this.middlewares[i]!;
      const next = chain;
      chain = (ctx: MiddlewareContext) => mw.handler(ctx, next);
    }

    return chain;
  }

  /**
   * Get the number of registered middlewares.
   */
  get size(): number {
    return this.middlewares.length;
  }

  /**
   * Clear all middleware.
   */
  clear(): void {
    this.middlewares = [];
  }
}

// ============================================================================
// Built-in Middleware Factories
// ============================================================================

/**
 * Create a logging middleware that logs prompt timing.
 */
export function createLoggingMiddleware(
  logger: (msg: string) => void = console.log
): NamedMiddleware {
  return {
    name: "logging",
    priority: 10,
    async handler(ctx, next) {
      const start = Date.now();
      logger(`[agent] Prompt started: "${ctx.message.slice(0, 50)}..."`);
      try {
        const response = await next(ctx);
        const duration = Date.now() - start;
        logger(`[agent] Prompt completed in ${duration}ms`);
        return response;
      } catch (err) {
        const duration = Date.now() - start;
        logger(`[agent] Prompt failed after ${duration}ms: ${(err as Error).message}`);
        throw err;
      }
    },
  };
}

/**
 * Create a rate limiting middleware.
 */
export function createRateLimitMiddleware(options: {
  maxRequestsPerMinute: number;
  onLimit?: (ctx: MiddlewareContext) => void;
}): NamedMiddleware {
  const timestamps: number[] = [];
  const { maxRequestsPerMinute, onLimit } = options;

  return {
    name: "rate-limit",
    priority: 20,
    async handler(ctx, next) {
      const now = Date.now();
      const windowStart = now - 60_000;

      // Remove timestamps outside the window
      while (timestamps.length > 0 && timestamps[0]! < windowStart) {
        timestamps.shift();
      }

      if (timestamps.length >= maxRequestsPerMinute) {
        onLimit?.(ctx);
        throw new Error(
          `Rate limit exceeded: ${maxRequestsPerMinute} requests per minute`
        );
      }

      timestamps.push(now);
      return next(ctx);
    },
  };
}

/**
 * Create a caching middleware that returns cached responses for repeated prompts.
 */
export function createCachingMiddleware(options?: {
  maxEntries?: number;
  ttlMs?: number;
}): NamedMiddleware {
  const cache = new Map<string, { response: Message; cachedAt: number }>();
  const maxEntries = options?.maxEntries ?? 100;
  const ttlMs = options?.ttlMs ?? 300_000; // 5 minutes default

  return {
    name: "cache",
    priority: 30,
    async handler(ctx, next) {
      const key = ctx.message;

      // Check cache
      const cached = cache.get(key);
      if (cached && Date.now() - cached.cachedAt < ttlMs) {
        ctx.metadata.cached = true;
        return cached.response;
      }

      const response = await next(ctx);

      // Store in cache (only text responses, not tool-using ones)
      if (!response.toolCalls?.length) {
        if (cache.size >= maxEntries) {
          // Evict oldest entry
          const firstKey = cache.keys().next().value;
          if (firstKey) cache.delete(firstKey);
        }
        cache.set(key, { response, cachedAt: Date.now() });
      }

      return response;
    },
  };
}
