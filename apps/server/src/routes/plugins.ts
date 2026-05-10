import { Hono } from 'hono';
import type { ProjectManager } from '../services/project-manager.js';
import type { PluginRegistry } from '../services/plugin-registry.js';
import { parseBody } from '../utils/validation.js';
import { SetProjectPluginSchema } from '../schemas/index.js';

/**
 * Project-level plugin routes.
 *
 * Lists all server plugins annotated with their per-project enabled state,
 * and allows enabling/disabling individual plugins per project.
 */
export function createPluginRoutes(projectManager: ProjectManager, pluginRegistry: PluginRegistry) {
  const app = new Hono();

  /**
   * GET /:projectId/plugins
   * List all plugins with their effective state for this project.
   */
  app.get('/:projectId/plugins', async (c) => {
    const projectId = c.req.param('projectId');
    const project = await projectManager.getProject(projectId);

    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const plugins = pluginRegistry.listPluginsForProject(projectId);
    return c.json({ plugins });
  });

  /**
   * PUT /:projectId/plugins/:pluginId
   * Set whether a plugin is enabled or disabled for this project.
   */
  app.put('/:projectId/plugins/:pluginId', async (c) => {
    const projectId = c.req.param('projectId');
    const pluginId = c.req.param('pluginId');

    const project = await projectManager.getProject(projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const body = await parseBody(c, SetProjectPluginSchema);

    try {
      pluginRegistry.setProjectPluginEnabled(projectId, pluginId, body.enabled);
      const plugins = pluginRegistry.listPluginsForProject(projectId);
      const updated = plugins.find((p) => p.id === pluginId);
      return c.json(updated);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ error: message }, 400);
    }
  });

  /**
   * DELETE /:projectId/plugins/:pluginId/override
   * Remove the per-project override, reverting to the server default.
   */
  app.delete('/:projectId/plugins/:pluginId/override', async (c) => {
    const projectId = c.req.param('projectId');
    const pluginId = c.req.param('pluginId');

    const project = await projectManager.getProject(projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const removed = pluginRegistry.removeProjectPluginOverride(projectId, pluginId);
    if (!removed) {
      return c.json({ error: 'No override exists for this plugin' }, 404);
    }

    return c.json({ success: true });
  });

  return app;
}
