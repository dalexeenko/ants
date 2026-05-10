import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createWebhookRoutes, createWebhookIngestRoutes } from './webhooks.js';
import type { WebhookManager } from '../services/webhook-manager.js';
import type { FileWatcherManager } from '../services/file-watcher-manager.js';

describe('webhook routes', () => {
  let app: Hono;
  let mockWebhookManager: Partial<WebhookManager>;
  let mockFileWatcherManager: Partial<FileWatcherManager>;

  const testEndpoint = {
    id: 'wh-1',
    projectId: 'proj-1',
    name: 'GitHub Webhook',
    slug: 'github-push',
    source: 'github',
    promptTemplate: 'Handle {{event}}',
    enabled: true,
    createdAt: '2024-01-01T00:00:00.000Z',
  };

  const testWatcher = {
    id: 'fw-1',
    projectId: 'proj-1',
    name: 'Config Watcher',
    watchPath: '/etc/config',
    promptTemplate: 'File changed: {{path}}',
    enabled: true,
    createdAt: '2024-01-01T00:00:00.000Z',
  };

  const testDeliveries = [
    { id: 'del-1', status: 'completed', receivedAt: '2024-01-01' },
  ];

  beforeEach(() => {
    mockWebhookManager = {
      listEndpoints: vi.fn().mockReturnValue([testEndpoint]),
      getEndpoint: vi.fn().mockReturnValue(testEndpoint),
      createEndpoint: vi.fn().mockReturnValue({ ...testEndpoint, id: 'wh-new' }),
      updateEndpoint: vi.fn().mockReturnValue({ ...testEndpoint, name: 'Updated' }),
      deleteEndpoint: vi.fn().mockReturnValue(true),
      getDeliveries: vi.fn().mockReturnValue(testDeliveries),
      handleWebhook: vi.fn().mockReturnValue({
        status: 200,
        message: 'Webhook received',
        deliveryId: 'del-new',
      }),
    };

    mockFileWatcherManager = {
      listWatchers: vi.fn().mockReturnValue([testWatcher]),
      getWatcher: vi.fn().mockReturnValue(testWatcher),
      createWatcher: vi.fn().mockReturnValue({ ...testWatcher, id: 'fw-new' }),
      updateWatcher: vi.fn().mockReturnValue({ ...testWatcher, name: 'Updated' }),
      deleteWatcher: vi.fn().mockReturnValue(true),
    };

    app = new Hono();
    const routes = createWebhookRoutes(
      mockWebhookManager as WebhookManager,
      mockFileWatcherManager as FileWatcherManager,
    );
    app.route('/api', routes);
  });

  // ==========================================================================
  // Webhook Endpoint CRUD
  // ==========================================================================

  describe('GET /:projectId/webhooks', () => {
    it('should list webhook endpoints', async () => {
      const res = await app.request('/api/proj-1/webhooks');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.endpoints).toHaveLength(1);
      expect(body.endpoints[0].name).toBe('GitHub Webhook');
    });
  });

  describe('POST /:projectId/webhooks', () => {
    it('should create a webhook endpoint', async () => {
      const res = await app.request('/api/proj-1/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Webhook',
          slug: 'new-webhook',
          source: 'github',
          promptTemplate: 'Handle {{event}}',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBe('wh-new');
    });

    it('should return 400 when name is missing', async () => {
      const res = await app.request('/api/proj-1/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'test', source: 'github', promptTemplate: 'x' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('name is required');
    });

    it('should return 400 when slug is missing', async () => {
      const res = await app.request('/api/proj-1/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', source: 'github', promptTemplate: 'x' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('slug is required');
    });

    it('should return 400 when source is missing', async () => {
      const res = await app.request('/api/proj-1/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', slug: 'test', promptTemplate: 'x' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('source is required');
    });

    it('should return 400 when promptTemplate is missing', async () => {
      const res = await app.request('/api/proj-1/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', slug: 'test', source: 'github' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('promptTemplate is required');
    });

    it('should return 400 for invalid source', async () => {
      const res = await app.request('/api/proj-1/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test',
          slug: 'test',
          source: 'invalid',
          promptTemplate: 'x',
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Invalid source');
    });

    it('should return 400 for invalid slug format', async () => {
      const res = await app.request('/api/proj-1/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test',
          slug: '-invalid',
          source: 'github',
          promptTemplate: 'x',
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('slug must be URL-safe');
    });

    it('should return 409 for duplicate slug', async () => {
      (mockWebhookManager.createEndpoint as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('UNIQUE constraint failed');
      });

      const res = await app.request('/api/proj-1/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test',
          slug: 'github-push',
          source: 'github',
          promptTemplate: 'x',
        }),
      });

      expect(res.status).toBe(409);
    });
  });

  describe('GET /:projectId/webhooks/:webhookId', () => {
    it('should get a webhook endpoint', async () => {
      const res = await app.request('/api/proj-1/webhooks/wh-1');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe('wh-1');
    });

    it('should return 404 when not found', async () => {
      (mockWebhookManager.getEndpoint as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await app.request('/api/proj-1/webhooks/non-existent');

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Webhook endpoint not found');
    });
  });

  describe('PATCH /:projectId/webhooks/:webhookId', () => {
    it('should update a webhook endpoint', async () => {
      const res = await app.request('/api/proj-1/webhooks/wh-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(200);
    });

    it('should return 404 when not found', async () => {
      (mockWebhookManager.updateEndpoint as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await app.request('/api/proj-1/webhooks/wh-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(404);
    });

    it('should return 400 for invalid source on update', async () => {
      const res = await app.request('/api/proj-1/webhooks/wh-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'invalid' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Invalid source');
    });

    it('should return 400 for invalid slug on update', async () => {
      const res = await app.request('/api/proj-1/webhooks/wh-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: '-bad' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('slug must be URL-safe');
    });

    it('should return 409 for duplicate slug on update', async () => {
      (mockWebhookManager.updateEndpoint as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('UNIQUE constraint failed');
      });

      const res = await app.request('/api/proj-1/webhooks/wh-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(409);
    });
  });

  describe('DELETE /:projectId/webhooks/:webhookId', () => {
    it('should delete a webhook endpoint', async () => {
      const res = await app.request('/api/proj-1/webhooks/wh-1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it('should return 404 when not found', async () => {
      (mockWebhookManager.deleteEndpoint as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const res = await app.request('/api/proj-1/webhooks/non-existent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /:projectId/webhooks/:webhookId/deliveries', () => {
    it('should list deliveries', async () => {
      const res = await app.request('/api/proj-1/webhooks/wh-1/deliveries');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deliveries).toHaveLength(1);
    });

    it('should return 404 when endpoint not found', async () => {
      (mockWebhookManager.getEndpoint as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await app.request('/api/proj-1/webhooks/non-existent/deliveries');

      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // File Watcher CRUD
  // ==========================================================================

  describe('GET /:projectId/watchers', () => {
    it('should list file watchers', async () => {
      const res = await app.request('/api/proj-1/watchers');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.watchers).toHaveLength(1);
    });
  });

  describe('POST /:projectId/watchers', () => {
    it('should create a file watcher', async () => {
      const res = await app.request('/api/proj-1/watchers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Watcher',
          watchPath: '/var/data',
          promptTemplate: 'File changed',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBe('fw-new');
    });

    it('should return 400 when name is missing', async () => {
      const res = await app.request('/api/proj-1/watchers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchPath: '/var', promptTemplate: 'x' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('name is required');
    });

    it('should return 400 when watchPath is missing', async () => {
      const res = await app.request('/api/proj-1/watchers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', promptTemplate: 'x' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('watchPath is required');
    });

    it('should return 400 when promptTemplate is missing', async () => {
      const res = await app.request('/api/proj-1/watchers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', watchPath: '/var' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('promptTemplate is required');
    });

    it('should return 400 when createWatcher throws', async () => {
      (mockFileWatcherManager.createWatcher as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Path not accessible');
      });

      const res = await app.request('/api/proj-1/watchers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test',
          watchPath: '/nonexistent',
          promptTemplate: 'x',
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /:projectId/watchers/:watcherId', () => {
    it('should get a file watcher', async () => {
      const res = await app.request('/api/proj-1/watchers/fw-1');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe('fw-1');
    });

    it('should return 404 when not found', async () => {
      (mockFileWatcherManager.getWatcher as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await app.request('/api/proj-1/watchers/non-existent');

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('File watcher not found');
    });
  });

  describe('PATCH /:projectId/watchers/:watcherId', () => {
    it('should update a file watcher', async () => {
      const res = await app.request('/api/proj-1/watchers/fw-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(200);
    });

    it('should return 404 when not found', async () => {
      (mockFileWatcherManager.updateWatcher as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await app.request('/api/proj-1/watchers/non-existent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(404);
    });

    it('should return 400 when updateWatcher throws', async () => {
      (mockFileWatcherManager.updateWatcher as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Invalid path');
      });

      const res = await app.request('/api/proj-1/watchers/fw-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchPath: '/bad' }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /:projectId/watchers/:watcherId', () => {
    it('should delete a file watcher', async () => {
      const res = await app.request('/api/proj-1/watchers/fw-1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it('should return 404 when not found', async () => {
      (mockFileWatcherManager.deleteWatcher as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const res = await app.request('/api/proj-1/watchers/non-existent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });
});

describe('webhook ingest routes', () => {
  let app: Hono;
  let mockWebhookManager: Partial<WebhookManager>;

  beforeEach(() => {
    mockWebhookManager = {
      handleWebhook: vi.fn().mockReturnValue({
        status: 200,
        message: 'Webhook received',
        deliveryId: 'del-1',
      }),
    };

    app = new Hono();
    const routes = createWebhookIngestRoutes(mockWebhookManager as WebhookManager);
    app.route('/hooks', routes);
  });

  describe('POST /hooks/:projectId/:slug', () => {
    it('should receive a webhook delivery', async () => {
      const res = await app.request('/hooks/proj-1/github-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'push' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.message).toBe('Webhook received');
      expect(body.deliveryId).toBe('del-1');
    });

    it('should pass headers and raw body to handleWebhook', async () => {
      const payload = JSON.stringify({ action: 'push' });
      await app.request('/hooks/proj-1/github-push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'push',
        },
        body: payload,
      });

      expect(mockWebhookManager.handleWebhook).toHaveBeenCalledWith(
        'proj-1',
        'github-push',
        expect.objectContaining({
          'content-type': 'application/json',
        }),
        payload,
      );
    });
  });
});
