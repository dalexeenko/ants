import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createAgentCommsRoutes } from './agent-comms.js';
import type { AgentCommsService } from '../services/agent-comms.js';

describe('agent-comms routes', () => {
  let app: Hono;
  let mockAgentComms: Partial<AgentCommsService>;

  const testMessage = {
    id: 'msg-1',
    fromProjectId: 'proj-1',
    toProjectId: 'proj-2',
    type: 'request',
    action: 'code_review',
    subject: 'Please review PR #42',
    content: 'Review the changes in PR #42',
    status: 'delivered',
    createdAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    mockAgentComms = {
      sendMessage: vi.fn().mockReturnValue({ ...testMessage, id: 'msg-new' }),
      getInbox: vi.fn().mockReturnValue([testMessage]),
      getOutbox: vi.fn().mockReturnValue([testMessage]),
      getMessage: vi.fn().mockReturnValue(testMessage),
      getThread: vi.fn().mockReturnValue([testMessage]),
    };

    app = new Hono();
    const routes = createAgentCommsRoutes(mockAgentComms as AgentCommsService);
    app.route('/agent-comms', routes);
  });

  describe('POST /agent-comms/messages', () => {
    it('should send a message', async () => {
      const res = await app.request('/agent-comms/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromProjectId: 'proj-1',
          toProjectId: 'proj-2',
          content: 'Hello from agent 1',
          subject: 'Greeting',
          action: 'custom',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBe('msg-new');
    });

    it('should return 400 when fromProjectId is missing', async () => {
      const res = await app.request('/agent-comms/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toProjectId: 'proj-2', content: 'Hello' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('fromProjectId is required');
    });

    it('should return 400 when toProjectId is missing', async () => {
      const res = await app.request('/agent-comms/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromProjectId: 'proj-1', content: 'Hello' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('toProjectId is required');
    });

    it('should return 400 when content is missing', async () => {
      const res = await app.request('/agent-comms/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromProjectId: 'proj-1', toProjectId: 'proj-2' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('content is required');
    });

    it('should use default type and action when not specified', async () => {
      await app.request('/agent-comms/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromProjectId: 'proj-1',
          toProjectId: 'proj-2',
          content: 'Hello',
        }),
      });

      expect(mockAgentComms.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'request',
          action: 'custom',
        }),
      );
    });

    it('should return 500 when sendMessage throws', async () => {
      (mockAgentComms.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Target project not found');
      });

      const res = await app.request('/agent-comms/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromProjectId: 'proj-1',
          toProjectId: 'non-existent',
          content: 'Hello',
        }),
      });

      expect(res.status).toBe(500);
    });
  });

  describe('GET /agent-comms/projects/:projectId/inbox', () => {
    it('should get inbox messages', async () => {
      const res = await app.request('/agent-comms/projects/proj-2/inbox');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.messages).toHaveLength(1);
    });

    it('should pass query filters', async () => {
      await app.request('/agent-comms/projects/proj-2/inbox?status=unread&limit=10');

      expect(mockAgentComms.getInbox).toHaveBeenCalledWith('proj-2', {
        status: 'unread',
        limit: 10,
      });
    });

    it('should use default limit of 50', async () => {
      await app.request('/agent-comms/projects/proj-2/inbox');

      expect(mockAgentComms.getInbox).toHaveBeenCalledWith('proj-2', {
        status: undefined,
        limit: 50,
      });
    });
  });

  describe('GET /agent-comms/projects/:projectId/outbox', () => {
    it('should get outbox messages', async () => {
      const res = await app.request('/agent-comms/projects/proj-1/outbox');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.messages).toHaveLength(1);
    });

    it('should pass limit parameter', async () => {
      await app.request('/agent-comms/projects/proj-1/outbox?limit=25');

      expect(mockAgentComms.getOutbox).toHaveBeenCalledWith('proj-1', 25);
    });

    it('should use default limit of 50', async () => {
      await app.request('/agent-comms/projects/proj-1/outbox');

      expect(mockAgentComms.getOutbox).toHaveBeenCalledWith('proj-1', 50);
    });
  });

  describe('GET /agent-comms/messages/:messageId', () => {
    it('should get a specific message', async () => {
      const res = await app.request('/agent-comms/messages/msg-1');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe('msg-1');
    });

    it('should return 404 when message not found', async () => {
      (mockAgentComms.getMessage as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await app.request('/agent-comms/messages/non-existent');

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Message not found');
    });
  });

  describe('GET /agent-comms/messages/:messageId/thread', () => {
    it('should get a conversation thread', async () => {
      const res = await app.request('/agent-comms/messages/msg-1/thread');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.messages).toHaveLength(1);
      expect(mockAgentComms.getThread).toHaveBeenCalledWith('msg-1');
    });

    it('should return empty thread when no messages', async () => {
      (mockAgentComms.getThread as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const res = await app.request('/agent-comms/messages/msg-1/thread');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.messages).toEqual([]);
    });
  });
});
