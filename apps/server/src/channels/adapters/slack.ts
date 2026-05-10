/**
 * SlackAdapter - Implements ChannelAdapter for Slack integration
 * 
 * Handles:
 * - Webhook signature verification
 * - Events API (app_mention, message.im)
 * - Message sending via Web API
 * - Reaction-based typing indicators
 */

import { createHmac, timingSafeEqual } from 'crypto';
import type { ChannelAdapter } from '../adapter.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('slack');
import type {
  Channel,
  ChannelType,
  InboundMessage,
  OutboundMessage,
  WebhookRequest,
  WebhookResponse,
  HealthStatus,
  SendResult,
  SlackChannelConfig,
  SlackCredentials,
  TriggerEvent,
} from '../types.js';
import { markdownToMrkdwn, mrkdwnToMarkdown, stripLeadingMention } from '../markdown.js';

// ============================================================================
// Slack Event Types
// ============================================================================

interface SlackEventWrapper {
  token?: string;
  team_id?: string;
  api_app_id?: string;
  type: string;
  event?: SlackEvent;
  event_id?: string;
  event_time?: number;
  challenge?: string;
  authorizations?: Array<{ user_id: string }>;
}

interface SlackEvent {
  type: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  channel?: string;
  channel_type?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  event_ts?: string;
}

interface SlackUser {
  id: string;
  name: string;
  real_name?: string;
}

// ============================================================================
// SlackAdapter
// ============================================================================

export class SlackAdapter implements ChannelAdapter {
  readonly type: ChannelType = 'slack';

  private channel: Channel | null = null;
  private config: SlackChannelConfig | null = null;
  private credentials: SlackCredentials | null = null;
  private lastEventAt: Date | null = null;

  // Cache for user info
  private userCache = new Map<string, SlackUser>();

