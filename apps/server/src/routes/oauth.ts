/**
 * OAuth routes — social auth initiation and callback.
 *
 * GET  /auth/oauth/:provider       — redirect to OAuth provider
 * GET  /auth/oauth/callback/:provider — handle provider callback
 * GET  /auth/oauth-providers       — list configured providers (public, for login page)
 * POST /auth/oauth-providers       — create provider (admin)
 * PUT  /auth/oauth-providers/:id   — update provider (admin)
 * DELETE /auth/oauth-providers/:id — delete provider (admin)
 */

import { Hono } from 'hono';
import { setCookie, getCookie } from 'hono/cookie';
import type { ServerConfig } from '../config.js';
import type { OAuthService } from '../services/oauth-service.js';
import type { WebSessionService } from '../services/web-session.js';
import type { AuthCodeService } from '../services/auth-code.js';
import type { AuditLogger } from '../services/audit-logger.js';
import type { AuthUser } from '../auth/provider.js';
import { createLogger } from '../utils/logger.js';
import { isSecure, getServerUrl } from '../utils/request.js';

const log = createLogger('oauth-routes');

const SESSION_COOKIE = 'openmgr_session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

interface OAuthRouteDeps {
  config: ServerConfig;
  oauthService: OAuthService;
  webSessionService: WebSessionService;
  authCodeService: AuthCodeService;
  auditLogger?: AuditLogger;
}

