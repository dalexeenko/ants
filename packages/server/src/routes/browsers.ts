/**
 * Browser instance management routes.
 * Mounted at: /session/:sessionId/browser
 *
 * Provides REST endpoints for listing and querying browser instances.
 * Screencast streaming is handled separately via WebSocket.
 */
import { Hono } from "hono";
import type { BrowserController } from "@openmgr/agent-browser-core";
import type { RouteContext } from "./types.js";

/**
 * Create browser management routes.
 */
export function createBrowserRoutes(ctx: RouteContext): Hono {
  const app = new Hono();

  /**
   * Helper to get the browser controller from a session agent.
   */
  async function getController(sessionId: string): Promise<BrowserController | null> {
    try {
      const agent = await ctx.getSessionAgent(sessionId);
      return (
        agent.getBrowserController?.() ??
        agent.getExtension<BrowserController>("sandboxBrowserController") ??
        null
      );
    } catch {
      return null;
    }
  }

  // List all browser instances for a session
  app.get("/:sessionId/browser", async (c) => {
    const sessionId = c.req.param("sessionId");
    const controller = await getController(sessionId);

    if (!controller) {
      return c.json({ browsers: [] });
    }

    const browsers = controller.getAll().map((b) => ({
      id: b.id,
      url: b.url,
      title: b.title,
      loading: b.loading,
      createdAt: b.createdAt,
    }));

    return c.json({ browsers });
  });

  // Get a specific browser instance
  app.get("/:sessionId/browser/:browserId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const browserId = c.req.param("browserId");
    const controller = await getController(sessionId);

    if (!controller) {
      return c.json({ error: "No browser controller available" }, 404);
    }

    const instance = controller.get(browserId);
    if (!instance) {
      return c.json({ error: "Browser not found" }, 404);
    }

    return c.json({
      id: instance.id,
      url: instance.url,
      title: instance.title,
      loading: instance.loading,
      canGoBack: instance.canGoBack,
      canGoForward: instance.canGoForward,
      createdAt: instance.createdAt,
    });
  });

  return app;
}
