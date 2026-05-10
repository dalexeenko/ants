/**
 * TelegramAdapter - Implements ChannelAdapter for Telegram Bot integration
 *
 * Handles:
 * - Webhook secret token verification (X-Telegram-Bot-Api-Secret-Token header)
 * - Message updates (mentions, DMs, group messages)
 * - Message sending via Telegram Bot API
 * - Reply threading via reply_to_message_id
 * - Typing indicators via sendChatAction
 * - Telegram MarkdownV2 conversion
 */

import { timingSafeEqual } from 'crypto';
import type { ChannelAdapter } from '../adapter.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('telegram');
import type {
  Channel,
  ChannelType,
  InboundMessage,
  OutboundMessage,
  WebhookRequest,
  WebhookResponse,
  HealthStatus,
  SendResult,
  TelegramChannelConfig,
  TelegramCredentials,
  TriggerEvent,
} from '../types.js';

// ============================================================================
// Telegram Types
// ============================================================================

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  message_thread_id?: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  reply_to_message?: TelegramMessage;
  entities?: TelegramMessageEntity[];
  caption_entities?: TelegramMessageEntity[];
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  sticker?: { file_id: string; emoji?: string };
  voice?: { file_id: string; duration: number };
  video?: { file_id: string; duration: number };
}

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramMessageEntity {
  type: string; // 'mention', 'bot_command', 'url', 'bold', 'italic', 'code', 'pre', etc.
  offset: number;
  length: number;
  url?: string;
  user?: TelegramUser;
  language?: string;
}

interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramBotUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

const TELEGRAM_API_BASE = 'https://api.telegram.org';

// ============================================================================
// TelegramAdapter
// ============================================================================

export class TelegramAdapter implements ChannelAdapter {
  readonly type: ChannelType = 'telegram';

  private channel: Channel | null = null;
  private config: TelegramChannelConfig | null = null;
  private credentials: TelegramCredentials | null = null;
  private lastEventAt: Date | null = null;
  private botInfo: TelegramBotUser | null = null;

  async initialize(channel: Channel): Promise<void> {
    this.channel = channel;
    this.config = channel.config as TelegramChannelConfig;
    this.credentials = channel.credentials as TelegramCredentials;

    // Validate required credentials
    if (!this.credentials.botToken) {
      throw new Error('Telegram bot token is required');
    }

    // Verify connection by calling getMe
    try {
      const result = await this.callTelegramApi('getMe');
      if (result.ok && result.result) {
        this.botInfo = result.result as TelegramBotUser;
        log.info(`Telegram adapter initialized for bot: @${this.botInfo.username}`);
      } else {
        throw new Error(`Telegram auth failed: ${JSON.stringify(result)}`);
      }
    } catch (error) {
      log.warn('Failed to verify Telegram connection:', error);
      // Don't throw - allow initialization even if we can't verify immediately
    }
  }

  async shutdown(): Promise<void> {
    this.channel = null;
    this.config = null;
    this.credentials = null;
    this.botInfo = null;
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.credentials) {
      return { healthy: false, message: 'Not initialized' };
    }

