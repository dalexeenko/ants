/**
 * FileWatcherManager - Manages file system watchers that trigger agent actions
 *
 * Uses Node.js fs.watch with recursive option to monitor directories.
 * Debounces events and renders prompt templates with file change info.
 *
 * Template variables: {{files}}, {{event}}, {{path}}
 */

import { watch, type FSWatcher } from 'fs';
import { join, relative } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import type { DrizzleDB } from '../db/index.js';
import { fileWatchers } from '../db/schema.js';
import type { FileWatcher } from '../db/schema.js';
import type { ProjectManager } from './project-manager.js';
import { getErrorMessage } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('FileWatcherManager');

// ============================================================================
// Types
// ============================================================================

export interface CreateFileWatcherInput {
  projectId: string;
  name: string;
  watchPath: string;
  patterns?: string[];
  ignorePatterns?: string[];
  events?: string[];
  debounceMs?: number;
  promptTemplate: string;
  enabled?: boolean;
}

export interface UpdateFileWatcherInput {
  name?: string;
  watchPath?: string;
  patterns?: string[];
  ignorePatterns?: string[];
  events?: string[];
  debounceMs?: number;
  promptTemplate?: string;
  enabled?: boolean;
}

interface ActiveWatcher {
  fsWatcher: FSWatcher;
  watcherId: string;
  debounceTimer: NodeJS.Timeout | null;
  pendingChanges: Map<string, string>; // path -> event type
}

// ============================================================================
// FileWatcherManager
// ============================================================================

export class FileWatcherManager {
  private db: DrizzleDB;
  private projectManager: ProjectManager;
  private activeWatchers: Map<string, ActiveWatcher> = new Map();

  constructor(db: DrizzleDB, projectManager: ProjectManager) {
    this.db = db;
    this.projectManager = projectManager;
  }

  // ==========================================================================
  // CRUD
  // ==========================================================================

  createWatcher(input: CreateFileWatcherInput, createdBy?: string): FileWatcher {
    const id = uuidv4();
    const now = new Date();

    const row: typeof fileWatchers.$inferInsert = {
      id,
      projectId: input.projectId,
      name: input.name,
      watchPath: input.watchPath,
      patterns: input.patterns ? JSON.stringify(input.patterns) : null,
      ignorePatterns: input.ignorePatterns ? JSON.stringify(input.ignorePatterns) : null,
      events: input.events ? JSON.stringify(input.events) : '["change"]',
      debounceMs: input.debounceMs ?? 1000,
      promptTemplate: input.promptTemplate,
      enabled: input.enabled ?? true,
      createdBy: createdBy || null,
      createdAt: now,
      updatedAt: now,
    };

    this.db.insert(fileWatchers).values(row).run();

    const watcher = this.db.select().from(fileWatchers).where(eq(fileWatchers.id, id)).get()!;

    // Auto-start if enabled
    if (watcher.enabled) {
      this.startWatcher(id);
    }

    return watcher;
  }

  getWatcher(id: string): FileWatcher | null {
    return this.db.select().from(fileWatchers).where(eq(fileWatchers.id, id)).get() ?? null;
  }

  listWatchers(projectId: string): FileWatcher[] {
    return this.db.select().from(fileWatchers)
      .where(eq(fileWatchers.projectId, projectId))
      .all();
  }

  updateWatcher(id: string, updates: UpdateFileWatcherInput): FileWatcher | null {
    const existing = this.getWatcher(id);
    if (!existing) return null;

    const now = new Date();
    const updateData: Partial<typeof fileWatchers.$inferInsert> = {
      updatedAt: now,
    };

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.watchPath !== undefined) updateData.watchPath = updates.watchPath;
    if (updates.patterns !== undefined) updateData.patterns = JSON.stringify(updates.patterns);
    if (updates.ignorePatterns !== undefined) updateData.ignorePatterns = JSON.stringify(updates.ignorePatterns);
    if (updates.events !== undefined) updateData.events = JSON.stringify(updates.events);
    if (updates.debounceMs !== undefined) updateData.debounceMs = updates.debounceMs;
    if (updates.promptTemplate !== undefined) updateData.promptTemplate = updates.promptTemplate;
    if (updates.enabled !== undefined) updateData.enabled = updates.enabled;

