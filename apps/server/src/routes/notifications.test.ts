import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createNotificationRoutes } from './notifications.js';
import type { PushNotificationService } from '../services/push-notification.js';

describe('notification routes', () => {
  let app: Hono;
  let mockPushService: Partial<PushNotificationService>;

  const testSubscription = {
    id: 'sub-1',
    endpoint: 'https://push.example.com/sub/abc',
    keys: { p256dh: 'key1', auth: 'key2' },
    userId: 'user-1',
    deviceName: 'Chrome Desktop',
    createdAt: '2024-01-01T00:00:00.000Z',
  };

  const testPreferences = [
    { eventType: 'session.error', enabled: true },
    { eventType: 'session.complete', enabled: false },
  ];

  beforeEach(() => {
    mockPushService = {
      getPublicKey: vi.fn().mockReturnValue('VAPID_PUBLIC_KEY_BASE64'),
      subscribe: vi.fn().mockReturnValue(testSubscription),
      unsubscribe: vi.fn().mockReturnValue(true),
      listSubscriptions: vi.fn().mockReturnValue([testSubscription]),
      setPreferences: vi.fn(),
      getPreferences: vi.fn().mockReturnValue(testPreferences),
      notify: vi.fn().mockResolvedValue({ sent: 1, failed: 0 }),
    };

    app = new Hono();
    const routes = createNotificationRoutes(mockPushService as PushNotificationService);
    app.route('/notifications', routes);
  });

  describe('GET /notifications/vapid-key', () => {
    it('should return the public VAPID key', async () => {
      const res = await app.request('/notifications/vapid-key');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.publicKey).toBe('VAPID_PUBLIC_KEY_BASE64');
    });
  });

  describe('POST /notifications/subscribe', () => {
    it('should register a push subscription', async () => {
      const res = await app.request('/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'https://push.example.com/sub/abc',
          keys: { p256dh: 'key1', auth: 'key2' },
          userId: 'user-1',
          deviceName: 'Chrome Desktop',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBe('sub-1');
    });

    it('should return 400 when endpoint is missing', async () => {
      const res = await app.request('/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: { p256dh: 'key1', auth: 'key2' } }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('endpoint is required');
    });

    it('should return 400 when keys are missing', async () => {
      const res = await app.request('/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: 'https://push.example.com/sub/abc' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('keys is required');
    });

    it('should return 400 when keys.p256dh is missing', async () => {
      const res = await app.request('/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'https://push.example.com/sub/abc',
          keys: { auth: 'key2' },
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('keys.p256dh is required');
    });
  });

  describe('POST /notifications/unsubscribe', () => {
    it('should remove a push subscription', async () => {
      const res = await app.request('/notifications/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: 'https://push.example.com/sub/abc' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it('should return 400 when endpoint is missing', async () => {
      const res = await app.request('/notifications/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('endpoint is required');
    });

    it('should return 404 when subscription not found', async () => {
      (mockPushService.unsubscribe as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const res = await app.request('/notifications/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: 'https://push.example.com/sub/unknown' }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Subscription not found');
    });
  });

  describe('GET /notifications/subscriptions', () => {
    it('should list all push subscriptions', async () => {
      const res = await app.request('/notifications/subscriptions');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.subscriptions).toHaveLength(1);
      expect(body.subscriptions[0].id).toBe('sub-1');
    });
  });

  describe('PUT /notifications/preferences', () => {
    it('should set notification preferences', async () => {
      const res = await app.request('/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscriptionId: 'sub-1',
          preferences: [
            { eventType: 'session.error', enabled: true },
            { eventType: 'session.complete', enabled: false },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it('should return 400 when subscriptionId is missing', async () => {
      const res = await app.request('/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: [] }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('subscriptionId is required');
    });

    it('should return 400 when preferences is not an array', async () => {
      const res = await app.request('/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionId: 'sub-1', preferences: 'invalid' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('preferences');
      expect(body.error).toMatch(/expected array|must be an array/);
    });

    it('should return 400 when preference missing eventType', async () => {
      const res = await app.request('/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscriptionId: 'sub-1',
          preferences: [{ enabled: true }],
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('eventType');
      expect(body.error).toMatch(/is required|must have/);
    });

    it('should return 400 when preference missing enabled boolean', async () => {
      const res = await app.request('/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscriptionId: 'sub-1',
          preferences: [{ eventType: 'session.error', enabled: 'yes' }],
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('enabled');
      expect(body.error).toMatch(/expected boolean|boolean enabled/);
    });
  });

  describe('GET /notifications/preferences/:subscriptionId', () => {
    it('should get preferences for a subscription', async () => {
      const res = await app.request('/notifications/preferences/sub-1');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.preferences).toHaveLength(2);
    });
  });

  describe('POST /notifications/test', () => {
    it('should send a test notification', async () => {
      const res = await app.request('/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.sent).toBe(1);
      expect(body.failed).toBe(0);
    });

    it('should use custom title and body', async () => {
      await app.request('/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Custom Title', body: 'Custom Body', projectId: 'proj-1' }),
      });

      expect(mockPushService.notify).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({
          title: 'Custom Title',
          body: 'Custom Body',
        }),
        'proj-1',
      );
    });
  });
});
