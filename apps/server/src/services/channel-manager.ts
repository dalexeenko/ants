/**
 * ChannelManager - Manages channel lifecycle, CRUD operations, and coordinates adapters
 */

import { v4 as uuidv4 } from 'uuid';
import { eq, and } from 'drizzle-orm';
import type { DrizzleDB } from '../db/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ChannelManager');
import {
  channels,
  channelProjectBindings,
  channelThreadSessions,
  projects,
} from '../db/schema.js';
import { EncryptionService } from './encryption.js';
import type { ChannelAdapter } from '../channels/adapter.js';
import { AdapterRegistry } from '../channels/adapter.js';
import type {
  Channel,
  ChannelType,
  ChannelConfig,
  ChannelCredentials,
  ChannelProjectBinding,
  TriggerConfig,
  ResponseConfig,
  ThreadSession,
  InboundMessage,
} from '../channels/types.js';

// ============================================================================
// Types
// ============================================================================

export interface CreateChannelInput {
  type: ChannelType;
  name: string;
  config: ChannelConfig;
  credentials: ChannelCredentials;
  enabled?: boolean;
}

export interface UpdateChannelInput {
  name?: string;
  config?: ChannelConfig;
  credentials?: ChannelCredentials;
  enabled?: boolean;
}

export interface CreateBindingInput {
  projectId: string;
  triggerConfig: TriggerConfig;
  responseConfig?: ResponseConfig;
  enabled?: boolean;
  priority?: number;
}

export interface UpdateBindingInput {
  triggerConfig?: TriggerConfig;
  responseConfig?: ResponseConfig;
  enabled?: boolean;
  priority?: number;
}

// ============================================================================
// ChannelManager
// ============================================================================

export class ChannelManager {
  private db: DrizzleDB;
  private encryption: EncryptionService;
  private registry: AdapterRegistry;
  private activeAdapters = new Map<string, ChannelAdapter>();

  constructor(db: DrizzleDB, encryption: EncryptionService) {
    this.db = db;
    this.encryption = encryption;
    this.registry = new AdapterRegistry();
  }

  /**
   * Register a channel adapter
   */
  registerAdapter(adapter: ChannelAdapter): void {
    this.registry.register(adapter);
  }

  /**
   * Get supported channel types
   */
  getSupportedTypes(): ChannelType[] {
    return this.registry.getSupportedTypes();
  }

  /**
   * Initialize all enabled channels on startup
   */
  async initialize(): Promise<void> {
    const enabledChannels = this.db
      .select()
      .from(channels)
      .where(eq(channels.enabled, true))
      .all();

    for (const row of enabledChannels) {
      try {
        await this.initializeChannel(this.rowToChannel(row));
      } catch (error) {
        log.error(`Failed to initialize channel ${row.id}:`, error);
      }
    }
  }

  /**
   * Shutdown all active adapters
   */
  async shutdown(): Promise<void> {
    for (const [channelId, adapter] of this.activeAdapters) {
      try {
        await adapter.shutdown();
      } catch (error) {
        log.error(`Failed to shutdown channel ${channelId}:`, error);
      }
    }
    this.activeAdapters.clear();
  }

  // ==========================================================================
  // Channel CRUD
  // ==========================================================================

  /**
   * List all channels
   */
  listChannels(): Channel[] {
    const rows = this.db.select().from(channels).all();
    return rows.map((row) => this.rowToChannel(row));
  }

  /**
   * Get a channel by ID
   */
  getChannel(id: string): Channel | null {
    const rows = this.db.select().from(channels).where(eq(channels.id, id)).all();
    if (rows.length === 0) return null;
    return this.rowToChannel(rows[0]);
  }

  /**
   * Get a channel by type (for webhook routing)
   */
  getChannelsByType(type: ChannelType): Channel[] {
    const rows = this.db
      .select()
      .from(channels)
      .where(eq(channels.type, type))
      .all();
    return rows.map((row) => this.rowToChannel(row));
  }

