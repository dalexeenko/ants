import { Hono } from "hono";
import type { RouteContext } from "./types.js";

/**
 * Token usage API routes.
 * Mounted at: /usage
 */
export function createUsageRoutes(ctx: RouteContext): Hono {
  const app = new Hono();

  // Get token usage summary
  app.get("/", (c) => {
    if (!ctx.state.agent.getUsageSummary) {
      return c.json(null);
    }
    const summary = ctx.state.agent.getUsageSummary();
    return c.json(summary);
  });

  return app;
}
