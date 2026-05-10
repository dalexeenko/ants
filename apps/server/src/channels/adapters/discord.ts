/**
 * DiscordAdapter - Implements ChannelAdapter for Discord integration
 *
 * Handles:
 * - Webhook signature verification using Ed25519
 * - PING interaction type (Discord endpoint verification)
 * - MESSAGE_CREATE events (mentions, DMs, channel messages)
 * - Message sending via Discord REST API
 * - Thread replies via message_reference
 * - Typing indicators
 */

import { verify } from 'crypto';
import type { ChannelAdapter } from '../adapter.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('discord');
import type {
  Channel,
  ChannelType,
  InboundMessage,
  OutboundMessage,
  WebhookRequest,
  WebhookResponse,
  HealthStatus,
  SendResult,
  DiscordChannelConfig,
  DiscordCredentials,
  TriggerEvent,
} from '../types.js';

// ============================================================================
// Discord Event / API Types
// ============================================================================

/** Discord interaction types */
const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
} as const;

/** Discord interaction response types */
const InteractionResponseType = {
  PONG: 1,
} as const;

interface DiscordInteraction {
  type: number;
  id?: string;
  token?: string;
  data?: unknown;
}

interface DiscordGatewayEvent {
  t?: string; // event name (e.g. MESSAGE_CREATE)
  op?: number;
  d?: DiscordMessageEvent;
  s?: number;
}

interface DiscordMessageEvent {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: {
    id: string;
    username: string;
    discriminator?: string;
    bot?: boolean;
  };
  content: string;
  timestamp: string;
  thread_id?: string;
  message_reference?: {
    message_id?: string;
    channel_id?: string;
    guild_id?: string;
  };
  mentions?: Array<{
    id: string;
    username: string;
    bot?: boolean;
  }>;
  attachments?: Array<{
    id: string;
    filename: string;
    url: string;
    content_type?: string;
    size: number;
  }>;
  type: number; // 0 = DEFAULT, 19 = REPLY, etc.
}

interface DiscordUser {
  id: string;
  username: string;
  discriminator?: string;
}

/** Possible payload shapes: interaction or gateway event */
type DiscordWebhookPayload = DiscordInteraction | DiscordGatewayEvent | DiscordMessageEvent;

const DISCORD_API_BASE = 'https://discord.com/api/v10';

// ============================================================================
// DiscordAdapter
// ============================================================================

export class DiscordAdapter implements ChannelAdapter {
  readonly type: ChannelType = 'discord';

  private channel: Channel | null = null;
  private config: DiscordChannelConfig | null = null;
  private credentials: DiscordCredentials | null = null;
  private lastEventAt: Date | null = null;

  // Cache for user info
  private userCache = new Map<string, DiscordUser>();

  async initialize(channel: Channel): Promise<void> {
    this.channel = channel;
    this.config = channel.config as DiscordChannelConfig;
    this.credentials = channel.credentials as DiscordCredentials;

    // Validate required credentials
    if (!this.credentials.botToken) {
      throw new Error('Discord bot token is required');
    }
    if (!this.credentials.publicKey) {
      throw new Error('Discord public key is required');
    }

    // Optionally verify connection by calling /users/@me
    try {
      const result = await this.callDiscordApi('GET', '/users/@me');
      log.info(`Discord adapter initialized for bot: ${result.username}`);
    } catch (error) {
      log.warn('Failed to verify Discord connection:', error);
      // Don't throw - allow initialization even if we can't verify immediately
    }
  }

  async shutdown(): Promise<void> {
    this.channel = null;
    this.config = null;
    this.credentials = null;
    this.userCache.clear();
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.credentials) {
      return { healthy: false, message: 'Not initialized' };
    }

