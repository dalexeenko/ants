import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createApprovalRoutes } from './approvals.js';
import type { ApprovalManager } from '../services/approval-manager.js';

describe('approval routes', () => {
  let app: Hono;
  let mockApprovalManager: Partial<ApprovalManager>;

  const testRule = {
    id: 'rule-1',
    projectId: 'proj-1',
    name: 'Block rm -rf',
    toolPattern: 'bash',
    argPatterns: { command: 'rm -rf' },
    action: 'block',
    priority: 1,
    enabled: true,
    createdAt: '2024-01-01T00:00:00.000Z',
  };

  const testRequest = {
    id: 'req-1',
    projectId: 'proj-1',
    ruleId: 'rule-1',
    sessionId: 'sess-1',
    toolName: 'bash',
    toolArgs: { command: 'rm -rf /' },
    status: 'pending',
    createdAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    mockApprovalManager = {
      listRules: vi.fn().mockReturnValue([testRule]),
      getRule: vi.fn().mockReturnValue(testRule),
      createRule: vi.fn().mockReturnValue({ ...testRule, id: 'rule-new' }),
      updateRule: vi.fn().mockReturnValue({ ...testRule, name: 'Updated Rule' }),
      deleteRule: vi.fn().mockReturnValue(true),
      listRequests: vi.fn().mockReturnValue([testRequest]),
      getRequest: vi.fn().mockReturnValue(testRequest),
      reviewRequest: vi.fn().mockReturnValue({ ...testRequest, status: 'approved' }),
    };

    app = new Hono();
    const routes = createApprovalRoutes(mockApprovalManager as ApprovalManager);
    app.route('/approvals', routes);
  });

  // ==========================================================================
  // Rules CRUD
  // ==========================================================================

  describe('GET /approvals/rules', () => {
    it('should list all rules', async () => {
      const res = await app.request('/approvals/rules');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rules).toHaveLength(1);
      expect(body.rules[0].name).toBe('Block rm -rf');
    });

    it('should filter by projectId', async () => {
      await app.request('/approvals/rules?projectId=proj-1');

      expect(mockApprovalManager.listRules).toHaveBeenCalledWith('proj-1');
    });

    it('should pass undefined when no projectId', async () => {
      await app.request('/approvals/rules');

      expect(mockApprovalManager.listRules).toHaveBeenCalledWith(undefined);
    });
  });

  describe('POST /approvals/rules', () => {
    it('should create a rule', async () => {
      const res = await app.request('/approvals/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Rule',
          toolPattern: 'bash',
          action: 'require_approval',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBe('rule-new');
    });

    it('should return 400 when name is missing', async () => {
      const res = await app.request('/approvals/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolPattern: 'bash', action: 'block' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('name is required');
    });

    it('should return 400 when toolPattern is missing', async () => {
      const res = await app.request('/approvals/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', action: 'block' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('toolPattern is required');
    });

    it('should return 400 when action is invalid', async () => {
      const res = await app.request('/approvals/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', toolPattern: 'bash', action: 'invalid' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('action');
      expect(body.error).toContain('Invalid option');
    });

    it('should return 400 when action is missing', async () => {
      const res = await app.request('/approvals/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', toolPattern: 'bash' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('action');
      expect(body.error).toContain('Invalid option');
    });
  });

  describe('GET /approvals/rules/:id', () => {
    it('should get a specific rule', async () => {
      const res = await app.request('/approvals/rules/rule-1');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe('rule-1');
    });

    it('should return 404 when rule not found', async () => {
      (mockApprovalManager.getRule as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await app.request('/approvals/rules/non-existent');

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Rule not found');
    });
  });

  describe('PATCH /approvals/rules/:id', () => {
    it('should update a rule', async () => {
      const res = await app.request('/approvals/rules/rule-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Rule' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('Updated Rule');
    });

    it('should return 400 for invalid action on update', async () => {
      const res = await app.request('/approvals/rules/rule-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'invalid' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('action');
      expect(body.error).toContain('Invalid option');
    });

    it('should return 404 when rule not found', async () => {
      (mockApprovalManager.updateRule as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await app.request('/approvals/rules/non-existent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Rule not found');
    });
  });

  describe('DELETE /approvals/rules/:id', () => {
    it('should delete a rule', async () => {
      const res = await app.request('/approvals/rules/rule-1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it('should return 404 when rule not found', async () => {
      (mockApprovalManager.deleteRule as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const res = await app.request('/approvals/rules/non-existent', { method: 'DELETE' });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Rule not found');
    });
  });

  // ==========================================================================
  // Approval Requests
  // ==========================================================================

  describe('GET /approvals/requests', () => {
    it('should list approval requests', async () => {
      const res = await app.request('/approvals/requests');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.requests).toHaveLength(1);
    });

    it('should filter by projectId and status', async () => {
      await app.request('/approvals/requests?projectId=proj-1&status=pending');

      expect(mockApprovalManager.listRequests).toHaveBeenCalledWith('proj-1', 'pending');
    });
  });

  describe('GET /approvals/requests/:id', () => {
    it('should get a specific request', async () => {
      const res = await app.request('/approvals/requests/req-1');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe('req-1');
    });

    it('should return 404 when request not found', async () => {
      (mockApprovalManager.getRequest as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await app.request('/approvals/requests/non-existent');

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Request not found');
    });
  });

  describe('POST /approvals/requests/:id/approve', () => {
    it('should approve a request', async () => {
      const res = await app.request('/approvals/requests/req-1/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewedBy: 'admin', note: 'Looks good' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('approved');
      expect(mockApprovalManager.reviewRequest).toHaveBeenCalledWith(
        'req-1', 'approved', 'admin', 'Looks good',
      );
    });

    it('should return 404 when request not found or already reviewed', async () => {
      (mockApprovalManager.reviewRequest as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await app.request('/approvals/requests/non-existent/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Request not found or already reviewed');
    });
  });

  describe('POST /approvals/requests/:id/deny', () => {
    it('should deny a request', async () => {
      (mockApprovalManager.reviewRequest as ReturnType<typeof vi.fn>).mockReturnValue({
        ...testRequest,
        status: 'denied',
      });

      const res = await app.request('/approvals/requests/req-1/deny', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewedBy: 'admin', note: 'Too dangerous' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('denied');
      expect(mockApprovalManager.reviewRequest).toHaveBeenCalledWith(
        'req-1', 'denied', 'admin', 'Too dangerous',
      );
    });

    it('should return 404 when request not found or already reviewed', async () => {
      (mockApprovalManager.reviewRequest as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await app.request('/approvals/requests/non-existent/deny', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // Project-scoped convenience
  // ==========================================================================

  describe('GET /approvals/projects/:projectId/pending', () => {
    it('should get pending requests for a project', async () => {
      const res = await app.request('/approvals/projects/proj-1/pending');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.requests).toBeDefined();
      expect(mockApprovalManager.listRequests).toHaveBeenCalledWith('proj-1', 'pending');
    });
  });
});
