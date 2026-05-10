/**
 * Cookie-based auth provider for the server web UI.
 *
 * Checks for an `ants_session` cookie, validates it via WebSessionService,
 * and resolves the associated user.  Returns `null` when no cookie is present
 * so that downstream providers (Bearer, CF Access) can still authenticate.
 */

import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { AuthProvider, AuthResult, AuthUser } from './provider.js';
import type { WebSessionService } from '../services/web-session.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('auth:cookie');

const SESSION_COOKIE = 'ants_session';

/** Callback that resolves a userId to a full AuthUser (minus passwordHash). */
export type UserLookup = (userId: string) => AuthUser | null | Promise<AuthUser | null>;

export class CookieAuthProvider implements AuthProvider {
  readonly name = 'Cookie';

  constructor(
    private readonly webSessionService: WebSessionService,
    private readonly lookupUser: UserLookup,
  ) {}

  async authenticate(c: Context): Promise<AuthResult | null> {
    const token = getCookie(c, SESSION_COOKIE);

    // No session cookie → not our credential type; let the chain continue.
    if (!token) {
      return null;
    }

    const userId = this.webSessionService.validateSession(token);
    if (!userId) {
      // Cookie was present but the session is invalid or expired.
      // Don't reject — the request may have a valid bearer token too.
      log.debug('Session cookie present but invalid/expired');
      return null;
    }

    try {
      const user = await this.lookupUser(userId);
      if (!user) {
        log.debug(`Session valid but user ${userId} not found`);
        return null;
      }

      return {
        authenticated: true,
        identity: { provider: 'cookie', email: user.email ?? undefined },
        user,
      };
    } catch (err) {
      log.error('Failed to look up user during cookie auth:', err);
      // Database error (e.g. corruption) — treat as auth failure so the
      // request gets a proper error response instead of hanging.
      return { authenticated: false };
    }
  }
}
