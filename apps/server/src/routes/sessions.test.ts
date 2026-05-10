import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSessionRoutes } from './sessions.js';
import { createSessionStreamingRoutes } from './session-streaming.js';
import type { ProjectManager } from '../services/project-manager.js';
import type { IAgentClient } from '../services/ants-agent-manager.js';

vi.mock('../services/worktree-manager.js', () => ({
  worktreeManager: {
    createWorktree: vi.fn().mockResolvedValue({
      id: 'wt-1',
      branch: 'ants/session-wt-1',
      baseBranch: 'main',
      path: '/tmp/test-project/.worktrees/wt-1',
    }),
    renameWorktreeBranch: vi.fn().mockResolvedValue(undefined),
    associateSession: vi.fn().mockResolvedValue(undefined),
    diffBySession: vi.fn().mockResolvedValue(null),
    mergeBySession: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
    discardBySession: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
  },
}));

// Import the mocked module to access mock functions
import { worktreeManager as _worktreeManager } from '../services/worktree-manager.js';
const mockWorktreeManager = _worktreeManager as Record<string, ReturnType<typeof vi.fn>>;

describe('sessions routes', () => {
  let app: Hono;
  let mockProjectManager: Partial<ProjectManager>;
  let mockAgentClient: Partial<IAgentClient>;
  const testProjectId = 'test-project-id';
  const testSessionId = 'test-session-id';

  beforeEach(() => {
    mockAgentClient = {
      isHealthy: vi.fn().mockResolvedValue(true),
      listSessions: vi.fn().mockResolvedValue([
        {
          id: testSessionId,
          workingDirectory: '/tmp/test-project',
          title: 'Test Session',
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
        },
      ]),
      getSession: vi.fn().mockResolvedValue({
        id: testSessionId,
        workingDirectory: '/tmp/test-project',
        title: 'Test Session',
      }),
      createSession: vi.fn().mockResolvedValue({
        id: testSessionId,
        workingDirectory: '/tmp/test-project',
      }),
      deleteSession: vi.fn().mockResolvedValue({ success: true }),
      getMessages: vi.fn().mockResolvedValue({
        messages: [
          { id: 'msg-1', role: 'user', content: 'Hello', sequence: 0 },
          { id: 'msg-2', role: 'assistant', content: 'Hi there!', sequence: 1 },
        ],
      }),
      sendPromptAsync: vi.fn().mockResolvedValue({
        status: 'completed',
        success: true,
        message: 'Hello! How can I help you?',
      }),
      abortSession: vi.fn().mockResolvedValue({ success: true }),
    };

    mockProjectManager = {
      getProject: vi.fn().mockResolvedValue({
        id: testProjectId,
        name: 'Test Project',
        workingDirectory: '/tmp/test-project',
      }),
      getClient: vi.fn().mockResolvedValue(mockAgentClient),
    };

    // Reset worktree manager mock call counts (implementations stay)
    mockWorktreeManager.createWorktree.mockClear();
    mockWorktreeManager.renameWorktreeBranch.mockClear();
    mockWorktreeManager.associateSession.mockClear();

    app = new Hono();
    const sessionRoutes = createSessionRoutes(
      mockProjectManager as ProjectManager,
    );
    const streamingRoutes = createSessionStreamingRoutes(
      mockProjectManager as ProjectManager,
    );
    app.route('/projects', sessionRoutes);
    app.route('/projects', streamingRoutes);
  });

  describe('GET /projects/:projectId/sessions', () => {
    it('should list sessions for a project', async () => {
      const res = await app.request(`/projects/${testProjectId}/sessions`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe(testSessionId);
    });

    it('should return 404 when project not found', async () => {
      (mockProjectManager.getProject as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request(`/projects/non-existent/sessions`);

      expect(res.status).toBe(404);
    });
  });

  describe('POST /projects/:projectId/sessions', () => {
    it('should create a new session', async () => {
      const res = await app.request(`/projects/${testProjectId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Test Session' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBe(testSessionId);
      expect(mockAgentClient.createSession).toHaveBeenCalledWith({
        workingDirectory: '/tmp/test-project',
        title: 'Test Session',
        parentId: undefined,
        mode: undefined,
        userId: 'system',
      });
    });

    it('should return 404 when project not found', async () => {
      (mockProjectManager.getProject as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request(`/projects/non-existent/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(404);
    });

    it('should handle server errors', async () => {
      (mockAgentClient.createSession as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Server error')
      );

      const res = await app.request(`/projects/${testProjectId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Server error');
    });
  });

  describe('POST /projects/:projectId/sessions (worktree)', () => {
    it('should create worktree when useWorktree is true and worktreeEnabled is true', async () => {
      (mockProjectManager.getProject as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: testProjectId,
        name: 'Test Project',
        workingDirectory: '/tmp/test-project',
        worktreeEnabled: true,
      });

      const res = await app.request(`/projects/${testProjectId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ useWorktree: true }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.worktree).toBeDefined();
      expect(body.worktree.branch).toBe('ants/session-wt-1');
      expect(mockWorktreeManager.createWorktree).toHaveBeenCalledWith('/tmp/test-project');
    });

    it('should NOT create worktree when worktreeEnabled is false', async () => {
      (mockProjectManager.getProject as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: testProjectId,
        name: 'Test Project',
        workingDirectory: '/tmp/test-project',
        worktreeEnabled: false,
      });

      const res = await app.request(`/projects/${testProjectId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ useWorktree: true }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.worktree).toBeUndefined();
      expect(mockWorktreeManager.createWorktree).not.toHaveBeenCalled();
    });

    it('should NOT create worktree when worktreeEnabled is undefined', async () => {
      const res = await app.request(`/projects/${testProjectId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ useWorktree: true }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.worktree).toBeUndefined();
      expect(mockWorktreeManager.createWorktree).not.toHaveBeenCalled();
    });

    it('should NOT create worktree when useWorktree is false even if worktreeEnabled', async () => {
      (mockProjectManager.getProject as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: testProjectId,
        name: 'Test Project',
        workingDirectory: '/tmp/test-project',
        worktreeEnabled: true,
      });

      const res = await app.request(`/projects/${testProjectId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.worktree).toBeUndefined();
      expect(mockWorktreeManager.createWorktree).not.toHaveBeenCalled();
    });
  });

  describe('GET /projects/:projectId/sessions/:sessionId', () => {
    it('should get session details', async () => {
      const res = await app.request(
        `/projects/${testProjectId}/sessions/${testSessionId}`
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(testSessionId);
    });

    it('should return 404 when session not found', async () => {
      (mockAgentClient.getSession as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('404 {"error":"Session not found"}')
      );

      const res = await app.request(
        `/projects/${testProjectId}/sessions/non-existent`
      );

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /projects/:projectId/sessions/:sessionId', () => {
    it('should delete session', async () => {
      const res = await app.request(
        `/projects/${testProjectId}/sessions/${testSessionId}`,
        { method: 'DELETE' }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });
  });

  describe('GET /projects/:projectId/sessions/:sessionId/messages', () => {
    it('should get session messages from agent-server', async () => {
      const res = await app.request(
        `/projects/${testProjectId}/sessions/${testSessionId}/messages`
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(2);
      expect(body[0].role).toBe('user');
      expect(body[1].role).toBe('assistant');
    });

    it('should proxy paginated request when limit is set', async () => {
      (mockAgentClient as any).getMessagesPaginated = vi.fn().mockResolvedValue({
        messages: [
          { id: 'msg-2', role: 'assistant', content: 'Hi there!', sequence: 1 },
        ],
        hasMore: true,
      });

      const res = await app.request(
        `/projects/${testProjectId}/sessions/${testSessionId}/messages?limit=1`
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.messages).toHaveLength(1);
      expect(body.hasMore).toBe(true);
      expect((mockAgentClient as any).getMessagesPaginated).toHaveBeenCalledWith(
        testSessionId, 1, undefined
      );
    });

    it('should proxy paginated request with beforeSequence', async () => {
      (mockAgentClient as any).getMessagesPaginated = vi.fn().mockResolvedValue({
        messages: [
          { id: 'msg-1', role: 'user', content: 'Hello', sequence: 0 },
        ],
        hasMore: false,
      });

      const res = await app.request(
        `/projects/${testProjectId}/sessions/${testSessionId}/messages?limit=10&beforeSequence=1`
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.messages).toHaveLength(1);
      expect(body.hasMore).toBe(false);
      expect((mockAgentClient as any).getMessagesPaginated).toHaveBeenCalledWith(
        testSessionId, 10, 1
      );
    });

    it('should return 400 for invalid limit', async () => {
      const res = await app.request(
        `/projects/${testProjectId}/sessions/${testSessionId}/messages?limit=abc`
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('limit');
    });

    it('should return 400 for negative limit', async () => {
      const res = await app.request(
        `/projects/${testProjectId}/sessions/${testSessionId}/messages?limit=-5`
      );

      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid beforeSequence', async () => {
      const res = await app.request(
        `/projects/${testProjectId}/sessions/${testSessionId}/messages?limit=10&beforeSequence=xyz`
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('beforeSequence');
    });

    it('should use non-paginated path when limit is not set', async () => {
      const res = await app.request(
        `/projects/${testProjectId}/sessions/${testSessionId}/messages`
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      // Non-paginated returns array directly
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(2);
      expect(mockAgentClient.getMessages).toHaveBeenCalledWith(testSessionId);
    });

    it('should return 503 when agent client is not available', async () => {
      (mockProjectManager.getClient as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request(
        `/projects/${testProjectId}/sessions/${testSessionId}/messages?limit=10`
      );

      expect(res.status).toBe(503);
    });
  });

  describe('POST /projects/:projectId/sessions/:sessionId/prompt', () => {
    it('should send prompt and receive response', async () => {
      const res = await app.request(
        `/projects/${testProjectId}/sessions/${testSessionId}/prompt`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'Hello, agent!' }),
        }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.response).toBe('Hello! How can I help you?');
      expect(mockAgentClient.sendPromptAsync).toHaveBeenCalledWith(
        testSessionId,
        'Hello, agent!'
      );
    });

    it('should return 400 when prompt is missing', async () => {
      const res = await app.request(
        `/projects/${testProjectId}/sessions/${testSessionId}/prompt`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('prompt is required');
    });

    it('should return 404 when project not found', async () => {
      (mockProjectManager.getProject as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request(
        `/projects/non-existent/sessions/${testSessionId}/prompt`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'Hello' }),
        }
      );

      expect(res.status).toBe(404);
    });

    it('should return 500 when agent client fails', async () => {
      (mockProjectManager.getClient as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request(
        `/projects/${testProjectId}/sessions/${testSessionId}/prompt`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'Hello' }),
        }
      );

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Failed to start agent server');
    });
  });

  describe('POST /projects/:projectId/sessions/:sessionId/abort', () => {
    it('should abort session', async () => {
      const res = await app.request(
        `/projects/${testProjectId}/sessions/${testSessionId}/abort`,
        { method: 'POST' }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it('should return 404 when project not found', async () => {
      (mockProjectManager.getProject as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request(
        `/projects/non-existent/sessions/${testSessionId}/abort`,
        { method: 'POST' }
      );

      expect(res.status).toBe(404);
    });

    it('should return success even when no agent client', async () => {
      (mockProjectManager.getClient as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request(
        `/projects/${testProjectId}/sessions/${testSessionId}/abort`,
        { method: 'POST' }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });
  });

  describe('GET /projects/:projectId/providers', () => {
    it('should get available providers', async () => {
      const res = await app.request(
        `/projects/${testProjectId}/providers`
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      // Response comes from models.dev (or fallback) - should include at least anthropic
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(1);
      const anthropic = body.find((p: { id: string }) => p.id === 'anthropic');
      expect(anthropic).toBeDefined();
      expect(anthropic.models).toBeDefined();
      expect(Array.isArray(anthropic.models)).toBe(true);
    });
  });
});
