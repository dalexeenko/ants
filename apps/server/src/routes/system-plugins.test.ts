import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestDatabase, type TestDatabase } from '../test-utils/db.js';
import { createSystemRoutes } from './system.js';
import { PluginRegistry } from '../services/plugin-registry.js';
import type { ServerConfig } from '../config.js';

describe('system plugin routes', () => {
  let testDb: TestDatabase;
  let registry: PluginRegistry;
  let app: Hono;

  // Minimal mocks for dependencies we don't exercise in plugin tests
  const mockAgentManager = {
    isInstalled: vi.fn().mockResolvedValue(true),
    getVersion: vi.fn().mockResolvedValue('1.0.0'),
    getAgentPath: vi.fn().mockReturnValue('/usr/bin/agent'),
    getRunningServers: vi.fn().mockReturnValue([]),
    getClient: vi.fn().mockReturnValue(null),
    restartAllServers: vi.fn().mockResolvedValue({ restarted: [], failed: [] }),
  } as any;

  const mockApiKeyManager = {
    listApiKeys: vi.fn().mockResolvedValue([]),
    getProviderKeys: vi.fn().mockResolvedValue(null),
    getProviderDefinitions: vi.fn().mockReturnValue([]),
    listCustomEnvVars: vi.fn().mockResolvedValue([]),
    pendingRestart: false,
    clearPendingRestart: vi.fn(),
  } as any;

  const config = {
    dataDir: '/tmp/test-data',
    workspacesDir: '/tmp/test-workspaces',
  } as ServerConfig;

  beforeEach(() => {
    testDb = createTestDatabase();
    registry = new PluginRegistry(testDb.db as any);
    const systemRoutes = createSystemRoutes(config, mockAgentManager, mockApiKeyManager, registry);
    app = new Hono();
    app.route('/system', systemRoutes);
  });

  afterEach(() => {
    testDb.sqlite.close();
  });

  describe('GET /system/plugins', () => {
    it('should return empty list initially', async () => {
      const res = await app.request('/system/plugins');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.plugins).toEqual([]);
    });

    it('should return registered plugins', async () => {
      registry.addPlugin('pkg-a', 'pkg-a@^1.0');
      registry.addPlugin('pkg-b', 'pkg-b@latest');

      const res = await app.request('/system/plugins');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.plugins).toHaveLength(2);
      expect(body.plugins.map((p: any) => p.packageName).sort()).toEqual(['pkg-a', 'pkg-b']);
    });
  });

  describe('POST /system/plugins', () => {
    it('should register a new plugin', async () => {
      const res = await app.request('/system/plugins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName: '@acme/tool', packageSpec: '@acme/tool@^2.0' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.packageName).toBe('@acme/tool');
      expect(body.packageSpec).toBe('@acme/tool@^2.0');
      expect(body.enabled).toBe(true);
      expect(body.id).toBeTruthy();
    });

    it('should register with optional version', async () => {
      const res = await app.request('/system/plugins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName: 'pkg', packageSpec: 'pkg@1.0.0', version: '1.0.0' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.version).toBe('1.0.0');
    });

    it('should reject duplicate package name', async () => {
      registry.addPlugin('pkg', 'pkg@1');

      const res = await app.request('/system/plugins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName: 'pkg', packageSpec: 'pkg@2' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('already registered');
    });

    it('should reject missing packageName', async () => {
      const res = await app.request('/system/plugins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageSpec: 'pkg@1' }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject missing packageSpec', async () => {
      const res = await app.request('/system/plugins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName: 'pkg' }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /system/plugins/:pluginId', () => {
    it('should return 404 for non-existent plugin', async () => {
      const res = await app.request('/system/plugins/no-such-id');
      expect(res.status).toBe(404);
    });

    it('should return the plugin', async () => {
      const p = registry.addPlugin('pkg', 'pkg@1');
      const res = await app.request(`/system/plugins/${p.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.packageName).toBe('pkg');
    });
  });

  describe('PATCH /system/plugins/:pluginId', () => {
    it('should return 404 for non-existent plugin', async () => {
      const res = await app.request('/system/plugins/bad-id', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      expect(res.status).toBe(404);
    });

    it('should update enabled state', async () => {
      const p = registry.addPlugin('pkg', 'pkg@1');
      const res = await app.request(`/system/plugins/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.enabled).toBe(false);
    });

    it('should update package spec', async () => {
      const p = registry.addPlugin('pkg', 'pkg@1');
      const res = await app.request(`/system/plugins/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageSpec: 'pkg@2' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.packageSpec).toBe('pkg@2');
    });
  });

  describe('DELETE /system/plugins/:pluginId', () => {
    it('should return 404 for non-existent plugin', async () => {
      const res = await app.request('/system/plugins/bad-id', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });

    it('should delete the plugin', async () => {
      const p = registry.addPlugin('pkg', 'pkg@1');
      const res = await app.request(`/system/plugins/${p.id}`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify it's gone
      expect(registry.getPlugin(p.id)).toBeNull();
    });
  });
});
