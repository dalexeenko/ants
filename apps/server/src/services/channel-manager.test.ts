import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ChannelManager } from './channel-manager.js';
import { EncryptionService } from './encryption.js';
import type { ChannelAdapter } from '../channels/adapter.js';
import type { InboundMessage, Channel } from '../channels/types.js';
import * as schema from '../db/schema.js';
import { createTestDatabase, type TestDB } from '../test-utils/db.js';

function makeAdapter(overrides: Partial<ChannelAdapter> = {}): ChannelAdapter {
  return {
    type: 'slack',
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
    handleWebhook: vi.fn().mockResolvedValue({ status: 200, body: 'ok' }),
    parseMessage: vi.fn().mockReturnValue(null),
    sendMessage: vi.fn().mockResolvedValue({ success: true }),
    getThreadId: vi.fn().mockReturnValue('thread-1'),
    ...overrides,
  };
}

describe('ChannelManager', () => {
  let sqlite: Database.Database;
  let db: TestDB;
  let encryption: EncryptionService;
  let manager: ChannelManager;

  beforeEach(() => {
    const validKey = Buffer.alloc(32, 'a').toString('base64');
    encryption = new EncryptionService(validKey);

    ({ sqlite, db } = createTestDatabase());

    manager = new ChannelManager(db, encryption);
  });

  afterEach(() => {
    sqlite.close();
  });

  // ========================================================================
  // Adapter Registration
  // ========================================================================

  describe('registerAdapter / getSupportedTypes', () => {
    it('should register and return supported types', () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);
      expect(manager.getSupportedTypes()).toEqual(['slack']);
    });

    it('should return empty when no adapters registered', () => {
      expect(manager.getSupportedTypes()).toEqual([]);
    });
  });

  // ========================================================================
  // Channel CRUD
  // ========================================================================

  describe('createChannel', () => {
    it('should create a channel and return it', async () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);

      const channel = await manager.createChannel({
        type: 'slack',
        name: 'My Slack',
        config: { workspaceId: 'W1' },
        credentials: { botToken: 'xoxb-test', signingSecret: 'sec' },
      });

      expect(channel.id).toBeDefined();
      expect(channel.name).toBe('My Slack');
      expect(channel.type).toBe('slack');
      expect(channel.enabled).toBe(true);
      expect(channel.credentials).toEqual({ botToken: 'xoxb-test', signingSecret: 'sec' });
    });

    it('should throw for unsupported channel type', async () => {
      await expect(
        manager.createChannel({
          type: 'slack',
          name: 'No Adapter',
          config: {},
          credentials: {},
        }),
      ).rejects.toThrow('Unsupported channel type');
    });

    it('should initialize adapter when channel is enabled', async () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);

      await manager.createChannel({
        type: 'slack',
        name: 'Enabled',
        config: {},
        credentials: { botToken: 'tok', signingSecret: 'sec' },
        enabled: true,
      });

      expect(adapter.initialize).toHaveBeenCalled();
    });

    it('should not initialize adapter when channel is disabled', async () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);

      await manager.createChannel({
        type: 'slack',
        name: 'Disabled',
        config: {},
        credentials: { botToken: 'tok', signingSecret: 'sec' },
        enabled: false,
      });

      expect(adapter.initialize).not.toHaveBeenCalled();
    });
  });

  describe('listChannels', () => {
    it('should return empty array when no channels', () => {
      expect(manager.listChannels()).toEqual([]);
    });

    it('should return all channels', async () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);

      await manager.createChannel({
        type: 'slack',
        name: 'Channel A',
        config: {},
        credentials: { botToken: 'a', signingSecret: 's' },
      });
      await manager.createChannel({
        type: 'slack',
        name: 'Channel B',
        config: {},
        credentials: { botToken: 'b', signingSecret: 's' },
      });

      const channels = manager.listChannels();
      expect(channels).toHaveLength(2);
    });
  });

  describe('getChannel', () => {
    it('should return null for non-existent channel', () => {
      expect(manager.getChannel('nope')).toBeNull();
    });

    it('should return channel by id', async () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);

      const created = await manager.createChannel({
        type: 'slack',
        name: 'Lookup',
        config: { key: 'val' },
        credentials: { botToken: 't', signingSecret: 's' },
      });

      const found = manager.getChannel(created.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Lookup');
    });
  });

  describe('getChannelsByType', () => {
    it('should return channels filtered by type', async () => {
      const slackAdapter = makeAdapter();
      const discordAdapter = makeAdapter({ type: 'discord' });
      manager.registerAdapter(slackAdapter);
      manager.registerAdapter(discordAdapter);

      await manager.createChannel({
        type: 'slack',
        name: 'Slack 1',
        config: {},
        credentials: { botToken: 't', signingSecret: 's' },
      });
      await manager.createChannel({
        type: 'discord',
        name: 'Discord 1',
        config: {},
        credentials: { botToken: 't', publicKey: 'k' },
      });

      const slacks = manager.getChannelsByType('slack');
      expect(slacks).toHaveLength(1);
      expect(slacks[0].type).toBe('slack');
    });
  });

  describe('updateChannel', () => {
    it('should return null for non-existent channel', async () => {
      const result = await manager.updateChannel('nope', { name: 'New' });
      expect(result).toBeNull();
    });

    it('should update channel name', async () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);

      const channel = await manager.createChannel({
        type: 'slack',
        name: 'Old Name',
        config: {},
        credentials: { botToken: 't', signingSecret: 's' },
      });

      const updated = await manager.updateChannel(channel.id, { name: 'New Name' });
      expect(updated!.name).toBe('New Name');
    });

    it('should re-initialize when config changes on active channel', async () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);

      const channel = await manager.createChannel({
        type: 'slack',
        name: 'Active',
        config: {},
        credentials: { botToken: 't', signingSecret: 's' },
      });

      // First init from create
      expect(adapter.initialize).toHaveBeenCalledTimes(1);

      await manager.updateChannel(channel.id, { config: { newKey: 'val' } });

      // Should have shut down and re-initialized
      expect(adapter.shutdown).toHaveBeenCalled();
      expect(adapter.initialize).toHaveBeenCalledTimes(2);
    });

    it('should shutdown adapter when disabling', async () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);

      const channel = await manager.createChannel({
        type: 'slack',
        name: 'Disable Test',
        config: {},
        credentials: { botToken: 't', signingSecret: 's' },
      });

      await manager.updateChannel(channel.id, { enabled: false });
      expect(adapter.shutdown).toHaveBeenCalled();
    });

    it('should initialize adapter when enabling', async () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);

      const channel = await manager.createChannel({
        type: 'slack',
        name: 'Enable Test',
        config: {},
        credentials: { botToken: 't', signingSecret: 's' },
        enabled: false,
      });

      expect(adapter.initialize).not.toHaveBeenCalled();
      await manager.updateChannel(channel.id, { enabled: true });
      expect(adapter.initialize).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteChannel', () => {
    it('should return false for non-existent channel', async () => {
      expect(await manager.deleteChannel('nope')).toBe(false);
    });

    it('should delete a channel and shutdown its adapter', async () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);

      const channel = await manager.createChannel({
        type: 'slack',
        name: 'Delete Me',
        config: {},
        credentials: { botToken: 't', signingSecret: 's' },
      });

      const result = await manager.deleteChannel(channel.id);
      expect(result).toBe(true);
      expect(adapter.shutdown).toHaveBeenCalled();
      expect(manager.getChannel(channel.id)).toBeNull();
    });
  });

  // ========================================================================
  // Binding CRUD
  // ========================================================================

  describe('createBinding', () => {
    it('should throw if channel does not exist', () => {
      expect(() =>
        manager.createBinding('no-channel', {
          projectId: 'p1',
          triggerConfig: { events: ['mention'] },
        }),
      ).toThrow('Channel not found');
    });

    it('should throw if project does not exist', async () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);

      const channel = await manager.createChannel({
        type: 'slack',
        name: 'Binding Test',
        config: {},
        credentials: { botToken: 't', signingSecret: 's' },
      });

      expect(() =>
        manager.createBinding(channel.id, {
          projectId: 'no-project',
          triggerConfig: { events: ['mention'] },
        }),
      ).toThrow('Project not found');
    });

    it('should create a binding', async () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);

      // Insert a project
      const now = new Date();
      sqlite.exec(`INSERT INTO projects (id, name, working_directory, auto_start, created_at, updated_at) VALUES ('p1', 'Test', '/tmp/test', 1, ${now.getTime()}, ${now.getTime()})`);

      const channel = await manager.createChannel({
        type: 'slack',
        name: 'Binding Test',
        config: {},
        credentials: { botToken: 't', signingSecret: 's' },
      });

      const binding = manager.createBinding(channel.id, {
        projectId: 'p1',
        triggerConfig: { events: ['mention', 'direct_message'] },
        priority: 5,
      });

      expect(binding.id).toBeDefined();
      expect(binding.channelId).toBe(channel.id);
      expect(binding.projectId).toBe('p1');
      expect(binding.triggerConfig.events).toEqual(['mention', 'direct_message']);
      expect(binding.priority).toBe(5);
      expect(binding.enabled).toBe(true);
    });
  });

  describe('listBindings', () => {
    it('should return empty array for no bindings', async () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);

      const channel = await manager.createChannel({
        type: 'slack',
        name: 'No Bindings',
        config: {},
        credentials: { botToken: 't', signingSecret: 's' },
      });

      expect(manager.listBindings(channel.id)).toEqual([]);
    });
  });

  describe('updateBinding', () => {
    it('should return null for non-existent binding', async () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);

      const channel = await manager.createChannel({
        type: 'slack',
        name: 'Update Binding',
        config: {},
        credentials: { botToken: 't', signingSecret: 's' },
      });

      expect(manager.updateBinding(channel.id, 'nope', { priority: 10 })).toBeNull();
    });

    it('should update binding fields', async () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);

      const now = new Date();
      sqlite.exec(`INSERT INTO projects (id, name, working_directory, auto_start, created_at, updated_at) VALUES ('p1', 'Test', '/tmp/test', 1, ${now.getTime()}, ${now.getTime()})`);

      const channel = await manager.createChannel({
        type: 'slack',
        name: 'Update Binding',
        config: {},
        credentials: { botToken: 't', signingSecret: 's' },
      });

      const binding = manager.createBinding(channel.id, {
        projectId: 'p1',
        triggerConfig: { events: ['mention'] },
      });

      const updated = manager.updateBinding(channel.id, binding.id, {
        priority: 10,
        enabled: false,
      });

      expect(updated!.priority).toBe(10);
      expect(updated!.enabled).toBe(false);
    });
  });

  describe('deleteBinding', () => {
    it('should return false for non-existent binding', async () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);

      const channel = await manager.createChannel({
        type: 'slack',
        name: 'Del Binding',
        config: {},
        credentials: { botToken: 't', signingSecret: 's' },
      });

      expect(manager.deleteBinding(channel.id, 'nope')).toBe(false);
    });

    it('should delete existing binding', async () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);

      const now = new Date();
      sqlite.exec(`INSERT INTO projects (id, name, working_directory, auto_start, created_at, updated_at) VALUES ('p1', 'Test', '/tmp/test', 1, ${now.getTime()}, ${now.getTime()})`);

      const channel = await manager.createChannel({
        type: 'slack',
        name: 'Del Binding',
        config: {},
        credentials: { botToken: 't', signingSecret: 's' },
      });

      const binding = manager.createBinding(channel.id, {
        projectId: 'p1',
        triggerConfig: { events: ['mention'] },
      });

      expect(manager.deleteBinding(channel.id, binding.id)).toBe(true);
      expect(manager.getBinding(channel.id, binding.id)).toBeNull();
    });
  });

  // ========================================================================
  // Binding Matching
  // ========================================================================

  describe('findMatchingBindings', () => {
    let channel: Channel;

    beforeEach(async () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);

      const now = new Date();
      sqlite.exec(`INSERT INTO projects (id, name, working_directory, auto_start, created_at, updated_at) VALUES ('p1', 'Test', '/tmp/test', 1, ${now.getTime()}, ${now.getTime()})`);

      channel = await manager.createChannel({
        type: 'slack',
        name: 'Matching',
        config: {},
        credentials: { botToken: 't', signingSecret: 's' },
      });
    });

    it('should match on event type', () => {
      manager.createBinding(channel.id, {
        projectId: 'p1',
        triggerConfig: { events: ['mention'] },
      });

      const message: InboundMessage = {
        id: 'm1',
        channelId: channel.id,
        platformMessageId: 'pm1',
        platformChannelId: 'C1',
        authorId: 'U1',
        authorName: 'user',
        content: 'hello',
        triggerType: 'mention',
        metadata: {},
        timestamp: new Date(),
      };

      const matches = manager.findMatchingBindings(message);
      expect(matches).toHaveLength(1);
    });

    it('should not match on wrong event type', () => {
      manager.createBinding(channel.id, {
        projectId: 'p1',
        triggerConfig: { events: ['direct_message'] },
      });

      const message: InboundMessage = {
        id: 'm1',
        channelId: channel.id,
        platformMessageId: 'pm1',
        platformChannelId: 'C1',
        authorId: 'U1',
        authorName: 'user',
        content: 'hello',
        triggerType: 'mention',
        metadata: {},
        timestamp: new Date(),
      };

      expect(manager.findMatchingBindings(message)).toHaveLength(0);
    });

    it('should filter by keyword include', () => {
      manager.createBinding(channel.id, {
        projectId: 'p1',
        triggerConfig: {
          events: ['channel_message'],
          filters: [{ type: 'keyword', include: ['deploy'] }],
        },
      });

      const noKeyword: InboundMessage = {
        id: 'm1',
        channelId: channel.id,
        platformMessageId: 'pm1',
        platformChannelId: 'C1',
        authorId: 'U1',
        authorName: 'user',
        content: 'hello world',
        triggerType: 'channel_message',
        metadata: {},
        timestamp: new Date(),
      };

      const withKeyword: InboundMessage = {
        ...noKeyword,
        id: 'm2',
        content: 'please deploy now',
      };

      expect(manager.findMatchingBindings(noKeyword)).toHaveLength(0);
      expect(manager.findMatchingBindings(withKeyword)).toHaveLength(1);
    });

    it('should filter by keyword exclude', () => {
      manager.createBinding(channel.id, {
        projectId: 'p1',
        triggerConfig: {
          events: ['channel_message'],
          filters: [{ type: 'keyword', exclude: ['ignore'] }],
        },
      });

      const excluded: InboundMessage = {
        id: 'm1',
        channelId: channel.id,
        platformMessageId: 'pm1',
        platformChannelId: 'C1',
        authorId: 'U1',
        authorName: 'user',
        content: 'please ignore this',
        triggerType: 'channel_message',
        metadata: {},
        timestamp: new Date(),
      };

      expect(manager.findMatchingBindings(excluded)).toHaveLength(0);
    });

    it('should filter by channel include/exclude', () => {
      manager.createBinding(channel.id, {
        projectId: 'p1',
        triggerConfig: {
          events: ['channel_message'],
          filters: [{ type: 'channel', include: ['C_ALLOWED'] }],
        },
      });

      const allowed: InboundMessage = {
        id: 'm1',
        channelId: channel.id,
        platformMessageId: 'pm1',
        platformChannelId: 'C_ALLOWED',
        authorId: 'U1',
        authorName: 'user',
        content: 'hi',
        triggerType: 'channel_message',
        metadata: {},
        timestamp: new Date(),
      };

      const disallowed: InboundMessage = {
        ...allowed,
        id: 'm2',
        platformChannelId: 'C_OTHER',
      };

      expect(manager.findMatchingBindings(allowed)).toHaveLength(1);
      expect(manager.findMatchingBindings(disallowed)).toHaveLength(0);
    });

    it('should filter by regex', () => {
      manager.createBinding(channel.id, {
        projectId: 'p1',
        triggerConfig: {
          events: ['channel_message'],
          filters: [{ type: 'regex', include: ['^TICKET-\\d+'] }],
        },
      });

      const matches: InboundMessage = {
        id: 'm1',
        channelId: channel.id,
        platformMessageId: 'pm1',
        platformChannelId: 'C1',
        authorId: 'U1',
        authorName: 'user',
        content: 'TICKET-123 fix the bug',
        triggerType: 'channel_message',
        metadata: {},
        timestamp: new Date(),
      };

      const noMatch: InboundMessage = {
        ...matches,
        id: 'm2',
        content: 'no ticket here',
      };

      expect(manager.findMatchingBindings(matches)).toHaveLength(1);
      expect(manager.findMatchingBindings(noMatch)).toHaveLength(0);
    });

    it('should sort matches by priority descending', () => {
      manager.createBinding(channel.id, {
        projectId: 'p1',
        triggerConfig: { events: ['mention'] },
        priority: 1,
      });
      manager.createBinding(channel.id, {
        projectId: 'p1',
        triggerConfig: { events: ['mention'] },
        priority: 10,
      });

      const message: InboundMessage = {
        id: 'm1',
        channelId: channel.id,
        platformMessageId: 'pm1',
        platformChannelId: 'C1',
        authorId: 'U1',
        authorName: 'user',
        content: 'hi',
        triggerType: 'mention',
        metadata: {},
        timestamp: new Date(),
      };

      const results = manager.findMatchingBindings(message);
      expect(results).toHaveLength(2);
      expect(results[0].priority).toBe(10);
      expect(results[1].priority).toBe(1);
    });
  });

  // ========================================================================
  // Thread Session Management
  // ========================================================================

  describe('getOrCreateThreadSession', () => {
    it('should create a new session', async () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);

      // Insert a project so the FK constraint is satisfied.
      const now = new Date();
      db.insert(schema.projects).values({
        id: 'p1', name: 'Test', workingDirectory: '/tmp/test',
        autoStart: true, createdAt: now, updatedAt: now,
      }).run();

      const channel = await manager.createChannel({
        type: 'slack',
        name: 'Session Test',
        config: {},
        credentials: { botToken: 't', signingSecret: 's' },
      });

      const session = manager.getOrCreateThreadSession(
        channel.id,
        'p1',
        'thread-abc',
        () => 'session-xyz',
      );

      expect(session.channelId).toBe(channel.id);
      expect(session.projectId).toBe('p1');
      expect(session.platformThreadId).toBe('thread-abc');
      expect(session.sessionId).toBe('session-xyz');
    });

    it('should return existing session for same thread', async () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);

      // Insert a project so the FK constraint is satisfied.
      const now = new Date();
      db.insert(schema.projects).values({
        id: 'p1', name: 'Test', workingDirectory: '/tmp/test2',
        autoStart: true, createdAt: now, updatedAt: now,
      }).run();

      const channel = await manager.createChannel({
        type: 'slack',
        name: 'Session Test 2',
        config: {},
        credentials: { botToken: 't', signingSecret: 's' },
      });

      const first = manager.getOrCreateThreadSession(
        channel.id,
        'p1',
        'thread-abc',
        () => 'session-1',
      );

      const second = manager.getOrCreateThreadSession(
        channel.id,
        'p1',
        'thread-abc',
        () => 'session-should-not-be-used',
      );

      expect(second.sessionId).toBe('session-1');
      expect(second.id).toBe(first.id);
    });
  });

  describe('getThreadSession', () => {
    it('should return null when no session exists', async () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);

      const channel = await manager.createChannel({
        type: 'slack',
        name: 'No Session',
        config: {},
        credentials: { botToken: 't', signingSecret: 's' },
      });

      expect(manager.getThreadSession(channel.id, 'nonexistent')).toBeNull();
    });
  });

  // ========================================================================
  // Initialize / Shutdown
  // ========================================================================

  describe('initialize', () => {
    it('should initialize all enabled channels', async () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);

      await manager.createChannel({
        type: 'slack',
        name: 'Enabled 1',
        config: {},
        credentials: { botToken: 't', signingSecret: 's' },
        enabled: true,
      });

      // Reset call count from createChannel
      (adapter.initialize as ReturnType<typeof vi.fn>).mockClear();

      await manager.initialize();
      expect(adapter.initialize).toHaveBeenCalledTimes(1);
    });
  });

  describe('shutdown', () => {
    it('should shutdown all active adapters', async () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);

      await manager.createChannel({
        type: 'slack',
        name: 'Shutdown Test',
        config: {},
        credentials: { botToken: 't', signingSecret: 's' },
      });

      await manager.shutdown();
      expect(adapter.shutdown).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Adapter Management helpers
  // ========================================================================

  describe('getAdapter', () => {
    it('should return registered adapter', () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);
      expect(manager.getAdapter('slack')).toBe(adapter);
    });

    it('should return undefined for unregistered type', () => {
      expect(manager.getAdapter('discord')).toBeUndefined();
    });
  });

  describe('getActiveAdapter', () => {
    it('should return active adapter after channel init', async () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);

      const channel = await manager.createChannel({
        type: 'slack',
        name: 'Active Adapter',
        config: {},
        credentials: { botToken: 't', signingSecret: 's' },
      });

      expect(manager.getActiveAdapter(channel.id)).toBe(adapter);
    });

    it('should return undefined when no active adapter', () => {
      expect(manager.getActiveAdapter('unknown')).toBeUndefined();
    });
  });

  describe('hasEnabledChannels', () => {
    it('should return false when no channels', () => {
      expect(manager.hasEnabledChannels()).toBe(false);
    });

    it('should return true when there is an enabled channel', async () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);

      await manager.createChannel({
        type: 'slack',
        name: 'Has Enabled',
        config: {},
        credentials: { botToken: 't', signingSecret: 's' },
        enabled: true,
      });

      expect(manager.hasEnabledChannels()).toBe(true);
    });

    it('should return false when all channels are disabled', async () => {
      const adapter = makeAdapter();
      manager.registerAdapter(adapter);

      await manager.createChannel({
        type: 'slack',
        name: 'Disabled',
        config: {},
        credentials: { botToken: 't', signingSecret: 's' },
        enabled: false,
      });

      expect(manager.hasEnabledChannels()).toBe(false);
    });
  });
});
