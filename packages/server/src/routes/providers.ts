import { Hono } from "hono";
import type { RouteContext } from "./types.js";

/**
 * Provider listing API route.
 * Mounted at: /provider (GET only, so mounted directly on root)
 */
export function createProviderRoutes(ctx: RouteContext): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const providers = ctx.state.agent.getAvailableProviders();
    return c.json({
      providers: providers.map(id => ({
        id,
        name: id.charAt(0).toUpperCase() + id.slice(1),
      })),
    });
  });

  return app;
}
