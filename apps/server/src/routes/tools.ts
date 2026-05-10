import { Hono } from 'hono';
import type { ProjectManager } from '../services/project-manager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('tools');

/**
 * Tools routes
 * Proxies tool information from the agent server
 */
export function createToolsRoutes(projectManager: ProjectManager) {
  const app = new Hono();

  // Get tools for a project
  app.get('/:projectId/tools', async (c) => {
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

      const tools = await agentClient.getTools();
      return c.json({ tools });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error(`Failed to get tools for project ${projectId}:`, message);
      return c.json({ error: message }, 500);
    }
  });

  // Get disabled tools for a project
  app.get('/:projectId/tools/disabled', async (c) => {
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

      const result = await agentClient.getDisabledTools();
      return c.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error(`Failed to get disabled tools for project ${projectId}:`, message);
      return c.json({ error: message }, 500);
    }
  });

  // Set disabled tools for a project
  app.put('/:projectId/tools/disabled', async (c) => {
    const projectId = c.req.param('projectId');
    const project = await projectManager.getProject(projectId);

    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    try {
      const body = await c.req.json() as { tools?: string[] };
      if (!body.tools || !Array.isArray(body.tools)) {
        return c.json({ error: 'tools array is required' }, 400);
      }

      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) {
        return c.json({ error: 'Agent client not available for project' }, 503);
      }

      const result = await agentClient.setDisabledTools(body.tools);
      return c.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error(`Failed to set disabled tools for project ${projectId}:`, message);
      return c.json({ error: message }, 500);
    }
  });

  // Disable a specific tool
  app.post('/:projectId/tools/:name/disable', async (c) => {
    const projectId = c.req.param('projectId');
    const name = c.req.param('name');
    const project = await projectManager.getProject(projectId);

    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    try {
      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) {
        return c.json({ error: 'Agent client not available for project' }, 503);
      }

      const result = await agentClient.disableTool(name);
      return c.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error(`Failed to disable tool ${name} for project ${projectId}:`, message);
      return c.json({ error: message }, 500);
    }
  });

  // Enable a specific tool
  app.post('/:projectId/tools/:name/enable', async (c) => {
    const projectId = c.req.param('projectId');
    const name = c.req.param('name');
    const project = await projectManager.getProject(projectId);

    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    try {
      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) {
        return c.json({ error: 'Agent client not available for project' }, 503);
      }

      const result = await agentClient.enableTool(name);
      return c.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error(`Failed to enable tool ${name} for project ${projectId}:`, message);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
