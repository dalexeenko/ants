/**
 * Approval Workflow routes
 * API for managing approval rules and reviewing approval requests
 * for dangerous operations.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ApprovalManager } from '../services/approval-manager.js';
import type { AuthUser } from '../auth/provider.js';
import { getErrorMessage } from '../utils/errors.js';
import { parseBody, parseBodyOptional } from '../utils/validation.js';
import {
  CreateApprovalRuleSchema,
  UpdateApprovalRuleSchema,
  ReviewRequestSchema,
} from '../schemas/index.js';

export function createApprovalRoutes(approvalManager: ApprovalManager) {
  const app = new Hono();

  // ---- Rules CRUD ----

  /**
   * GET /approvals/rules
   * List all approval rules (optional ?projectId= to filter)
   */
  app.get('/rules', (c) => {
    const projectId = c.req.query('projectId');
    const rules = approvalManager.listRules(projectId || undefined);
    return c.json({ rules });
  });

  /**
   * POST /approvals/rules
   * Create a new approval rule
   */
  app.post('/rules', async (c) => {
    const user = (c as any).get('user') as AuthUser | undefined;
    const body = await parseBody(c, CreateApprovalRuleSchema);

    try {
      const rule = approvalManager.createRule({
        projectId: body.projectId,
        name: body.name,
        description: body.description,
        toolPattern: body.toolPattern,
        argPatterns: body.argPatterns,
        action: body.action,
        priority: body.priority,
      }, user?.id || 'system');

      return c.json(rule, 201);
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      return c.json({ error: getErrorMessage(error) }, 500);
    }
  });

  /**
   * GET /approvals/rules/:id
   * Get a specific approval rule
   */
  app.get('/rules/:id', (c) => {
    const id = c.req.param('id');
    const rule = approvalManager.getRule(id);

    if (!rule) {
      return c.json({ error: 'Rule not found' }, 404);
    }

    return c.json(rule);
  });

  /**
   * PATCH /approvals/rules/:id
   * Update an approval rule
   */
  app.patch('/rules/:id', async (c) => {
    const id = c.req.param('id');
    const body = await parseBody(c, UpdateApprovalRuleSchema);

    try {
      const rule = approvalManager.updateRule(id, {
        name: body.name,
        description: body.description,
        toolPattern: body.toolPattern,
        argPatterns: body.argPatterns,
        action: body.action,
        priority: body.priority,
        enabled: body.enabled,
      });

      if (!rule) {
        return c.json({ error: 'Rule not found' }, 404);
      }

      return c.json(rule);
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      return c.json({ error: getErrorMessage(error) }, 500);
    }
  });

  /**
   * DELETE /approvals/rules/:id
   * Delete an approval rule
   */
  app.delete('/rules/:id', (c) => {
    const id = c.req.param('id');
    const deleted = approvalManager.deleteRule(id);

    if (!deleted) {
      return c.json({ error: 'Rule not found' }, 404);
    }

    return c.json({ success: true });
  });

  // ---- Approval Requests ----

  /**
   * GET /approvals/requests
   * List approval requests (optional ?projectId=&status=)
   */
  app.get('/requests', (c) => {
    const projectId = c.req.query('projectId');
    const status = c.req.query('status');
    const requests = approvalManager.listRequests(projectId || undefined, status || undefined);
    return c.json({ requests });
  });

  /**
   * GET /approvals/requests/:id
   * Get a specific approval request
   */
  app.get('/requests/:id', (c) => {
    const id = c.req.param('id');
    const request = approvalManager.getRequest(id);

    if (!request) {
      return c.json({ error: 'Request not found' }, 404);
    }

    return c.json(request);
  });

  /**
   * POST /approvals/requests/:id/approve
   * Approve a pending request
   */
  app.post('/requests/:id/approve', async (c) => {
    const id = c.req.param('id');
    const body = await parseBodyOptional(c, ReviewRequestSchema, {});

    try {
      const result = approvalManager.reviewRequest(id, 'approved', body.reviewedBy, body.note);

      if (!result) {
        return c.json({ error: 'Request not found or already reviewed' }, 404);
      }

      return c.json(result);
    } catch (error) {
      return c.json({ error: getErrorMessage(error) }, 500);
    }
  });

  /**
   * POST /approvals/requests/:id/deny
   * Deny a pending request
   */
  app.post('/requests/:id/deny', async (c) => {
    const id = c.req.param('id');
    const body = await parseBodyOptional(c, ReviewRequestSchema, {});

    try {
      const result = approvalManager.reviewRequest(id, 'denied', body.reviewedBy, body.note);

      if (!result) {
        return c.json({ error: 'Request not found or already reviewed' }, 404);
      }

      return c.json(result);
    } catch (error) {
      return c.json({ error: getErrorMessage(error) }, 500);
    }
  });

  // ---- Project-scoped convenience ----

  /**
   * GET /approvals/projects/:projectId/pending
   * Get pending approval requests for a project
   */
  app.get('/projects/:projectId/pending', (c) => {
    const projectId = c.req.param('projectId');
    const requests = approvalManager.listRequests(projectId, 'pending');
    return c.json({ requests });
  });

  return app;
}
