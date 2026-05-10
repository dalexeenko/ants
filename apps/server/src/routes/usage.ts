import { Hono } from 'hono';
import type { ProjectManager } from '../services/project-manager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('usage');

/**
 * Usage routes
 * Proxies token usage information from the agent server for a project.
 */
export function createUsageRoutes(projectManager: ProjectManager) {
  const app = new Hono();

  // Get token usage for a project
  app.get('/:projectId/usage', async (c) => {
    const projectId = c.req.param('projectId');
    const project = await projectManager.getProject(projectId);

    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    try {
      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) {
        return c.json({ error: 'Agent client not available for project' }, 503);
      }

      const result = await agentClient.getUsage();
      return c.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error(`Failed to get usage for project ${projectId}:`, message);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
