import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiscordAdapter } from './discord.js';
import type { Channel, WebhookRequest } from '../types.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock crypto.verify - we'll control it for signature tests
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  return {
    ...actual,
    verify: vi.fn().mockReturnValue(true),
  };
});

import { verify } from 'crypto';
const mockVerify = vi.mocked(verify);

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'ch-discord-1',
    type: 'discord',
    name: 'Test Discord',
    config: {
      applicationId: 'APP_123',
      guildId: 'GUILD_456',
      botUserId: 'BOT_789',
      allowedChannels: [],
    },
    credentials: {
      botToken: 'discord-bot-token',
      publicKey: 'abcd1234'.repeat(8), // 64-char hex = 32 bytes
    },
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('DiscordAdapter', () => {
  let adapter: DiscordAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new DiscordAdapter();

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'BOT_789', username: 'testbot' }),
    });

    // Default: signature verification passes
    mockVerify.mockReturnValue(true);
  });

  // ========================================================================
  // Initialize / Shutdown
  // ========================================================================

  describe('initialize', () => {
    it('should call /users/@me to verify connection', async () => {
      await adapter.initialize(makeChannel());

      expect(mockFetch).toHaveBeenCalledWith(
        'https://discord.com/api/v10/users/@me',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bot discord-bot-token',
          }),
        }),
      );
    });

    it('should throw if botToken is missing', async () => {
      await expect(
        adapter.initialize(makeChannel({ credentials: { publicKey: 'abc' } })),
      ).rejects.toThrow('Discord bot token is required');
    });

    it('should throw if publicKey is missing', async () => {
      await expect(
        adapter.initialize(makeChannel({ credentials: { botToken: 'tok' } })),
      ).rejects.toThrow('Discord public key is required');
    });

    it('should not throw if /users/@me fails (warns only)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      await expect(adapter.initialize(makeChannel())).resolves.toBeUndefined();
    });
  });

  describe('shutdown', () => {
    it('should clear internal state', async () => {
      await adapter.initialize(makeChannel());
      await adapter.shutdown();

      const health = await adapter.healthCheck();
      expect(health.healthy).toBe(false);
      expect(health.message).toBe('Not initialized');
    });
  });

  // ========================================================================
  // Health check
  // ========================================================================

  describe('healthCheck', () => {
    it('should return unhealthy when not initialized', async () => {
      const result = await adapter.healthCheck();
      expect(result.healthy).toBe(false);
    });

    it('should return healthy when API responds', async () => {
      await adapter.initialize(makeChannel());
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'BOT', username: 'bot' }),
      });

      const result = await adapter.healthCheck();
      expect(result.healthy).toBe(true);
    });
  });

  // ========================================================================
  // Webhook handling
  // ========================================================================

  describe('handleWebhook', () => {
    it('should reject when signature verification fails', async () => {
      await adapter.initialize(makeChannel());
      mockVerify.mockReturnValue(false);

      const request: WebhookRequest = {
        headers: {
          'x-signature-ed25519': 'badsig',
          'x-signature-timestamp': '12345',
        },
        body: '{}',
        rawBody: Buffer.from('{}'),
      };

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(401);
    });

    it('should respond to PING interaction', async () => {
      await adapter.initialize(makeChannel());

      const body = JSON.stringify({ type: 1 });
      const request: WebhookRequest = {
        headers: {
          'x-signature-ed25519': 'validsig',
          'x-signature-timestamp': '12345',
        },
        body,
        rawBody: Buffer.from(body),
      };

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
      expect((response.body as Record<string, unknown>).type).toBe(1); // PONG
    });

    it('should acknowledge message events with 200', async () => {
      await adapter.initialize(makeChannel());

      const body = JSON.stringify({
        t: 'MESSAGE_CREATE',
        d: {
          id: 'msg-1',
          channel_id: 'C1',
          author: { id: 'U1', username: 'user' },
          content: 'hello',
          timestamp: new Date().toISOString(),
          type: 0,
        },
      });

      const request: WebhookRequest = {
        headers: {
          'x-signature-ed25519': 'validsig',
          'x-signature-timestamp': '12345',
        },
        body,
        rawBody: Buffer.from(body),
      };

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
    });

    it('should reject missing signature headers', async () => {
      await adapter.initialize(makeChannel());

      const request: WebhookRequest = {
        headers: {},
        body: '{}',
        rawBody: Buffer.from('{}'),
      };

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(401);
    });

    it('should return 400 for invalid JSON', async () => {
      await adapter.initialize(makeChannel());

      const body = 'not json';
      const request: WebhookRequest = {
        headers: {
          'x-signature-ed25519': 'validsig',
          'x-signature-timestamp': '12345',
        },
        body,
        rawBody: Buffer.from(body),
      };

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(400);
    });
  });

  // ========================================================================
  // parseMessage
  // ========================================================================

  describe('parseMessage', () => {
    it('should return null for PING interaction', async () => {
      await adapter.initialize(makeChannel());
      expect(adapter.parseMessage({ type: 1 })).toBeNull();
    });

    it('should return null for bot messages', async () => {
      await adapter.initialize(makeChannel());
      const result = adapter.parseMessage({
        t: 'MESSAGE_CREATE',
        d: {
          id: 'msg-1',
          channel_id: 'C1',
          author: { id: 'U1', username: 'bot', bot: true },
          content: 'hello',
          timestamp: new Date().toISOString(),
          type: 0,
        },
      });
      expect(result).toBeNull();
    });

    it('should parse gateway-style MESSAGE_CREATE', async () => {
      await adapter.initialize(makeChannel());

      const result = adapter.parseMessage({
        t: 'MESSAGE_CREATE',
        d: {
          id: 'msg-1',
          channel_id: 'C_CHAN',
          guild_id: 'G1',
          author: { id: 'U1', username: 'alice' },
          content: 'Hello world',
          timestamp: '2024-01-01T00:00:00.000Z',
          type: 0,
        },
      });

      expect(result).not.toBeNull();
      expect(result!.platformMessageId).toBe('msg-1');
      expect(result!.authorName).toBe('alice');
      expect(result!.content).toBe('Hello world');
      expect(result!.triggerType).toBe('channel_message');
    });

    it('should detect mention trigger when bot is mentioned', async () => {
      await adapter.initialize(makeChannel());

      const result = adapter.parseMessage({
        t: 'MESSAGE_CREATE',
        d: {
          id: 'msg-2',
          channel_id: 'C1',
          guild_id: 'G1',
          author: { id: 'U1', username: 'alice' },
          content: '<@BOT_789> help me',
          timestamp: '2024-01-01T00:00:00.000Z',
          mentions: [{ id: 'BOT_789', username: 'testbot', bot: true }],
          type: 0,
        },
      });

      expect(result).not.toBeNull();
      expect(result!.triggerType).toBe('mention');
      // Bot mention should be stripped
      expect(result!.content).not.toContain('<@BOT_789>');
    });

    it('should detect DM trigger when no guild_id', async () => {
      await adapter.initialize(makeChannel());

      const result = adapter.parseMessage({
        t: 'MESSAGE_CREATE',
        d: {
          id: 'msg-3',
          channel_id: 'DM_CHAN',
          author: { id: 'U1', username: 'alice' },
          content: 'private message',
          timestamp: '2024-01-01T00:00:00.000Z',
          type: 0,
        },
      });

      expect(result).not.toBeNull();
      expect(result!.triggerType).toBe('direct_message');
    });

    it('should parse direct message payloads (no gateway wrapper)', async () => {
      await adapter.initialize(makeChannel());

      const result = adapter.parseMessage({
        id: 'msg-direct',
        channel_id: 'C1',
        guild_id: 'G1',
        author: { id: 'U1', username: 'bob' },
        content: 'direct payload',
        timestamp: '2024-01-01T00:00:00.000Z',
        type: 0,
      });

      expect(result).not.toBeNull();
      expect(result!.platformMessageId).toBe('msg-direct');
    });

    it('should filter by allowedChannels', async () => {
      await adapter.initialize(
        makeChannel({
          config: {
            applicationId: 'APP',
            botUserId: 'BOT_789',
            allowedChannels: ['C_ALLOWED'],
          },
        }),
      );

      const result = adapter.parseMessage({
        t: 'MESSAGE_CREATE',
        d: {
          id: 'msg-4',
          channel_id: 'C_OTHER',
          guild_id: 'G1',
          author: { id: 'U1', username: 'alice' },
          content: 'test',
          timestamp: '2024-01-01T00:00:00.000Z',
          type: 0,
        },
      });

      expect(result).toBeNull();
    });

    it('should convert Discord markdown (user mentions)', async () => {
      await adapter.initialize(makeChannel());

      const result = adapter.parseMessage({
        t: 'MESSAGE_CREATE',
        d: {
          id: 'msg-5',
          channel_id: 'C1',
          guild_id: 'G1',
          author: { id: 'U1', username: 'alice' },
          content: 'Hey <@123456789> check <#999> and ||spoiler||',
          timestamp: '2024-01-01T00:00:00.000Z',
          type: 0,
        },
      });

      expect(result).not.toBeNull();
      expect(result!.content).toContain('@user');
      expect(result!.content).toContain('#channel');
      expect(result!.content).not.toContain('||');
    });

    it('should map attachments', async () => {
      await adapter.initialize(makeChannel());

      const result = adapter.parseMessage({
        t: 'MESSAGE_CREATE',
        d: {
          id: 'msg-6',
          channel_id: 'C1',
          guild_id: 'G1',
          author: { id: 'U1', username: 'alice' },
          content: 'attached',
          timestamp: '2024-01-01T00:00:00.000Z',
          type: 0,
          attachments: [
            {
              id: 'att-1',
              filename: 'photo.png',
              url: 'https://cdn.discord.com/photo.png',
              content_type: 'image/png',
              size: 1024,
            },
          ],
        },
      });

      expect(result).not.toBeNull();
      expect(result!.attachments).toHaveLength(1);
      expect(result!.attachments![0].type).toBe('image');
    });

    it('should return null for unrecognized payload', async () => {
      await adapter.initialize(makeChannel());
      expect(adapter.parseMessage({ something: 'else' })).toBeNull();
    });
  });

  // ========================================================================
  // sendMessage
  // ========================================================================

  describe('sendMessage', () => {
    it('should return error when not initialized', async () => {
      const result = await adapter.sendMessage({
        channelId: 'ch-1',
        content: 'hello',
        targetChannelId: 'C1',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Not initialized');
    });

    it('should return error when no target specified', async () => {
      await adapter.initialize(makeChannel());
      const result = await adapter.sendMessage({
        channelId: 'ch-1',
        content: 'hello',
      });
      expect(result.success).toBe(false);
    });

    it('should send message to channel', async () => {
      await adapter.initialize(makeChannel());

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'sent-msg-1' }),
      });

      const result = await adapter.sendMessage({
        channelId: 'ch-1',
        content: 'Hello!',
        targetChannelId: 'C_TARGET',
      });

      expect(result.success).toBe(true);
      expect(result.platformMessageId).toBe('sent-msg-1');

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(lastCall[0]).toBe(
        'https://discord.com/api/v10/channels/C_TARGET/messages',
      );
    });

    it('should include message_reference for thread replies', async () => {
      await adapter.initialize(makeChannel());

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'sent-msg-2' }),
      });

      await adapter.sendMessage({
        channelId: 'ch-1',
        content: 'reply',
        targetChannelId: 'C1',
        targetThreadId: 'parent-msg-id',
      });

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const sentBody = JSON.parse(lastCall[1].body);
      expect(sentBody.message_reference.message_id).toBe('parent-msg-id');
    });

    it('should create DM channel when targeting user', async () => {
      await adapter.initialize(makeChannel());

      // First call creates DM channel
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'DM_CHANNEL_ID' }),
      });

      // Second call sends the message
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'sent-dm-1' }),
      });

      const result = await adapter.sendMessage({
        channelId: 'ch-1',
        content: 'DM content',
        targetUserId: 'USER_TARGET',
      });

      expect(result.success).toBe(true);

      // Verify DM channel creation was called
      const dmCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 2];
      expect(dmCall[0]).toBe('https://discord.com/api/v10/users/@me/channels');
    });

    it('should truncate messages over 2000 chars', async () => {
      await adapter.initialize(makeChannel());

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'long-msg' }),
      });

      const longContent = 'a'.repeat(2500);
      await adapter.sendMessage({
        channelId: 'ch-1',
        content: longContent,
        targetChannelId: 'C1',
      });

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const sentBody = JSON.parse(lastCall[1].body);
      expect(sentBody.content.length).toBe(2000);
      expect(sentBody.content.endsWith('...')).toBe(true);
    });

    it('should handle API errors', async () => {
      await adapter.initialize(makeChannel());

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => 'Missing access',
      });

      const result = await adapter.sendMessage({
        channelId: 'ch-1',
        content: 'hello',
        targetChannelId: 'C1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('403');
    });
  });

  // ========================================================================
  // getThreadId
  // ========================================================================

  describe('getThreadId', () => {
    it('should return platformThreadId if present', () => {
      const msg = {
        id: 'm1',
        channelId: 'ch-1',
        platformMessageId: 'msg-1',
        platformThreadId: 'thread-1',
        platformChannelId: 'C1',
        authorId: 'U1',
        authorName: 'user',
        content: 'test',
        triggerType: 'mention' as const,
        metadata: {},
        timestamp: new Date(),
      };
      expect(adapter.getThreadId(msg)).toBe('thread-1');
    });

    it('should fall back to platformMessageId', () => {
      const msg = {
        id: 'm1',
        channelId: 'ch-1',
        platformMessageId: 'msg-1',
        platformChannelId: 'C1',
        authorId: 'U1',
        authorName: 'user',
        content: 'test',
        triggerType: 'mention' as const,
        metadata: {},
        timestamp: new Date(),
      };
      expect(adapter.getThreadId(msg)).toBe('msg-1');
    });
  });

  // ========================================================================
  // Typing indicator
  // ========================================================================

  describe('sendTypingIndicator', () => {
    it('should POST to typing endpoint', async () => {
      await adapter.initialize(makeChannel());
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });

      await adapter.sendTypingIndicator('C123');

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(lastCall[0]).toBe('https://discord.com/api/v10/channels/C123/typing');
    });

    it('should not throw when not initialized', async () => {
      await expect(adapter.sendTypingIndicator('C1')).resolves.toBeUndefined();
    });
  });

  // ========================================================================
  // getUserInfo
  // ========================================================================

  describe('getUserInfo', () => {
    it('should fetch user info and cache it', async () => {
      await adapter.initialize(makeChannel());

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'U123',
          username: 'alice',
          discriminator: '1234',
        }),
      });

      const user1 = await adapter.getUserInfo('U123');
      expect(user1).toEqual({ id: 'U123', username: 'alice', discriminator: '1234' });

      // Second call should use cache
      const callsBefore = mockFetch.mock.calls.length;
      const user2 = await adapter.getUserInfo('U123');
      expect(user2).toEqual(user1);
      expect(mockFetch.mock.calls.length).toBe(callsBefore);
    });

    it('should return null on API failure', async () => {
      await adapter.initialize(makeChannel());
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const user = await adapter.getUserInfo('U_BAD');
      expect(user).toBeNull();
    });
  });
});