    this.db.update(fileWatchers).set(updateData).where(eq(fileWatchers.id, id)).run();

    // Restart watcher if it was running or if enabled state changed
    const updated = this.getWatcher(id)!;
    const wasActive = this.activeWatchers.has(id);

    if (wasActive) {
      this.stopWatcher(id);
    }
    if (updated.enabled) {
      this.startWatcher(id);
    }

    return updated;
  }

  deleteWatcher(id: string): boolean {
    const existing = this.getWatcher(id);
    if (!existing) return false;

    // Stop the watcher if running
    this.stopWatcher(id);

    this.db.delete(fileWatchers).where(eq(fileWatchers.id, id)).run();
    return true;
  }

  // ==========================================================================
  // Watcher Lifecycle
  // ==========================================================================

  /**
   * Start watching for a specific watcher configuration
   */
  startWatcher(id: string): void {
    // Already watching
    if (this.activeWatchers.has(id)) return;

    const watcherConfig = this.getWatcher(id);
    if (!watcherConfig || !watcherConfig.enabled) return;

    this.startWatcherInternal(watcherConfig);
  }

  private async startWatcherInternal(watcherConfig: FileWatcher): Promise<void> {
    try {
      const project = await this.projectManager.getProject(watcherConfig.projectId);
      if (!project) {
        log.error(`Project ${watcherConfig.projectId} not found for watcher ${watcherConfig.id}`);
        return;
      }

      const absoluteWatchPath = join(project.workingDirectory, watcherConfig.watchPath);

      const fsWatcher = watch(absoluteWatchPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        this.handleFileEvent(watcherConfig.id, eventType, filename);
      });

      fsWatcher.on('error', (error) => {
        log.error(`Error in watcher ${watcherConfig.id}:`, error);
      });

      const active: ActiveWatcher = {
        fsWatcher,
        watcherId: watcherConfig.id,
        debounceTimer: null,
        pendingChanges: new Map(),
      };

      this.activeWatchers.set(watcherConfig.id, active);
      log.info(`Started watcher "${watcherConfig.name}" on ${absoluteWatchPath}`);

    } catch (error) {
      log.error(`Failed to start watcher ${watcherConfig.id}:`, getErrorMessage(error));
    }
  }

  /**
   * Stop a specific watcher
   */
  stopWatcher(id: string): void {
    const active = this.activeWatchers.get(id);
    if (!active) return;

    if (active.debounceTimer) {
      clearTimeout(active.debounceTimer);
    }
    active.fsWatcher.close();
    this.activeWatchers.delete(id);

    log.info(`Stopped watcher ${id}`);
  }

  /**
   * Start all enabled watchers
   */
  async startAllWatchers(): Promise<void> {
    const allWatchers = this.db.select().from(fileWatchers).all();
    for (const watcher of allWatchers) {
      if (watcher.enabled) {
        await this.startWatcherInternal(watcher);
      }
    }
    log.info(`Started ${this.activeWatchers.size} watcher(s)`);
  }

  /**
   * Stop all active watchers
   */
  stopAllWatchers(): void {
    for (const [id] of this.activeWatchers) {
      this.stopWatcher(id);
    }
  }

  /**
   * Shutdown the manager - stops all watchers
   */
  shutdown(): void {
    this.stopAllWatchers();
    log.info('Shut down');
  }

  // ==========================================================================
  // File Event Handling
  // ==========================================================================

  /**
   * Handle a file system event with debouncing
   */
  private handleFileEvent(watcherId: string, eventType: string, filename: string): void {
    const active = this.activeWatchers.get(watcherId);
    if (!active) return;

    const watcherConfig = this.getWatcher(watcherId);
    if (!watcherConfig) return;

    // Check if the event type is one we care about
    const allowedEvents: string[] = watcherConfig.events ? JSON.parse(watcherConfig.events) : ['change'];
    // fs.watch uses 'rename' for add/unlink and 'change' for changes
    const normalizedEvent = eventType === 'rename' ? 'add' : 'change';

    if (!allowedEvents.includes(normalizedEvent) && !allowedEvents.includes(eventType)) {
      return;
    }

    // Check glob patterns
    if (watcherConfig.patterns) {
      const patterns: string[] = JSON.parse(watcherConfig.patterns);
      if (patterns.length > 0 && !this.matchesPatterns(filename, patterns)) {
        return;
      }
    }

    // Check ignore patterns
    if (watcherConfig.ignorePatterns) {
      const ignorePatterns: string[] = JSON.parse(watcherConfig.ignorePatterns);
      if (ignorePatterns.length > 0 && this.matchesPatterns(filename, ignorePatterns)) {
        return;
      }
    }

    // Add to pending changes
    active.pendingChanges.set(filename, normalizedEvent);

    // Reset debounce timer
    if (active.debounceTimer) {
      clearTimeout(active.debounceTimer);
    }

    active.debounceTimer = setTimeout(() => {
      this.processPendingChanges(watcherId);
    }, watcherConfig.debounceMs);
  }

  /**
   * Simple glob pattern matching (supports * and **)
   */
  private matchesPatterns(filename: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      if (this.matchGlob(filename, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Basic glob matching: supports *, **, and ? wildcards
   */
  private matchGlob(str: string, pattern: string): boolean {
    // Convert glob to regex
    let regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars (except * and ?)
      .replace(/\*\*/g, '<<DOUBLESTAR>>')
      .replace(/\*/g, '[^/]*')
      .replace(/<<DOUBLESTAR>>/g, '.*')
      .replace(/\?/g, '.');

    regexStr = '^' + regexStr + '$';

    try {
      return new RegExp(regexStr).test(str);
    } catch {
      return false;
    }
  }

  /**
   * Process accumulated file changes after debounce
   */
  private async processPendingChanges(watcherId: string): Promise<void> {
    const active = this.activeWatchers.get(watcherId);
    if (!active || active.pendingChanges.size === 0) return;

    const watcherConfig = this.getWatcher(watcherId);
    if (!watcherConfig) return;

    // Collect changes and clear pending
    const changes = new Map(active.pendingChanges);
    active.pendingChanges.clear();

    const files = Array.from(changes.keys());
    const events = Array.from(new Set(changes.values()));

    log.info(`Watcher "${watcherConfig.name}" detected ${files.length} file change(s)`);

    // Render prompt template
    const prompt = this.renderPromptTemplate(watcherConfig.promptTemplate, {
      files: files.join('\n'),
      event: events.join(', '),
      path: watcherConfig.watchPath,
    });

    // Send to agent
    try {
      const client = await this.projectManager.getClient(watcherConfig.projectId);
      if (!client) {
        log.error(`Could not get agent client for project ${watcherConfig.projectId}`);
        return;
      }

      const project = await this.projectManager.getProject(watcherConfig.projectId);
      if (!project) {
        log.error(`Project ${watcherConfig.projectId} not found`);
        return;
      }

      // Create a new session for this batch of changes
      const session = (await client.createSession({
        workingDirectory: project.workingDirectory,
        title: `File watcher: ${watcherConfig.name} - ${files.length} file(s) changed`,
      })) as { id: string };

      await client.sendPromptAsync(session.id, prompt);

      log.info(`Sent prompt for watcher "${watcherConfig.name}" to session ${session.id}`);

    } catch (error) {
      log.error(`Error sending prompt for watcher ${watcherId}:`, getErrorMessage(error));
    }
  }

  /**
   * Render a prompt template with file change data
   */
  private renderPromptTemplate(template: string, data: {
    files: string;
    event: string;
    path: string;
  }): string {
    let result = template;
    result = result.replace(/\{\{files\}\}/g, data.files);
    result = result.replace(/\{\{event\}\}/g, data.event);
    result = result.replace(/\{\{path\}\}/g, data.path);
    return result;
  }
}
