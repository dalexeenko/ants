import { Hono } from "hono";
import type { RouteContext } from "./types.js";

/**
 * Session CRUD, branching, and rollback routes.
 * Mounted at: /session
 */
export function createSessionRoutes(ctx: RouteContext): Hono {
  const app = new Hono();

  // Delete all sessions
  app.delete("/", async (c) => {
    const sessions = ctx.state.sessions;
    if (!sessions) {
      return c.json({ error: "Sessions not available" }, 500);
    }

    const count = await sessions.deleteAllSessions();

    // Clear all session states and activity tracking
    ctx.sessionStates.clear();
    ctx.sessionLastActivity.clear();

    return c.json({ success: true, deletedCount: count });
  });

  // Create a new session
  app.post("/", async (c) => {
    const sessions = ctx.state.sessions;
    if (!sessions) {
      return c.json({ error: "Sessions not available" }, 500);
    }
    
    const body = await c.req.json().catch(() => ({}));
    const session = await sessions.createSession({
      id: body.id,  // Allow caller to specify session ID
      workingDirectory: body.workingDirectory || ctx.state.agent.getConfig().workingDirectory,
      title: body.title,
      parentId: body.parentId,
      userId: body.userId,
      provider: body.provider || ctx.state.agent.getConfig().provider,
      model: body.model || ctx.state.agent.getConfig().model,
    });
    
    // Initialize session state with mode
    const mode = body.mode || ctx.state.agent.getMode?.() || "build";
    ctx.sessionStates.set(session.id, { isActive: false, mode });
    
    // If mode is plan, set it on the agent
    if (mode === "plan") {
      const sessionState = ctx.sessionStates.get(session.id);
      const targetAgent = sessionState?.agent || ctx.state.agent;
      if (targetAgent.setMode) {
        targetAgent.setMode("plan");
      }
    }
    
    return c.json({ ...session, mode }, 201);
  });

  // Get/set session mode
  app.get("/:sessionId/mode", (c) => {
    const sessionId = c.req.param("sessionId");
    const sessionState = ctx.sessionStates.get(sessionId);
    const mode = sessionState?.mode || "build";
    return c.json({ mode });
  });

  app.put("/:sessionId/mode", async (c) => {
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json().catch(() => ({}));
    const mode = body.mode;
    
    if (mode !== "plan" && mode !== "build") {
      return c.json({ error: "Invalid mode. Must be 'plan' or 'build'" }, 400);
    }
    
    const sessionState = ctx.sessionStates.get(sessionId);
    if (!sessionState) {
      return c.json({ error: "Session not found" }, 404);
    }
    
    sessionState.mode = mode;
    
    // Update the agent mode
    const targetAgent = sessionState.agent || ctx.state.agent;
    if (targetAgent.setMode) {
      targetAgent.setMode(mode);
    }
    
    return c.json({ mode });
  });

  // Get session details
  app.get("/:sessionId", async (c) => {
    const sessions = ctx.state.sessions;
    if (!sessions) {
      return c.json({ error: "Sessions not available" }, 500);
    }
    
    const sessionId = c.req.param("sessionId");
    const session = await sessions.getSession(sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }
    
    return c.json(session);
  });

  // Delete session
  app.delete("/:sessionId", async (c) => {
    const sessions = ctx.state.sessions;
    if (!sessions) {
      return c.json({ error: "Sessions not available" }, 500);
    }
    
    const sessionId = c.req.param("sessionId");
    const deleted = await sessions.deleteSession(sessionId);
    const sessionState = ctx.sessionStates.get(sessionId);
    ctx.sessionStates.delete(sessionId);
    ctx.sessionLastActivity.delete(sessionId);
    sessionState?.agent?.shutdown?.().catch((err: unknown) => {
      console.error(`[agent-server] Error shutting down agent for deleted session ${sessionId}:`, err);
    });
    
    return c.json({ success: deleted });
  });

  // Get session messages
  app.get("/:sessionId/message", async (c) => {
    const sessions = ctx.state.sessions;
    if (!sessions) {
      return c.json({ error: "Sessions not available" }, 500);
    }
    
    const sessionId = c.req.param("sessionId");

    // Support optional pagination via query parameters
    const limitParam = c.req.query("limit");
    const beforeSequenceParam = c.req.query("beforeSequence");

    if (limitParam) {
      const limit = parseInt(limitParam, 10);
      if (isNaN(limit) || limit < 1) {
        return c.json({ error: "limit must be a positive integer" }, 400);
      }
      const beforeSequence = beforeSequenceParam
        ? parseInt(beforeSequenceParam, 10)
        : undefined;
      if (beforeSequenceParam && (isNaN(beforeSequence!) || beforeSequence! < 0)) {
        return c.json({ error: "beforeSequence must be a non-negative integer" }, 400);
      }

      const result = await sessions.getSessionMessagesPaginated(
        sessionId,
        limit,
        beforeSequence,
      );
      return c.json({ messages: result.messages, hasMore: result.hasMore });
    }

    const messages = await sessions.getSessionMessages(sessionId);
    
    return c.json({ messages });
  });

  // ---- Branching ----

  app.get("/:sessionId/branches", (c) => {
    const sessionId = c.req.param("sessionId");
    const sessionState = ctx.sessionStates.get(sessionId);
    const targetAgent = sessionState?.agent || ctx.state.agent;

    const tree = targetAgent.getConversationTree?.();
    if (!tree) return c.json({ branches: [] });

    const branches = tree.getBranches().map((b) => ({
      id: b.id,
      name: b.name,
      messageCount: b.headId ? tree.getPathToNode(b.headId).length : 0,
      isActive: b.isActive,
      forkPointId: b.forkPointId,
    }));

    return c.json({ branches });
  });

  app.post("/:sessionId/branches", async (c) => {
    const sessionId = c.req.param("sessionId");
    const sessionState = ctx.sessionStates.get(sessionId);
    const targetAgent = sessionState?.agent || ctx.state.agent;

    const body = await c.req.json<{ name: string; messageId?: string }>();

    const tree = targetAgent.getConversationTree?.();
    if (!tree) return c.json({ error: "Branching not available" }, 501);

    const branch = tree.createBranch(body.name, body.messageId);
    return c.json({ id: branch.id, name: branch.name, created: true }, 201);
  });

  app.post("/:sessionId/branches/:branchId/switch", (c) => {
    const sessionId = c.req.param("sessionId");
    const branchId = c.req.param("branchId");
    const sessionState = ctx.sessionStates.get(sessionId);
    const targetAgent = sessionState?.agent || ctx.state.agent;

    const tree = targetAgent.getConversationTree?.();
    if (!tree) return c.json({ error: "Branching not available" }, 501);

    tree.switchBranch(branchId);
    return c.json({ success: true, activeBranch: branchId });
  });

  app.delete("/:sessionId/branches/:branchId", (c) => {
    const sessionId = c.req.param("sessionId");
    const branchId = c.req.param("branchId");
    const sessionState = ctx.sessionStates.get(sessionId);
    const targetAgent = sessionState?.agent || ctx.state.agent;

    const tree = targetAgent.getConversationTree?.();
    if (!tree) return c.json({ error: "Branching not available" }, 501);

    tree.deleteBranch(branchId);
    return c.json({ success: true });
  });

  app.post("/:sessionId/rollback", async (c) => {
    const sessionId = c.req.param("sessionId");
    const sessionState = ctx.sessionStates.get(sessionId);
    const targetAgent = sessionState?.agent || ctx.state.agent;

    const body = await c.req.json<{ count?: number }>();

    const tree = targetAgent.getConversationTree?.();
    if (!tree) return c.json({ error: "Branching not available" }, 501);

    tree.rollbackN(body.count ?? 1);
    return c.json({ success: true });
  });

  return app;
}
