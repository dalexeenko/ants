import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../test-utils/db.js';
import { PluginRegistry } from './plugin-registry.js';
import { v4 as uuidv4 } from 'uuid';
import { projects } from '../db/schema.js';

function createProject(db: any, overrides: Partial<typeof projects.$inferInsert> = {}) {
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

describe('PluginRegistry', () => {
  let testDb: TestDatabase;
  let registry: PluginRegistry;

  beforeEach(() => {
    testDb = createTestDatabase();
    registry = new PluginRegistry(testDb.db as any);
  });

  afterEach(() => {
    testDb.sqlite.close();
  });

  // ── Server-level CRUD ───────────────────────────────────────────────

  describe('addPlugin', () => {
    it('should register a new plugin', () => {
      const plugin = registry.addPlugin('@acme/my-plugin', '@acme/my-plugin@^2.0');
      expect(plugin.packageName).toBe('@acme/my-plugin');
      expect(plugin.packageSpec).toBe('@acme/my-plugin@^2.0');
      expect(plugin.enabled).toBe(true);
      expect(plugin.version).toBeNull();
      expect(plugin.id).toBeTruthy();
    });

    it('should register a plugin with a version', () => {
      const plugin = registry.addPlugin('some-plugin', 'some-plugin@1.0.0', '1.0.0');
      expect(plugin.version).toBe('1.0.0');
    });

    it('should reject duplicate package names', () => {
      registry.addPlugin('@acme/foo', '@acme/foo@^1.0');
      expect(() => registry.addPlugin('@acme/foo', '@acme/foo@^2.0')).toThrow(
        'Plugin "@acme/foo" is already registered',
      );
    });
  });

  describe('listPlugins', () => {
    it('should return empty list when no plugins registered', () => {
      expect(registry.listPlugins()).toEqual([]);
    });

    it('should return all registered plugins', () => {
      registry.addPlugin('plugin-a', 'plugin-a@1.0');
      registry.addPlugin('plugin-b', 'plugin-b@2.0');
      const list = registry.listPlugins();
      expect(list).toHaveLength(2);
      expect(list.map((p) => p.packageName).sort()).toEqual(['plugin-a', 'plugin-b']);
    });
  });

  describe('getPlugin', () => {
    it('should return null for non-existent ID', () => {
      expect(registry.getPlugin('no-such-id')).toBeNull();
    });

    it('should return the plugin by ID', () => {
      const added = registry.addPlugin('my-pkg', 'my-pkg@^1');
      const found = registry.getPlugin(added.id);
      expect(found).not.toBeNull();
      expect(found!.packageName).toBe('my-pkg');
    });
  });

  describe('getPluginByPackageName', () => {
    it('should return null for non-existent package name', () => {
      expect(registry.getPluginByPackageName('nope')).toBeNull();
    });

    it('should find by package name', () => {
      registry.addPlugin('my-pkg', 'my-pkg@^1');
      const found = registry.getPluginByPackageName('my-pkg');
      expect(found).not.toBeNull();
      expect(found!.packageSpec).toBe('my-pkg@^1');
    });
  });

  describe('updatePlugin', () => {
    it('should return null for non-existent plugin', () => {
      expect(registry.updatePlugin('nope', { enabled: false })).toBeNull();
    });

    it('should update enabled state', () => {
      const p = registry.addPlugin('pkg', 'pkg@1');
      const updated = registry.updatePlugin(p.id, { enabled: false });
      expect(updated!.enabled).toBe(false);
    });

    it('should update package spec', () => {
      const p = registry.addPlugin('pkg', 'pkg@1');
      const updated = registry.updatePlugin(p.id, { packageSpec: 'pkg@2' });
      expect(updated!.packageSpec).toBe('pkg@2');
    });

    it('should update version', () => {
      const p = registry.addPlugin('pkg', 'pkg@1');
      const updated = registry.updatePlugin(p.id, { version: '1.2.3' });
      expect(updated!.version).toBe('1.2.3');
    });
  });

  describe('removePlugin', () => {
    it('should return false for non-existent plugin', () => {
      expect(registry.removePlugin('nope')).toBe(false);
    });

    it('should remove the plugin', () => {
      const p = registry.addPlugin('pkg', 'pkg@1');
      expect(registry.removePlugin(p.id)).toBe(true);
      expect(registry.getPlugin(p.id)).toBeNull();
      expect(registry.listPlugins()).toHaveLength(0);
    });
  });

  // ── Per-project overrides ─────────────────────────────────────────

  describe('listPluginsForProject', () => {
    it('should return all plugins with server defaults when no overrides', () => {
      const projectId = createProject(testDb.db);
      registry.addPlugin('pkg-a', 'pkg-a@1');
      registry.addPlugin('pkg-b', 'pkg-b@1');

      const list = registry.listPluginsForProject(projectId);
      expect(list).toHaveLength(2);
      for (const p of list) {
        expect(p.hasOverride).toBe(false);
        expect(p.projectEnabled).toBe(true);
      }
    });

    it('should reflect disabled server-level plugins', () => {
      const projectId = createProject(testDb.db);
      const p = registry.addPlugin('pkg-a', 'pkg-a@1');
      registry.updatePlugin(p.id, { enabled: false });

      const list = registry.listPluginsForProject(projectId);
      expect(list).toHaveLength(1);
      expect(list[0].projectEnabled).toBe(false);
      expect(list[0].hasOverride).toBe(false);
    });

    it('should apply project overrides', () => {
      const projectId = createProject(testDb.db);
      const p = registry.addPlugin('pkg-a', 'pkg-a@1');
      registry.setProjectPluginEnabled(projectId, p.id, false);

      const list = registry.listPluginsForProject(projectId);
      expect(list).toHaveLength(1);
      expect(list[0].hasOverride).toBe(true);
      expect(list[0].projectEnabled).toBe(false);
      // Server-level still enabled
      expect(list[0].enabled).toBe(true);
    });

    it('should allow project to re-enable a server-disabled plugin', () => {
      const projectId = createProject(testDb.db);
      const p = registry.addPlugin('pkg-a', 'pkg-a@1');
      registry.updatePlugin(p.id, { enabled: false });
      registry.setProjectPluginEnabled(projectId, p.id, true);

      const list = registry.listPluginsForProject(projectId);
      expect(list[0].enabled).toBe(false); // server-level still disabled
      expect(list[0].projectEnabled).toBe(true); // project overrides to enabled
      expect(list[0].hasOverride).toBe(true);
    });
  });

  describe('setProjectPluginEnabled', () => {
    it('should throw if plugin does not exist', () => {
      const projectId = createProject(testDb.db);
      expect(() => registry.setProjectPluginEnabled(projectId, 'bad-id', true)).toThrow(
        'Plugin not found',
      );
    });

    it('should create an override row', () => {
      const projectId = createProject(testDb.db);
      const p = registry.addPlugin('pkg', 'pkg@1');
      registry.setProjectPluginEnabled(projectId, p.id, false);

      const list = registry.listPluginsForProject(projectId);
      expect(list[0].hasOverride).toBe(true);
      expect(list[0].projectEnabled).toBe(false);
    });

    it('should update an existing override row', () => {
      const projectId = createProject(testDb.db);
      const p = registry.addPlugin('pkg', 'pkg@1');
      registry.setProjectPluginEnabled(projectId, p.id, false);
      registry.setProjectPluginEnabled(projectId, p.id, true);

      const list = registry.listPluginsForProject(projectId);
      expect(list[0].hasOverride).toBe(true);
      expect(list[0].projectEnabled).toBe(true);
    });

    it('should be isolated per project', () => {
      const projA = createProject(testDb.db, { name: 'A' });
      const projB = createProject(testDb.db, { name: 'B' });
      const p = registry.addPlugin('pkg', 'pkg@1');

      registry.setProjectPluginEnabled(projA, p.id, false);

      const listA = registry.listPluginsForProject(projA);
      const listB = registry.listPluginsForProject(projB);
      expect(listA[0].projectEnabled).toBe(false);
      expect(listB[0].projectEnabled).toBe(true); // no override, uses server default
    });
  });

  describe('removeProjectPluginOverride', () => {
    it('should return false if no override exists', () => {
      const projectId = createProject(testDb.db);
      const p = registry.addPlugin('pkg', 'pkg@1');
      expect(registry.removeProjectPluginOverride(projectId, p.id)).toBe(false);
    });

    it('should remove the override and revert to server default', () => {
      const projectId = createProject(testDb.db);
      const p = registry.addPlugin('pkg', 'pkg@1');
      registry.setProjectPluginEnabled(projectId, p.id, false);

      expect(registry.removeProjectPluginOverride(projectId, p.id)).toBe(true);

      const list = registry.listPluginsForProject(projectId);
      expect(list[0].hasOverride).toBe(false);
      expect(list[0].projectEnabled).toBe(true); // back to server default
    });
  });

  // ── getEffectivePluginsForProject ──────────────────────────────────

  describe('getEffectivePluginsForProject', () => {
    it('should return empty array when no plugins', () => {
      const projectId = createProject(testDb.db);
      expect(registry.getEffectivePluginsForProject(projectId)).toEqual([]);
    });

    it('should return all enabled plugins by default', () => {
      const projectId = createProject(testDb.db);
      registry.addPlugin('pkg-a', 'pkg-a@1');
      registry.addPlugin('pkg-b', 'pkg-b@2');

      const effective = registry.getEffectivePluginsForProject(projectId);
      expect(effective).toHaveLength(2);
      expect(effective.map((p) => p.packageSpec).sort()).toEqual(['pkg-a@1', 'pkg-b@2']);
    });

    it('should exclude server-disabled plugins', () => {
      const projectId = createProject(testDb.db);
      const a = registry.addPlugin('pkg-a', 'pkg-a@1');
      registry.addPlugin('pkg-b', 'pkg-b@2');
      registry.updatePlugin(a.id, { enabled: false });

      const effective = registry.getEffectivePluginsForProject(projectId);
      expect(effective).toHaveLength(1);
      expect(effective[0].packageName).toBe('pkg-b');
    });

    it('should respect project overrides', () => {
      const projectId = createProject(testDb.db);
      const a = registry.addPlugin('pkg-a', 'pkg-a@1');
      registry.addPlugin('pkg-b', 'pkg-b@2');
      registry.setProjectPluginEnabled(projectId, a.id, false);

      const effective = registry.getEffectivePluginsForProject(projectId);
      expect(effective).toHaveLength(1);
      expect(effective[0].packageName).toBe('pkg-b');
    });

    it('should allow project to re-enable a server-disabled plugin', () => {
      const projectId = createProject(testDb.db);
      const a = registry.addPlugin('pkg-a', 'pkg-a@1');
      registry.updatePlugin(a.id, { enabled: false });
      registry.setProjectPluginEnabled(projectId, a.id, true);

      const effective = registry.getEffectivePluginsForProject(projectId);
      expect(effective).toHaveLength(1);
      expect(effective[0].packageName).toBe('pkg-a');
    });
  });

  // ── Cascade on delete ──────────────────────────────────────────────

  describe('cascade behavior', () => {
    it('should remove project overrides when a plugin is deleted', () => {
      const projectId = createProject(testDb.db);
      const p = registry.addPlugin('pkg', 'pkg@1');
      registry.setProjectPluginEnabled(projectId, p.id, false);

      registry.removePlugin(p.id);

      // Project should have no plugins at all now
      const list = registry.listPluginsForProject(projectId);
      expect(list).toHaveLength(0);
    });
  });
});
