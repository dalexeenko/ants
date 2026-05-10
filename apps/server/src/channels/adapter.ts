/**
 * ChannelAdapter interface - Platform-specific implementations must implement this.
 */

import type {
  Channel,
  ChannelType,
  InboundMessage,
  OutboundMessage,
  WebhookRequest,
  WebhookResponse,
  HealthStatus,
  SendResult,
} from './types.js';

export interface ChannelAdapter {
  /**
   * The channel type this adapter handles
   */
  readonly type: ChannelType;

  /**
   * Initialize the adapter with channel configuration
   */
  initialize(channel: Channel): Promise<void>;

  /**
   * Gracefully shutdown the adapter
   */
  shutdown(): Promise<void>;

  /**
   * Check adapter health/connectivity
   */
  healthCheck(): Promise<HealthStatus>;

  /**
   * Handle incoming webhook from the platform
   * Must respond quickly (< 3 seconds for Slack)
   */
  handleWebhook(request: WebhookRequest): Promise<WebhookResponse>;

  /**
   * Parse a raw platform event into a normalized InboundMessage
   * Returns null if the event should be ignored (e.g., bot's own messages)
   */
  parseMessage(rawEvent: unknown): InboundMessage | null;

  /**
   * Send a message to the platform
   */
  sendMessage(message: OutboundMessage): Promise<SendResult>;

  /**
   * Extract the thread ID from a message for session mapping
   * For DMs, this might be the conversation ID
   * For channel messages, this is the thread_ts or message_ts
   */
  getThreadId(message: InboundMessage): string;

  /**
   * Add a reaction to a message (optional - for typing indicators)
   */
  addReaction?(channelId: string, messageId: string, emoji: string): Promise<void>;

  /**
   * Remove a reaction from a message (optional - for typing indicators)
   */
  removeReaction?(channelId: string, messageId: string, emoji: string): Promise<void>;
}

/**
 * Registry of channel adapters by type
 */
export class AdapterRegistry {
  private adapters = new Map<ChannelType, ChannelAdapter>();

  register(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  get(type: ChannelType): ChannelAdapter | undefined {
    return this.adapters.get(type);
  }

  has(type: ChannelType): boolean {
    return this.adapters.has(type);
  }

  getAll(): ChannelAdapter[] {
    return Array.from(this.adapters.values());
  }

  getSupportedTypes(): ChannelType[] {
    return Array.from(this.adapters.keys());
  }
}
