/**
 * Push Notification Service
 * Implements Web Push (RFC 8030) with VAPID for self-hosted push notifications.
 * 
 * Notifications open the app via deeplinks (openmgr://) so users can
 * directly interact with the relevant project/session.
 * 
 * VAPID keys are auto-generated on first run and stored in the data directory.
 */

import { createECDH } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { eq, and } from 'drizzle-orm';
import type { DrizzleDB } from '../db/index.js';
import { v4 as uuid } from 'uuid';
import { pushSubscriptions, notificationPreferences } from '../db/schema.js';
import { createLogger } from '../utils/logger.js';
import webpush from 'web-push';

const log = createLogger('push');

interface VAPIDKeys {
  publicKey: string;  // base64url-encoded
  privateKey: string; // base64url-encoded
}

interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: {
    deeplink?: string; // openmgr://projects/:id/sessions/:sid
    type?: string;
    projectId?: string;
    sessionId?: string;
  };
  actions?: Array<{
    action: string;
    title: string;
  }>;
}

export class PushNotificationService {
  private db: DrizzleDB;
  private vapidKeys: VAPIDKeys;
  private dataDir: string;
  private contactEmail: string;
  private multiUserEnabled = false;
  private getEffectiveRole: ((userId: string, projectId: string) => string | null) | null = null;

  constructor(db: DrizzleDB, dataDir: string, contactEmail?: string) {
    this.db = db;
    this.dataDir = dataDir;
    // VAPID requires a valid mailto: or https: URL as the "sub" claim.
    // Apple's push service rejects localhost domains with BadJwtToken.
    this.contactEmail = contactEmail || 'mailto:webpush@openmgr.dev';
    this.vapidKeys = this.loadOrGenerateVAPIDKeys();
  }

  /**
   * Enable multi-user project access filtering for notifications.
   * When enabled, notifications for a specific project are only sent to
   * subscribers whose userId has access to that project.
   */
  setMultiUserMode(enabled: boolean, getEffectiveRole?: (userId: string, projectId: string) => string | null): void {
    this.multiUserEnabled = enabled;
    this.getEffectiveRole = getEffectiveRole ?? null;
  }

  /**
   * Get the public VAPID key for client subscription
   */
  getPublicKey(): string {
    return this.vapidKeys.publicKey;
  }

