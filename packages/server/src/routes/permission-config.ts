import { Hono } from "hono";
import type { RouteContext } from "./types.js";

/**
 * Permission configuration API routes.
 * Mounted at: /permissions
 */
export function createPermissionConfigRoutes(ctx: RouteContext): Hono {
  const app = new Hono();

  // Get permission config
  app.get("/config", (c) => {
    if (!ctx.state.agent.getPermissionConfig) {
      return c.json({
        defaultMode: "ask",
        alwaysAllow: [],
        alwaysDeny: [],
        allowAll: false,
      });
    }
    const config = ctx.state.agent.getPermissionConfig();
    return c.json(config);
  });

  // Update permission config
  app.put("/config", async (c) => {
    if (!ctx.state.agent.updatePermissionConfig) {
      return c.json({ error: "Agent does not support permission config management" }, 501);
    }
    const body = await c.req.json<{
      defaultMode?: string;
      alwaysAllow?: string[];
      alwaysDeny?: string[];
      allowAll?: boolean;
    }>();
    ctx.state.agent.updatePermissionConfig(body);
    // Return the updated config
    const updated = ctx.state.agent.getPermissionConfig?.() ?? body;
    return c.json(updated);
  });

  return app;
}