export function createOAuthRoutes(deps: OAuthRouteDeps) {
  const { config, oauthService, webSessionService, authCodeService, auditLogger } = deps;
  const app = new Hono();

  // ── GET /oauth-providers ─────────────────────────────────────────────
  // Public — returns enabled providers for the login page UI
  app.get('/oauth-providers', async (c) => {
    const providers = await oauthService.listProviders();
    // Only return enabled providers, and exclude secrets
    return c.json(
      providers
        .filter((p) => p.enabled)
        .map((p) => ({ id: p.id, type: p.type, clientId: p.clientId })),
    );
  });

  // ── POST /oauth-providers ────────────────────────────────────────────
  // Admin only — create a new OAuth provider
  app.post('/oauth-providers', async (c) => {
    const user = (c as any).get('user') as AuthUser | undefined;
    if (!user || user.role !== 'admin') {
      return c.json({ error: 'Admin access required' }, 403);
    }

    const body = await c.req.json().catch(() => ({})) as {
      type?: string;
      clientId?: string;
      clientSecret?: string;
      discoveryUrl?: string;
      config?: Record<string, unknown>;
    };

    if (!body.type || !body.clientId || !body.clientSecret) {
      return c.json({ error: 'type, clientId, and clientSecret are required' }, 400);
    }

    if (!['google', 'github', 'microsoft', 'oidc'].includes(body.type)) {
      return c.json({ error: 'Invalid type. Must be google, github, microsoft, or oidc' }, 400);
    }

    if (body.type === 'oidc' && !body.discoveryUrl) {
      return c.json({ error: 'discoveryUrl is required for OIDC providers' }, 400);
    }

    try {
      const provider = await oauthService.createProvider({
        type: body.type as any,
        clientId: body.clientId,
        clientSecret: body.clientSecret,
        discoveryUrl: body.discoveryUrl,
        config: body.config,
      });

      auditLogger?.log({
        userId: user.id,
        username: user.username,
        action: 'oauth_provider.created',
        details: JSON.stringify({ type: body.type, id: provider.id }),
      });

      return c.json(provider, 201);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500);
    }
  });

  // ── PUT /oauth-providers/:id ─────────────────────────────────────────
  app.put('/oauth-providers/:id', async (c) => {
    const user = (c as any).get('user') as AuthUser | undefined;
    if (!user || user.role !== 'admin') {
      return c.json({ error: 'Admin access required' }, 403);
    }

    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({})) as {
      clientId?: string;
      clientSecret?: string;
      discoveryUrl?: string;
      config?: Record<string, unknown>;
      enabled?: boolean;
    };

    const updated = await oauthService.updateProvider(id, body);
    if (!updated) {
      return c.json({ error: 'OAuth provider not found' }, 404);
    }

    auditLogger?.log({
      userId: user.id,
      username: user.username,
      action: 'oauth_provider.updated',
      details: JSON.stringify({ id }),
    });

    return c.json(updated);
  });

  // ── DELETE /oauth-providers/:id ──────────────────────────────────────
  app.delete('/oauth-providers/:id', async (c) => {
    const user = (c as any).get('user') as AuthUser | undefined;
    if (!user || user.role !== 'admin') {
      return c.json({ error: 'Admin access required' }, 403);
    }

    const id = c.req.param('id');
    const deleted = await oauthService.deleteProvider(id);
    if (!deleted) {
      return c.json({ error: 'OAuth provider not found' }, 404);
    }

    auditLogger?.log({
      userId: user.id,
      username: user.username,
      action: 'oauth_provider.deleted',
      details: JSON.stringify({ id }),
    });

    return c.json({ ok: true });
  });

  // ── GET /oauth/:provider ─────────────────────────────────────────────
  // Initiates the OAuth flow. Redirects to the provider's authorize URL.
  // Optional query params: redirect_uri, state (for app connect flow)
  app.get('/oauth/:providerId', async (c) => {
    const providerId = c.req.param('providerId');
    const appRedirectUri = c.req.query('redirect_uri');
    const appState = c.req.query('state');

    try {
      const serverUrl = getServerUrl(c);
      const callbackUrl = `${serverUrl}/auth/oauth/callback/${providerId}`;

      const authorizeUrl = await oauthService.getAuthorizeUrl(
        providerId,
        callbackUrl,
        appRedirectUri ? { redirectUri: appRedirectUri, state: appState } : undefined,
      );

      return c.redirect(authorizeUrl);
    } catch (e) {
      log.error('OAuth initiation failed:', e);
      return c.redirect(`/login?error=${encodeURIComponent((e as Error).message)}`);
    }
  });

  // ── GET /oauth/callback/:provider ────────────────────────────────────
  // Handles the OAuth provider callback.
  app.get('/oauth/callback/:providerId', async (c) => {
    const providerId = c.req.param('providerId');
    const code = c.req.query('code');
    const stateParam = c.req.query('state');
    const error = c.req.query('error');

    if (error) {
      const errorDescription = c.req.query('error_description') || error;
      log.warn(`OAuth callback error from provider ${providerId}: ${errorDescription}`);
      return c.redirect(`/login?error=${encodeURIComponent(errorDescription)}`);
    }

    if (!code || !stateParam) {
      return c.redirect('/login?error=Missing+code+or+state');
    }

    try {
      const serverUrl = getServerUrl(c);
      const callbackUrl = `${serverUrl}/auth/oauth/callback/${providerId}`;

      const result = await oauthService.handleCallback(stateParam, code, callbackUrl);

      // Set session cookie
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
        action: 'user.oauth_login',
        details: JSON.stringify({ provider: providerId }),
        ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || undefined,
      });

      // If this was part of an app connect flow, generate auth code and redirect
      if (result.appRedirect?.redirectUri) {
        const authCode = authCodeService.createCode(result.user.id, result.appRedirect.redirectUri);
        const redirectUrl = new URL(result.appRedirect.redirectUri);
        redirectUrl.searchParams.set('code', authCode);
        if (result.appRedirect.state) {
          redirectUrl.searchParams.set('state', result.appRedirect.state);
        }
        redirectUrl.searchParams.set('server', serverUrl);
        return c.redirect(redirectUrl.toString());
      }

      // Otherwise redirect to the web UI
      return c.redirect('/');
    } catch (e) {
      log.error('OAuth callback failed:', e);
      return c.redirect(`/login?error=${encodeURIComponent((e as Error).message)}`);
    }
  });

  return app;
}
