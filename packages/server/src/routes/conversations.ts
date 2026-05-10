import { Hono } from "hono";
import type { RouteContext } from "./types.js";

/**
 * Conversations (beta) API routes.
 * Mounted at: /beta/conversations
 */
export function createConversationRoutes(ctx: RouteContext): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const sessions = ctx.state.sessions;
    if (!sessions) {
      return c.json({ error: "Conversations not available" }, 500);
    }
    const list = await sessions.getRootSessions(50);
    return c.json({ data: list, count: list.length });
  });

  app.get("/:id", async (c) => {
    const sessions = ctx.state.sessions;
    if (!sessions) {
      return c.json({ error: "Conversations not available" }, 500);
    }
    const id = c.req.param("id");
    const session = await sessions.getSession(id);
    if (!session) {
      return c.json({ error: "Conversation not found" }, 404);
    }
    return c.json({ data: session });
  });

  app.get("/:id/messages", async (c) => {
    const sessions = ctx.state.sessions;
    if (!sessions) {
      return c.json({ error: "Conversations not available" }, 500);
    }
    const id = c.req.param("id");
    const messages = await sessions.getSessionMessages(id);
    return c.json({ data: messages, count: messages.length });
  });

  app.delete("/:id", async (c) => {
    const sessions = ctx.state.sessions;
    if (!sessions) {
      return c.json({ error: "Conversations not available" }, 500);
    }
    const id = c.req.param("id");
    const deleted = await sessions.deleteSession(id);
    return c.json({ success: deleted });
  });

  return app;
}