  /**
   * Register a push subscription
   */
  subscribe(subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    userId?: string;
    deviceName?: string;
  }): unknown {
    const id = uuid();
    const now = new Date();

    // Upsert - update if endpoint already exists
    const existing = this.db.select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, subscription.endpoint))
      .get();

    if (existing) {
      this.db.update(pushSubscriptions)
        .set({
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          userId: subscription.userId ?? existing.userId,
          deviceName: subscription.deviceName ?? existing.deviceName,
          lastUsedAt: now,
        })
        .where(eq(pushSubscriptions.id, existing.id))
        .run();
      return existing;
    }

    this.db.insert(pushSubscriptions).values({
      id,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userId: subscription.userId ?? null,
      deviceName: subscription.deviceName ?? null,
      createdAt: now,
    }).run();

    return this.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, id)).get();
  }

  /**
   * Remove a push subscription
   */
  unsubscribe(endpoint: string): boolean {
    const result = this.db.delete(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
      .run();
    return result.changes > 0;
  }

  /**
   * List all subscriptions
   */
  listSubscriptions(): unknown[] {
    return this.db.select().from(pushSubscriptions).all();
  }

  /**
   * Set notification preferences
   */
  setPreferences(subscriptionId: string, preferences: Array<{
    projectId?: string;
    eventType: string;
    enabled: boolean;
  }>): void {
    for (const pref of preferences) {
      const existing = this.db.select()
        .from(notificationPreferences)
        .where(and(
          eq(notificationPreferences.subscriptionId, subscriptionId),
          pref.projectId 
            ? eq(notificationPreferences.projectId, pref.projectId)
            : undefined as any,
          eq(notificationPreferences.eventType, pref.eventType),
        ))
        .get();

      if (existing) {
        this.db.update(notificationPreferences)
          .set({ enabled: pref.enabled })
          .where(eq(notificationPreferences.id, existing.id))
          .run();
      } else {
        this.db.insert(notificationPreferences).values({
          id: uuid(),
          subscriptionId,
          projectId: pref.projectId ?? null,
          eventType: pref.eventType,
          enabled: pref.enabled,
        }).run();
      }
    }
  }

  /**
   * Get preferences for a subscription
   */
  getPreferences(subscriptionId: string): unknown[] {
    return this.db.select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.subscriptionId, subscriptionId))
      .all();
  }

  /**
   * Send a notification to all relevant subscribers.
   *
   * In multi-user mode, when a projectId is specified, only subscribers
   * whose userId has access to that project will receive the notification.
   * Subscriptions without a userId are skipped in multi-user mode when
   * a projectId is provided (we can't verify access without a user).
   *
   * In single-user mode, all subscribers receive all notifications.
   */
  async notify(eventType: string, payload: PushPayload, projectId?: string): Promise<{ sent: number; failed: number }> {
    // Get all subscriptions that want this event type
    const allSubs = this.db.select().from(pushSubscriptions).all();
    let sent = 0;
    let failed = 0;

    for (const sub of allSubs) {
      // Multi-user project access filtering
      if (this.multiUserEnabled && projectId && this.getEffectiveRole) {
        if (!sub.userId) {
          // Can't verify access without a userId — skip in multi-user mode
          continue;
        }
        const role = this.getEffectiveRole(sub.userId, projectId);
        if (!role) {
          // User doesn't have access to this project — skip
          continue;
        }
      }

      // Check per-subscription preferences
      const prefs = this.db.select()
        .from(notificationPreferences)
        .where(and(
          eq(notificationPreferences.subscriptionId, sub.id),
          eq(notificationPreferences.eventType, eventType),
        ))
        .all();

      // Also check project-specific preferences if projectId is provided
      if (projectId) {
        const projectPrefs = this.db.select()
          .from(notificationPreferences)
          .where(and(
            eq(notificationPreferences.subscriptionId, sub.id),
            eq(notificationPreferences.projectId, projectId),
            eq(notificationPreferences.eventType, eventType),
          ))
          .all();

        // If project-specific preferences exist, they take precedence
        if (projectPrefs.length > 0) {
          const shouldNotify = projectPrefs.some(p => p.enabled);
          if (!shouldNotify) continue;
        } else {
          // Fall back to global preferences
          const shouldNotify = prefs.length === 0 || prefs.some(p => p.enabled);
          if (!shouldNotify) continue;
        }
      } else {
        // No project context — use global preferences only
        const shouldNotify = prefs.length === 0 || prefs.some(p => p.enabled);
        if (!shouldNotify) continue;
      }

      try {
        await this.sendPush(sub, payload);
        sent++;

        // Update last used
        this.db.update(pushSubscriptions)
          .set({ lastUsedAt: new Date() })
          .where(eq(pushSubscriptions.id, sub.id))
          .run();
      } catch (error: any) {
        failed++;
        // If subscription is gone (410), remove it
        if (error.statusCode === 410 || error.statusCode === 404) {
          this.db.delete(pushSubscriptions)
            .where(eq(pushSubscriptions.id, sub.id))
            .run();
        }
        log.error(`Failed to send to ${sub.id}:`, error.message);
      }
    }

    return { sent, failed };
  }

  // ==== Convenience notification methods ====

  async notifyTaskComplete(projectId: string, taskName: string, sessionId: string, success: boolean): Promise<void> {
    const eventType = success ? 'task_complete' : 'task_failed';
    await this.notify(eventType, {
      title: success ? 'Task Completed' : 'Task Failed',
      body: `${taskName} has ${success ? 'completed successfully' : 'failed'}`,
      tag: `task-${taskName}`,
      data: {
        deeplink: `openmgr://project/${projectId}/session/${sessionId}`,
        type: eventType,
        projectId,
        sessionId,
      },
      actions: [
        { action: 'view', title: 'View Session' },
      ],
    }, projectId);
  }

  async notifyApprovalNeeded(projectId: string, toolName: string, requestId: string, sessionId?: string): Promise<void> {
    // Deep link into the session where the approval is needed (if known),
    // otherwise fall back to the project view
    const deeplink = sessionId
      ? `openmgr://project/${projectId}/session/${sessionId}`
      : `openmgr://project/${projectId}`;

    await this.notify('approval_needed', {
      title: 'Approval Required',
      body: `Agent wants to execute: ${toolName}`,
      tag: `approval-${requestId}`,
      data: {
        deeplink,
        type: 'approval_needed',
        projectId,
        sessionId,
      },
      actions: [
        { action: 'approve', title: 'Approve' },
        { action: 'deny', title: 'Deny' },
      ],
    }, projectId);
  }

  async notifySessionCompleted(projectId: string, sessionId: string, summary?: string): Promise<void> {
    await this.notify('session_completed', {
      title: 'Session Completed',
      body: summary ? summary.substring(0, 200) : 'Session finished',
      tag: `session-${sessionId}`,
      data: {
        deeplink: `openmgr://project/${projectId}/session/${sessionId}`,
        type: 'session_completed',
        projectId,
        sessionId,
      },
      actions: [
        { action: 'view', title: 'View Session' },
      ],
    }, projectId);
  }

  async notifyAgentError(projectId: string, error: string, sessionId?: string): Promise<void> {
    await this.notify('agent_error', {
      title: 'Agent Error',
      body: error.substring(0, 200),
      tag: `error-${projectId}`,
      data: {
        deeplink: sessionId 
          ? `openmgr://project/${projectId}/session/${sessionId}`
          : `openmgr://project/${projectId}`,
        type: 'agent_error',
        projectId,
        sessionId,
      },
    }, projectId);
  }

  // ==== Web Push Protocol Implementation ====

  /**
   * Send a push notification to a single subscription.
   * Delegates to the web-push library for RFC-compliant encryption and VAPID.
   */
  private async sendPush(
    subscription: typeof pushSubscriptions.$inferSelect,
    payload: PushPayload,
  ): Promise<void> {
    const pushSubscription = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      },
    };

    try {
      await webpush.sendNotification(pushSubscription, JSON.stringify(payload), {
        vapidDetails: {
          subject: this.contactEmail,
          publicKey: this.vapidKeys.publicKey,
          privateKey: this.vapidKeys.privateKey,
        },
        TTL: 86400,
      });
    } catch (err: any) {
      log.error(`Push failed: ${err.statusCode ?? 'unknown'} ${err.message}`);
      log.error(`  Endpoint: ${subscription.endpoint}`);
      if (err.body) log.error(`  Response body: ${err.body}`);
      if (err.headers) log.error(`  Response headers: ${JSON.stringify(err.headers)}`);
      log.error(`  VAPID sub: ${this.contactEmail}`);

      // Re-throw with statusCode so the caller can handle 410/404
      const error: any = new Error(err.message || 'Push failed');
      error.statusCode = err.statusCode;
      throw error;
    }
  }

  // ==== VAPID Key Management ====

  private loadOrGenerateVAPIDKeys(): VAPIDKeys {
    const keyPath = join(this.dataDir, 'vapid-keys.json');

    if (existsSync(keyPath)) {
      try {
        const data = JSON.parse(readFileSync(keyPath, 'utf-8'));
        if (data.publicKey && data.privateKey) {
          return data;
        }
      } catch {
        // Regenerate
      }
    }

    // Generate new VAPID keys
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();

    const keys: VAPIDKeys = {
      publicKey: Buffer.from(ecdh.getPublicKey()).toString('base64url'),
      privateKey: ecdh.getPrivateKey('base64url'),
    };

    writeFileSync(keyPath, JSON.stringify(keys, null, 2));
    log.info('Generated new VAPID keys');

    return keys;
  }
}