  /**
   * Create a new channel
   */
  async createChannel(input: CreateChannelInput, createdBy?: string): Promise<Channel> {
    if (!this.registry.has(input.type)) {
      throw new Error(`Unsupported channel type: ${input.type}`);
    }

    const id = uuidv4();
    const now = new Date();

    // Convert credentials to string values for encryption
    const credentialsAsStrings: Record<string, string> = {};
    for (const [key, value] of Object.entries(input.credentials)) {
      credentialsAsStrings[key] = String(value);
    }
    const encryptedCredentials = this.encryption.encryptObject(credentialsAsStrings);

    this.db.insert(channels).values({
      id,
      type: input.type,
      name: input.name,
      config: JSON.stringify(input.config),
      credentials: encryptedCredentials,
      enabled: input.enabled ?? true,
      createdBy: createdBy || null,
      createdAt: now,
      updatedAt: now,
    }).run();

    const channel = this.getChannel(id)!;

    // Initialize if enabled
    if (channel.enabled) {
      await this.initializeChannel(channel);
    }

    return channel;
  }

  /**
   * Update a channel
   */
  async updateChannel(id: string, input: UpdateChannelInput): Promise<Channel | null> {
    const existing = this.getChannel(id);
    if (!existing) return null;

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (input.name !== undefined) {
      updateData.name = input.name;
    }
    if (input.config !== undefined) {
      updateData.config = JSON.stringify(input.config);
    }
    if (input.credentials !== undefined) {
      const credentialsAsStrings: Record<string, string> = {};
      for (const [key, value] of Object.entries(input.credentials)) {
        credentialsAsStrings[key] = String(value);
      }
      updateData.credentials = this.encryption.encryptObject(credentialsAsStrings);
    }
    if (input.enabled !== undefined) {
      updateData.enabled = input.enabled;
    }

    this.db.update(channels).set(updateData).where(eq(channels.id, id)).run();

    const updated = this.getChannel(id)!;

    // Handle enable/disable
    if (input.enabled !== undefined) {
      if (input.enabled && !this.activeAdapters.has(id)) {
        await this.initializeChannel(updated);
      } else if (!input.enabled && this.activeAdapters.has(id)) {
        await this.shutdownChannel(id);
      }
    } else if (this.activeAdapters.has(id)) {
      // Re-initialize if config/credentials changed
      await this.shutdownChannel(id);
      await this.initializeChannel(updated);
    }

    return updated;
  }

  /**
   * Delete a channel
   */
  async deleteChannel(id: string): Promise<boolean> {
    // Shutdown adapter if active
    if (this.activeAdapters.has(id)) {
      await this.shutdownChannel(id);
    }

    const result = this.db.delete(channels).where(eq(channels.id, id)).run();
    return result.changes > 0;
  }

  // ==========================================================================
  // Binding CRUD
  // ==========================================================================

  /**
   * List bindings for a channel
   */
  listBindings(channelId: string): ChannelProjectBinding[] {
    const rows = this.db
      .select()
      .from(channelProjectBindings)
      .where(eq(channelProjectBindings.channelId, channelId))
      .all();
    return rows.map((row) => this.rowToBinding(row));
  }

  /**
   * Get a specific binding
   */
  getBinding(channelId: string, bindingId: string): ChannelProjectBinding | null {
    const rows = this.db
      .select()
      .from(channelProjectBindings)
      .where(
        and(
          eq(channelProjectBindings.channelId, channelId),
          eq(channelProjectBindings.id, bindingId)
        )
      )
      .all();
    if (rows.length === 0) return null;
    return this.rowToBinding(rows[0]);
  }

  /**
   * Create a binding between a channel and project
   */
  createBinding(channelId: string, input: CreateBindingInput, createdBy?: string): ChannelProjectBinding {
    // Verify channel exists
    const channel = this.getChannel(channelId);
    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    // Verify project exists
    const projectRows = this.db
      .select()
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .all();
    if (projectRows.length === 0) {
      throw new Error(`Project not found: ${input.projectId}`);
    }

    const id = uuidv4();
    const now = new Date();

    this.db.insert(channelProjectBindings).values({
      id,
      channelId,
      projectId: input.projectId,
      triggerConfig: JSON.stringify(input.triggerConfig),
      responseConfig: input.responseConfig ? JSON.stringify(input.responseConfig) : null,
      enabled: input.enabled ?? true,
      priority: input.priority ?? 0,
      createdBy: createdBy || null,
      createdAt: now,
      updatedAt: now,
    }).run();

    return this.getBinding(channelId, id)!;
  }

