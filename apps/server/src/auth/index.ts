/**
 * Auth module — pluggable authentication providers.
 *
 * Re-exports everything consumers need so they can import from `./auth/index.js`.
 */

// Types
export type { AuthProvider, AuthResult, AuthIdentity, AuthUser } from './provider.js';

// Middleware
export { createAuthMiddleware, requireRole } from './middleware.js';
export type { AuthMiddlewareOptions } from './middleware.js';

// Providers
export { BearerAuthProvider, UserTokenAuthProvider } from './bearer.js';
export { CloudflareAccessAuthProvider } from './cloudflare-access.js';
export type { CloudflareAccessConfig } from './cloudflare-access.js';
export { CookieAuthProvider } from './cookie.js';
export type { UserLookup } from './cookie.js';
