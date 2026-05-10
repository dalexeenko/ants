import { Hono } from "hono";
import type { RouteContext } from "./types.js";

/**
 * Health, readiness, and status routes.
 * Mounts: /healthz, /health, /readyz, /beta/status
 */
export function createHealthRoutes(ctx: RouteContext): Hono {
  const app = new Hono();

  // Health check - simple status endpoint (also support /health for compatibility)
  app.get("/healthz", (c) => {
    return c.json({ 
      status: "healthy", 
      version: "0.1.0",
      timestamp: new Date().toISOString() 
    });
  });
  
  app.get("/health", (c) => {
    return c.json({ 
      status: "healthy", 
      version: "0.1.0",
      timestamp: new Date().toISOString() 
    });
  });

  // Readiness check
  app.get("/readyz", (c) => {
    return c.json({ ready: true });
  });

  // Agent status endpoint
  app.get("/beta/status", (c) => {
    const config = ctx.state.agent.getConfig();
    return c.json({
      agent: {
        provider: config.provider,
        model: config.model,
      },
      version: "0.1.0",
    });
  });

  return app;
}
