import { Hono } from "hono";
import type { RouteContext } from "./types.js";

/**
 * Agent types listing and management API routes.
 * Mounted at: /agent-types
 */
export function createAgentTypeRoutes(ctx: RouteContext): Hono {
  const app = new Hono();

  /**
   * GET / — List all agent types (including disabled ones).
   */
  app.get("/", (c) => {
    if (ctx.state.agent.getAgentTypes) {
      const agentTypes = ctx.state.agent.getAgentTypes();
      return c.json({ agentTypes });
    }
    return c.json({ agentTypes: [] });
  });

  /**
   * GET /conflicts — List name conflicts between same-precedence agent types.
   */
  app.get("/conflicts", (c) => {
    if (ctx.state.agent.getAgentTypeConflicts) {
      const conflicts = ctx.state.agent.getAgentTypeConflicts();
      return c.json({ conflicts });
    }
    return c.json({ conflicts: [] });
  });

  /**
   * PUT /:name/enabled — Set the enabled state of an agent type.
   */
  app.put("/:name/enabled", async (c) => {
    const name = c.req.param("name");
    const body = await c.req.json<{ enabled: boolean }>();

    if (typeof body.enabled !== "boolean") {
      return c.json({ error: "enabled must be a boolean" }, 400);
    }

    if (ctx.state.agent.setAgentTypeEnabled) {
      const found = ctx.state.agent.setAgentTypeEnabled(name, body.enabled);
      if (!found) {
        return c.json({ error: `Agent type not found: ${name}` }, 404);
      }
      return c.json({ name, enabled: body.enabled });
    }

    return c.json({ error: "Agent does not support agent type management" }, 501);
  });

  return app;
}
