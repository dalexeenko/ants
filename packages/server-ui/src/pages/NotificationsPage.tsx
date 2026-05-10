import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

interface PushSubscription {
  id: string;
  endpoint: string;
  userId: string | null;
  deviceName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

interface NotificationPreference {
  id: string;
  subscriptionId: string;
  projectId: string | null;
  eventType: string;
  enabled: boolean;
}

const EVENT_TYPES = [
  { id: 'task_complete', label: 'Task completed' },
  { id: 'task_failed', label: 'Task failed' },
  { id: 'approval_needed', label: 'Approval required' },
  { id: 'agent_error', label: 'Agent error' },
  { id: 'session_completed', label: 'Session completed' },
];

type PermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

function isIOSSafari(): boolean {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(ua);
  return isIOS && isSafari;
}

function isStandalone(): boolean {
  return ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true)
    || window.matchMedia('(display-mode: standalone)').matches;
}

export function NotificationsPage() {
  const [permissionState, setPermissionState] = useState<PermissionState>('default');
  const [subscribed, setSubscribed] = useState(false);
  const [subscriptions, setSubscriptions] = useState<PushSubscription[]>([]);
  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [iosSafariNeedsPWA, setIosSafariNeedsPWA] = useState(false);

  // Check browser support and current permission state
  useEffect(() => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      // On iOS Safari, push notifications require the site to be installed
      // as a PWA (added to home screen). Detect this case so we can show
      // specific guidance instead of a generic "not supported" message.
      if (isIOSSafari() && !isStandalone()) {
        setIosSafariNeedsPWA(true);
      }
      setPermissionState('unsupported');
      return;
    }
    setPermissionState(Notification.permission as PermissionState);
  }, []);

  const loadData = useCallback(async () => {
    try {
      const { subscriptions: subs } = await api.get<{ subscriptions: PushSubscription[] }>(
        '/notifications/subscriptions',
      );
      setSubscriptions(subs);

      // Check if we have an active subscription from this browser
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            const exists = subs.some((s) => s.endpoint === sub.endpoint);
            setSubscribed(exists);

            // Load preferences for our subscription
            if (exists) {
              const ourSub = subs.find((s) => s.endpoint === sub.endpoint);
              if (ourSub) {
                const { preferences: prefs } = await api.get<{
                  preferences: NotificationPreference[];
                }>(`/notifications/preferences/${ourSub.id}`);
                setPreferences(prefs);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to load notification data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const enableNotifications = async () => {
    setActionLoading(true);
    setStatus(null);
    try {
      // 1. Request permission
      const permission = await Notification.requestPermission();
      setPermissionState(permission as PermissionState);
      if (permission !== 'granted') {
        setStatus({ type: 'error', message: 'Notification permission was denied' });
        return;
      }

      // 2. Register service worker
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;

      // 3. Get VAPID key
      const { publicKey } = await api.get<{ publicKey: string }>('/notifications/vapid-key');

      // Convert VAPID key from base64url to Uint8Array
      const urlBase64ToUint8Array = (base64String: string) => {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        return Uint8Array.from(rawData, (c) => c.charCodeAt(0));
      };

      // 4. Subscribe to push
      const pushSub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const subJson = pushSub.toJSON();

      // 5. Register subscription with server
      await api.post('/notifications/subscribe', {
        endpoint: subJson.endpoint,
        keys: {
          p256dh: subJson.keys?.p256dh,
          auth: subJson.keys?.auth,
        },
        deviceName: getBrowserName(),
      });

      setSubscribed(true);
      setStatus({ type: 'success', message: 'Push notifications enabled' });
      await loadData();
    } catch (err) {
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to enable notifications',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const disableNotifications = async () => {
    setActionLoading(true);
    setStatus(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await api.post('/notifications/unsubscribe', { endpoint: sub.endpoint });
          await sub.unsubscribe();
        }
      }
      setSubscribed(false);
      setPreferences([]);
      setStatus({ type: 'success', message: 'Push notifications disabled' });
      await loadData();
    } catch (err) {
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to disable notifications',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const togglePreference = async (eventType: string, enabled: boolean) => {
    try {
      // Find our subscription
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return;
      const ourSub = subscriptions.find((s) => s.endpoint === sub.endpoint);
      if (!ourSub) return;

      await api.put('/notifications/preferences', {
        subscriptionId: ourSub.id,
        preferences: [{ eventType, enabled }],
      });

      // Update local state
      setPreferences((prev) => {
        const existing = prev.find((p) => p.eventType === eventType && !p.projectId);
        if (existing) {
          return prev.map((p) =>
            p.eventType === eventType && !p.projectId ? { ...p, enabled } : p,
          );
        }
        return [
          ...prev,
          { id: '', subscriptionId: ourSub.id, projectId: null, eventType, enabled },
        ];
      });
    } catch (err) {
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to update preference',
      });
    }
  };

  const sendTestNotification = async () => {
    setTestLoading(true);
    setStatus(null);
    try {
      const result = await api.post<{ sent: number; failed: number }>('/notifications/test');
      setStatus({
        type: result.sent > 0 ? 'success' : 'error',
        message: `Sent: ${result.sent}, Failed: ${result.failed}`,
      });
    } catch (err) {
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to send test notification',
      });
    } finally {
      setTestLoading(false);
    }
  };

  const isPreferenceEnabled = (eventType: string): boolean => {
    const pref = preferences.find((p) => p.eventType === eventType && !p.projectId);
    return pref ? pref.enabled : true; // Default to enabled if no preference set
  };

  return (
    <div data-testid="server-ui-notifications">
      <div className="page-header">
        <h1>Notifications</h1>
        <p>Configure push notification preferences</p>
      </div>

      {status && (
        <div className={`status-banner ${status.type}`}>{status.message}</div>
      )}

      {/* Push Notification Status */}
      <div className="section">
        <h2 className="section-header">Push Notifications</h2>
        <p className="section-description">
          Receive browser notifications for task completions, approval requests, and agent errors.
        </p>

        <div className="card">
          {permissionState === 'unsupported' ? (
            <div className="card-row">
              <div className="card-info">
                {iosSafariNeedsPWA ? (
                  <>
                    <strong>Add to Home Screen Required</strong>
                    <span className="text-muted">
                      On iOS, push notifications require this site to be installed as an app.
                      Tap the share button in Safari, then select "Add to Home Screen."
                      Once installed, open it from your home screen and return here to enable notifications.
                    </span>
                  </>
                ) : (
                  <>
                    <strong>Not Supported</strong>
                    <span className="text-muted">
                      Your browser doesn't support push notifications.
                    </span>
                  </>
                )}
              </div>
            </div>
          ) : permissionState === 'denied' ? (
            <div className="card-row">
              <div className="card-info">
                <strong>Permission Denied</strong>
                <span className="text-muted">
                  Notifications were blocked. Please enable them in your browser settings.
                </span>
              </div>
            </div>
          ) : loading ? (
            <div className="card-row">
              <div className="loading">
                <div className="spinner" />
                <span>Loading...</span>
              </div>
            </div>
          ) : subscribed ? (
            <div className="card-row">
              <div className="card-info">
                <strong>Enabled</strong>
                <span className="text-muted">
                  Push notifications are active on this browser.
                </span>
              </div>
              <div className="card-actions">
                <button
                  className="btn btn-danger btn-sm"
                  onClick={disableNotifications}
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Disabling...' : 'Disable'}
                </button>
                <button
                  className="btn btn-sm"
                  onClick={sendTestNotification}
                  disabled={testLoading}
                >
                  {testLoading ? 'Sending...' : 'Send Test'}
                </button>
              </div>
            </div>
          ) : (
            <div className="card-row">
              <div className="card-info">
                <strong>Disabled</strong>
                <span className="text-muted">
                  Enable push notifications to receive alerts.
                </span>
              </div>
              <div className="card-actions">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={enableNotifications}
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Enabling...' : 'Enable Notifications'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Event Type Preferences */}
      {subscribed && (
        <div className="section">
          <h2 className="section-header">Event Types</h2>
          <p className="section-description">
            Choose which events trigger push notifications.
          </p>

          <div className="card">
            {EVENT_TYPES.map((eventType) => (
              <div className="card-row" key={eventType.id}>
                <div className="card-info">
                  <strong>{eventType.label}</strong>
                </div>
                <div className="card-actions">
                  <label className="toggle-label">
                    <input
                      type="checkbox"
                      checked={isPreferenceEnabled(eventType.id)}
                      onChange={(e) => togglePreference(eventType.id, e.target.checked)}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Subscriptions (admin view) */}
      {subscriptions.length > 0 && (
        <div className="section">
          <h2 className="section-header">Active Subscriptions</h2>
          <p className="section-description">
            All registered push notification subscriptions.
          </p>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Registered</th>
                  <th>Last Used</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((sub) => (
                  <tr key={sub.id}>
                    <td>{sub.deviceName || 'Unknown'}</td>
                    <td>{new Date(sub.createdAt).toLocaleDateString()}</td>
                    <td>
                      {sub.lastUsedAt
                        ? new Date(sub.lastUsedAt).toLocaleDateString()
                        : 'Never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function getBrowserName(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Edg/')) return 'Edge';
  if (ua.includes('Chrome')) return 'Chrome';
  if (ua.includes('Safari')) return 'Safari';
  return 'Browser';
}
