import { Hono } from "hono";
import type { RouteContext } from "./types.js";

/**
 * Tools listing and management API routes.
 * Mounted at: /tools
 */
export function createToolRoutes(ctx: RouteContext): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    // Get tools from agent if the method exists
    if (ctx.state.agent.getTools) {
      const tools = ctx.state.agent.getTools();
      return c.json({
        tools: tools.map(tool => ({
          name: tool.name,
          description: tool.description || '',
          available: true,
        })),
      });
    }
    
    // Fallback: return empty list if agent doesn't support listing tools
    return c.json({ tools: [] });
  });

  // Get disabled tools list
  app.get("/disabled", (c) => {
    if (!ctx.state.agent.getDisabledTools) {
      return c.json({ disabledTools: [] });
    }
    const disabledTools = ctx.state.agent.getDisabledTools();
    return c.json({ disabledTools });
  });

  // Set disabled tools list (replace entire list)
  app.put("/disabled", async (c) => {
    if (!ctx.state.agent.setDisabledTools) {
      return c.json({ error: "Agent does not support disabled tools management" }, 501);
    }
    const body = await c.req.json<{ tools: string[] }>();
    if (!Array.isArray(body.tools)) {
      return c.json({ error: "tools must be an array of strings" }, 400);
    }
    ctx.state.agent.setDisabledTools(body.tools);
    return c.json({ disabledTools: body.tools });
  });

  // Disable a single tool
  app.post("/:name/disable", (c) => {
    const name = c.req.param("name");
    if (!ctx.state.agent.getDisabledTools || !ctx.state.agent.setDisabledTools) {
      return c.json({ error: "Agent does not support disabled tools management" }, 501);
    }
    const current = ctx.state.agent.getDisabledTools();
    if (!current.includes(name)) {
      ctx.state.agent.setDisabledTools([...current, name]);
    }
    return c.json({ success: true, name, disabled: true });
  });

  // Enable a single tool
  app.post("/:name/enable", (c) => {
    const name = c.req.param("name");
    if (!ctx.state.agent.getDisabledTools || !ctx.state.agent.setDisabledTools) {
      return c.json({ error: "Agent does not support disabled tools management" }, 501);
    }
    const current = ctx.state.agent.getDisabledTools();
    ctx.state.agent.setDisabledTools(current.filter(t => t !== name));
    return c.json({ success: true, name, disabled: false });
  });

  return app;
}
