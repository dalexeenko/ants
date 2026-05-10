import { Hono } from "hono";
import type { QuestionResponse, PermissionResponse } from "@ants/agent-core";
import type { RouteContext } from "./types.js";

/**
 * Question and permission response routes.
 * Mounted at: /session
 */
export function createInteractionRoutes(ctx: RouteContext): Hono {
  const app = new Hono();

  // ---- Question Response ----
  // Endpoint for clients to respond to a question.request event
  app.post("/:sessionId/question/:questionId/respond", async (c) => {
    const sessionId = c.req.param("sessionId");
    const questionId = c.req.param("questionId");

    // Try the session's agent first, then fall back to the primary agent
    const sessionState = ctx.sessionStates.get(sessionId);
    const targetAgent = sessionState?.agent || ctx.state.agent;

    if (!targetAgent.respondToQuestion) {
      return c.json({ error: "Question system not available" }, 501);
    }

    if (!targetAgent.hasPendingQuestion?.(questionId)) {
      return c.json({ error: "No pending question with this ID" }, 404);
    }

    const body = await c.req.json<{ selected?: string[]; freeformText?: string }>();
    
    const response: QuestionResponse = {
      selected: body.selected ?? [],
      freeformText: body.freeformText,
    };

    targetAgent.respondToQuestion(questionId, response);
    
    return c.json({ success: true });
  });

  // ---- Permission Response ----
  // Endpoint for clients to respond to a tool.permission.request event
  app.post("/:sessionId/permission/:toolCallId/respond", async (c) => {
    const toolCallId = c.req.param("toolCallId");
    
    if (!ctx.permissionResolvers.has(toolCallId)) {
      return c.json({ error: "No pending permission request with this ID" }, 404);
    }

    const body = await c.req.json<{ response: string }>();
    const validResponses = ["allow_once", "allow_always", "deny"];
    
    if (!body.response || !validResponses.includes(body.response)) {
      return c.json({ error: `Invalid response. Must be one of: ${validResponses.join(", ")}` }, 400);
    }

    const resolver = ctx.permissionResolvers.get(toolCallId);
    if (resolver) {
      resolver(body.response as PermissionResponse);
      ctx.permissionResolvers.delete(toolCallId);
    }
    
    return c.json({ success: true });
  });

  return app;
}
