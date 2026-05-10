import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHmac } from 'crypto';
import { SlackAdapter } from './slack.js';
import type { Channel, WebhookRequest, OutboundMessage } from '../types.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'ch-1',
    type: 'slack',
    name: 'Test Slack',
    config: {
      workspaceId: 'W123',
      workspaceName: 'Test Workspace',
      botUserId: 'U_BOT',
      allowedChannels: [],
    },
    credentials: {
      botToken: 'xoxb-test-token',
      signingSecret: 'test-signing-secret',
    },
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createSignedRequest(body: string, signingSecret: string): WebhookRequest {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sigBasestring = `v0:${timestamp}:${body}`;
  const signature =
    'v0=' + createHmac('sha256', signingSecret).update(sigBasestring).digest('hex');

  return {
    headers: {
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': signature,
      'content-type': 'application/json',
    },
    body,
    rawBody: Buffer.from(body),
  };
}

describe('SlackAdapter', () => {
  let adapter: SlackAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new SlackAdapter();
    // Mock successful auth.test response for initialization
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, team: 'TestTeam', user: 'testbot' }),
    });
  });

  // ========================================================================
  // Initialize / Shutdown
  // ========================================================================

  describe('initialize', () => {
    it('should store channel data and call auth.test', async () => {
      await adapter.initialize(makeChannel());

      expect(mockFetch).toHaveBeenCalledWith(
        'https://slack.com/api/auth.test',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer xoxb-test-token',
          }),
        }),
      );
    });

    it('should throw if botToken is missing', async () => {
      const channel = makeChannel({
        credentials: { signingSecret: 'sec' },
      });
      await expect(adapter.initialize(channel)).rejects.toThrow(
        'Slack bot token is required',
      );
    });

    it('should throw if signingSecret is missing', async () => {
      const channel = makeChannel({
        credentials: { botToken: 'tok' },
      });
      await expect(adapter.initialize(channel)).rejects.toThrow(
        'Slack signing secret is required',
      );
    });

    it('should not throw if auth.test fails (warns only)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      await expect(adapter.initialize(makeChannel())).resolves.toBeUndefined();
    });
  });

  describe('shutdown', () => {
    it('should clear internal state', async () => {
      await adapter.initialize(makeChannel());
      await adapter.shutdown();

      // healthCheck should return not initialized
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

    it('should return healthy when auth.test succeeds', async () => {
      await adapter.initialize(makeChannel());
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, team: 'T', user: 'U' }),
      });

      const result = await adapter.healthCheck();
      expect(result.healthy).toBe(true);
    });

    it('should return unhealthy when auth.test fails', async () => {
      await adapter.initialize(makeChannel());
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false, error: 'invalid_auth' }),
      });

      const result = await adapter.healthCheck();
      expect(result.healthy).toBe(false);
    });
  });

  // ========================================================================
  // Webhook handling
  // ========================================================================

  describe('handleWebhook', () => {
    it('should reject invalid signature', async () => {
      await adapter.initialize(makeChannel());

      const request: WebhookRequest = {
        headers: {
          'x-slack-request-timestamp': '0',
          'x-slack-signature': 'v0=invalid',
        },
        body: '{}',
        rawBody: Buffer.from('{}'),
      };

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(401);
    });

    it('should respond to url_verification challenge', async () => {
      const signingSecret = 'test-signing-secret';
      await adapter.initialize(makeChannel());

      const body = JSON.stringify({
        type: 'url_verification',
        challenge: 'test-challenge-value',
      });

      const request = createSignedRequest(body, signingSecret);
      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(200);
      expect((response.body as Record<string, unknown>).challenge).toBe('test-challenge-value');
    });

    it('should acknowledge event_callback with 200', async () => {
      const signingSecret = 'test-signing-secret';
      await adapter.initialize(makeChannel());

      const body = JSON.stringify({
        type: 'event_callback',
        event: {
          type: 'app_mention',
          user: 'U123',
          text: '<@U_BOT> hello',
          channel: 'C123',
          ts: '1234567890.123456',
        },
      });

      const request = createSignedRequest(body, signingSecret);
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

    it('should reject stale timestamps (replay attack protection)', async () => {
      const signingSecret = 'test-signing-secret';
      await adapter.initialize(makeChannel());

      const body = '{}';
      const staleTimestamp = String(Math.floor(Date.now() / 1000) - 600); // 10 min ago
      const sigBasestring = `v0:${staleTimestamp}:${body}`;
      const signature =
        'v0=' +
        createHmac('sha256', signingSecret).update(sigBasestring).digest('hex');

      const request: WebhookRequest = {
        headers: {
          'x-slack-request-timestamp': staleTimestamp,
          'x-slack-signature': signature,
        },
        body,
        rawBody: Buffer.from(body),
      };

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(401);
    });

    it('should return 400 for invalid JSON', async () => {
      const signingSecret = 'test-signing-secret';
      await adapter.initialize(makeChannel());

      const body = 'not json';
      const request = createSignedRequest(body, signingSecret);
      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(400);
    });
  });

  // ========================================================================
  // parseMessage
  // ========================================================================

  describe('parseMessage', () => {
    it('should return null for non-event_callback', async () => {
      await adapter.initialize(makeChannel());
      expect(adapter.parseMessage({ type: 'url_verification' })).toBeNull();
    });

    it('should return null for bot messages', async () => {
      await adapter.initialize(makeChannel());
      const result = adapter.parseMessage({
        type: 'event_callback',
        event: {
          type: 'message',
          bot_id: 'B123',
          text: 'hello',
          channel: 'C1',
          ts: '1234.5678',
        },
      });
      expect(result).toBeNull();
    });

    it('should return null for bot_message subtype', async () => {
      await adapter.initialize(makeChannel());
      const result = adapter.parseMessage({
        type: 'event_callback',
        event: {
          type: 'message',
          subtype: 'bot_message',
          text: 'hello',
          channel: 'C1',
          ts: '1234.5678',
        },
      });
      expect(result).toBeNull();
    });

    it('should return null for message_changed subtype', async () => {
      await adapter.initialize(makeChannel());
      const result = adapter.parseMessage({
        type: 'event_callback',
        event: {
          type: 'message',
          subtype: 'message_changed',
          text: 'hello',
          channel: 'C1',
          ts: '1234.5678',
        },
      });
      expect(result).toBeNull();
    });

    it('should parse app_mention as mention trigger', async () => {
      await adapter.initialize(makeChannel());

      const result = adapter.parseMessage({
        type: 'event_callback',
        team_id: 'T123',
        event: {
          type: 'app_mention',
          user: 'U_USER',
          text: '<@U_BOT> what is the weather?',
          channel: 'C123',
          ts: '1234.5678',
          event_ts: '1234.5678',
        },
      });

      expect(result).not.toBeNull();
      expect(result!.triggerType).toBe('mention');
      expect(result!.authorId).toBe('U_USER');
      // Bot mention should be stripped
      expect(result!.content).not.toContain('<@U_BOT>');
    });

    it('should parse DM as direct_message trigger', async () => {
      await adapter.initialize(makeChannel());

      const result = adapter.parseMessage({
        type: 'event_callback',
        event: {
          type: 'message',
          user: 'U_USER',
          text: 'hello bot',
          channel: 'D123',
          channel_type: 'im',
          ts: '1234.5678',
          event_ts: '1234.5678',
        },
      });

      expect(result).not.toBeNull();
      expect(result!.triggerType).toBe('direct_message');
    });

    it('should parse channel message as channel_message trigger', async () => {
      await adapter.initialize(makeChannel());

      const result = adapter.parseMessage({
        type: 'event_callback',
        event: {
          type: 'message',
          user: 'U_USER',
          text: 'general chat',
          channel: 'C123',
          channel_type: 'channel',
          ts: '1234.5678',
          event_ts: '1234.5678',
        },
      });

      expect(result).not.toBeNull();
      expect(result!.triggerType).toBe('channel_message');
    });

    it('should filter by allowedChannels', async () => {
      await adapter.initialize(
        makeChannel({
          config: {
            workspaceId: 'W1',
            botUserId: 'U_BOT',
            allowedChannels: ['C_ALLOWED'],
          },
        }),
      );

      const result = adapter.parseMessage({
        type: 'event_callback',
        event: {
          type: 'message',
          user: 'U_USER',
          text: 'test',
          channel: 'C_NOT_ALLOWED',
          channel_type: 'channel',
          ts: '1.2',
          event_ts: '1.2',
        },
      });

      expect(result).toBeNull();
    });

    it('should use thread_ts as platformThreadId', async () => {
      await adapter.initialize(makeChannel());

      const result = adapter.parseMessage({
        type: 'event_callback',
        event: {
          type: 'message',
          user: 'U_USER',
          text: 'reply in thread',
          channel: 'C123',
          ts: '1234.9999',
          thread_ts: '1234.0000',
          event_ts: '1234.9999',
        },
      });

      expect(result).not.toBeNull();
      expect(result!.platformThreadId).toBe('1234.0000');
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
        targetChannelId: 'C123',
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
      expect(result.error).toContain('No target');
    });

    it('should send message to channel', async () => {
      await adapter.initialize(makeChannel());

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, ts: '1234.5678' }),
      });

      const result = await adapter.sendMessage({
        channelId: 'ch-1',
        content: 'Hello **world**',
        targetChannelId: 'C123',
      });

      expect(result.success).toBe(true);
      expect(result.platformMessageId).toBe('1234.5678');

      // Verify the fetch call
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(lastCall[0]).toBe('https://slack.com/api/chat.postMessage');
      const sentBody = JSON.parse(lastCall[1].body);
      expect(sentBody.channel).toBe('C123');
    });

    it('should include thread_ts when targetThreadId is set', async () => {
      await adapter.initialize(makeChannel());

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, ts: '1234.5678' }),
      });

      await adapter.sendMessage({
        channelId: 'ch-1',
        content: 'reply',
        targetChannelId: 'C123',
        targetThreadId: '1234.0000',
      });

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const sentBody = JSON.parse(lastCall[1].body);
      expect(sentBody.thread_ts).toBe('1234.0000');
    });

    it('should return error on Slack API failure', async () => {
      await adapter.initialize(makeChannel());

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false, error: 'channel_not_found' }),
      });

      const result = await adapter.sendMessage({
        channelId: 'ch-1',
        content: 'hello',
        targetChannelId: 'C_BAD',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('channel_not_found');
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
        platformMessageId: '1234.9999',
        platformThreadId: '1234.0000',
        platformChannelId: 'C1',
        authorId: 'U1',
        authorName: 'user',
        content: 'test',
        triggerType: 'mention' as const,
        metadata: {},
        timestamp: new Date(),
      };
      expect(adapter.getThreadId(msg)).toBe('1234.0000');
    });

    it('should fall back to platformMessageId', () => {
      const msg = {
        id: 'm1',
        channelId: 'ch-1',
        platformMessageId: '1234.9999',
        platformChannelId: 'C1',
        authorId: 'U1',
        authorName: 'user',
        content: 'test',
        triggerType: 'mention' as const,
        metadata: {},
        timestamp: new Date(),
      };
      expect(adapter.getThreadId(msg)).toBe('1234.9999');
    });
  });

  // ========================================================================
  // Reactions
  // ========================================================================

  describe('addReaction / removeReaction', () => {
    it('should call reactions.add API', async () => {
      await adapter.initialize(makeChannel());
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

      await adapter.addReaction('C123', '1234.5678', 'eyes');

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(lastCall[0]).toBe('https://slack.com/api/reactions.add');
    });

    it('should call reactions.remove API', async () => {
      await adapter.initialize(makeChannel());
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

      await adapter.removeReaction('C123', '1234.5678', 'eyes');

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(lastCall[0]).toBe('https://slack.com/api/reactions.remove');
    });

    it('should not throw when not initialized', async () => {
      await expect(
        adapter.addReaction('C1', '1.2', 'ok'),
      ).resolves.toBeUndefined();
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
        json: async () => ({
          ok: true,
          user: { id: 'U123', name: 'testuser', real_name: 'Test User' },
        }),
      });

      const user1 = await adapter.getUserInfo('U123');
      expect(user1).toEqual({
        id: 'U123',
        name: 'testuser',
        real_name: 'Test User',
      });

      // Second call should use cache (no new fetch)
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
