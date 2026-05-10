/**
 * Push Notification routes
 * API for managing Web Push subscriptions, preferences, and sending test notifications.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { PushNotificationService } from '../services/push-notification.js';
import { getErrorMessage } from '../utils/errors.js';
import { parseBody, parseBodyOptional } from '../utils/validation.js';
import {
  PushSubscribeSchema,
  PushUnsubscribeSchema,
  NotificationPreferencesSchema,
  TestNotificationSchema,
} from '../schemas/index.js';

export function createNotificationRoutes(pushService: PushNotificationService) {
  const app = new Hono();

  /**
   * GET /notifications/vapid-key
   * Get the public VAPID key for client-side push subscription.
   * This endpoint is also available without auth (for service worker registration).
   */
  app.get('/vapid-key', (c) => {
    return c.json({ publicKey: pushService.getPublicKey() });
  });

  /**
   * POST /notifications/subscribe
   * Register a push subscription.
   *
   * The userId is automatically set from the authenticated user context.
   * In multi-user mode, userId is required (enforced via auth middleware).
   * In single-user mode, it defaults to the system user.
   */
  app.post('/subscribe', async (c) => {
    try {
      const body = await parseBody(c, PushSubscribeSchema);

      // Always use the authenticated user's ID for the subscription.
      // This prevents users from subscribing on behalf of other users.
      const user = (c as any).get('user') as { id: string } | undefined;
      const userId = user?.id ?? body.userId;

      const subscription = pushService.subscribe({
        endpoint: body.endpoint,
        keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
        userId,
        deviceName: body.deviceName,
      });

      return c.json(subscription, 201);
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      return c.json({ error: getErrorMessage(error) }, 500);
    }
  });

  /**
   * POST /notifications/unsubscribe
   * Remove a push subscription
   */
  app.post('/unsubscribe', async (c) => {
    try {
      const body = await parseBody(c, PushUnsubscribeSchema);

      const removed = pushService.unsubscribe(body.endpoint);

      if (!removed) {
        return c.json({ error: 'Subscription not found' }, 404);
      }

      return c.json({ success: true });
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      return c.json({ error: getErrorMessage(error) }, 500);
    }
  });

  /**
   * GET /notifications/subscriptions
   * List all push subscriptions
   */
  app.get('/subscriptions', (c) => {
    const subscriptions = pushService.listSubscriptions();
    return c.json({ subscriptions });
  });

  /**
   * PUT /notifications/preferences
   * Set notification preferences for a subscription
   */
  app.put('/preferences', async (c) => {
    try {
      const body = await parseBody(c, NotificationPreferencesSchema);

      pushService.setPreferences(body.subscriptionId, body.preferences);

      return c.json({ success: true });
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      return c.json({ error: getErrorMessage(error) }, 500);
    }
  });

  /**
   * GET /notifications/preferences/:subscriptionId
   * Get notification preferences for a subscription
   */
  app.get('/preferences/:subscriptionId', (c) => {
    const subscriptionId = c.req.param('subscriptionId');
    const preferences = pushService.getPreferences(subscriptionId);
    return c.json({ preferences });
  });

  /**
   * POST /notifications/test
   * Send a test notification to all subscribers
   */
  app.post('/test', async (c) => {
    try {
      const body = await parseBodyOptional(c, TestNotificationSchema, {});

      const result = await pushService.notify('test', {
        title: body.title || 'OpenMgr Test Notification',
        body: body.body || 'This is a test push notification from your OpenMgr server.',
        tag: 'test',
        data: {
          deeplink: body.projectId
            ? `openmgr://projects/${body.projectId}`
            : 'openmgr://notifications',
          type: 'test',
          projectId: body.projectId,
        },
      }, body.projectId);

      return c.json(result);
    } catch (error) {
      return c.json({ error: getErrorMessage(error) }, 500);
    }
  });

  return app;
}
