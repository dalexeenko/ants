/**
 * ChannelRouter - Routes incoming webhooks to the appropriate channel adapter
 */

import type { ChannelManager } from '../services/channel-manager.js';
import type { MessageQueueService } from '../services/message-queue.js';
import type { WebhookRequest, ChannelType } from './types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ChannelRouter');

export interface RouteResult {
  status: number;
  body?: string | Record<string, unknown>;
  headers?: Record<string, string>;
}

export class ChannelRouter {
  private channelManager: ChannelManager;
  private messageQueue: MessageQueueService;

  constructor(channelManager: ChannelManager, messageQueue: MessageQueueService) {
    this.channelManager = channelManager;
    this.messageQueue = messageQueue;
  }

  /**
   * Route a webhook request to the appropriate channel adapter
   */
  async route(channelType: ChannelType, request: WebhookRequest): Promise<RouteResult> {
    const adapter = this.channelManager.getAdapter(channelType);
    if (!adapter) {
      return { status: 400, body: { error: `Unsupported channel type: ${channelType}` } };
    }

    // Get all channels of this type to find one that validates
    const channels = this.channelManager.getChannelsByType(channelType);
    if (channels.length === 0) {
      return { status: 404, body: { error: `No ${channelType} channels configured` } };
    }

    // For Slack, we need to handle the webhook at the adapter level first
    // The adapter will verify the signature and handle url_verification
    
    // Find an enabled channel that can handle this request
    for (const channel of channels) {
      if (!channel.enabled) continue;

      // Initialize adapter with this channel's config for verification
      try {
        await adapter.initialize(channel);
        const response = await adapter.handleWebhook(request);

        // If the adapter accepted the request (not 401), process it
        if (response.status !== 401) {
          // Parse the message if this was an event
          let body: unknown;
          try {
            body = JSON.parse(request.body);
          } catch {
            return response;
          }

          const message = adapter.parseMessage(body);
          
          // If we got a valid message, enqueue it
          if (message) {
            // Set the correct channel ID
            message.channelId = channel.id;

            this.messageQueue.enqueueInbound({
              channelId: channel.id,
              payload: message,
              platformRef: message.platformMessageId,
            });
          }

          return {
            status: response.status,
            body: response.body,
            headers: response.headers,
          };
        }
      } catch (error) {
        log.error(`Error processing webhook for channel ${channel.id}:`, error);
        continue;
      }
    }

    // No channel accepted the request
    return { status: 401, body: { error: 'Invalid webhook signature' } };
  }

  /**
   * Route with a specific channel ID (for when we know which channel)
   */
  async routeToChannel(channelId: string, request: WebhookRequest): Promise<RouteResult> {
    const channel = this.channelManager.getChannel(channelId);
    if (!channel) {
      return { status: 404, body: { error: 'Channel not found' } };
    }

    if (!channel.enabled) {
      return { status: 400, body: { error: 'Channel is disabled' } };
    }

    const adapter = this.channelManager.getAdapter(channel.type);
    if (!adapter) {
      return { status: 500, body: { error: 'Adapter not found for channel type' } };
    }

    try {
      await adapter.initialize(channel);
      const response = await adapter.handleWebhook(request);

      if (response.status !== 401) {
        let body: unknown;
        try {
          body = JSON.parse(request.body);
        } catch {
          return response;
        }

        const message = adapter.parseMessage(body);
        
        if (message) {
          message.channelId = channel.id;

          this.messageQueue.enqueueInbound({
            channelId: channel.id,
            payload: message,
            platformRef: message.platformMessageId,
          });
        }
      }

      return {
        status: response.status,
        body: response.body,
        headers: response.headers,
      };
    } catch (error) {
      log.error(`Error processing webhook for channel ${channelId}:`, error);
      return { status: 500, body: { error: 'Internal error processing webhook' } };
    }
  }
}
