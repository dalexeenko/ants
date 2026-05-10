import { Hono } from "hono";
import type { SearchSessionsOptions, SearchMessagesOptions } from "@openmgr/agent-storage";
import type { RouteContext } from "./types.js";

/**
 * Search API routes.
 * Mounted at: /search
 */
export function createSearchRoutes(ctx: RouteContext): Hono {
  const app = new Hono();

  /**
   * Search sessions with optional filters.
   * Query params: q, provider, model, workingDirectory, includeMessages,
   *   rootOnly, limit, offset, orderBy, orderDirection
   */
  app.get("/sessions", async (c) => {
    const sessions = ctx.state.sessions;
    if (!sessions) {
      return c.json({ error: "Search not available" }, 500);
    }

    const query = c.req.query("q");
    const provider = c.req.query("provider");
    const model = c.req.query("model");
    const workingDirectory = c.req.query("workingDirectory");
    const includeMessages = c.req.query("includeMessages") === "true";
    const rootOnly = c.req.query("rootOnly") === "true";
    const limit = parseInt(c.req.query("limit") ?? "50", 10);
    const offset = parseInt(c.req.query("offset") ?? "0", 10);
    const orderBy = c.req.query("orderBy") as SearchSessionsOptions["orderBy"];
    const orderDirection = c.req.query("orderDirection") as SearchSessionsOptions["orderDirection"];

    const options: SearchSessionsOptions = {
      query: query || undefined,
      provider: provider || undefined,
      model: model || undefined,
      workingDirectory: workingDirectory || undefined,
      includeMessages,
      rootOnly,
      limit,
      offset,
      orderBy: orderBy || "updatedAt",
      orderDirection: orderDirection || "desc",
    };

    try {
      const results = await sessions.searchSessions(options);
      return c.json({
        results,
        pagination: { limit, offset, count: results.length },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * Search messages across all sessions.
   * Query params: q (required), sessionId, role, limit, offset
   */
  app.get("/messages", async (c) => {
    const sessions = ctx.state.sessions;
    if (!sessions) {
      return c.json({ error: "Search not available" }, 500);
    }

    const query = c.req.query("q");
    if (!query) {
      return c.json({ error: 'Query parameter "q" is required' }, 400);
    }

    const sessionId = c.req.query("sessionId");
    const role = c.req.query("role") as "user" | "assistant" | undefined;
    const limit = parseInt(c.req.query("limit") ?? "100", 10);
    const offset = parseInt(c.req.query("offset") ?? "0", 10);

    const options: SearchMessagesOptions = {
      query,
      sessionId: sessionId || undefined,
      role: role || undefined,
      limit,
      offset,
    };

    try {
      const results = await sessions.searchMessages(options);
      return c.json({
        results,
        pagination: { limit, offset, count: results.length },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
