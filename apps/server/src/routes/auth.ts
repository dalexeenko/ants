/**
 * Auth routes — handles login, OAuth flows, auth code exchange, and session management.
 *
 * These routes are mostly public (no auth middleware) since they're the entry
 * point for authentication. The exceptions are routes that require an existing
 * session (like /auth/status when you want to know who you are).
 */

import { Hono } from 'hono';
import { timingSafeEqual } from 'crypto';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import type { ServerConfig } from '../config.js';
import type { UserManager } from '../services/user-manager.js';
import type { AuditLogger } from '../services/audit-logger.js';
import type { WebSessionService } from '../services/web-session.js';
import type { AuthCodeService } from '../services/auth-code.js';
import type { OAuthService } from '../services/oauth-service.js';
import { SYSTEM_USER_ID } from '../services/system-user.js';
import { createLogger } from '../utils/logger.js';
import { isSecure, getServerUrl } from '../utils/request.js';

const log = createLogger('auth-routes');

const serverVersion = process.env.ANTS_SERVER_VERSION || undefined;

const SESSION_COOKIE = 'ants_session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

interface AuthRouteDeps {
  config: ServerConfig;
  webSessionService: WebSessionService;
  authCodeService: AuthCodeService;
  userManager?: UserManager;
  auditLogger?: AuditLogger;
  oauthService?: OAuthService;
}

