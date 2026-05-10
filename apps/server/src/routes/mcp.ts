import { Hono } from 'hono';
import type { ProjectManager } from '../services/project-manager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('mcp');

/**
 * MCP (Model Context Protocol) routes
 * Proxies MCP server management operations to the agent server for a project.
 */
export function createMcpRoutes(projectManager: ProjectManager) {
  const app = new Hono();

  // List MCP servers for a project
  app.get('/:projectId/mcp/servers', async (c) => {
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

      const result = await agentClient.getMcpServers();
      return c.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error(`Failed to get MCP servers for project ${projectId}:`, message);
      return c.json({ error: message }, 500);
    }
  });

  // Add an MCP server to a project
  app.post('/:projectId/mcp/servers', async (c) => {
    const projectId = c.req.param('projectId');
    const project = await projectManager.getProject(projectId);

    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    try {
      const body = await c.req.json() as { name?: string; config?: Record<string, unknown> };

      if (!body.name) {
        return c.json({ error: 'name is required' }, 400);
      }

      if (!body.config) {
        return c.json({ error: 'config is required' }, 400);
      }

      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) {
        return c.json({ error: 'Agent client not available for project' }, 503);
      }

      const result = await agentClient.addMcpServer(body.name, body.config);
      return c.json(result, 201);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error(`Failed to add MCP server for project ${projectId}:`, message);
      return c.json({ error: message }, 500);
    }
  });

  // Remove an MCP server from a project
  app.delete('/:projectId/mcp/servers/:name', async (c) => {
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

      const result = await agentClient.removeMcpServer(name);
      return c.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error(`Failed to remove MCP server ${name} for project ${projectId}:`, message);
      return c.json({ error: message }, 500);
    }
  });

  // List MCP tools for a project
  app.get('/:projectId/mcp/tools', async (c) => {
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

      const result = await agentClient.getMcpTools();
      return c.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error(`Failed to get MCP tools for project ${projectId}:`, message);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
