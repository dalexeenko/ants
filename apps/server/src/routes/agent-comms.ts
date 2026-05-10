/**
 * Agent Communication routes
 * API for cross-project agent-to-agent messaging.
 */

import { Hono } from 'hono';
import type { AgentCommsService } from '../services/agent-comms.js';
import { getErrorMessage } from '../utils/errors.js';
import { parseBody } from '../utils/validation.js';
import { SendAgentMessageSchema } from '../schemas/index.js';

export function createAgentCommsRoutes(agentComms: AgentCommsService) {
  const app = new Hono();

  /**
   * POST /agent-comms/messages
   * Send a message from one agent to another
   */
  app.post('/messages', async (c) => {
    const body = await parseBody(c, SendAgentMessageSchema);

    try {
      const result = agentComms.sendMessage({
        fromProjectId: body.fromProjectId,
        toProjectId: body.toProjectId,
        type: body.type || 'request',
        action: body.action || 'custom',
        subject: body.subject,
        content: body.content,
        metadata: body.metadata,
        parentMessageId: body.parentMessageId,
      });

      return c.json(result, 201);
    } catch (error) {
      return c.json({ error: getErrorMessage(error) }, 500);
    }
  });

  /**
   * GET /agent-comms/projects/:projectId/inbox
   * Get incoming messages for a project
   */
  app.get('/projects/:projectId/inbox', (c) => {
    const projectId = c.req.param('projectId');
    const status = c.req.query('status');
    const limit = parseInt(c.req.query('limit') || '50', 10);

    const messages = agentComms.getInbox(projectId, { status: status || undefined, limit });
    return c.json({ messages });
  });

  /**
   * GET /agent-comms/projects/:projectId/outbox
   * Get sent messages from a project
   */
  app.get('/projects/:projectId/outbox', (c) => {
    const projectId = c.req.param('projectId');
    const limit = parseInt(c.req.query('limit') || '50', 10);

    const messages = agentComms.getOutbox(projectId, limit);
    return c.json({ messages });
  });

  /**
   * GET /agent-comms/messages/:messageId
   * Get a specific message
   */
  app.get('/messages/:messageId', (c) => {
    const messageId = c.req.param('messageId');
    const message = agentComms.getMessage(messageId);

    if (!message) {
      return c.json({ error: 'Message not found' }, 404);
    }

    return c.json(message);
  });

  /**
   * GET /agent-comms/messages/:messageId/thread
   * Get a conversation thread
   */
  app.get('/messages/:messageId/thread', (c) => {
    const messageId = c.req.param('messageId');
    const thread = agentComms.getThread(messageId);

    return c.json({ messages: thread });
  });

  return app;
}