export function createAuthRoutes(deps: AuthRouteDeps) {
  const { config, webSessionService, authCodeService, userManager, auditLogger, oauthService } = deps;
  const app = new Hono();

  // ── GET /auth/status ─────────────────────────────────────────────────
  // Returns the current auth mode, available providers, and current user (if any).
  // Public — used by the UI to decide what to show.
  app.get('/status', async (c) => {
    const isMultiUser = config.multiUser;
    
    // Check if the request has a valid session cookie
    let currentUser = null;
    const sessionToken = getCookie(c, SESSION_COOKIE);
    if (sessionToken) {
      const userId = webSessionService.validateSession(sessionToken);
      if (userId && userManager) {
        const user = await userManager.getUser(userId);
        if (user) {
          currentUser = {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            email: user.email,
            role: user.role,
          };
        }
      } else if (userId === SYSTEM_USER_ID && !isMultiUser) {
        currentUser = {
          id: SYSTEM_USER_ID,
          username: 'system',
          displayName: 'System',
          email: null,
          role: 'admin',
        };
      }
    }

    // Determine available auth methods
    const authMethods: string[] = [];
    let oauthProviderList: Array<{ id: string; type: string }> = [];
    if (isMultiUser) {
      authMethods.push('password');
      // Check configured OAuth providers
      if (oauthService) {
        const providers = await oauthService.listProviders();
        const enabledProviders = providers.filter(p => p.enabled);
        if (enabledProviders.length > 0) {
          authMethods.push('oauth');
          oauthProviderList = enabledProviders.map(p => ({ id: p.id, type: p.type }));
        }
      }
    }
    if (config.cfAccessTeamDomain) {
      authMethods.push('cloudflare-access');
    }
    // Only advertise bearer auth in single-user mode (shared secret).
    // In multi-user mode, per-user tokens use the same Bearer scheme
    // but are not a separate "auth method" — they're part of user auth.
    if (config.secret && !isMultiUser) {
      authMethods.push('bearer');
    }

    // Check if initial setup is still needed (no admin user exists)
    const needsSetup = isMultiUser && userManager ? userManager.needsSetup() : false;

    return c.json({
      multiUser: isMultiUser,
      needsSetup,
      authMethods,
      currentUser,
      hasCfAccess: !!(config.cfAccessTeamDomain && config.cfAccessAud),
      oauthProviders: oauthProviderList,
      ...(serverVersion ? { serverVersion } : {}),
    });
  });

  // ── POST /auth/login ─────────────────────────────────────────────────
  // Email/password login. Sets a session cookie and returns user info.
  app.post('/login', async (c) => {
    if (!config.multiUser || !userManager) {
      return c.json({ error: 'Multi-user mode is not enabled' }, 400);
    }

    const body = await c.req.json().catch(() => ({})) as { username?: string; password?: string };
    const { username, password } = body;

    if (!username || !password) {
      return c.json({ error: 'Username and password are required' }, 400);
    }

    const result = await userManager.authenticatePassword(username, password);
    if (!result) {
      auditLogger?.log({
        username,
        action: 'user.login_failed',
        ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || undefined,
      });
      return c.json({ error: 'Invalid username or password' }, 401);
    }

    // Create a web session and set cookie
    const sessionToken = webSessionService.createSession(result.user.id);
    setCookie(c, SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: isSecure(c),
      sameSite: 'Lax',
      maxAge: SESSION_MAX_AGE,
      path: '/',
    });

    auditLogger?.log({
      userId: result.user.id,
      username: result.user.username,
      action: 'user.login',
      ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || undefined,
    });

    return c.json({
      user: {
        id: result.user.id,
        username: result.user.username,
        displayName: result.user.displayName,
        email: result.user.email,
        role: result.user.role,
      },
    });
  });

  // ── POST /auth/logout ────────────────────────────────────────────────
  // Deletes the session cookie and invalidates the server-side session.
  app.post('/logout', async (c) => {
    const sessionToken = getCookie(c, SESSION_COOKIE);
    if (sessionToken) {
      webSessionService.deleteSession(sessionToken);
    }
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  // ── GET /auth/connect ────────────────────────────────────────────────
  // Entry point for the app auth flow. The app opens this URL in the
  // system browser. If the user is already authenticated (via cookie or
  // CF Access), generates an auth code and redirects immediately. Otherwise,
  // shows the login page with the redirect info preserved.
  app.get('/connect', async (c) => {
    const redirectUri = c.req.query('redirect_uri');
    const state = c.req.query('state');

    if (!redirectUri) {
      return c.json({ error: 'redirect_uri is required' }, 400);
    }

    // Check if already authenticated via cookie
    const sessionToken = getCookie(c, SESSION_COOKIE);
    let userId: string | null = null;

    if (sessionToken) {
      userId = webSessionService.validateSession(sessionToken);
    }

    // In single-user mode, auto-authenticate as system user
    if (!config.multiUser && !userId) {
      userId = SYSTEM_USER_ID;
    }

    if (userId) {
      // Already authenticated — generate auth code and redirect
      const code = authCodeService.createCode(userId, redirectUri);
      const serverUrl = getServerUrl(c);
      const redirectUrl = new URL(redirectUri);
      redirectUrl.searchParams.set('code', code);
      if (state) redirectUrl.searchParams.set('state', state);
      redirectUrl.searchParams.set('server', serverUrl);
      return c.redirect(redirectUrl.toString());
    }

    // Not authenticated — redirect to login with the connect params preserved
    const loginUrl = `/login?redirect_uri=${encodeURIComponent(redirectUri)}${state ? `&state=${encodeURIComponent(state)}` : ''}&connect=true`;
    return c.redirect(loginUrl);
  });

  // ── POST /auth/token ─────────────────────────────────────────────────
  // Exchange a one-time auth code for a bearer token.
  // This is the app's callback after /auth/connect redirects back.
  app.post('/token', async (c) => {
    const body = await c.req.json().catch(() => ({})) as {
      code?: string;
      redirect_uri?: string;
    };

    if (!body.code || !body.redirect_uri) {
      return c.json({ error: 'code and redirect_uri are required' }, 400);
    }

    const userId = authCodeService.exchangeCode(body.code, body.redirect_uri);
    if (!userId) {
      return c.json({ error: 'Invalid, expired, or already-used authorization code' }, 400);
    }

    // In single-user mode, return the server secret as the token
    if (!config.multiUser) {
      return c.json({
        token: config.secret,
        user: {
          id: SYSTEM_USER_ID,
          username: 'system',
          displayName: 'System',
          role: 'admin',
        },
      });
    }

    // Multi-user mode: create a user token
    if (!userManager) {
      return c.json({ error: 'User manager not available' }, 500);
    }

    const user = await userManager.getUser(userId);
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    const tokenResult = await userManager.createToken(userId, `app-${Date.now()}`);

    auditLogger?.log({
      userId: user.id,
      username: user.username,
      action: 'user.token_created',
      details: JSON.stringify({ via: 'auth-code-exchange' }),
      ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || undefined,
    });

    return c.json({
      token: tokenResult.token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        role: user.role,
      },
    });
  });

  // ── POST /auth/connect-token ──────────────────────────────────────────
  // Generate a one-time auth code for connecting the desktop/mobile app.
  // Called from the server web UI when the user clicks "Connect App".
  // Requires an existing session (cookie auth).
  app.post('/connect-token', async (c) => {
    // Authenticate via session cookie
    const sessionToken = getCookie(c, SESSION_COOKIE);
    let userId: string | null = null;

    if (sessionToken) {
      userId = webSessionService.validateSession(sessionToken);
    }

    // In single-user mode, auto-authenticate
    if (!config.multiUser && !userId) {
      userId = SYSTEM_USER_ID;
    }

    if (!userId) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const code = authCodeService.createCode(userId, 'ants://connect');

    // Determine protocol: proxy headers first, then client hint as fallback.
    // The client sends { secure: true } when it loaded the page over HTTPS,
    // which is a reliable signal that the user's connection is secure even
    // when the reverse proxy doesn't forward protocol headers.
    let serverUrl = getServerUrl(c);
    const body = await c.req.json().catch(() => ({}));
    if (!isSecure(c) && body?.secure === true) {
      const host = c.req.header('host') || 'localhost';
      serverUrl = `https://${host}`;
      log.info('connect-token: proxy headers indicate HTTP but client reports HTTPS — using client hint');
    }

    const serverName = c.req.header('host')?.replace(/:\d+$/, '') || 'Ants Server';

    log.debug('connect-token: serverUrl=%s secure=%s x-forwarded-proto=%s x-forwarded-scheme=%s forwarded=%s clientSecure=%s',
      serverUrl, isSecure(c),
      c.req.header('x-forwarded-proto') || '(not set)',
      c.req.header('x-forwarded-scheme') || '(not set)',
      c.req.header('forwarded') || '(not set)',
      body?.secure ?? '(not set)');

    return c.json({ code, serverUrl, serverName });
  });

  // ── GET /auth/session ──────────────────────────────────────────────────
  // Exchange a bearer token for a session cookie and redirect.
  // Used by the desktop/mobile app to open the server web UI in a browser
  // with a valid session. The app constructs:
  //   {serverUrl}/auth/session?token=...&redirect=/channels
  app.get('/session', async (c) => {
    const token = c.req.query('token');
    const redirect = c.req.query('redirect') || '/';

    if (!token) {
      return c.redirect('/login');
    }

    // Validate the token
    let userId: string | null = null;

    // 1. Check the shared server secret (single-user mode only)
    if (!config.multiUser && config.secret) {
      try {
        const bufA = Buffer.from(token);
        const bufB = Buffer.from(config.secret);
        if (bufA.length === bufB.length && timingSafeEqual(bufA, bufB)) {
          userId = SYSTEM_USER_ID;
        }
      } catch {
        // ignore comparison errors
      }
    }

    // 2. Check per-user tokens (multi-user mode)
    if (!userId && userManager) {
      const user = await userManager.validateToken(token);
      if (user) {
        userId = user.id;
      }
    }

    if (!userId) {
      log.warn('Invalid token in /auth/session');
      return c.redirect('/login');
    }

    // Create a web session and set the cookie
    const sessionToken = webSessionService.createSession(userId);
    setCookie(c, SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: isSecure(c),
      sameSite: 'Lax',
      maxAge: SESSION_MAX_AGE,
      path: '/',
    });

    return c.redirect(redirect);
  });

  return app;
}
