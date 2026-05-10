/**
 * Setup routes — initial admin account creation for multi-user mode.
 *
 * When multi-user mode is enabled and no admin user exists yet, the server
 * enters "setup mode". These public (unauthenticated) endpoints allow the
 * first user to create an admin account:
 *
 *   GET  /setup/status  — check whether setup is needed
 *   POST /setup         — create the initial admin account
 *
 * Security:
 *   - If OPENMGR_SETUP_TOKEN is set, the POST /setup request must include the
 *     matching token. This prevents unauthorized users from claiming admin on
 *     a publicly accessible deployment.
 *   - If OPENMGR_SETUP_TOKEN is not set, the first person to POST /setup
 *     claims admin (suitable for local / trusted-network deployments).
 *   - Once setup is complete (an admin exists), both endpoints become no-ops.
 */

import { Hono } from 'hono';
import { timingSafeEqual } from 'crypto';
import type { ServerConfig } from '../config.js';
import type { UserManager } from '../services/user-manager.js';
import type { AuditLogger } from '../services/audit-logger.js';
import type { WebSessionService } from '../services/web-session.js';
import { setCookie } from 'hono/cookie';
import { createLogger } from '../utils/logger.js';
import { isSecure } from '../utils/request.js';

const log = createLogger('setup-routes');

const SESSION_COOKIE = 'openmgr_session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

interface SetupRouteDeps {
  config: ServerConfig;
  userManager: UserManager;
  auditLogger: AuditLogger;
  webSessionService: WebSessionService;
}

export function createSetupRoutes(deps: SetupRouteDeps) {
  const { config, userManager, auditLogger, webSessionService } = deps;
  const app = new Hono();

  // ── GET /setup/status ──────────────────────────────────────────────────
  // Returns whether initial setup is still needed.
  app.get('/status', (c) => {
    const needsSetup = userManager.needsSetup();
    return c.json({
      needsSetup,
      // Let the UI know whether a setup token is required
      setupTokenRequired: needsSetup && !!config.setupToken,
    });
  });

  // ── POST /setup ────────────────────────────────────────────────────────
  // Create the initial admin account.
  app.post('/', async (c) => {
    // Guard: setup already completed
    if (!userManager.needsSetup()) {
      return c.json({ error: 'Setup has already been completed' }, 409);
    }

    const body = await c.req.json().catch(() => ({})) as {
      username?: string;
      password?: string;
      setupToken?: string;
    };

    // Validate setup token if one is configured
    if (config.setupToken) {
      if (!body.setupToken) {
        return c.json({ error: 'Setup token is required' }, 401);
      }
      try {
        const bufA = Buffer.from(body.setupToken);
        const bufB = Buffer.from(config.setupToken);
        if (bufA.length !== bufB.length || !timingSafeEqual(bufA, bufB)) {
          log.warn('Invalid setup token attempt', {
            ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip'),
          });
          return c.json({ error: 'Invalid setup token' }, 401);
        }
      } catch {
        return c.json({ error: 'Invalid setup token' }, 401);
      }
    }

    const { username, password } = body;

    if (!username || !password) {
      return c.json({ error: 'username and password are required' }, 400);
    }

    if (username.length < 2) {
      return c.json({ error: 'Username must be at least 2 characters' }, 400);
    }

    if (password.length < 8) {
      return c.json({ error: 'Password must be at least 8 characters' }, 400);
    }

    try {
      const admin = await userManager.completeSetup(username, password);

      auditLogger.log({
        userId: admin.id,
        username: admin.username,
        action: 'setup.completed',
        details: JSON.stringify({ method: config.setupToken ? 'token' : 'first-user' }),
        ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || undefined,
      });

      log.info(`Initial admin account created: ${admin.username}`);

      // Create a web session so the user is immediately logged in
      const sessionToken = webSessionService.createSession(admin.id);
      setCookie(c, SESSION_COOKIE, sessionToken, {
        httpOnly: true,
        secure: isSecure(c),
        sameSite: 'Lax',
        maxAge: SESSION_MAX_AGE,
        path: '/',
      });

      return c.json({
        ok: true,
        user: {
          id: admin.id,
          username: admin.username,
          displayName: admin.displayName,
          role: admin.role,
        },
      }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Setup failed';
      return c.json({ error: message }, 400);
    }
  });

  return app;
}
