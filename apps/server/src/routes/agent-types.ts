import { Hono } from 'hono';
import type { ProjectManager } from '../services/project-manager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('agent-types');

/**
 * Agent type routes.
 * Proxies agent type (subagent preset) operations to the agent server.
 */
export function createAgentTypeRoutes(projectManager: ProjectManager) {
  const app = new Hono();

  /**
   * GET /:projectId/agent-types — List all agent types for a project.
   */
  app.get('/:projectId/agent-types', async (c) => {
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

      const data = await agentClient.getAgentTypes();
      return c.json(data);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error(`Failed to get agent types for project ${projectId}:`, message);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * GET /:projectId/agent-types/conflicts — List agent type name conflicts.
   */
  app.get('/:projectId/agent-types/conflicts', async (c) => {
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

      const data = await agentClient.getAgentTypeConflicts();
      return c.json(data);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error(`Failed to get agent type conflicts for project ${projectId}:`, message);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * PUT /:projectId/agent-types/:name/enabled — Enable/disable an agent type.
   */
  app.put('/:projectId/agent-types/:name/enabled', async (c) => {
    const projectId = c.req.param('projectId');
    const name = c.req.param('name');
    const project = await projectManager.getProject(projectId);

    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    try {
      const body = await c.req.json<{ enabled: boolean }>();
      if (typeof body.enabled !== 'boolean') {
        return c.json({ error: 'enabled must be a boolean' }, 400);
      }

      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) {
        return c.json({ error: 'Agent client not available for project' }, 503);
      }

      const data = await agentClient.setAgentTypeEnabled(name, body.enabled);
      return c.json(data);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error(`Failed to set agent type enabled for project ${projectId}:`, message);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