    try {
      const result = await this.callDiscordApi('GET', '/users/@me');
      return {
        healthy: true,
        message: 'Connected',
        lastEventAt: this.lastEventAt ?? undefined,
        details: {
          username: result.username,
          id: result.id,
        },
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
    // Verify Ed25519 signature
    if (!this.verifySignature(request)) {
      return { status: 401, body: { error: 'Invalid signature' } };
    }

    let payload: DiscordWebhookPayload;
    try {
      payload = JSON.parse(request.body);
    } catch {
      return { status: 400, body: { error: 'Invalid JSON' } };
    }

    // Handle Discord PING interaction (endpoint verification)
    if ('type' in payload && (payload as DiscordInteraction).type === InteractionType.PING) {
      return {
        status: 200,
        body: { type: InteractionResponseType.PONG },
        headers: { 'Content-Type': 'application/json' },
      };
    }

    // Handle gateway-style event payloads (MESSAGE_CREATE, etc.)
    // Discord webhook events can arrive as { t: 'MESSAGE_CREATE', d: { ... } }
    // or directly as the message object depending on configuration
    this.lastEventAt = new Date();

    // Acknowledge immediately - actual processing happens async via queue
    return { status: 200, body: 'ok' };
  }

  parseMessage(rawEvent: unknown): InboundMessage | null {
    const event = rawEvent as Record<string, unknown>;

    // Support both gateway-style { t, d } and direct message payloads
    let messageData: DiscordMessageEvent;

    if (event.t === 'MESSAGE_CREATE' && event.d) {
      messageData = event.d as DiscordMessageEvent;
    } else if (event.author && event.channel_id) {
      // Direct message payload
      messageData = event as unknown as DiscordMessageEvent;
    } else if ('type' in event && (event as unknown as DiscordInteraction).type === InteractionType.PING) {
      // PING interaction, not a user message
      return null;
    } else {
      return null;
    }

    // Ignore bot messages to prevent loops
    if (messageData.author.bot) {
      return null;
    }

    // Determine trigger type
    let triggerType: TriggerEvent;
    const isBotMentioned = messageData.mentions?.some(
      (m) => m.id === this.config?.botUserId
    );
    const isDM = !messageData.guild_id;

    if (isDM) {
      triggerType = 'direct_message';
    } else if (isBotMentioned) {
      triggerType = 'mention';
    } else {
      triggerType = 'channel_message';
    }

    // Check allowed channels if configured
    if (this.config?.allowedChannels && this.config.allowedChannels.length > 0) {
      if (!this.config.allowedChannels.includes(messageData.channel_id)) {
        return null;
      }
    }

    // Clean up message text
    let content = messageData.content || '';

    // Strip bot mention from content
    if (triggerType === 'mention' && this.config?.botUserId) {
      content = this.stripDiscordMention(content, this.config.botUserId);
    }

    // Convert Discord markdown to standard markdown
    content = this.discordMarkdownToStandard(content);

    // Map Discord attachments
    const attachments = messageData.attachments?.map((att) => ({
      type: this.inferAttachmentType(att.content_type),
      name: att.filename,
      url: att.url,
      mimeType: att.content_type,
    })) as InboundMessage['attachments'];

    // Determine thread ID
    // If the message is in a thread, use thread_id
    // Otherwise for DMs use channel_id
    const platformThreadId = messageData.thread_id || messageData.channel_id;

    return {
      id: messageData.id,
      channelId: this.channel?.id || '',
      platformMessageId: messageData.id,
      platformThreadId,
      platformChannelId: messageData.channel_id,
      authorId: messageData.author.id,
      authorName: messageData.author.username,
      content,
      attachments,
      triggerType,
      metadata: {
        guildId: messageData.guild_id,
        messageType: messageData.type,
        hasReference: !!messageData.message_reference,
      },
      timestamp: new Date(messageData.timestamp),
    };
  }

  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    if (!this.credentials) {
      return { success: false, error: 'Not initialized' };
    }

    const channelId = message.targetChannelId || message.targetUserId;
    if (!channelId) {
      return { success: false, error: 'No target channel or user specified' };
    }

    // If targeting a user via DM, we need to create/get the DM channel first
    let targetChannelId = channelId;
    if (message.targetUserId && !message.targetChannelId) {
      try {
        const dmChannel = await this.callDiscordApi('POST', '/users/@me/channels', {
          recipient_id: message.targetUserId,
        });
        targetChannelId = dmChannel.id as string;
      } catch (error) {
        return {
          success: false,
          error: `Failed to create DM channel: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }
    }

    // Convert standard markdown to Discord markdown
    const discordContent = this.standardToDiscordMarkdown(message.content);

    const body: Record<string, unknown> = {
      content: discordContent,
    };

    // Reply in thread if specified (message_reference for replies)
    if (message.targetThreadId) {
      body.message_reference = {
        message_id: message.targetThreadId,
      };
      // Allow the message to send even if the referenced message is deleted
      body.allowed_mentions = { parse: ['users', 'roles'] };
    }

    try {
      const result = await this.callDiscordApi(
        'POST',
        `/channels/${targetChannelId}/messages`,
        body
      );

      return {
        success: true,
        platformMessageId: result.id as string,
        platformThreadId: result.id as string,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  getThreadId(message: InboundMessage): string {
    // For thread continuity:
    // - If message is in a thread, use the thread ID
    // - For DMs, use the channel_id (which is the DM channel)
    // - Otherwise use the message's own ID as thread root
    return message.platformThreadId || message.platformMessageId;
  }

  // ==========================================================================
  // Public Utility Methods
  // ==========================================================================

  /**
   * Send a typing indicator to a channel
   */
  async sendTypingIndicator(channelId: string): Promise<void> {
    if (!this.credentials) return;

    try {
      await this.callDiscordApi('POST', `/channels/${channelId}/typing`);
    } catch (error) {
      log.debug('Failed to send typing indicator:', error);
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Verify Discord webhook signature using Ed25519
   */
  private verifySignature(request: WebhookRequest): boolean {
    if (!this.credentials?.publicKey) {
      return false;
    }

    const signature = request.headers['x-signature-ed25519'];
    const timestamp = request.headers['x-signature-timestamp'];

    if (!signature || !timestamp) {
      return false;
    }

    try {
      const message = Buffer.from(timestamp + request.body);
      const signatureBuffer = Buffer.from(signature, 'hex');
      const publicKeyBuffer = Buffer.from(this.credentials.publicKey, 'hex');

      return verify(
        null, // Ed25519 doesn't use a separate hash algorithm
        message,
        { key: publicKeyBuffer, format: 'der', type: 'spki' },
        signatureBuffer
      );
    } catch {
      // If the key format is raw (32 bytes), construct an Ed25519 public key manually
      try {
        const message = Buffer.from(timestamp + request.body);
        const signatureBuffer = Buffer.from(signature, 'hex');
        const publicKeyHex = this.credentials.publicKey;

        // Ed25519 public key in DER/SPKI format:
        // 30 2a 30 05 06 03 2b 65 70 03 21 00 <32 bytes of key>
        const derPrefix = Buffer.from('302a300506032b6570032100', 'hex');
        const rawKey = Buffer.from(publicKeyHex, 'hex');
        const derKey = Buffer.concat([derPrefix, rawKey]);

        return verify(
          null,
          message,
          { key: derKey, format: 'der', type: 'spki' },
          signatureBuffer
        );
      } catch {
        return false;
      }
    }
  }

  /**
   * Strip Discord bot mention from message content
   * Discord mentions look like <@USER_ID> or <@!USER_ID>
   */
  private stripDiscordMention(text: string, botUserId: string): string {
    const mentionPattern = new RegExp(`\\s*<@!?${botUserId}>\\s*`, 'g');
    return text.replace(mentionPattern, ' ').trim();
  }

  /**
   * Convert Discord markdown to standard markdown
   * Discord markdown is mostly standard with some differences:
   * - User mentions: <@USER_ID> or <@!USER_ID>
   * - Channel mentions: <#CHANNEL_ID>
   * - Role mentions: <@&ROLE_ID>
   * - Custom emoji: <:name:ID> or <a:name:ID>
   * - Timestamps: <t:TIMESTAMP:FORMAT>
   * - Spoilers: ||text||
   * - Headers: # (same)
   * - Code blocks: ``` (same)
   */
  private discordMarkdownToStandard(text: string): string {
    let result = text;

    // Protect code blocks from conversion
    const codeBlocks: string[] = [];
    result = result.replace(/```[\s\S]*?```/g, (match) => {
      codeBlocks.push(match);
      return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
    });

    // Protect inline code
    const inlineCode: string[] = [];
    result = result.replace(/`[^`]+`/g, (match) => {
      inlineCode.push(match);
      return `__INLINE_CODE_${inlineCode.length - 1}__`;
    });

    // Convert user mentions: <@USER_ID> or <@!USER_ID> -> @user
    result = result.replace(/<@!?(\d+)>/g, '@user');

    // Convert channel mentions: <#CHANNEL_ID> -> #channel
    result = result.replace(/<#(\d+)>/g, '#channel');

    // Convert role mentions: <@&ROLE_ID> -> @role
    result = result.replace(/<@&(\d+)>/g, '@role');

    // Convert custom emoji: <:name:ID> or <a:name:ID> -> :name:
    result = result.replace(/<a?:(\w+):\d+>/g, ':$1:');

    // Convert timestamps: <t:TIMESTAMP:FORMAT> -> readable format
    result = result.replace(/<t:(\d+)(?::[tTdDfFR])?>/g, (_match, ts) => {
      try {
        return new Date(parseInt(ts, 10) * 1000).toISOString();
      } catch {
        return _match;
      }
    });

    // Remove spoiler markers: ||text|| -> text
    result = result.replace(/\|\|([^|]+)\|\|/g, '$1');

    // Restore code blocks
    for (let i = codeBlocks.length - 1; i >= 0; i--) {
      result = result.replace(`__CODE_BLOCK_${i}__`, codeBlocks[i]);
    }

    // Restore inline code
    for (let i = inlineCode.length - 1; i >= 0; i--) {
      result = result.replace(`__INLINE_CODE_${i}__`, inlineCode[i]);
    }

    return result;
  }

  /**
   * Convert standard markdown to Discord markdown
   * Most markdown is the same, but we handle a few edge cases
   */
  private standardToDiscordMarkdown(text: string): string {
    // Discord supports standard markdown mostly as-is
    // Main thing is to ensure content fits within Discord's 2000 char limit
    if (text.length > 2000) {
      return text.substring(0, 1997) + '...';
    }
    return text;
  }

  /**
   * Infer attachment type from MIME type
   */
  private inferAttachmentType(mimeType?: string): 'file' | 'image' | 'code' | 'link' {
    if (!mimeType) return 'file';
    if (mimeType.startsWith('image/')) return 'image';
    if (
      mimeType.includes('text/') ||
      mimeType.includes('javascript') ||
      mimeType.includes('json') ||
      mimeType.includes('xml')
    ) {
      return 'code';
    }
    return 'file';
  }

  /**
   * Call Discord REST API
   */
  private async callDiscordApi(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    if (!this.credentials?.botToken) {
      throw new Error('Bot token not configured');
    }

    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bot ${this.credentials.botToken}`,
        'Content-Type': 'application/json',
      },
    };

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${DISCORD_API_BASE}${path}`, options);

    // Some endpoints return 204 No Content (e.g., typing indicator)
    if (response.status === 204) {
      return {};
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Discord API error: ${response.status} ${response.statusText} - ${errorBody}`
      );
    }

    return (await response.json()) as Record<string, unknown>;
  }

  /**
   * Get user info (with caching)
   */
  async getUserInfo(userId: string): Promise<DiscordUser | null> {
    if (this.userCache.has(userId)) {
      return this.userCache.get(userId)!;
    }

    try {
      const result = await this.callDiscordApi('GET', `/users/${userId}`);
      const user: DiscordUser = {
        id: result.id as string,
        username: result.username as string,
        discriminator: result.discriminator as string | undefined,
      };
      this.userCache.set(userId, user);
      return user;
    } catch (error) {
      log.debug('Failed to get Discord user info:', error);
    }

    return null;
  }
}
