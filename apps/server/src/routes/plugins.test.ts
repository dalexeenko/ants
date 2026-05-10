import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { createPluginRoutes } from './plugins.js';
import { PluginRegistry } from '../services/plugin-registry.js';
import { createTestDatabase, type TestDatabase } from '../test-utils/db.js';
import { projects } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

function insertProject(db: any, overrides: Partial<typeof projects.$inferInsert> = {}): string {
  const now = new Date();
  const id = overrides.id ?? uuidv4();
  db.insert(projects).values({
    id,
    name: overrides.name ?? 'Test Project',
    workingDirectory: overrides.workingDirectory ?? `/workspace/${id}`,
    autoStart: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }).run();
  return id;
}

describe('project plugin routes', () => {
  let testDb: TestDatabase;
  let registry: PluginRegistry;
  let app: Hono;
  let projectId: string;

  beforeEach(() => {
    testDb = createTestDatabase();
    registry = new PluginRegistry(testDb.db as any);

    const mockProjectManager = {
      getProject: vi.fn(async (id: string) => {
        const rows = (testDb.db as any)
          .select()
          .from(projects)
          .where(eq(projects.id, id))
          .all();
        if (rows.length === 0) return null;
        return {
          id: rows[0].id,
          name: rows[0].name,
          workingDirectory: rows[0].workingDirectory,
        };
      }),
    };

    const routes = createPluginRoutes(mockProjectManager as any, registry);
    app = new Hono();
    app.route('/api', routes);

    projectId = insertProject(testDb.db);
  });

  afterEach(() => {
    testDb.sqlite.close();
  });

  describe('GET /:projectId/plugins', () => {
    it('should list plugins for a project', async () => {
      registry.addPlugin('pkg-a', 'pkg-a@1');
      registry.addPlugin('pkg-b', 'pkg-b@2');

      const res = await app.request(`/api/${projectId}/plugins`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.plugins).toHaveLength(2);
      for (const p of body.plugins) {
        expect(p.hasOverride).toBe(false);
        expect(p.projectEnabled).toBe(true);
      }
    });

    it('should return 404 when project not found', async () => {
      const res = await app.request('/api/non-existent/plugins');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Project not found');
    });

    it('should return empty list when no plugins registered', async () => {
      const res = await app.request(`/api/${projectId}/plugins`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.plugins).toEqual([]);
    });

    it('should show project overrides', async () => {
      const p = registry.addPlugin('pkg', 'pkg@1');
      registry.setProjectPluginEnabled(projectId, p.id, false);

      const res = await app.request(`/api/${projectId}/plugins`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.plugins[0].hasOverride).toBe(true);
      expect(body.plugins[0].projectEnabled).toBe(false);
    });
  });

  describe('PUT /:projectId/plugins/:pluginId', () => {
    it('should disable a plugin for the project', async () => {
      const p = registry.addPlugin('pkg', 'pkg@1');

      const res = await app.request(`/api/${projectId}/plugins/${p.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.projectEnabled).toBe(false);
      expect(body.hasOverride).toBe(true);
    });

    it('should enable a server-disabled plugin for the project', async () => {
      const p = registry.addPlugin('pkg', 'pkg@1');
      registry.updatePlugin(p.id, { enabled: false });

      const res = await app.request(`/api/${projectId}/plugins/${p.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.projectEnabled).toBe(true);
      expect(body.enabled).toBe(false); // server level still disabled
    });

    it('should return 404 when project not found', async () => {
      const p = registry.addPlugin('pkg', 'pkg@1');

      const res = await app.request(`/api/non-existent/plugins/${p.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });

      expect(res.status).toBe(404);
    });

    it('should return 400 when plugin not found', async () => {
      const res = await app.request(`/api/${projectId}/plugins/bad-id`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Plugin not found');
    });

    it('should reject missing enabled field', async () => {
      const p = registry.addPlugin('pkg', 'pkg@1');

      const res = await app.request(`/api/${projectId}/plugins/${p.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /:projectId/plugins/:pluginId/override', () => {
    it('should remove a project override', async () => {
      const p = registry.addPlugin('pkg', 'pkg@1');
      registry.setProjectPluginEnabled(projectId, p.id, false);

      const res = await app.request(`/api/${projectId}/plugins/${p.id}/override`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify it reverted to server default
      const list = registry.listPluginsForProject(projectId);
      expect(list[0].hasOverride).toBe(false);
      expect(list[0].projectEnabled).toBe(true);
    });

    it('should return 404 when project not found', async () => {
      const p = registry.addPlugin('pkg', 'pkg@1');
      registry.setProjectPluginEnabled(projectId, p.id, false);

      const res = await app.request(`/api/non-existent/plugins/${p.id}/override`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });

    it('should return 404 when no override exists', async () => {
      const p = registry.addPlugin('pkg', 'pkg@1');

      const res = await app.request(`/api/${projectId}/plugins/${p.id}/override`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
    });
  });
});
