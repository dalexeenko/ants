/**
 * Webhook & File Watcher API routes
 *
 * Provides:
 * - CRUD for webhook endpoints (project-scoped, authenticated)
 * - CRUD for file watchers (project-scoped, authenticated)
 * - Delivery history
 * - Public webhook ingestion endpoint (unauthenticated)
 */

import { Hono } from 'hono';
import type { WebhookManager } from '../services/webhook-manager.js';
import type { FileWatcherManager } from '../services/file-watcher-manager.js';
import type { AuthUser } from '../auth/provider.js';
import { getErrorMessage } from '../utils/errors.js';
import { parseBody } from '../utils/validation.js';
import {
  CreateWebhookEndpointSchema,
  UpdateWebhookEndpointSchema,
  CreateFileWatcherSchema,
  UpdateFileWatcherSchema,
} from '../schemas/index.js';

// ============================================================================
// Authenticated routes (project-scoped)
// ============================================================================

export function createWebhookRoutes(
  webhookManager: WebhookManager,
  fileWatcherManager: FileWatcherManager
) {
  const app = new Hono();

  // ==========================================================================
  // Webhook Endpoint CRUD
  // ==========================================================================

  /**
   * List webhook endpoints for a project
   */
  app.get('/:projectId/webhooks', (c) => {
    const projectId = c.req.param('projectId');
    const endpoints = webhookManager.listEndpoints(projectId);
    return c.json({ endpoints });
  });

  /**
   * Create a webhook endpoint
   */
  app.post('/:projectId/webhooks', async (c) => {
    const projectId = c.req.param('projectId');
    const user = (c as any).get('user') as AuthUser | undefined;
    const body = await parseBody(c, CreateWebhookEndpointSchema);

    const validSources = ['github', 'gitlab', 'bitbucket', 'generic', 'ci'];
    if (!validSources.includes(body.source)) {
      return c.json({ error: `Invalid source. Must be one of: ${validSources.join(', ')}` }, 400);
    }

    // Validate slug format (URL-safe)
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(body.slug)) {
      return c.json({ error: 'slug must be URL-safe (lowercase alphanumeric, hyphens, underscores, must start with alphanumeric)' }, 400);
    }

    try {
      const endpoint = webhookManager.createEndpoint({
        ...body,
        projectId,
      }, user?.id || 'system');
      return c.json(endpoint, 201);
    } catch (error) {
      const msg = getErrorMessage(error, 'Failed to create webhook endpoint');
      if (msg.includes('UNIQUE constraint')) {
        return c.json({ error: 'A webhook endpoint with this slug already exists for this project' }, 409);
      }
      return c.json({ error: msg }, 400);
    }
  });

  /**
   * Get a webhook endpoint
   */
  app.get('/:projectId/webhooks/:webhookId', (c) => {
    const webhookId = c.req.param('webhookId');
    const endpoint = webhookManager.getEndpoint(webhookId);

    if (!endpoint) {
      return c.json({ error: 'Webhook endpoint not found' }, 404);
    }

    return c.json(endpoint);
  });

  /**
   * Update a webhook endpoint
   */
  app.patch('/:projectId/webhooks/:webhookId', async (c) => {
    const webhookId = c.req.param('webhookId');
    const body = await parseBody(c, UpdateWebhookEndpointSchema);

    if (body.source !== undefined) {
      const validSources = ['github', 'gitlab', 'bitbucket', 'generic', 'ci'];
      if (!validSources.includes(body.source)) {
        return c.json({ error: `Invalid source. Must be one of: ${validSources.join(', ')}` }, 400);
      }
    }

    if (body.slug !== undefined && !/^[a-z0-9][a-z0-9_-]*$/.test(body.slug)) {
      return c.json({ error: 'slug must be URL-safe (lowercase alphanumeric, hyphens, underscores, must start with alphanumeric)' }, 400);
    }

    try {
      const endpoint = webhookManager.updateEndpoint(webhookId, body);

      if (!endpoint) {
        return c.json({ error: 'Webhook endpoint not found' }, 404);
      }

      return c.json(endpoint);
    } catch (error) {
      const msg = getErrorMessage(error, 'Failed to update webhook endpoint');
      if (msg.includes('UNIQUE constraint')) {
        return c.json({ error: 'A webhook endpoint with this slug already exists for this project' }, 409);
      }
      return c.json({ error: msg }, 400);
    }
  });

  /**
   * Delete a webhook endpoint
   */
  app.delete('/:projectId/webhooks/:webhookId', (c) => {
    const webhookId = c.req.param('webhookId');
    const deleted = webhookManager.deleteEndpoint(webhookId);

    if (!deleted) {
      return c.json({ error: 'Webhook endpoint not found' }, 404);
    }

    return c.json({ success: true });
  });

  /**
   * List deliveries for a webhook endpoint
   */
  app.get('/:projectId/webhooks/:webhookId/deliveries', (c) => {
    const webhookId = c.req.param('webhookId');
    const status = c.req.query('status');
    const limit = parseInt(c.req.query('limit') || '50', 10);

    const endpoint = webhookManager.getEndpoint(webhookId);
    if (!endpoint) {
      return c.json({ error: 'Webhook endpoint not found' }, 404);
    }

    const deliveries = webhookManager.getDeliveries(webhookId, { status, limit });
    return c.json({ deliveries });
  });

  // ==========================================================================
  // File Watcher CRUD
  // ==========================================================================

  /**
   * List file watchers for a project
   */
  app.get('/:projectId/watchers', (c) => {
    const projectId = c.req.param('projectId');
    const watchers = fileWatcherManager.listWatchers(projectId);
    return c.json({ watchers });
  });

  /**
   * Create a file watcher
   */
  app.post('/:projectId/watchers', async (c) => {
    const projectId = c.req.param('projectId');
    const user = (c as any).get('user') as AuthUser | undefined;
    const body = await parseBody(c, CreateFileWatcherSchema);

    try {
      const watcher = fileWatcherManager.createWatcher({
        ...body,
        projectId,
      }, user?.id || 'system');
      return c.json(watcher, 201);
    } catch (error) {
      return c.json({ error: getErrorMessage(error, 'Failed to create file watcher') }, 400);
    }
  });

  /**
   * Get a file watcher
   */
  app.get('/:projectId/watchers/:watcherId', (c) => {
    const watcherId = c.req.param('watcherId');
    const watcher = fileWatcherManager.getWatcher(watcherId);

    if (!watcher) {
      return c.json({ error: 'File watcher not found' }, 404);
    }

    return c.json(watcher);
  });

  /**
   * Update a file watcher
   */
  app.patch('/:projectId/watchers/:watcherId', async (c) => {
    const watcherId = c.req.param('watcherId');
    const body = await parseBody(c, UpdateFileWatcherSchema);

    try {
      const watcher = fileWatcherManager.updateWatcher(watcherId, body);

      if (!watcher) {
        return c.json({ error: 'File watcher not found' }, 404);
      }

      return c.json(watcher);
    } catch (error) {
      return c.json({ error: getErrorMessage(error, 'Failed to update file watcher') }, 400);
    }
  });

  /**
   * Delete a file watcher
   */
  app.delete('/:projectId/watchers/:watcherId', (c) => {
    const watcherId = c.req.param('watcherId');
    const deleted = fileWatcherManager.deleteWatcher(watcherId);

    if (!deleted) {
      return c.json({ error: 'File watcher not found' }, 404);
    }

    return c.json({ success: true });
  });

  return app;
}

// ============================================================================
// Public webhook ingestion (no auth required)
// ============================================================================

export function createWebhookIngestRoutes(webhookManager: WebhookManager) {
  const app = new Hono();

  /**
   * Receive a webhook delivery
   * POST /hooks/:projectId/:slug
   *
   * This is the public-facing endpoint that external services (GitHub, GitLab, etc.) send to.
   * No authentication is required - verification is done via HMAC signatures.
   */
  app.post('/:projectId/:slug', async (c) => {
    const projectId = c.req.param('projectId');
    const slug = c.req.param('slug');

    // Get raw body for signature verification
    const rawBody = await c.req.text();

    // Collect headers (lowercased)
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    const result = webhookManager.handleWebhook(projectId, slug, headers, rawBody);

    return c.json({
      message: result.message,
      deliveryId: result.deliveryId,
    }, result.status as 200);
  });

  return app;
}
