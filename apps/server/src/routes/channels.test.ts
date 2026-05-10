import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createChannelRoutes } from './channels.js';
import type { ChannelManager } from '../services/channel-manager.js';
import type { MessageQueueService } from '../services/message-queue.js';

describe('channels routes', () => {
  let app: Hono;
  let mockChannelManager: Partial<ChannelManager>;
  let mockMessageQueue: Partial<MessageQueueService>;

  const testChannel = {
    id: 'ch-1',
    type: 'slack',
    name: 'Test Slack',
    config: { teamId: 'T123' },
    credentials: { botToken: 'xoxb-secret' },
    enabled: true,
    createdAt: '2024-01-01T00:00:00.000Z',
  };

  const testBinding = {
    id: 'bind-1',
    channelId: 'ch-1',
    projectId: 'proj-1',
    triggerConfig: { events: ['message'] },
    createdAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    mockChannelManager = {
      listChannels: vi.fn().mockReturnValue([testChannel]),
      getChannel: vi.fn().mockReturnValue(testChannel),
      createChannel: vi.fn().mockResolvedValue({ ...testChannel, id: 'ch-new' }),
      updateChannel: vi.fn().mockResolvedValue({ ...testChannel, name: 'Updated' }),
      deleteChannel: vi.fn().mockResolvedValue(true),
      getSupportedTypes: vi.fn().mockReturnValue(['slack', 'discord', 'telegram']),
      listBindings: vi.fn().mockReturnValue([testBinding]),
      getBinding: vi.fn().mockReturnValue(testBinding),
      createBinding: vi.fn().mockReturnValue({ ...testBinding, id: 'bind-new' }),
      updateBinding: vi.fn().mockReturnValue({ ...testBinding, triggerConfig: { events: ['message', 'reaction'] } }),
      deleteBinding: vi.fn().mockReturnValue(true),
    };

    mockMessageQueue = {
      enqueueOutbound: vi.fn().mockReturnValue({ id: 'msg-1', status: 'pending' }),
      getStats: vi.fn().mockReturnValue({ pending: 0, processing: 0, completed: 5, failed: 1 }),
      listMessages: vi.fn().mockReturnValue([]),
    };

    app = new Hono();
    const routes = createChannelRoutes(
      mockChannelManager as ChannelManager,
      mockMessageQueue as MessageQueueService,
    );
    app.route('/channels', routes);
  });

  // ==========================================================================
  // Channel CRUD
  // ==========================================================================

  describe('GET /channels', () => {
    it('should list all channels with masked credentials', async () => {
      const res = await app.request('/channels');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.channels).toHaveLength(1);
      expect(body.channels[0].credentials).toEqual({ configured: true });
      expect(body.channels[0].name).toBe('Test Slack');
    });

    it('should return empty array when no channels exist', async () => {
      (mockChannelManager.listChannels as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const res = await app.request('/channels');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.channels).toEqual([]);
    });
  });

  describe('POST /channels', () => {
    it('should create a new channel', async () => {
      const res = await app.request('/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'slack',
          name: 'New Slack',
          config: { teamId: 'T456' },
          credentials: { botToken: 'xoxb-new' },
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBe('ch-new');
      expect(body.credentials).toEqual({ configured: true });
    });

    it('should return 400 when type is missing', async () => {
      const res = await app.request('/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', config: {}, credentials: {} }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('type');
    });

    it('should return 400 when name is missing', async () => {
      const res = await app.request('/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'slack', config: {}, credentials: {} }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('name is required');
    });

    it('should return 400 when config is missing', async () => {
      const res = await app.request('/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'slack', name: 'Test', credentials: {} }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('config is required');
    });

    it('should return 400 when credentials is missing', async () => {
      const res = await app.request('/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'slack', name: 'Test', config: {} }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('credentials is required');
    });

    it('should return 400 for unsupported channel type', async () => {
      const res = await app.request('/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'unsupported',
          name: 'Test',
          config: {},
          credentials: {},
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      // Zod enum validation catches invalid types before the route handler
      expect(body.error).toContain('type');
    });

    it('should return 400 when createChannel throws', async () => {
      (mockChannelManager.createChannel as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Duplicate channel'),
      );

      const res = await app.request('/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'slack',
          name: 'Test',
          config: {},
          credentials: {},
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Duplicate channel');
    });
  });

  describe('GET /channels/:id', () => {
    it('should get channel by id with masked credentials', async () => {
      const res = await app.request('/channels/ch-1');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe('ch-1');
      expect(body.credentials).toEqual({ configured: true });
    });

    it('should return 404 when channel not found', async () => {
      (mockChannelManager.getChannel as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await app.request('/channels/non-existent');

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Channel not found');
    });
  });

  describe('PATCH /channels/:id', () => {
    it('should update a channel', async () => {
      const res = await app.request('/channels/ch-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.credentials).toEqual({ configured: true });
    });

    it('should return 404 when channel not found', async () => {
      (mockChannelManager.updateChannel as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/channels/non-existent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Channel not found');
    });

    it('should return 400 when updateChannel throws', async () => {
      (mockChannelManager.updateChannel as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Update failed'),
      );

      const res = await app.request('/channels/ch-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Update failed');
    });
  });

  describe('DELETE /channels/:id', () => {
    it('should delete a channel', async () => {
      const res = await app.request('/channels/ch-1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it('should return 404 when channel not found', async () => {
      (mockChannelManager.deleteChannel as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const res = await app.request('/channels/non-existent', { method: 'DELETE' });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Channel not found');
    });
  });

  // ==========================================================================
  // Binding CRUD
  // ==========================================================================

  describe('GET /channels/:id/bindings', () => {
    it('should list bindings for a channel', async () => {
      const res = await app.request('/channels/ch-1/bindings');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.bindings).toHaveLength(1);
    });

    it('should return 404 when channel not found', async () => {
      (mockChannelManager.getChannel as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await app.request('/channels/non-existent/bindings');

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Channel not found');
    });
  });

  describe('POST /channels/:id/bindings', () => {
    it('should create a binding', async () => {
      const res = await app.request('/channels/ch-1/bindings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'proj-1',
          triggerConfig: { events: ['mention'] },
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBe('bind-new');
    });

    it('should return 400 when projectId is missing', async () => {
      const res = await app.request('/channels/ch-1/bindings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          triggerConfig: { events: ['mention'] },
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('projectId is required');
    });

    it('should return 400 when triggerConfig is missing', async () => {
      const res = await app.request('/channels/ch-1/bindings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'proj-1',
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('triggerConfig is required');
    });

    it('should return 400 when triggerConfig.events is empty', async () => {
      const res = await app.request('/channels/ch-1/bindings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'proj-1',
          triggerConfig: { events: [] },
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('triggerConfig.events must not be empty');
    });

    it('should return 404 when createBinding throws with not found', async () => {
      (mockChannelManager.createBinding as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Channel not found');
      });

      const res = await app.request('/channels/ch-1/bindings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'proj-1',
          triggerConfig: { events: ['mention'] },
        }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /channels/:id/bindings/:bindingId', () => {
    it('should get a specific binding', async () => {
      const res = await app.request('/channels/ch-1/bindings/bind-1');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe('bind-1');
    });

    it('should return 404 when binding not found', async () => {
      (mockChannelManager.getBinding as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await app.request('/channels/ch-1/bindings/non-existent');

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Binding not found');
    });
  });

  describe('PATCH /channels/:id/bindings/:bindingId', () => {
    it('should update a binding', async () => {
      const res = await app.request('/channels/ch-1/bindings/bind-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerConfig: { events: ['mention', 'reaction'] } }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.triggerConfig.events).toContain('reaction');
    });

    it('should return 404 when binding not found', async () => {
      (mockChannelManager.updateBinding as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await app.request('/channels/ch-1/bindings/non-existent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerConfig: { events: ['mention'] } }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Binding not found');
    });
  });

  describe('DELETE /channels/:id/bindings/:bindingId', () => {
    it('should delete a binding', async () => {
      const res = await app.request('/channels/ch-1/bindings/bind-1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it('should return 404 when binding not found', async () => {
      (mockChannelManager.deleteBinding as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const res = await app.request('/channels/ch-1/bindings/non-existent', { method: 'DELETE' });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Binding not found');
    });
  });

  // ==========================================================================
  // Outbound messaging
  // ==========================================================================

  describe('POST /channels/:id/send', () => {
    it('should send an outbound message', async () => {
      const res = await app.request('/channels/ch-1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Hello!',
          targetChannelId: 'C123',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.messageId).toBe('msg-1');
      expect(body.status).toBe('pending');
    });

    it('should return 404 when channel not found', async () => {
      (mockChannelManager.getChannel as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await app.request('/channels/non-existent/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello!', targetChannelId: 'C123' }),
      });

      expect(res.status).toBe(404);
    });

    it('should return 400 when content is missing', async () => {
      const res = await app.request('/channels/ch-1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetChannelId: 'C123' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('content is required');
    });

    it('should return 400 when neither targetChannelId nor targetUserId is provided', async () => {
      const res = await app.request('/channels/ch-1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello!' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('targetChannelId or targetUserId is required');
    });
  });

  // ==========================================================================
  // Message queue status
  // ==========================================================================

  describe('GET /channels/:id/queue', () => {
    it('should get queue stats for a channel', async () => {
      const res = await app.request('/channels/ch-1/queue');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.stats).toBeDefined();
      expect(body.stats.pending).toBe(0);
    });

    it('should return 404 when channel not found', async () => {
      (mockChannelManager.getChannel as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await app.request('/channels/non-existent/queue');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /channels/:id/queue/messages', () => {
    it('should list messages in queue', async () => {
      const res = await app.request('/channels/ch-1/queue/messages');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.messages).toBeDefined();
    });

    it('should return 404 when channel not found', async () => {
      (mockChannelManager.getChannel as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await app.request('/channels/non-existent/queue/messages');

      expect(res.status).toBe(404);
    });

    it('should pass query params to listMessages', async () => {
      await app.request('/channels/ch-1/queue/messages?status=pending&direction=inbound&limit=10');

      expect(mockMessageQueue.listMessages).toHaveBeenCalledWith('ch-1', {
        status: 'pending',
        direction: 'inbound',
        limit: 10,
      });
    });
  });
});
