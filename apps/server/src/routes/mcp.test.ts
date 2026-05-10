import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createMcpRoutes } from './mcp.js';
import type { ProjectManager } from '../services/project-manager.js';

describe('MCP routes', () => {
  let app: Hono;
  let mockProjectManager: Partial<ProjectManager>;
  let mockAgentClient: any;

  const testServers = {
    servers: [
      { name: 'filesystem', config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] } },
    ],
  };

  const testTools = {
    tools: [
      { name: 'fs_read', description: 'Read a file', server: 'filesystem' },
    ],
  };

  beforeEach(() => {
    mockAgentClient = {
      getMcpServers: vi.fn().mockResolvedValue(testServers),
      addMcpServer: vi.fn().mockResolvedValue({ success: true }),
      removeMcpServer: vi.fn().mockResolvedValue({ success: true }),
      getMcpTools: vi.fn().mockResolvedValue(testTools),
    };

    mockProjectManager = {
      getProject: vi.fn().mockResolvedValue({ id: 'proj-1', name: 'Test' }),
      getClient: vi.fn().mockResolvedValue(mockAgentClient),
    };

    app = new Hono();
    const routes = createMcpRoutes(mockProjectManager as ProjectManager);
    app.route('/api', routes);
  });

  describe('GET /:projectId/mcp/servers', () => {
    it('should list MCP servers for a project', async () => {
      const res = await app.request('/api/proj-1/mcp/servers');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.servers).toHaveLength(1);
      expect(body.servers[0].name).toBe('filesystem');
    });

    it('should return 404 when project not found', async () => {
      (mockProjectManager.getProject as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/non-existent/mcp/servers');

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Project not found');
    });

    it('should return 503 when agent client not available', async () => {
      (mockProjectManager.getClient as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/proj-1/mcp/servers');

      expect(res.status).toBe(503);
    });

    it('should return 500 when getMcpServers throws', async () => {
      mockAgentClient.getMcpServers.mockRejectedValue(new Error('MCP error'));

      const res = await app.request('/api/proj-1/mcp/servers');

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('MCP error');
    });
  });

  describe('POST /:projectId/mcp/servers', () => {
    it('should add an MCP server', async () => {
      const res = await app.request('/api/proj-1/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'github', config: { command: 'npx', args: ['mcp-github'] } }),
      });

      expect(res.status).toBe(201);
      expect(mockAgentClient.addMcpServer).toHaveBeenCalledWith('github', { command: 'npx', args: ['mcp-github'] });
    });

    it('should return 400 when name is missing', async () => {
      const res = await app.request('/api/proj-1/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { command: 'test' } }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('name is required');
    });

    it('should return 400 when config is missing', async () => {
      const res = await app.request('/api/proj-1/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'github' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('config is required');
    });

    it('should return 404 when project not found', async () => {
      (mockProjectManager.getProject as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/non-existent/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test', config: {} }),
      });

      expect(res.status).toBe(404);
    });

    it('should return 503 when agent client not available', async () => {
      (mockProjectManager.getClient as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/proj-1/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test', config: {} }),
      });

      expect(res.status).toBe(503);
    });

    it('should return 500 when addMcpServer throws', async () => {
      mockAgentClient.addMcpServer.mockRejectedValue(new Error('Add failed'));

      const res = await app.request('/api/proj-1/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'bad', config: {} }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Add failed');
    });
  });

  describe('DELETE /:projectId/mcp/servers/:name', () => {
    it('should remove an MCP server', async () => {
      const res = await app.request('/api/proj-1/mcp/servers/filesystem', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      expect(mockAgentClient.removeMcpServer).toHaveBeenCalledWith('filesystem');
    });

    it('should return 404 when project not found', async () => {
      (mockProjectManager.getProject as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/non-existent/mcp/servers/test', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });

    it('should return 503 when agent client not available', async () => {
      (mockProjectManager.getClient as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/proj-1/mcp/servers/test', {
        method: 'DELETE',
      });

      expect(res.status).toBe(503);
    });

    it('should return 500 when removeMcpServer throws', async () => {
      mockAgentClient.removeMcpServer.mockRejectedValue(new Error('Remove failed'));

      const res = await app.request('/api/proj-1/mcp/servers/bad', {
        method: 'DELETE',
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Remove failed');
    });
  });

  describe('GET /:projectId/mcp/tools', () => {
    it('should list MCP tools for a project', async () => {
      const res = await app.request('/api/proj-1/mcp/tools');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].name).toBe('fs_read');
    });

    it('should return 404 when project not found', async () => {
      (mockProjectManager.getProject as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/non-existent/mcp/tools');

      expect(res.status).toBe(404);
    });

    it('should return 503 when agent client not available', async () => {
      (mockProjectManager.getClient as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/api/proj-1/mcp/tools');

      expect(res.status).toBe(503);
    });

    it('should return 500 when getMcpTools throws', async () => {
      mockAgentClient.getMcpTools.mockRejectedValue(new Error('Tools error'));

      const res = await app.request('/api/proj-1/mcp/tools');

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Tools error');
    });
  });
});
