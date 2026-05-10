/**
 * Pluggable auth provider interface.
 *
 * Each provider inspects the incoming request and returns an AuthResult
 * if it recognises its own credential type (header, cookie, etc.),
 * or `null` to let the next provider in the chain try.
 */

import type { Context } from 'hono';
import type { User } from '../db/schema.js';

// ── Public types ────────────────────────────────────────────────────────────

export type AuthUser = Omit<User, 'passwordHash'>;

/**
 * Lightweight identity extracted from the authenticated credential.
 * Always populated on successful auth; downstream code can read it
 * via `c.get('authIdentity')`.
 */
export interface AuthIdentity {
  /** Which provider authenticated this request */
  provider: string;
  /** Email address, when available (CF Access JWT, multi-user record, …) */
  email?: string;
}

/**
 * Result returned by an AuthProvider.
 *
 * - `authenticated: true`  → request proceeds; identity & user are set on ctx.
 * - `authenticated: false` → the provider recognised its credential type but
 *   the credential was invalid. The middleware rejects immediately with 401
 *   (does NOT fall through to later providers).
 */
export interface AuthResult {
  authenticated: boolean;
  /** Lightweight identity info (always set on success) */
  identity?: AuthIdentity;
  /** Full local user record — only set by BearerAuthProvider in multi-user mode */
  user?: AuthUser;
}

/**
 * A pluggable authentication provider.
 *
 * Implementations inspect the Hono `Context` for their specific credential
 * (e.g. Authorization header, Cf-Access-Jwt-Assertion header) and return:
 *
 * - `AuthResult` when the provider recognises the credential type
 * - `null` when the request contains no credential this provider handles
 */
export interface AuthProvider {
  /** Human-readable name shown in the startup banner */
  name: string;

  /**
   * Attempt to authenticate the request.
   *
   * @returns `AuthResult` if this provider's credential type is present,
   *          `null` if the request has nothing for this provider.
   */
  authenticate(c: Context): Promise<AuthResult | null>;
}
