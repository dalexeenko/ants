/**
 * User Notification Preference routes
 * Self-service endpoints for users to manage their own notification preferences.
 * Mounted at /me — provides current user info and notification preference management.
 *
 *   GET  /me                         — current user info
 *   GET  /me/notifications           — notification preferences
 *   PUT  /me/notifications/:projectId — set notification preference for a project
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { PushNotificationService } from '../services/push-notification.js';
import type { AuthUser } from '../auth/index.js';
import { getErrorMessage } from '../utils/errors.js';
import { parseBody } from '../utils/validation.js';
import { SetUserNotificationPreferenceSchema } from '../schemas/index.js';

export function createUserNotificationRoutes(pushService: PushNotificationService) {
  const app = new Hono();

  // ── GET / ─ Get current user info (mounted at /me) ──────────────────────
  app.get('/', (c) => {
    const user = (c as any).get('user') as AuthUser | undefined;
    if (!user) {
      return c.json({ error: 'Not authenticated' }, 401);
    }

    return c.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      enabled: user.enabled,
      createdAt: user.createdAt,
    });
  });

  // ── GET /notifications ─ Get notification preferences ──────────────────
  app.get('/notifications', (c) => {
    const user = (c as any).get('user') as AuthUser | undefined;
    if (!user) {
      return c.json({ error: 'Not authenticated' }, 401);
    }

    // Find subscriptions belonging to this user
    const allSubscriptions = pushService.listSubscriptions() as Array<{
      id: string;
      userId: string | null;
    }>;
    const userSubscriptions = allSubscriptions.filter(
      (sub) => sub.userId === user.id
    );

    // Gather preferences for each subscription
    const preferences: Array<{ subscriptionId: string; preferences: unknown[] }> = [];
    for (const sub of userSubscriptions) {
      const prefs = pushService.getPreferences(sub.id);
      preferences.push({ subscriptionId: sub.id, preferences: prefs });
    }

    return c.json({ subscriptions: userSubscriptions, preferences });
  });

  // ── PUT /notifications/:projectId ─ Set notification preference ────────
  app.put('/notifications/:projectId', async (c) => {
    const user = (c as any).get('user') as AuthUser | undefined;
    if (!user) {
      return c.json({ error: 'Not authenticated' }, 401);
    }

    const projectId = c.req.param('projectId');
    const body = await parseBody(c, SetUserNotificationPreferenceSchema);

    // Find subscriptions belonging to this user
    const allSubscriptions = pushService.listSubscriptions() as Array<{
      id: string;
      userId: string | null;
    }>;
    const userSubscriptions = allSubscriptions.filter(
      (sub) => sub.userId === user.id
    );

    if (userSubscriptions.length === 0) {
      return c.json(
        { error: 'No push subscriptions found for this user. Subscribe to push notifications first.' },
        404
      );
    }

    // Default event types if not specified
    const eventTypes = body.eventTypes ?? [
      'task_complete',
      'task_failed',
      'approval_needed',
      'agent_error',
    ];

    try {
      // Apply preference to all of the user's subscriptions
      for (const sub of userSubscriptions) {
        const preferences = eventTypes.map((eventType) => ({
          projectId,
          eventType,
          enabled: body.enabled,
        }));
        pushService.setPreferences(sub.id, preferences);
      }

      return c.json({ success: true, projectId, enabled: body.enabled, eventTypes });
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      return c.json({ error: getErrorMessage(error) }, 500);
    }
  });

  return app;
}
