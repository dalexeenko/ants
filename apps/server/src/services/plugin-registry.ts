/**
 * PluginRegistry — manages the server-level list of installed plugins
 * and per-project enable/disable overrides.
 *
 * Plugins are npm package specs (e.g. "@acme/my-plugin@^2.0") stored in the
 * database.  When an agent process starts for a project, the server reads the
 * effective plugin list (server defaults + project overrides) and passes it to
 * the agent so it can `npm install` and load them.
 */

import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import type { DrizzleDB } from '../db/index.js';
import { serverPlugins, projectPlugins } from '../db/schema.js';
import type { ServerPlugin, ProjectPlugin } from '../db/schema.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('plugin-registry');

// ── Public types ────────────────────────────────────────────────────────────

export interface PluginInfo {
  id: string;
  packageName: string;
  packageSpec: string;
  version: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectPluginInfo extends PluginInfo {
  /** Whether the project has an explicit override for this plugin. */
  hasOverride: boolean;
  /** The effective enabled state for this project (override wins over server default). */
  projectEnabled: boolean;
}

// ── Service ─────────────────────────────────────────────────────────────────

export class PluginRegistry {
  constructor(private readonly db: DrizzleDB) {}

  // ── Server-level CRUD ───────────────────────────────────────────────────

  /** List all server-level plugins. */
  listPlugins(): PluginInfo[] {
    const rows = this.db.select().from(serverPlugins).all();
    return rows.map(toPluginInfo);
  }

  /** Get a single plugin by ID. */
  getPlugin(id: string): PluginInfo | null {
    const row = this.db
      .select()
      .from(serverPlugins)
      .where(eq(serverPlugins.id, id))
      .get();
    return row ? toPluginInfo(row) : null;
  }

  /** Get a single plugin by npm package name. */
  getPluginByPackageName(packageName: string): PluginInfo | null {
    const row = this.db
      .select()
      .from(serverPlugins)
      .where(eq(serverPlugins.packageName, packageName))
      .get();
    return row ? toPluginInfo(row) : null;
  }

  /**
   * Register a new plugin.  This records the intent to install it —
   * actual npm installation happens when an agent process starts.
   */
  addPlugin(packageName: string, packageSpec: string, version?: string): PluginInfo {
    const existing = this.getPluginByPackageName(packageName);
    if (existing) {
      throw new Error(`Plugin "${packageName}" is already registered`);
    }

    const now = new Date();
    const row: typeof serverPlugins.$inferInsert = {
      id: randomUUID(),
      packageName,
      packageSpec,
      version: version ?? null,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };

    this.db.insert(serverPlugins).values(row).run();
    log.info(`Registered plugin: ${packageName} (${packageSpec})`);
    return toPluginInfo(row as ServerPlugin);
  }

  /**
   * Update plugin metadata (e.g. after successful agent-side install
   * resolves the version, or to change the package spec).
   */
  updatePlugin(
    id: string,
    updates: { packageSpec?: string; version?: string; enabled?: boolean },
  ): PluginInfo | null {
    const existing = this.getPlugin(id);
    if (!existing) return null;

    const now = new Date();
    this.db
      .update(serverPlugins)
      .set({
        ...(updates.packageSpec !== undefined ? { packageSpec: updates.packageSpec } : {}),
        ...(updates.version !== undefined ? { version: updates.version } : {}),
        ...(updates.enabled !== undefined ? { enabled: updates.enabled } : {}),
        updatedAt: now,
      })
      .where(eq(serverPlugins.id, id))
      .run();

    return this.getPlugin(id);
  }

  /** Remove a plugin from the server-level list (cascades to project overrides). */
  removePlugin(id: string): boolean {
    const existing = this.getPlugin(id);
    if (!existing) return false;

    this.db.delete(serverPlugins).where(eq(serverPlugins.id, id)).run();
    log.info(`Removed plugin: ${existing.packageName}`);
    return true;
  }

  // ── Per-project overrides ─────────────────────────────────────────────

  /**
   * List all server plugins annotated with their effective state for a given project.
   * Plugins with no project override use the server-level enabled flag.
   */
  listPluginsForProject(projectId: string): ProjectPluginInfo[] {
    const allPlugins = this.db.select().from(serverPlugins).all();
    const overrides = this.db
      .select()
      .from(projectPlugins)
      .where(eq(projectPlugins.projectId, projectId))
      .all();

    const overrideMap = new Map<string, ProjectPlugin>();
    for (const o of overrides) {
      overrideMap.set(o.pluginId, o);
    }

    return allPlugins.map((plugin) => {
      const override = overrideMap.get(plugin.id);
      const info = toPluginInfo(plugin);
      return {
        ...info,
        hasOverride: !!override,
        projectEnabled: override ? override.enabled : info.enabled,
      };
    });
  }

  /**
   * Set the per-project enabled state for a plugin.
   * Creates an override row if none exists, or updates the existing one.
   */
  setProjectPluginEnabled(projectId: string, pluginId: string, enabled: boolean): void {
    // Verify plugin exists
    const plugin = this.getPlugin(pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    const now = new Date();
    const existing = this.db
      .select()
      .from(projectPlugins)
      .where(
        and(
          eq(projectPlugins.projectId, projectId),
          eq(projectPlugins.pluginId, pluginId),
        ),
      )
      .get();

    if (existing) {
      this.db
        .update(projectPlugins)
        .set({ enabled, updatedAt: now })
        .where(eq(projectPlugins.id, existing.id))
        .run();
    } else {
      this.db
        .insert(projectPlugins)
        .values({
          id: randomUUID(),
          projectId,
          pluginId,
          enabled,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  }

  /**
   * Remove the per-project override for a plugin, reverting to the server default.
   */
  removeProjectPluginOverride(projectId: string, pluginId: string): boolean {
    const existing = this.db
      .select()
      .from(projectPlugins)
      .where(
        and(
          eq(projectPlugins.projectId, projectId),
          eq(projectPlugins.pluginId, pluginId),
        ),
      )
      .get();

    if (!existing) return false;

    this.db.delete(projectPlugins).where(eq(projectPlugins.id, existing.id)).run();
    return true;
  }

  // ── Query helpers for agent startup ───────────────────────────────────

  /**
   * Returns the list of package specs that should be installed for a given
   * project, taking per-project overrides into account.
   */
  getEffectivePluginsForProject(projectId: string): { packageName: string; packageSpec: string }[] {
    const pluginList = this.listPluginsForProject(projectId);
    return pluginList
      .filter((p) => p.projectEnabled)
      .map((p) => ({ packageName: p.packageName, packageSpec: p.packageSpec }));
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toPluginInfo(row: ServerPlugin): PluginInfo {
  return {
    id: row.id,
    packageName: row.packageName,
    packageSpec: row.packageSpec,
    version: row.version,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
