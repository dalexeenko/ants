import { Hono } from "hono";
import type { RouteContext } from "./types.js";

/**
 * Plugin management API routes.
 * Mounted at: /plugins
 */
export function createPluginRoutes(ctx: RouteContext): Hono {
  const app = new Hono();

  // List installed plugins
  app.get("/", (c) => {
    if (!ctx.state.pluginManager) {
      return c.json({ error: "Plugin management not available" }, 501);
    }

    const installed = ctx.state.pluginManager.listInstalled();
    const registeredPlugins = ctx.state.agent.getPluginNames?.() ?? [];

    return c.json({
      installed,
      registered: registeredPlugins,
    });
  });

  // Install a plugin from npm
  app.post("/install", async (c) => {
    if (!ctx.state.pluginManager) {
      return c.json({ error: "Plugin management not available" }, 501);
    }

    const body = await c.req.json<{ packageSpec: string }>().catch(() => ({ packageSpec: "" }));

    if (!body.packageSpec) {
      return c.json({ error: "packageSpec is required" }, 400);
    }

    try {
      // Install the npm package
      const result = await ctx.state.pluginManager.install(body.packageSpec);

      // Register each extracted plugin with the primary agent
      const registered: string[] = [];
      const errors: Array<{ name: string; error: string }> = [];

      for (const plugin of result.plugins) {
        try {
          if (ctx.state.agent.use) {
            await ctx.state.agent.use(plugin);
            registered.push(plugin.name);
          }
        } catch (err) {
          errors.push({
            name: plugin.name,
            error: (err as Error).message,
          });
        }
      }

      return c.json({
        success: true,
        packageName: result.packageName,
        version: result.version,
        plugins: result.plugins.map((p) => p.name),
        registered,
        errors: errors.length > 0 ? errors : undefined,
      }, 201);
    } catch (err) {
      return c.json({
        success: false,
        error: (err as Error).message,
      }, 400);
    }
  });

  // Uninstall a plugin package
  app.post("/uninstall", async (c) => {
    if (!ctx.state.pluginManager) {
      return c.json({ error: "Plugin management not available" }, 501);
    }

    const body = await c.req.json<{ packageName: string }>().catch(() => ({ packageName: "" }));

    if (!body.packageName) {
      return c.json({ error: "packageName is required" }, 400);
    }

    try {
      // Get plugin names before uninstalling so we can unregister them
      const info = ctx.state.pluginManager.listInstalled().find(
        (i) => i.packageName === body.packageName
      );

      // Unregister plugins from the agent
      const unregistered: string[] = [];
      if (info && ctx.state.agent.unuse) {
        for (const pluginName of info.pluginNames) {
          try {
            await ctx.state.agent.unuse(pluginName);
            unregistered.push(pluginName);
          } catch {
            // Plugin may not have been registered (e.g. registration failed)
          }
        }
      }

      // Uninstall the npm package
      const pluginNames = await ctx.state.pluginManager.uninstall(body.packageName);

      return c.json({
        success: true,
        packageName: body.packageName,
        plugins: pluginNames,
        unregistered,
      });
    } catch (err) {
      return c.json({
        success: false,
        error: (err as Error).message,
      }, 400);
    }
  });

  return app;
}
