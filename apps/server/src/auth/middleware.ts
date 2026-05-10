/**
 * Auth middleware — dispatches through a chain of AuthProviders.
 *
 * For each incoming request the middleware iterates the providers in order:
 *
 * - `null`                       → provider doesn't handle this request; skip
 * - `{ authenticated: false }`   → provider recognised the credential but it's
 *                                  invalid; reject immediately with 401
 * - `{ authenticated: true, … }` → set identity / user on context, proceed
 *
 * If every provider returns `null` the request is rejected with 401.
 *
 * When `systemUserEnabled` is true (single-user mode), any authenticated
 * request that doesn't already have a specific user is automatically resolved
 * to the system user so that every request has a user context.
 */

import type { Context, Next } from 'hono';
import type { AuthProvider, AuthIdentity, AuthUser } from './provider.js';
import type { UserRole } from '../services/user-manager.js';
import { SYSTEM_USER_ID, SYSTEM_USER_USERNAME } from '../services/system-user.js';

// ── System user constant ────────────────────────────────────────────────────

const SYSTEM_USER: AuthUser = {
  id: SYSTEM_USER_ID,
  username: SYSTEM_USER_USERNAME,
  displayName: 'System',
  email: null,
  role: 'admin',
  enabled: true,
  lastLoginAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

// ── Options ─────────────────────────────────────────────────────────────────

export interface AuthMiddlewareOptions {
  /**
   * When true (single-user mode), every authenticated request that doesn't
   * already have a user from its provider is resolved to the system user.
   */
  systemUserEnabled?: boolean;
}

// ── Chain middleware ─────────────────────────────────────────────────────────

export function createAuthMiddleware(
  providers: AuthProvider[],
  options: AuthMiddlewareOptions = {},
) {
  const { systemUserEnabled = false } = options;

  return async (c: Context, next: Next) => {
    for (const provider of providers) {
      const result = await provider.authenticate(c);

      if (result === null) {
        // This provider doesn't apply — try the next one.
        continue;
      }

      if (!result.authenticated) {
        // Provider recognised the credential type but it was invalid.
        return c.json({ error: 'Invalid credentials' }, 401);
      }

      // Successful authentication — populate context.
      if (result.identity) {
        (c as any).set('authIdentity', result.identity);
      }
      if (result.user) {
        (c as any).set('user', result.user);
      } else if (systemUserEnabled) {
        // Single-user mode: resolve to the system user so every
        // authenticated request has a user context.
        (c as any).set('user', SYSTEM_USER);
      }

      await next();
      return;
    }

    // No provider could authenticate the request.
    return c.json({ error: 'Missing or invalid authentication' }, 401);
  };
}

// ── Role middleware ──────────────────────────────────────────────────────────

/**
 * Middleware that requires a specific role (or higher).
 * Must be used after createAuthMiddleware.
 *
 * When accessed via a provider that doesn't set a local user (shared secret,
 * Cloudflare Access without multi-user), access is always granted — these
 * represent system-level access.
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return async (c: Context, next: Next) => {
    const user = (c as any).get('user') as AuthUser | undefined;

    // No local user context → system-level access (shared secret or CF Access).
    // Grant access unconditionally.
    if (!user) {
      await next();
      return;
    }

    if (!allowedRoles.includes(user.role as UserRole)) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    await next();
  };
}
