/**
 * Deeplink configuration and utilities for Ants.
 * 
 * URL Scheme: ants://
 * 
 * Supported Routes:
 * - ants://                           → Open app (home)
 * - ants://project/:projectId         → Open specific project
 * - ants://project/:projectId/session/:sessionId → Open specific session
 * - ants://project/:projectId/settings → Open project settings
 * - ants://settings                   → Open app settings
 * - ants://settings/:section          → Open specific settings section
 * - ants://auth/callback?code=...     → OAuth callback
 * - ants://connect?url=...            → Connect to remote server
 * - ants://open?path=...              → Open local project by path
 */

// ============ Constants ============

export const DEEPLINK_SCHEME = 'ants';
export const DEEPLINK_PREFIX = `${DEEPLINK_SCHEME}://`;

// ============ Route Types ============

export type DeeplinkRoute =
  | { type: 'home' }
  | { type: 'project'; projectId: string }
  | { type: 'session'; projectId: string; sessionId: string }
  | { type: 'project-settings'; projectId: string }
  | { type: 'settings'; section?: SettingsSectionId }
  | { type: 'auth-callback'; code: string; state?: string; server?: string }
  | { type: 'connect'; url: string; name?: string; code?: string }
  | { type: 'open'; path: string }
  | { type: 'unknown'; url: string };

export type SettingsSectionId = 
  | 'general'
  | 'authentication'
  | 'remote-servers'
  | 'mcp-servers'
  | 'permissions'
  | 'theme';

// ============ Route Patterns ============

export const ROUTE_PATTERNS = {
  home: '/',
  project: '/project/:projectId',
  session: '/project/:projectId/session/:sessionId',
  projectSettings: '/project/:projectId/settings',
  settings: '/settings',
  settingsSection: '/settings/:section',
  authCallback: '/auth/callback',
  connect: '/connect',
  open: '/open',
} as const;

// ============ Parse Deeplink URL ============

/**
 * Parse a deeplink URL into a typed route object.
 */
export function parseDeeplink(url: string): DeeplinkRoute {
  try {
    // Handle both full URLs and path-only
    let urlObj: URL;
    if (url.startsWith(DEEPLINK_PREFIX)) {
      // ants://path -> need to make it parseable
      urlObj = new URL(url.replace(DEEPLINK_PREFIX, 'http://ants/'));
    } else if (url.startsWith('/')) {
      urlObj = new URL(`http://ants${url}`);
    } else {
      urlObj = new URL(url);
    }

    const pathname = urlObj.pathname;
    const searchParams = urlObj.searchParams;

    // Home
    if (pathname === '/' || pathname === '') {
      return { type: 'home' };
    }

    // Auth callback: /auth/callback?code=...&state=...&server=...
    if (pathname === '/auth/callback') {
      const code = searchParams.get('code');
      if (code) {
        return {
          type: 'auth-callback',
          code,
          state: searchParams.get('state') || undefined,
          server: searchParams.get('server') || undefined,
        };
      }
    }

    // Connect: /connect?url=...&code=...
    if (pathname === '/connect') {
      const remoteUrl = searchParams.get('url');
      if (remoteUrl) {
        return {
          type: 'connect',
          url: remoteUrl,
          name: searchParams.get('name') || undefined,
          code: searchParams.get('code') || undefined,
        };
      }
    }

    // Open local project: /open?path=...
    if (pathname === '/open') {
      const path = searchParams.get('path');
      if (path) {
        return { type: 'open', path };
      }
    }

    // Settings: /settings or /settings/:section
    if (pathname === '/settings') {
      return { type: 'settings' };
    }
    const settingsMatch = pathname.match(/^\/settings\/([^/]+)$/);
    if (settingsMatch) {
      return {
        type: 'settings',
        section: settingsMatch[1] as SettingsSectionId,
      };
    }

    // Project settings: /project/:id/settings
    const projectSettingsMatch = pathname.match(/^\/project\/([^/]+)\/settings$/);
    if (projectSettingsMatch) {
      return {
        type: 'project-settings',
        projectId: decodeURIComponent(projectSettingsMatch[1]),
      };
    }

    // Session: /project/:projectId/session/:sessionId
    const sessionMatch = pathname.match(/^\/project\/([^/]+)\/session\/([^/]+)$/);
    if (sessionMatch) {
      return {
        type: 'session',
        projectId: decodeURIComponent(sessionMatch[1]),
        sessionId: decodeURIComponent(sessionMatch[2]),
      };
    }

    // Project: /project/:projectId
    const projectMatch = pathname.match(/^\/project\/([^/]+)$/);
    if (projectMatch) {
      return {
        type: 'project',
        projectId: decodeURIComponent(projectMatch[1]),
      };
    }

    // Unknown route
    return { type: 'unknown', url };
  } catch (e) {
    return { type: 'unknown', url };
  }
}

// ============ Build Deeplink URLs ============

/** All valid route types that can be built (excludes 'unknown') */
export type BuildableDeeplinkRoute = Exclude<DeeplinkRoute, { type: 'unknown' }>;

/**
 * Build a deeplink URL from a route object.
 */
export function buildDeeplink(route: BuildableDeeplinkRoute): string {
  switch (route.type) {
    case 'home':
      return DEEPLINK_PREFIX;

    case 'project':
      return `${DEEPLINK_PREFIX}project/${encodeURIComponent(route.projectId)}`;

    case 'session':
      return `${DEEPLINK_PREFIX}project/${encodeURIComponent(route.projectId)}/session/${encodeURIComponent(route.sessionId)}`;

    case 'project-settings':
      return `${DEEPLINK_PREFIX}project/${encodeURIComponent(route.projectId)}/settings`;

    case 'settings':
      return route.section
        ? `${DEEPLINK_PREFIX}settings/${route.section}`
        : `${DEEPLINK_PREFIX}settings`;

    case 'auth-callback': {
      const params = new URLSearchParams({ code: route.code });
      if (route.state) params.set('state', route.state);
      if (route.server) params.set('server', route.server);
      return `${DEEPLINK_PREFIX}auth/callback?${params.toString()}`;
    }

    case 'connect': {
      const params = new URLSearchParams({ url: route.url });
      if (route.name) params.set('name', route.name);
      if (route.code) params.set('code', route.code);
      return `${DEEPLINK_PREFIX}connect?${params.toString()}`;
    }

    case 'open':
      return `${DEEPLINK_PREFIX}open?path=${encodeURIComponent(route.path)}`;
  }
}

// ============ React Navigation Linking Config ============

/**
 * Linking configuration for React Navigation.
 * Use this in your NavigationContainer.
 */
export const navigationLinkingConfig = {
  prefixes: [DEEPLINK_PREFIX, 'https://ants.dev'],
  config: {
    screens: {
      Home: '',
      Project: 'project/:projectId',
      Session: 'project/:projectId/session/:sessionId',
      ProjectSettings: 'project/:projectId/settings',
      Settings: 'settings',
      SettingsSection: 'settings/:section',
      AuthCallback: 'auth/callback',
      Connect: 'connect',
      Open: 'open',
    },
  },
};

// ============ Deeplink Handler Type ============

export type DeeplinkHandler = (route: DeeplinkRoute) => void | Promise<void>;

/**
 * Create a deeplink handler that processes URLs and calls the appropriate callback.
 */
export function createDeeplinkHandler(handler: DeeplinkHandler) {
  return (url: string) => {
    const route = parseDeeplink(url);
    return handler(route);
  };
}
