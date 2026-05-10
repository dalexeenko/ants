/**
 * Core types for the messaging channels abstraction.
 * These types are platform-agnostic and extended by specific adapters.
 */

// ============================================================================
// Channel Types
// ============================================================================

export type ChannelType = 'slack' | 'discord' | 'twitter' | 'reddit' | 'telegram';

export interface ChannelConfig {
  [key: string]: unknown;
}

export interface ChannelCredentials {
  [key: string]: unknown;
}

export interface Channel {
  id: string;
  type: ChannelType;
  name: string;
  config: ChannelConfig;
  credentials: ChannelCredentials;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Trigger Configuration
// ============================================================================

export type TriggerEvent =
  | 'mention'           // @bot mention
  | 'direct_message'    // DM to bot
  | 'reaction'          // Emoji reaction
  | 'keyword'           // Keyword match
  | 'channel_message';  // Any message in specific channels

export interface TriggerFilter {
  type: 'channel' | 'user' | 'keyword' | 'regex';
  include?: string[];
  exclude?: string[];
}

export interface TriggerConfig {
  events: TriggerEvent[];
  filters?: TriggerFilter[];
}

// ============================================================================
// Response Configuration
// ============================================================================

export type ResponseMode = 'reply' | 'thread' | 'dm' | 'channel';
export type ThreadBehavior = 'always' | 'if_exists' | 'never';

export interface ResponseConfig {
  mode?: ResponseMode;
  threadBehavior?: ThreadBehavior;
  typingIndicator?: boolean;
  maxResponseLength?: number;
}

// ============================================================================
// Channel Project Binding
// ============================================================================

export interface ChannelProjectBinding {
  id: string;
  channelId: string;
  projectId: string;
  triggerConfig: TriggerConfig;
  responseConfig?: ResponseConfig;
  enabled: boolean;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Message Types
// ============================================================================

export interface Attachment {
  type: 'file' | 'image' | 'code' | 'link';
  name?: string;
  url?: string;
  content?: string;
  mimeType?: string;
}

export interface InboundMessage {
  id: string;
  channelId: string;
  platformMessageId: string;
  platformThreadId?: string;
  platformChannelId: string;
  authorId: string;
  authorName: string;
  content: string;
  attachments?: Attachment[];
  triggerType: TriggerEvent;
  metadata: Record<string, unknown>;
  timestamp: Date;
}

export interface OutboundMessage {
  channelId: string;
  projectId?: string;
  sessionId?: string;
  targetThreadId?: string;
  targetChannelId?: string;
  targetUserId?: string;
  content: string;
  attachments?: Attachment[];
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Message Queue Types
// ============================================================================

export type MessageDirection = 'inbound' | 'outbound';
export type MessageStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface QueuedMessage {
  id: string;
  channelId: string;
  bindingId?: string;
  direction: MessageDirection;
  status: MessageStatus;
  payload: InboundMessage | OutboundMessage;
  platformRef?: string;
  sessionId?: string;
  attempts: number;
  lastError?: string;
  createdAt: Date;
  processedAt?: Date;
}

// ============================================================================
// Thread Session Mapping
// ============================================================================

export interface ThreadSession {
  id: string;
  channelId: string;
  projectId: string;
  platformThreadId: string;
  sessionId: string;
  createdAt: Date;
  lastActiveAt: Date;
}

// ============================================================================
// Webhook Types
// ============================================================================

export interface WebhookRequest {
  headers: Record<string, string>;
  body: string;
  rawBody: Buffer;
}

export interface WebhookResponse {
  status: number;
  body?: string | Record<string, unknown>;
  headers?: Record<string, string>;
}

// ============================================================================
// Health & Status
// ============================================================================

export interface HealthStatus {
  healthy: boolean;
  message?: string;
  lastEventAt?: Date;
  details?: Record<string, unknown>;
}

export interface SendResult {
  success: boolean;
  platformMessageId?: string;
  platformThreadId?: string;
  error?: string;
}

// ============================================================================
// Slack-Specific Types
// ============================================================================

export interface SlackChannelConfig extends ChannelConfig {
  workspaceId: string;
  workspaceName: string;
  botUserId: string;
  allowedChannels?: string[];
}

export interface SlackCredentials extends ChannelCredentials {
  botToken: string;
  signingSecret: string;
}

// Type guards
export function isSlackConfig(config: ChannelConfig): config is SlackChannelConfig {
  return (
    typeof (config as SlackChannelConfig).workspaceId === 'string' &&
    typeof (config as SlackChannelConfig).botUserId === 'string'
  );
}

export function isSlackCredentials(credentials: ChannelCredentials): credentials is SlackCredentials {
  return (
    typeof (credentials as SlackCredentials).botToken === 'string' &&
    typeof (credentials as SlackCredentials).signingSecret === 'string'
  );
}

// ============================================================================
// Discord-Specific Types
// ============================================================================

export interface DiscordChannelConfig extends ChannelConfig {
  applicationId: string;
  guildId?: string;
  botUserId: string;
  allowedChannels?: string[];
}

export interface DiscordCredentials extends ChannelCredentials {
  botToken: string;
  publicKey: string;
}

export function isDiscordConfig(config: ChannelConfig): config is DiscordChannelConfig {
  return typeof (config as DiscordChannelConfig).applicationId === 'string';
}

export function isDiscordCredentials(credentials: ChannelCredentials): credentials is DiscordCredentials {
  return (
    typeof (credentials as DiscordCredentials).botToken === 'string' &&
    typeof (credentials as DiscordCredentials).publicKey === 'string'
  );
}

// ============================================================================
// Telegram-Specific Types
// ============================================================================

export interface TelegramChannelConfig extends ChannelConfig {
  botUsername: string;
  allowedChats?: string[];
}

export interface TelegramCredentials extends ChannelCredentials {
  botToken: string;
  webhookSecret?: string;
}

export function isTelegramConfig(config: ChannelConfig): config is TelegramChannelConfig {
  return typeof (config as TelegramChannelConfig).botUsername === 'string';
}

export function isTelegramCredentials(credentials: ChannelCredentials): credentials is TelegramCredentials {
  return typeof (credentials as TelegramCredentials).botToken === 'string';
}
