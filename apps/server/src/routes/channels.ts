/**
 * Channel API routes
 * 
 * Provides CRUD operations for channels and bindings,
 * webhook endpoints for platform events,
 * and outbound message API.
 */

import { Hono } from 'hono';
import type { ChannelManager } from '../services/channel-manager.js';
import type { MessageQueueService } from '../services/message-queue.js';
import { ChannelRouter } from '../channels/router.js';
import type { ChannelType, WebhookRequest, OutboundMessage } from '../channels/types.js';
import type { AuthUser } from '../auth/provider.js';
import { getErrorMessage } from '../utils/errors.js';
import { parseBody } from '../utils/validation.js';
import {
  CreateChannelSchema,
  UpdateChannelSchema,
  CreateBindingSchema,
  UpdateBindingSchema,
  SendMessageSchema,
} from '../schemas/index.js';

export function createChannelRoutes(
  channelManager: ChannelManager,
  messageQueue: MessageQueueService
) {
  const app = new Hono();

  // ==========================================================================
  // Channel CRUD
  // ==========================================================================

  /**
   * List all channels
   */
  app.get('/', (c) => {
    const channelsList = channelManager.listChannels();
    
    // Mask credentials in response
    const sanitized = channelsList.map((ch) => ({
      ...ch,
      credentials: { configured: true }, // Don't expose actual credentials
    }));

    return c.json({ channels: sanitized });
  });

  /**
   * Create a new channel
   */
  app.post('/', async (c) => {
    const user = (c as any).get('user') as AuthUser | undefined;
    const body = await parseBody(c, CreateChannelSchema);

    // Validate channel type is supported
    const supportedTypes = channelManager.getSupportedTypes();
    if (!supportedTypes.includes(body.type)) {
      return c.json({ 
        error: `Unsupported channel type: ${body.type}. Supported: ${supportedTypes.join(', ')}` 
      }, 400);
    }

    try {
      const channel = await channelManager.createChannel(body, user?.id || 'system');
      return c.json({
        ...channel,
        credentials: { configured: true },
      }, 201);
    } catch (error) {
      return c.json({ error: getErrorMessage(error, 'Failed to create channel') }, 400);
    }
  });

  /**
   * Get a channel by ID
   */
  app.get('/:id', (c) => {
    const id = c.req.param('id');
    const channel = channelManager.getChannel(id);

    if (!channel) {
      return c.json({ error: 'Channel not found' }, 404);
    }

    return c.json({
      ...channel,
      credentials: { configured: true },
    });
  });

  /**
   * Update a channel
   */
  app.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const body = await parseBody(c, UpdateChannelSchema);

    try {
      const channel = await channelManager.updateChannel(id, body);

      if (!channel) {
        return c.json({ error: 'Channel not found' }, 404);
      }

      return c.json({
        ...channel,
        credentials: { configured: true },
      });
    } catch (error) {
      return c.json({ error: getErrorMessage(error, 'Failed to update channel') }, 400);
    }
  });

  /**
   * Delete a channel
   */
  app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const deleted = await channelManager.deleteChannel(id);

    if (!deleted) {
      return c.json({ error: 'Channel not found' }, 404);
    }

    return c.json({ success: true });
  });

  // ==========================================================================
  // Binding CRUD
  // ==========================================================================

  /**
   * List bindings for a channel
   */
  app.get('/:id/bindings', (c) => {
    const channelId = c.req.param('id');
    
    const channel = channelManager.getChannel(channelId);
    if (!channel) {
      return c.json({ error: 'Channel not found' }, 404);
    }

    const bindings = channelManager.listBindings(channelId);
    return c.json({ bindings });
  });

  /**
   * Create a binding
   */
  app.post('/:id/bindings', async (c) => {
    const channelId = c.req.param('id');
    const user = (c as any).get('user') as AuthUser | undefined;
    const body = await parseBody(c, CreateBindingSchema);

    if (body.triggerConfig.events.length === 0) {
      return c.json({ error: 'triggerConfig.events must not be empty' }, 400);
    }

    try {
      const binding = channelManager.createBinding(channelId, body, user?.id || 'system');
      return c.json(binding, 201);
    } catch (error) {
      const msg = getErrorMessage(error, 'Failed to create binding');
      const status = msg.includes('not found') ? 404 : 400;
      return c.json({ error: msg }, status);
    }
  });

  /**
   * Get a specific binding
   */
  app.get('/:id/bindings/:bindingId', (c) => {
    const channelId = c.req.param('id');
    const bindingId = c.req.param('bindingId');

    const binding = channelManager.getBinding(channelId, bindingId);
    if (!binding) {
      return c.json({ error: 'Binding not found' }, 404);
    }

    return c.json(binding);
  });

  /**
   * Update a binding
   */
  app.patch('/:id/bindings/:bindingId', async (c) => {
    const channelId = c.req.param('id');
    const bindingId = c.req.param('bindingId');
    const body = await parseBody(c, UpdateBindingSchema);

    const binding = channelManager.updateBinding(channelId, bindingId, body);
    if (!binding) {
      return c.json({ error: 'Binding not found' }, 404);
    }

    return c.json(binding);
  });

  /**
   * Delete a binding
   */
  app.delete('/:id/bindings/:bindingId', (c) => {
    const channelId = c.req.param('id');
    const bindingId = c.req.param('bindingId');

    const deleted = channelManager.deleteBinding(channelId, bindingId);
    if (!deleted) {
      return c.json({ error: 'Binding not found' }, 404);
    }

    return c.json({ success: true });
  });

  // ==========================================================================
  // Outbound Messaging
  // ==========================================================================

  /**
   * Send an outbound message through a channel
   */
  app.post('/:id/send', async (c) => {
    const channelId = c.req.param('id');
    const body = await parseBody(c, SendMessageSchema);

    const channel = channelManager.getChannel(channelId);
    if (!channel) {
      return c.json({ error: 'Channel not found' }, 404);
    }

    if (!body.targetChannelId && !body.targetUserId) {
      return c.json({ error: 'targetChannelId or targetUserId is required' }, 400);
    }

    const outboundMessage: OutboundMessage = {
      channelId,
      projectId: body.projectId,
      sessionId: body.sessionId,
      targetThreadId: body.targetThreadId,
      targetChannelId: body.targetChannelId,
      targetUserId: body.targetUserId,
      content: body.content,
    };

    const queued = messageQueue.enqueueOutbound({
      channelId,
      payload: outboundMessage,
      sessionId: body.sessionId,
    });

    return c.json({ 
      success: true, 
      messageId: queued.id,
      status: queued.status,
    });
  });

  // ==========================================================================
  // Message Queue Status
  // ==========================================================================

  /**
   * Get message queue stats for a channel
   */
  app.get('/:id/queue', (c) => {
    const channelId = c.req.param('id');

    const channel = channelManager.getChannel(channelId);
    if (!channel) {
      return c.json({ error: 'Channel not found' }, 404);
    }

    const stats = messageQueue.getStats(channelId);
    return c.json({ stats });
  });

  /**
   * List recent messages in queue
   */
  app.get('/:id/queue/messages', (c) => {
    const channelId = c.req.param('id');
    const status = c.req.query('status') as 'pending' | 'processing' | 'completed' | 'failed' | undefined;
    const direction = c.req.query('direction') as 'inbound' | 'outbound' | undefined;
    const limit = parseInt(c.req.query('limit') || '50', 10);

    const channel = channelManager.getChannel(channelId);
    if (!channel) {
      return c.json({ error: 'Channel not found' }, 404);
    }

    const messages = messageQueue.listMessages(channelId, { status, direction, limit });
    return c.json({ messages });
  });

  return app;
}