  /**
   * Update a binding
   */
  updateBinding(
    channelId: string,
    bindingId: string,
    input: UpdateBindingInput
  ): ChannelProjectBinding | null {
    const existing = this.getBinding(channelId, bindingId);
    if (!existing) return null;

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (input.triggerConfig !== undefined) {
      updateData.triggerConfig = JSON.stringify(input.triggerConfig);
    }
    if (input.responseConfig !== undefined) {
      updateData.responseConfig = JSON.stringify(input.responseConfig);
    }
    if (input.enabled !== undefined) {
      updateData.enabled = input.enabled;
    }
    if (input.priority !== undefined) {
      updateData.priority = input.priority;
    }

    this.db
      .update(channelProjectBindings)
      .set(updateData)
      .where(eq(channelProjectBindings.id, bindingId))
      .run();

    return this.getBinding(channelId, bindingId);
  }

  /**
   * Delete a binding
   */
  deleteBinding(channelId: string, bindingId: string): boolean {
    const result = this.db
      .delete(channelProjectBindings)
      .where(
        and(
          eq(channelProjectBindings.channelId, channelId),
          eq(channelProjectBindings.id, bindingId)
        )
      )
      .run();
    return result.changes > 0;
  }

  // ==========================================================================
  // Binding Matching
  // ==========================================================================

  /**
   * Find bindings that match an inbound message
   */
  findMatchingBindings(message: InboundMessage): ChannelProjectBinding[] {
    const bindings = this.db
      .select()
      .from(channelProjectBindings)
      .where(
        and(
          eq(channelProjectBindings.channelId, message.channelId),
          eq(channelProjectBindings.enabled, true)
        )
      )
      .all();

    return bindings
      .map((row) => this.rowToBinding(row))
      .filter((binding) => this.matchesTrigger(message, binding.triggerConfig))
      .sort((a, b) => b.priority - a.priority); // Higher priority first
  }

