/**
 * OpenMgr Service Worker
 *
 * Handles push notifications from the OpenMgr server and displays them as
 * native browser notifications. Clicking a notification opens the app via
 * its deep-link URL (openmgr://) or falls back to the server web UI.
 */

/* eslint-env serviceworker */

self.addEventListener('install', (event) => {
  // Take control immediately — don't wait for old service worker to stop
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  // Claim all open tabs so push events work immediately
  event.waitUntil(self.clients.claim());
});

/**
 * Handle incoming push messages from the server.
 *
 * Expected payload shape (JSON):
 *   {
 *     title: string,
 *     body: string,
 *     icon?: string,
 *     badge?: string,
 *     tag?: string,
 *     data?: { deeplink?: string, type?: string, projectId?: string, sessionId?: string },
 *     actions?: Array<{ action: string, title: string }>
 *   }
 */
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    // If the payload isn't valid JSON, show a generic notification
    payload = { title: 'OpenMgr', body: event.data.text() };
  }

  const title = payload.title || 'OpenMgr';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/assets/icon-192.png',
    badge: payload.badge || '/assets/badge-72.png',
    tag: payload.tag || undefined,
    data: payload.data || {},
    actions: payload.actions || [],
    // Vibrate pattern: short-long-short
    vibrate: [100, 200, 100],
    // Keep the notification visible until the user interacts with it
    requireInteraction: payload.data?.type === 'approval_needed',
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Handle notification click — open the deep-link URL or the server web UI.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const action = event.action; // Which action button was clicked (if any)

  // Determine the URL to open.
  // The deeplink is an openmgr:// URL that the OS will route to the native app
  // (desktop or mobile). This is how self-hosted servers deliver push
  // notifications without Apple/Google push credentials — the browser acts as
  // a relay, and the deep link opens the installed app.
  let url;

  if (data.deeplink) {
    url = data.deeplink;
  } else if (data.projectId && data.sessionId) {
    // Fallback: open the session in the web UI
    url = `/projects/${data.projectId}/sessions/${data.sessionId}`;
  } else if (data.projectId) {
    url = `/projects/${data.projectId}`;
  } else {
    url = '/';
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If there's already an open window, focus it and navigate
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus().then((focused) => {
            if (focused && 'navigate' in focused) {
              return focused.navigate(url);
            }
          });
        }
      }
      // Otherwise open a new window
      return self.clients.openWindow(url);
    })
  );
});

/**
 * Handle notification close (dismissed without clicking).
 * Could be used for analytics in the future.
 */
self.addEventListener('notificationclose', (_event) => {
  // No-op for now
});