/**
 * Create webhook routes for channel platforms
 * These routes do NOT require authentication (webhooks come from external platforms)
 */
export function createChannelWebhookRoutes(
  channelManager: ChannelManager,
  messageQueue: MessageQueueService
) {
  const app = new Hono();
  const channelRouter = new ChannelRouter(channelManager, messageQueue);

  /**
   * Slack Events API webhook
   * POST /channels/slack/events
   */
  app.post('/slack/events', async (c) => {
    // Get raw body for signature verification
    const rawBody = await c.req.text();
    
    // Build webhook request
    const request: WebhookRequest = {
      headers: {
        'x-slack-request-timestamp': c.req.header('x-slack-request-timestamp') || '',
        'x-slack-signature': c.req.header('x-slack-signature') || '',
        'content-type': c.req.header('content-type') || '',
      },
      body: rawBody,
      rawBody: Buffer.from(rawBody),
    };

    const result = await channelRouter.route('slack' as ChannelType, request);

    // Set response headers if provided
    if (result.headers) {
      for (const [key, value] of Object.entries(result.headers)) {
        c.header(key, value);
      }
    }

    if (typeof result.body === 'string') {
      return c.text(result.body, result.status as 200);
    }
    return c.json(result.body || {}, result.status as 200);
  });

  /**
   * Discord Interactions webhook
   * POST /channels/discord/events
   */
  app.post('/discord/events', async (c) => {
    const rawBody = await c.req.text();

    const request: WebhookRequest = {
      headers: {
        'x-signature-ed25519': c.req.header('x-signature-ed25519') || '',
        'x-signature-timestamp': c.req.header('x-signature-timestamp') || '',
        'content-type': c.req.header('content-type') || '',
      },
      body: rawBody,
      rawBody: Buffer.from(rawBody),
    };

    const result = await channelRouter.route('discord' as ChannelType, request);

    if (result.headers) {
      for (const [key, value] of Object.entries(result.headers)) {
        c.header(key, value);
      }
    }

    if (typeof result.body === 'string') {
      return c.text(result.body, result.status as 200);
    }
    return c.json(result.body || {}, result.status as 200);
  });

  /**
   * Telegram Bot API webhook
   * POST /channels/telegram/events
   */
  app.post('/telegram/events', async (c) => {
    const rawBody = await c.req.text();

    const request: WebhookRequest = {
      headers: {
        'x-telegram-bot-api-secret-token': c.req.header('x-telegram-bot-api-secret-token') || '',
        'content-type': c.req.header('content-type') || '',
      },
      body: rawBody,
      rawBody: Buffer.from(rawBody),
    };

    const result = await channelRouter.route('telegram' as ChannelType, request);

    if (result.headers) {
      for (const [key, value] of Object.entries(result.headers)) {
        c.header(key, value);
      }
    }

    if (typeof result.body === 'string') {
      return c.text(result.body, result.status as 200);
    }
    return c.json(result.body || {}, result.status as 200);
  });

  return app;
}
