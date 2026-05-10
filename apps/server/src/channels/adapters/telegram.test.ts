import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TelegramAdapter } from './telegram.js';
import type { Channel, WebhookRequest } from '../types.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'ch-tg-1',
    type: 'telegram',
    name: 'Test Telegram',
    config: {
      botUsername: 'testbot',
      allowedChats: [],
    },
    credentials: {
      botToken: '123456:ABC-DEF',
      webhookSecret: 'my-secret-token',
    },
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeTelegramUpdate(overrides: Record<string, unknown> = {}) {
  return {
    update_id: 100001,
    message: {
      message_id: 42,
      from: {
        id: 111,
        is_bot: false,
        first_name: 'Alice',
        last_name: 'Smith',
        username: 'alice',
      },
      chat: {
        id: 222,
        type: 'private' as const,
        first_name: 'Alice',
      },
      date: Math.floor(Date.now() / 1000),
      text: 'Hello bot',
      entities: [],
    },
    ...overrides,
  };
}

describe('TelegramAdapter', () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TelegramAdapter();

    // Mock successful getMe response for initialization
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        result: { id: 999, is_bot: true, first_name: 'TestBot', username: 'testbot' },
      }),
    });
  });

  // ========================================================================
  // Initialize / Shutdown
  // ========================================================================

  describe('initialize', () => {
    it('should call getMe to verify connection', async () => {
      await adapter.initialize(makeChannel());

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bot123456:ABC-DEF/getMe',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should throw if botToken is missing', async () => {
      await expect(
        adapter.initialize(makeChannel({ credentials: {} })),
      ).rejects.toThrow('Telegram bot token is required');
    });

    it('should not throw if getMe fails (warns only)', async () => {
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

    it('should return healthy when getMe succeeds', async () => {
      await adapter.initialize(makeChannel());

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          result: { id: 999, is_bot: true, first_name: 'Bot', username: 'bot' },
        }),
      });

      const result = await adapter.healthCheck();
      expect(result.healthy).toBe(true);
    });

    it('should return unhealthy when getMe returns bad result', async () => {
      await adapter.initialize(makeChannel());

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false }),
      });

      const result = await adapter.healthCheck();
      expect(result.healthy).toBe(false);
    });
  });

  // ========================================================================
  // Webhook handling
  // ========================================================================

  describe('handleWebhook', () => {
    it('should reject when webhook secret does not match', async () => {
      await adapter.initialize(makeChannel());

      const request: WebhookRequest = {
        headers: {
          'x-telegram-bot-api-secret-token': 'wrong-secret',
        },
        body: JSON.stringify(makeTelegramUpdate()),
        rawBody: Buffer.from('{}'),
      };

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(401);
    });

    it('should reject when secret header is missing', async () => {
      await adapter.initialize(makeChannel());

      const request: WebhookRequest = {
        headers: {},
        body: JSON.stringify(makeTelegramUpdate()),
        rawBody: Buffer.from('{}'),
      };

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(401);
    });

    it('should accept when no webhook secret is configured', async () => {
      await adapter.initialize(
        makeChannel({ credentials: { botToken: '123456:ABC-DEF' } }),
      );

      const body = JSON.stringify(makeTelegramUpdate());
      const request: WebhookRequest = {
        headers: {},
        body,
        rawBody: Buffer.from(body),
      };

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
    });

    it('should accept when secret matches', async () => {
      await adapter.initialize(makeChannel());

      const body = JSON.stringify(makeTelegramUpdate());
      const request: WebhookRequest = {
        headers: {
          'x-telegram-bot-api-secret-token': 'my-secret-token',
        },
        body,
        rawBody: Buffer.from(body),
      };

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(200);
    });

    it('should return 400 for invalid JSON', async () => {
      await adapter.initialize(
        makeChannel({ credentials: { botToken: '123456:ABC-DEF' } }),
      );

      const request: WebhookRequest = {
        headers: {},
        body: 'not json',
        rawBody: Buffer.from('not json'),
      };

      const response = await adapter.handleWebhook(request);
      expect(response.status).toBe(400);
    });

    it('should return 400 for missing update_id', async () => {
      await adapter.initialize(
        makeChannel({ credentials: { botToken: '123456:ABC-DEF' } }),
      );

      const body = JSON.stringify({ message: {} });
      const request: WebhookRequest = {
        headers: {},
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
    it('should return null when no message in update', async () => {
      await adapter.initialize(makeChannel());
      expect(adapter.parseMessage({ update_id: 1 })).toBeNull();
    });

    it('should return null for bot messages', async () => {
      await adapter.initialize(makeChannel());
      const update = makeTelegramUpdate();
      update.message.from!.is_bot = true;

      expect(adapter.parseMessage(update)).toBeNull();
    });

    it('should return null for empty text', async () => {
      await adapter.initialize(makeChannel());
      const update = makeTelegramUpdate();
      update.message.text = '';

      expect(adapter.parseMessage(update)).toBeNull();
    });

    it('should parse private message as direct_message', async () => {
      await adapter.initialize(makeChannel());
      const update = makeTelegramUpdate();

      const result = adapter.parseMessage(update);
      expect(result).not.toBeNull();
      expect(result!.triggerType).toBe('direct_message');
      expect(result!.content).toBe('Hello bot');
      expect(result!.authorName).toBe('Alice Smith');
      expect(result!.authorId).toBe('111');
    });

    it('should parse group message as channel_message', async () => {
      await adapter.initialize(makeChannel());

      const update = makeTelegramUpdate();
      update.message.chat = {
        id: 333,
        type: 'group',
        title: 'Test Group',
      };

      const result = adapter.parseMessage(update);
      expect(result).not.toBeNull();
      expect(result!.triggerType).toBe('channel_message');
    });

    it('should detect mention trigger when bot is mentioned', async () => {
      await adapter.initialize(makeChannel());

      const update = makeTelegramUpdate();
      update.message.chat = {
        id: 333,
        type: 'group',
        title: 'Test Group',
      };
      update.message.text = '@testbot what is the time?';
      update.message.entities = [
        { type: 'mention', offset: 0, length: 8 },
      ];

      const result = adapter.parseMessage(update);
      expect(result).not.toBeNull();
      expect(result!.triggerType).toBe('mention');
      // Bot mention should be stripped
      expect(result!.content).not.toContain('@testbot');
    });

    it('should filter by allowedChats', async () => {
      await adapter.initialize(
        makeChannel({
          config: { botUsername: 'testbot', allowedChats: ['999'] },
        }),
      );

      const update = makeTelegramUpdate();
      // chat.id = 222 which is not in allowedChats

      const result = adapter.parseMessage(update);
      expect(result).toBeNull();
    });

    it('should use message_thread_id as platformThreadId for forum topics', async () => {
      await adapter.initialize(makeChannel());

      const update = makeTelegramUpdate();
      update.message.message_thread_id = 555;
      update.message.chat = {
        id: 333,
        type: 'supergroup',
        title: 'Forum',
      };
      update.message.text = '@testbot hello';
      update.message.entities = [{ type: 'mention', offset: 0, length: 8 }];

      const result = adapter.parseMessage(update);
      expect(result).not.toBeNull();
      expect(result!.platformThreadId).toBe('555');
    });

    it('should use reply_to_message.message_id as platformThreadId', async () => {
      await adapter.initialize(makeChannel());

      const update = makeTelegramUpdate();
      update.message.reply_to_message = {
        message_id: 40,
        chat: update.message.chat,
        date: Math.floor(Date.now() / 1000),
      };

      const result = adapter.parseMessage(update);
      expect(result).not.toBeNull();
      expect(result!.platformThreadId).toBe('40');
    });

    it('should handle edited_message', async () => {
      await adapter.initialize(makeChannel());

      const update = {
        update_id: 100002,
        edited_message: {
          message_id: 42,
          from: {
            id: 111,
            is_bot: false,
            first_name: 'Alice',
            username: 'alice',
          },
          chat: { id: 222, type: 'private' as const },
          date: Math.floor(Date.now() / 1000),
          text: 'edited message',
        },
      };

      const result = adapter.parseMessage(update);
      expect(result).not.toBeNull();
      expect(result!.content).toBe('edited message');
      expect(result!.metadata.isEdited).toBe(true);
    });

    it('should use caption for media messages', async () => {
      await adapter.initialize(makeChannel());

      const update = makeTelegramUpdate();
      update.message.text = undefined;
      update.message.caption = 'photo caption';
      update.message.photo = [
        { file_id: 'f1', file_unique_id: 'fu1', width: 100, height: 100 },
      ];

      const result = adapter.parseMessage(update);
      expect(result).not.toBeNull();
      expect(result!.content).toBe('photo caption');
      expect(result!.attachments).toHaveLength(1);
      expect(result!.attachments![0].type).toBe('image');
    });

    it('should handle document attachments', async () => {
      await adapter.initialize(makeChannel());

      const update = makeTelegramUpdate();
      update.message.text = 'here is a file';
      update.message.document = {
        file_id: 'doc-1',
        file_unique_id: 'doc-u-1',
        file_name: 'report.pdf',
        mime_type: 'application/pdf',
      };

      const result = adapter.parseMessage(update);
      expect(result).not.toBeNull();
      expect(result!.attachments).toHaveLength(1);
      expect(result!.attachments![0].type).toBe('file');
      expect(result!.attachments![0].name).toBe('report.pdf');
    });

    it('should convert telegram entities to markdown', async () => {
      await adapter.initialize(makeChannel());

      const update = makeTelegramUpdate();
      update.message.text = 'Hello bold world';
      update.message.entities = [
        { type: 'bold', offset: 6, length: 4 },
      ];

      const result = adapter.parseMessage(update);
      expect(result).not.toBeNull();
      expect(result!.content).toContain('**bold**');
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
        targetChannelId: '222',
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

    it('should send message with MarkdownV2 parse_mode', async () => {
      await adapter.initialize(makeChannel());

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          result: { message_id: 99 },
        }),
      });

      const result = await adapter.sendMessage({
        channelId: 'ch-1',
        content: 'Hello world',
        targetChannelId: '222',
      });

      expect(result.success).toBe(true);
      expect(result.platformMessageId).toBe('99');

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(lastCall[0]).toBe(
        'https://api.telegram.org/bot123456:ABC-DEF/sendMessage',
      );
      const sentBody = JSON.parse(lastCall[1].body);
      expect(sentBody.chat_id).toBe('222');
      expect(sentBody.parse_mode).toBe('MarkdownV2');
    });

    it('should include reply_to_message_id for thread replies', async () => {
      await adapter.initialize(makeChannel());

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          result: { message_id: 100 },
        }),
      });

      await adapter.sendMessage({
        channelId: 'ch-1',
        content: 'reply',
        targetChannelId: '222',
        targetThreadId: '42',
      });

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const sentBody = JSON.parse(lastCall[1].body);
      expect(sentBody.reply_to_message_id).toBe(42);
    });

    it('should retry without parse_mode on MarkdownV2 failure', async () => {
      await adapter.initialize(makeChannel());

      // First attempt with MarkdownV2 fails
      mockFetch.mockRejectedValueOnce(new Error('parse error'));

      // Retry without parse_mode succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          result: { message_id: 101 },
        }),
      });

      const result = await adapter.sendMessage({
        channelId: 'ch-1',
        content: 'problematic_markdown',
        targetChannelId: '222',
      });

      expect(result.success).toBe(true);
      expect(result.platformMessageId).toBe('101');

      // Verify retry was without parse_mode
      const retryCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const retryBody = JSON.parse(retryCall[1].body);
      expect(retryBody.parse_mode).toBeUndefined();
    });

    it('should handle API error', async () => {
      await adapter.initialize(makeChannel());

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: false,
          description: 'Bad Request: chat not found',
        }),
      });

      const result = await adapter.sendMessage({
        channelId: 'ch-1',
        content: 'hello',
        targetChannelId: 'BAD_CHAT',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('chat not found');
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
        platformMessageId: '42',
        platformThreadId: '555',
        platformChannelId: '222',
        authorId: '111',
        authorName: 'Alice',
        content: 'test',
        triggerType: 'direct_message' as const,
        metadata: {},
        timestamp: new Date(),
      };
      expect(adapter.getThreadId(msg)).toBe('555');
    });

    it('should fall back to platformMessageId', () => {
      const msg = {
        id: 'm1',
        channelId: 'ch-1',
        platformMessageId: '42',
        platformChannelId: '222',
        authorId: '111',
        authorName: 'Alice',
        content: 'test',
        triggerType: 'direct_message' as const,
        metadata: {},
        timestamp: new Date(),
      };
      expect(adapter.getThreadId(msg)).toBe('42');
    });
  });

  // ========================================================================
  // Typing indicator
  // ========================================================================

  describe('sendTypingIndicator', () => {
    it('should call sendChatAction API', async () => {
      await adapter.initialize(makeChannel());

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

      await adapter.sendTypingIndicator('222');

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(lastCall[0]).toBe(
        'https://api.telegram.org/bot123456:ABC-DEF/sendChatAction',
      );
      const sentBody = JSON.parse(lastCall[1].body);
      expect(sentBody.action).toBe('typing');
    });

    it('should not throw when not initialized', async () => {
      await expect(adapter.sendTypingIndicator('222')).resolves.toBeUndefined();
    });
  });
});
