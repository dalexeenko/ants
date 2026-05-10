import { Hono } from 'hono';
import type { ProjectManager } from '../services/project-manager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('file-watch');

/**
 * File watch routes
 * Proxies agent-level file watching operations to the agent server for a project.
 * Note: This is separate from the server-level FileWatcherManager (webhooks.ts watchers).
 * These routes control the agent process's own file-watching behavior.
 */
export function createFileWatchRoutes(projectManager: ProjectManager) {
  const app = new Hono();

  // Watch a file path in a project's agent
  app.post('/:projectId/files/watch', async (c) => {
    const projectId = c.req.param('projectId');
    const project = await projectManager.getProject(projectId);

    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    try {
      const body = await c.req.json() as { path?: string };

      if (!body.path) {
        return c.json({ error: 'path is required' }, 400);
      }

      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) {
        return c.json({ error: 'Agent client not available for project' }, 503);
      }

      const result = await agentClient.watchFile(body.path);
      return c.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error(`Failed to watch file for project ${projectId}:`, message);
      return c.json({ error: message }, 500);
    }
  });

  // Unwatch a file path in a project's agent
  app.delete('/:projectId/files/watch', async (c) => {
    const projectId = c.req.param('projectId');
    const project = await projectManager.getProject(projectId);

    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    try {
      const body = await c.req.json() as { path?: string };

      if (!body.path) {
        return c.json({ error: 'path is required' }, 400);
      }

      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) {
        return c.json({ error: 'Agent client not available for project' }, 503);
      }

      const result = await agentClient.unwatchFile(body.path);
      return c.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error(`Failed to unwatch file for project ${projectId}:`, message);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