  /**
   * Check if a message matches trigger config
   */
  private matchesTrigger(message: InboundMessage, config: TriggerConfig): boolean {
    // Check if event type matches
    if (!config.events.includes(message.triggerType)) {
      return false;
    }

    // Check filters if present
    if (config.filters) {
      for (const filter of config.filters) {
        if (!this.matchesFilter(message, filter)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Check if a message matches a specific filter
   */
  private matchesFilter(
    message: InboundMessage,
    filter: { type: string; include?: string[]; exclude?: string[] }
  ): boolean {
    let value: string | undefined;

    switch (filter.type) {
      case 'channel':
        value = message.platformChannelId;
        break;
      case 'user':
        value = message.authorId;
        break;
      case 'keyword':
        // For keyword, check if any keyword is in the message
        if (filter.include && filter.include.length > 0) {
          const hasKeyword = filter.include.some((kw) =>
            message.content.toLowerCase().includes(kw.toLowerCase())
          );
          if (!hasKeyword) return false;
        }
        if (filter.exclude && filter.exclude.length > 0) {
          const hasExcluded = filter.exclude.some((kw) =>
            message.content.toLowerCase().includes(kw.toLowerCase())
          );
          if (hasExcluded) return false;
        }
        return true;
      case 'regex':
        if (filter.include && filter.include.length > 0) {
          const hasMatch = filter.include.some((pattern) => {
            try {
              return new RegExp(pattern).test(message.content);
            } catch {
              return false;
            }
          });
          if (!hasMatch) return false;
        }
        return true;
      default:
        return true;
    }

    if (value) {
      if (filter.include && filter.include.length > 0 && !filter.include.includes(value)) {
        return false;
      }
      if (filter.exclude && filter.exclude.length > 0 && filter.exclude.includes(value)) {
        return false;
      }
    }

    return true;
  }

  // ==========================================================================
  // Thread Session Management
  // ==========================================================================

  /**
   * Get or create a session for a thread
   */
  getOrCreateThreadSession(
    channelId: string,
    projectId: string,
    platformThreadId: string,
    createSessionId: () => string
  ): ThreadSession {
    const existing = this.db
      .select()
      .from(channelThreadSessions)
      .where(
        and(
          eq(channelThreadSessions.channelId, channelId),
          eq(channelThreadSessions.platformThreadId, platformThreadId)
        )
      )
      .all();

    if (existing.length > 0) {
      const row = existing[0];
      // Update last active time
      this.db
        .update(channelThreadSessions)
        .set({ lastActiveAt: new Date() })
        .where(eq(channelThreadSessions.id, row.id))
        .run();

      return {
        id: row.id,
        channelId: row.channelId,
        projectId: row.projectId,
        platformThreadId: row.platformThreadId,
        sessionId: row.sessionId,
        createdAt: row.createdAt,
        lastActiveAt: new Date(),
      };
    }

    // Create new session mapping
    const id = uuidv4();
    const sessionId = createSessionId();
    const now = new Date();

    this.db.insert(channelThreadSessions).values({
      id,
      channelId,
      projectId,
      platformThreadId,
      sessionId,
      createdAt: now,
      lastActiveAt: now,
    }).run();

    return {
      id,
      channelId,
      projectId,
      platformThreadId,
      sessionId,
      createdAt: now,
      lastActiveAt: now,
    };
  }

  /**
   * Get session for a thread
   */
  getThreadSession(channelId: string, platformThreadId: string): ThreadSession | null {
    const rows = this.db
      .select()
      .from(channelThreadSessions)
      .where(
        and(
          eq(channelThreadSessions.channelId, channelId),
          eq(channelThreadSessions.platformThreadId, platformThreadId)
        )
      )
      .all();

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      id: row.id,
      channelId: row.channelId,
      projectId: row.projectId,
      platformThreadId: row.platformThreadId,
      sessionId: row.sessionId,
      createdAt: row.createdAt,
      lastActiveAt: row.lastActiveAt,
    };
  }

  // ==========================================================================
  // Adapter Management
  // ==========================================================================

  /**
   * Get adapter for a channel type
   */
  getAdapter(type: ChannelType): ChannelAdapter | undefined {
    return this.registry.get(type);
  }

  /**
   * Get active adapter instance for a channel
   */
  getActiveAdapter(channelId: string): ChannelAdapter | undefined {
    return this.activeAdapters.get(channelId);
  }

  /**
   * Check if there are any enabled channels (for startup warning)
   */
  hasEnabledChannels(): boolean {
    const count = this.db
      .select()
      .from(channels)
      .where(eq(channels.enabled, true))
      .all();
    return count.length > 0;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private async initializeChannel(channel: Channel): Promise<void> {
    const adapter = this.registry.get(channel.type);
    if (!adapter) {
      throw new Error(`No adapter registered for channel type: ${channel.type}`);
    }

    await adapter.initialize(channel);
    this.activeAdapters.set(channel.id, adapter);
    log.info(`Initialized channel: ${channel.name} (${channel.type})`);
  }

  private async shutdownChannel(channelId: string): Promise<void> {
    const adapter = this.activeAdapters.get(channelId);
    if (adapter) {
      await adapter.shutdown();
      this.activeAdapters.delete(channelId);
    }
  }

  private rowToChannel(row: typeof channels.$inferSelect): Channel {
    let credentials: ChannelCredentials;
    try {
      credentials = this.encryption.decryptObject(row.credentials) as ChannelCredentials;
    } catch {
      credentials = {};
    }

    return {
      id: row.id,
      type: row.type as ChannelType,
      name: row.name,
      config: JSON.parse(row.config) as ChannelConfig,
      credentials,
      enabled: row.enabled,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private rowToBinding(row: typeof channelProjectBindings.$inferSelect): ChannelProjectBinding {
    return {
      id: row.id,
      channelId: row.channelId,
      projectId: row.projectId,
      triggerConfig: JSON.parse(row.triggerConfig) as TriggerConfig,
      responseConfig: row.responseConfig
        ? (JSON.parse(row.responseConfig) as ResponseConfig)
        : undefined,
      enabled: row.enabled,
      priority: row.priority,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
