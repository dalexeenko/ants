import { Hono } from 'hono';
import type { ProjectManager } from '../services/project-manager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('permissions');

/**
 * Permission config routes
 * Proxies permission configuration operations to the agent server for a project.
 */
export function createPermissionRoutes(projectManager: ProjectManager) {
  const app = new Hono();

  // Get permission config for a project
  app.get('/:projectId/permissions/config', async (c) => {
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

      const result = await agentClient.getPermissionConfig();
      return c.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error(`Failed to get permission config for project ${projectId}:`, message);
      return c.json({ error: message }, 500);
    }
  });

  // Update permission config for a project
  app.put('/:projectId/permissions/config', async (c) => {
    const projectId = c.req.param('projectId');
    const project = await projectManager.getProject(projectId);

    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    try {
      const body = await c.req.json() as { defaultMode?: string; alwaysAllow?: string[]; alwaysDeny?: string[]; allowAll?: boolean };

      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) {
        return c.json({ error: 'Agent client not available for project' }, 503);
      }

      const result = await agentClient.updatePermissionConfig(body);
      return c.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error(`Failed to update permission config for project ${projectId}:`, message);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
