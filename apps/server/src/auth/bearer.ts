/**
 * Bearer token auth providers.
 *
 * Two providers are exported:
 *
 * - `BearerAuthProvider` — validates the shared server secret (single-user mode).
 *   System-level access with no user context.
 *
 * - `UserTokenAuthProvider` — validates per-user tokens via UserManager
 *   (multi-user mode). Each authenticated request has full user context.
 *
 * Both return `null` when the request has no Authorization header so that
 * other providers in the chain (e.g. Cloudflare Access) can try.
 */

import { timingSafeEqual } from 'crypto';
import type { Context } from 'hono';
import type { UserManager } from '../services/user-manager.js';
import type { AuthProvider, AuthResult } from './provider.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract bearer token from request, returning null if not present
 * or { authenticated: false } if the header is malformed.
 */
function extractBearerToken(c: Context): string | null | AuthResult {
  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return { authenticated: false };
  }

  return token;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function secureCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);

    // If lengths differ we still perform a comparison to keep timing constant.
    if (bufA.length !== bufB.length) {
      timingSafeEqual(bufA, bufA);
      return false;
    }

    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// ── Shared secret provider (single-user mode) ──────────────────────────────

export class BearerAuthProvider implements AuthProvider {
  readonly name = 'Bearer Token';

  constructor(
    private readonly secret: string,
  ) {}

  async authenticate(c: Context): Promise<AuthResult | null> {
    const tokenOrResult = extractBearerToken(c);
    if (tokenOrResult === null) return null;
    if (typeof tokenOrResult !== 'string') return tokenOrResult;

    if (secureCompare(tokenOrResult, this.secret)) {
      return {
        authenticated: true,
        identity: { provider: 'bearer' },
      };
    }

    return { authenticated: false };
  }
}

// ── Per-user token provider (multi-user mode) ──────────────────────────────

export class UserTokenAuthProvider implements AuthProvider {
  readonly name = 'User Token';

  constructor(
    private readonly userManager: UserManager,
  ) {}

  async authenticate(c: Context): Promise<AuthResult | null> {
    const tokenOrResult = extractBearerToken(c);
    if (tokenOrResult === null) return null;
    if (typeof tokenOrResult !== 'string') return tokenOrResult;

    const user = await this.userManager.validateToken(tokenOrResult);
    if (user) {
      return {
        authenticated: true,
        identity: { provider: 'bearer', email: user.email ?? undefined },
        user,
      };
    }

    return { authenticated: false };
  }
}