  async initialize(channel: Channel): Promise<void> {
    this.channel = channel;
    this.config = channel.config as SlackChannelConfig;
    this.credentials = channel.credentials as SlackCredentials;

    // Validate required credentials
    if (!this.credentials.botToken) {
      throw new Error('Slack bot token is required');
    }
    if (!this.credentials.signingSecret) {
      throw new Error('Slack signing secret is required');
    }

    // Optionally verify connection by calling auth.test
    try {
      const authResult = await this.callSlackApi('auth.test', {});
      if (!authResult.ok) {
        throw new Error(`Slack auth failed: ${authResult.error}`);
      }
      log.info(`Slack adapter initialized for workspace: ${authResult.team}`);
    } catch (error) {
      log.warn('Failed to verify Slack connection:', error);
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
      const result = await this.callSlackApi('auth.test', {});
      return {
        healthy: result.ok === true,
        message: result.ok ? 'Connected' : String(result.error || 'Unknown error'),
        lastEventAt: this.lastEventAt ?? undefined,
        details: {
          team: result.team,
          user: result.user,
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
    // Verify signature
    if (!this.verifySignature(request)) {
      return { status: 401, body: { error: 'Invalid signature' } };
    }

    let payload: SlackEventWrapper;
    try {
      payload = JSON.parse(request.body);
    } catch {
      return { status: 400, body: { error: 'Invalid JSON' } };
    }

    // Handle URL verification challenge
    if (payload.type === 'url_verification') {
      return {
        status: 200,
        body: { challenge: payload.challenge },
        headers: { 'Content-Type': 'application/json' },
      };
    }

    // Handle event callbacks
    if (payload.type === 'event_callback' && payload.event) {
      this.lastEventAt = new Date();
      
      // Acknowledge immediately - actual processing happens async via queue
      return { status: 200, body: 'ok' };
    }

    return { status: 200, body: 'ok' };
  }

  parseMessage(rawEvent: unknown): InboundMessage | null {
    const wrapper = rawEvent as SlackEventWrapper;
    
    if (wrapper.type !== 'event_callback' || !wrapper.event) {
      return null;
    }

    const event = wrapper.event;

    // Ignore bot messages to prevent loops
    if (event.bot_id || event.subtype === 'bot_message') {
      return null;
    }

    // Ignore message edits/deletes
    if (event.subtype === 'message_changed' || event.subtype === 'message_deleted') {
      return null;
    }

    // Determine trigger type
    let triggerType: TriggerEvent;
    if (event.type === 'app_mention') {
      triggerType = 'mention';
    } else if (event.type === 'message' && event.channel_type === 'im') {
      triggerType = 'direct_message';
    } else if (event.type === 'message') {
      triggerType = 'channel_message';
    } else {
      return null;
    }

    // Check allowed channels if configured
    if (this.config?.allowedChannels && this.config.allowedChannels.length > 0) {
      if (event.channel && !this.config.allowedChannels.includes(event.channel)) {
        return null;
      }
    }

    // Clean up the message text
    let content = event.text || '';
    if (triggerType === 'mention' && this.config?.botUserId) {
      content = stripLeadingMention(content, this.config.botUserId);
    }

    // Convert mrkdwn to standard markdown for the agent
    content = mrkdwnToMarkdown(content);

    return {
      id: event.event_ts || event.ts || '',
      channelId: this.channel?.id || '',
      platformMessageId: event.ts || '',
      platformThreadId: event.thread_ts || event.ts,
      platformChannelId: event.channel || '',
      authorId: event.user || '',
      authorName: event.user || '', // Will be resolved later if needed
      content,
      triggerType,
      metadata: {
        teamId: wrapper.team_id,
        eventId: wrapper.event_id,
        channelType: event.channel_type,
      },
      timestamp: new Date((Number(event.event_ts) || Date.now() / 1000) * 1000),
    };
  }

  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    if (!this.credentials) {
      return { success: false, error: 'Not initialized' };
    }

    // Convert markdown to mrkdwn
    const mrkdwnContent = markdownToMrkdwn(message.content);

    // Determine where to send
    const channel = message.targetChannelId || message.targetUserId;
    if (!channel) {
      return { success: false, error: 'No target channel or user specified' };
    }

    const params: Record<string, unknown> = {
      channel,
      text: mrkdwnContent,
    };

    // Reply in thread if specified
    if (message.targetThreadId) {
      params.thread_ts = message.targetThreadId;
    }

    try {
      const result = await this.callSlackApi('chat.postMessage', params);

      if (result.ok) {
        return {
          success: true,
          platformMessageId: String(result.ts),
          platformThreadId: String(result.ts),
        };
      } else {
        return {
          success: false,
          error: String(result.error || 'Unknown Slack API error'),
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  getThreadId(message: InboundMessage): string {
    // For thread continuity:
    // - If message is in a thread, use the thread_ts
    // - Otherwise use the message's own ts (becomes the thread parent)
    return message.platformThreadId || message.platformMessageId;
  }

  async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    if (!this.credentials) return;

    try {
      await this.callSlackApi('reactions.add', {
        channel: channelId,
        timestamp: messageId,
        name: emoji,
      });
    } catch (error) {
      // Ignore errors (e.g., already reacted)
      log.debug('Failed to add reaction:', error);
    }
  }

  async removeReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    if (!this.credentials) return;

    try {
      await this.callSlackApi('reactions.remove', {
        channel: channelId,
        timestamp: messageId,
        name: emoji,
      });
    } catch (error) {
      // Ignore errors (e.g., reaction doesn't exist)
      log.debug('Failed to remove reaction:', error);
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Verify Slack webhook signature
   */
  private verifySignature(request: WebhookRequest): boolean {
    if (!this.credentials?.signingSecret) {
      return false;
    }

    const timestamp = request.headers['x-slack-request-timestamp'];
    const signature = request.headers['x-slack-signature'];

    if (!timestamp || !signature) {
      return false;
    }

    // Check timestamp to prevent replay attacks (5 minutes tolerance)
    const requestTime = parseInt(timestamp, 10);
    const currentTime = Math.floor(Date.now() / 1000);
    if (Math.abs(currentTime - requestTime) > 300) {
      return false;
    }

    // Compute signature
    const sigBasestring = `v0:${timestamp}:${request.body}`;
    const mySignature = 'v0=' + createHmac('sha256', this.credentials.signingSecret)
      .update(sigBasestring)
      .digest('hex');

    // Timing-safe comparison
    try {
      return timingSafeEqual(
        Buffer.from(mySignature),
        Buffer.from(signature)
      );
    } catch {
      return false;
    }
  }

  /**
   * Call Slack Web API
   */
  private async callSlackApi(
    method: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    if (!this.credentials?.botToken) {
      throw new Error('Bot token not configured');
    }

    const response = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.credentials.botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.status} ${response.statusText}`);
    }

    return await response.json() as Record<string, unknown>;
  }

  /**
   * Get user info (with caching)
   */
  async getUserInfo(userId: string): Promise<SlackUser | null> {
    if (this.userCache.has(userId)) {
      return this.userCache.get(userId)!;
    }

    try {
      const result = await this.callSlackApi('users.info', { user: userId });
      if (result.ok && result.user) {
        const user = result.user as { id: string; name: string; real_name?: string };
        const slackUser: SlackUser = {
          id: user.id,
          name: user.name,
          real_name: user.real_name,
        };
        this.userCache.set(userId, slackUser);
        return slackUser;
      }
    } catch (error) {
      log.debug('Failed to get user info:', error);
    }

    return null;
  }
}
