import { Hono } from "hono";
import type { RouteContext } from "./types.js";

/**
 * MCP (Model Context Protocol) server management API routes.
 * Mounted at: /mcp
 */
export function createMcpRoutes(ctx: RouteContext): Hono {
  const app = new Hono();

  // List MCP servers with status
  app.get("/servers", (c) => {
    if (!ctx.state.agent.getMcpServers) {
      return c.json({ servers: [] });
    }
    const servers = ctx.state.agent.getMcpServers();
    return c.json({ servers });
  });

  // Add an MCP server
  app.post("/servers", async (c) => {
    if (!ctx.state.agent.addMcpServer) {
      return c.json({ error: "Agent does not support MCP server management" }, 501);
    }
    const body = await c.req.json<{ name: string; config: Record<string, unknown> }>();
    if (!body.name) {
      return c.json({ error: "name is required" }, 400);
    }
    if (!body.config) {
      return c.json({ error: "config is required" }, 400);
    }
    try {
      await ctx.state.agent.addMcpServer(body.name, body.config);
      return c.json({ success: true, name: body.name }, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  // Remove an MCP server
  app.delete("/servers/:name", async (c) => {
    const name = c.req.param("name");
    if (!ctx.state.agent.removeMcpServer) {
      return c.json({ error: "Agent does not support MCP server management" }, 501);
    }
    try {
      await ctx.state.agent.removeMcpServer(name);
      return c.json({ success: true, name });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  // List all MCP tools across servers
  app.get("/tools", (c) => {
    if (!ctx.state.agent.getMcpTools) {
      return c.json({ tools: [] });
    }
    const tools = ctx.state.agent.getMcpTools();
    return c.json({ tools });
  });

  return app;
}