    try {
      const result = await this.callTelegramApi('getMe');
      if (result.ok && result.result) {
        const bot = result.result as TelegramBotUser;
        return {
          healthy: true,
          message: 'Connected',
          lastEventAt: this.lastEventAt ?? undefined,
          details: {
            username: bot.username,
            id: bot.id,
          },
        };
      }
      return {
        healthy: false,
        message: 'Unexpected response from Telegram',
        lastEventAt: this.lastEventAt ?? undefined,
      };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        lastEventAt: this.lastEventAt ?? undefined,
      };
    }
  }

  async handleWebhook(request: WebhookRequest): Promise<WebhookResponse> {
    // Verify webhook secret if configured
    if (!this.verifyWebhookSecret(request)) {
      return { status: 401, body: { error: 'Invalid signature' } };
    }

    let payload: TelegramUpdate;
    try {
      payload = JSON.parse(request.body);
    } catch {
      return { status: 400, body: { error: 'Invalid JSON' } };
    }

    // Validate it looks like a Telegram update
    if (typeof payload.update_id !== 'number') {
      return { status: 400, body: { error: 'Invalid Telegram update' } };
    }

    this.lastEventAt = new Date();

    // Acknowledge immediately - actual processing happens async via queue
    return { status: 200, body: 'ok' };
  }

  parseMessage(rawEvent: unknown): InboundMessage | null {
    const update = rawEvent as TelegramUpdate;

    // Get the message from the update (support message, edited_message, channel_post)
    const message = update.message || update.edited_message;
    if (!message) {
      return null;
    }

    // Ignore bot messages to prevent loops
    if (message.from?.is_bot) {
      return null;
    }

    // Get the text content (text or caption for media messages)
    let content = message.text || message.caption || '';

    // If there's no text content, skip
    if (!content.trim()) {
      return null;
    }

    // Determine trigger type
    let triggerType: TriggerEvent;
    const isPrivate = message.chat.type === 'private';
    const botUsername = this.config?.botUsername || this.botInfo?.username;
    const isBotMentioned = botUsername
      ? this.isMentioned(content, message.entities || message.caption_entities || [], botUsername)
      : false;

    if (isPrivate) {
      triggerType = 'direct_message';
    } else if (isBotMentioned) {
      triggerType = 'mention';
    } else {
      triggerType = 'channel_message';
    }

    // Check allowed chats if configured
    if (this.config?.allowedChats && this.config.allowedChats.length > 0) {
      const chatId = String(message.chat.id);
      if (!this.config.allowedChats.includes(chatId)) {
        return null;
      }
    }

    // Strip bot mention from content
    if (triggerType === 'mention' && botUsername) {
      content = this.stripBotMention(content, botUsername);
    }

    // Convert Telegram entities to standard markdown
    content = this.telegramToStandardMarkdown(
      content,
      message.entities || message.caption_entities || []
    );

    // Map attachments
    const attachments = this.extractAttachments(message);

    // Determine thread ID:
    // 1. Forum topic thread: message_thread_id
    // 2. Reply chain: reply_to_message.message_id
    // 3. Default: chat.id (for DMs and standalone messages)
    let platformThreadId: string;
    if (message.message_thread_id) {
      platformThreadId = String(message.message_thread_id);
    } else if (message.reply_to_message) {
      platformThreadId = String(message.reply_to_message.message_id);
    } else {
      platformThreadId = String(message.chat.id);
    }

    const authorName = [message.from?.first_name, message.from?.last_name]
      .filter(Boolean)
      .join(' ') || message.from?.username || 'Unknown';

    return {
      id: String(update.update_id),
      channelId: this.channel?.id || '',
      platformMessageId: String(message.message_id),
      platformThreadId,
      platformChannelId: String(message.chat.id),
      authorId: String(message.from?.id || 0),
      authorName,
      content,
      attachments: attachments.length > 0 ? attachments : undefined,
      triggerType,
      metadata: {
        chatType: message.chat.type,
        chatTitle: message.chat.title,
        isEdited: !!update.edited_message,
        messageThreadId: message.message_thread_id,
        hasReplyTo: !!message.reply_to_message,
      },
      timestamp: new Date(message.date * 1000),
    };
  }

  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    if (!this.credentials) {
      return { success: false, error: 'Not initialized' };
    }

    const chatId = message.targetChannelId || message.targetUserId;
    if (!chatId) {
      return { success: false, error: 'No target chat or user specified' };
    }

    // Convert standard markdown to Telegram MarkdownV2
    const telegramContent = this.standardToTelegramMarkdown(message.content);

    const params: Record<string, unknown> = {
      chat_id: chatId,
      text: telegramContent,
      parse_mode: 'MarkdownV2',
    };

    // Reply to a specific message for threading
    if (message.targetThreadId) {
      params.reply_to_message_id = parseInt(message.targetThreadId, 10);
    }

    try {
      const result = await this.callTelegramApi('sendMessage', params);

      if (result.ok && result.result) {
        const sentMessage = result.result as { message_id: number };
        return {
          success: true,
          platformMessageId: String(sentMessage.message_id),
          platformThreadId: String(sentMessage.message_id),
        };
      } else {
        return {
          success: false,
          error: String(
            (result as Record<string, unknown>).description || 'Unknown Telegram API error'
          ),
        };
      }
    } catch (error) {
      // If MarkdownV2 parsing fails, retry without parse_mode
      try {
        params.text = message.content;
        delete params.parse_mode;
        const result = await this.callTelegramApi('sendMessage', params);
        if (result.ok && result.result) {
          const sentMessage = result.result as { message_id: number };
          return {
            success: true,
            platformMessageId: String(sentMessage.message_id),
            platformThreadId: String(sentMessage.message_id),
          };
        }
      } catch {
        // Fall through to error return
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  getThreadId(message: InboundMessage): string {
    // For thread continuity:
    // - Forum topics use message_thread_id
    // - Reply chains use the replied message ID
    // - DMs and standalone messages use the chat ID
    return message.platformThreadId || message.platformMessageId;
  }

  // ==========================================================================
  // Public Utility Methods
  // ==========================================================================

  /**
   * Send a typing indicator to a chat
   */
  async sendTypingIndicator(chatId: string): Promise<void> {
    if (!this.credentials) return;

    try {
      await this.callTelegramApi('sendChatAction', {
        chat_id: chatId,
        action: 'typing',
      });
    } catch (error) {
      log.debug('Failed to send typing indicator:', error);
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Verify Telegram webhook secret token
   * If webhookSecret is not configured, allow all requests (rely on URL secrecy)
   */
  private verifyWebhookSecret(request: WebhookRequest): boolean {
    if (!this.credentials?.webhookSecret) {
      // No secret configured - accept all requests
      return true;
    }

    const secretToken = request.headers['x-telegram-bot-api-secret-token'];
    if (!secretToken) {
      return false;
    }

    // Timing-safe comparison
    try {
      const expected = Buffer.from(this.credentials.webhookSecret);
      const received = Buffer.from(secretToken);

      if (expected.length !== received.length) {
        return false;
      }

      return timingSafeEqual(expected, received);
    } catch {
      return false;
    }
  }

  /**
   * Check if the bot is mentioned in the message
   */
  private isMentioned(
    text: string,
    entities: TelegramMessageEntity[],
    botUsername: string
  ): boolean {
    // Check entities for mention type
    for (const entity of entities) {
      if (entity.type === 'mention') {
        const mentionText = text.substring(entity.offset, entity.offset + entity.length);
        if (mentionText.toLowerCase() === `@${botUsername.toLowerCase()}`) {
          return true;
        }
      }
      // Check for text_mention (when user has no username)
      if (entity.type === 'text_mention' && entity.user?.is_bot) {
        return true;
      }
    }

    // Also check for @botname in text (fallback)
    return text.toLowerCase().includes(`@${botUsername.toLowerCase()}`);
  }

  /**
   * Strip bot mention from message content
   */
  private stripBotMention(text: string, botUsername: string): string {
    const mentionPattern = new RegExp(`\\s*@${this.escapeRegex(botUsername)}\\s*`, 'gi');
    return text.replace(mentionPattern, ' ').trim();
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Convert Telegram message entities to standard markdown
   * Telegram sends plain text + entity offsets; we reconstruct markdown
   */
  private telegramToStandardMarkdown(
    text: string,
    entities: TelegramMessageEntity[]
  ): string {
    if (!entities || entities.length === 0) {
      return text;
    }

    // Sort entities by offset (reverse order so we can insert without shifting offsets)
    const sorted = [...entities].sort((a, b) => b.offset - a.offset);

    let result = text;

    for (const entity of sorted) {
      const start = entity.offset;
      const end = entity.offset + entity.length;
      const entityText = text.substring(start, end);

      let replacement: string;

      switch (entity.type) {
        case 'bold':
          replacement = `**${entityText}**`;
          break;
        case 'italic':
          replacement = `*${entityText}*`;
          break;
        case 'underline':
          replacement = `__${entityText}__`;
          break;
        case 'strikethrough':
          replacement = `~~${entityText}~~`;
          break;
        case 'code':
          replacement = `\`${entityText}\``;
          break;
        case 'pre':
          if (entity.language) {
            replacement = `\`\`\`${entity.language}\n${entityText}\n\`\`\``;
          } else {
            replacement = `\`\`\`\n${entityText}\n\`\`\``;
          }
          break;
        case 'text_link':
          replacement = entity.url ? `[${entityText}](${entity.url})` : entityText;
          break;
        case 'url':
          // URLs are already in the text, no conversion needed
          replacement = entityText;
          break;
        case 'mention':
          // @username mentions - keep as-is
          replacement = entityText;
          break;
        case 'bot_command':
          // /command - keep as-is
          replacement = entityText;
          break;
        case 'spoiler':
          // No standard markdown equivalent, just show the text
          replacement = entityText;
          break;
        default:
          replacement = entityText;
      }

      result = result.substring(0, start) + replacement + result.substring(end);
    }

    return result;
  }

  /**
   * Convert standard markdown to Telegram MarkdownV2
   * MarkdownV2 requires escaping special characters outside of formatting
   */
  private standardToTelegramMarkdown(text: string): string {
    // Characters that must be escaped in MarkdownV2:
    // _ * [ ] ( ) ~ ` > # + - = | { } . !
    // But NOT inside code blocks or inline code

    let result = text;

    // Protect code blocks
    const codeBlocks: string[] = [];
    result = result.replace(/```[\s\S]*?```/g, (match) => {
      codeBlocks.push(match);
      return `__TGCODE_BLOCK_${codeBlocks.length - 1}__`;
    });

    // Protect inline code
    const inlineCode: string[] = [];
    result = result.replace(/`[^`]+`/g, (match) => {
      inlineCode.push(match);
      return `__TGINLINE_CODE_${inlineCode.length - 1}__`;
    });

    // Protect markdown formatting markers temporarily
    // Bold: **text**
    const bolds: string[] = [];
    result = result.replace(/\*\*([^*]+)\*\*/g, (_match, inner) => {
      bolds.push(inner);
      return `__TGBOLD_${bolds.length - 1}__`;
    });

    // Italic: *text*
    const italics: string[] = [];
    result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_match, inner) => {
      italics.push(inner);
      return `__TGITALIC_${italics.length - 1}__`;
    });

    // Strikethrough: ~~text~~
    const strikes: string[] = [];
    result = result.replace(/~~([^~]+)~~/g, (_match, inner) => {
      strikes.push(inner);
      return `__TGSTRIKE_${strikes.length - 1}__`;
    });

    // Links: [text](url)
    const links: [string, string][] = [];
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, linkText, url) => {
      links.push([linkText, url]);
      return `__TGLINK_${links.length - 1}__`;
    });

    // Escape special characters in remaining text
    result = result.replace(/([_\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');

    // Restore links with MarkdownV2 format
    for (let i = links.length - 1; i >= 0; i--) {
      const [linkText, url] = links[i];
      const escapedText = linkText.replace(/([_\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
      // URL inside parentheses only needs ) and \ escaped
      const escapedUrl = url.replace(/([)\\])/g, '\\$1');
      result = result.replace(`__TGLINK_${i}__`, `[${escapedText}](${escapedUrl})`);
    }

    // Restore strikethrough
    for (let i = strikes.length - 1; i >= 0; i--) {
      const escapedInner = strikes[i].replace(/([_\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
      result = result.replace(`__TGSTRIKE_${i}__`, `~${escapedInner}~`);
    }

    // Restore italic
    for (let i = italics.length - 1; i >= 0; i--) {
      const escapedInner = italics[i].replace(/([_\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
      result = result.replace(`__TGITALIC_${i}__`, `_${escapedInner}_`);
    }

    // Restore bold
    for (let i = bolds.length - 1; i >= 0; i--) {
      const escapedInner = bolds[i].replace(/([_\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
      result = result.replace(`__TGBOLD_${i}__`, `*${escapedInner}*`);
    }

    // Restore inline code (no escaping needed inside)
    for (let i = inlineCode.length - 1; i >= 0; i--) {
      result = result.replace(`__TGINLINE_CODE_${i}__`, inlineCode[i]);
    }

    // Restore code blocks (no escaping needed inside)
    for (let i = codeBlocks.length - 1; i >= 0; i--) {
      result = result.replace(`__TGCODE_BLOCK_${i}__`, codeBlocks[i]);
    }

    return result;
  }

  /**
   * Extract attachments from a Telegram message
   */
  private extractAttachments(
    message: TelegramMessage
  ): Array<{ type: 'file' | 'image' | 'code' | 'link'; name?: string; url?: string; mimeType?: string }> {
    const attachments: Array<{
      type: 'file' | 'image' | 'code' | 'link';
      name?: string;
      url?: string;
      mimeType?: string;
    }> = [];

    // Photos - use the largest size
    if (message.photo && message.photo.length > 0) {
      const largest = message.photo[message.photo.length - 1];
      attachments.push({
        type: 'image',
        name: 'photo.jpg',
        url: largest.file_id, // File IDs need to be resolved via getFile API
        mimeType: 'image/jpeg',
      });
    }

    // Documents
    if (message.document) {
      const mimeType = message.document.mime_type;
      const isCode =
        mimeType?.includes('text/') ||
        mimeType?.includes('javascript') ||
        mimeType?.includes('json') ||
        mimeType?.includes('xml');

      attachments.push({
        type: isCode ? 'code' : 'file',
        name: message.document.file_name,
        url: message.document.file_id,
        mimeType: message.document.mime_type,
      });
    }

    return attachments;
  }

  /**
   * Call Telegram Bot API
   */
  private async callTelegramApi(
    method: string,
    params?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    if (!this.credentials?.botToken) {
      throw new Error('Bot token not configured');
    }

    const url = `${TELEGRAM_API_BASE}/bot${this.credentials.botToken}/${method}`;

    const options: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (params) {
      options.body = JSON.stringify(params);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Telegram API error: ${response.status} ${response.statusText} - ${errorBody}`
      );
    }

    return (await response.json()) as Record<string, unknown>;
  }
}
