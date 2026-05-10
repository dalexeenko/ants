/**
 * Request utility helpers for extracting protocol and building server URLs.
 *
 * Behind TLS-terminating proxies / load balancers the request arrives as
 * plain HTTP even though the client connected via HTTPS.  These helpers
 * check the standard `X-Forwarded-Proto` header first, then fall back to
 * inspecting the raw request URL.
 */

import type { Context } from 'hono';

/**
 * Return `true` when the *original* client request was made over HTTPS.
 *
 * Checks (in order):
 * 1. `X-Forwarded-Proto` header (ALB, nginx, Caddy, Cloudflare, etc.)
 * 2. `X-Forwarded-Scheme` header (alternative used by some proxies)
 * 3. `X-Forwarded-Ssl` header (`on` = HTTPS, used by some older proxies)
 * 4. Standard `Forwarded` header (RFC 7239, e.g. `proto=https`)
 * 5. Whether `c.req.url` starts with `https`
 */
export function isSecure(c: Context): boolean {
  // 1. X-Forwarded-Proto (most common)
  const forwardedProto = c.req.header('x-forwarded-proto');
  if (forwardedProto) {
    return forwardedProto.split(',')[0]!.trim().toLowerCase() === 'https';
  }

  // 2. X-Forwarded-Scheme
  const forwardedScheme = c.req.header('x-forwarded-scheme');
  if (forwardedScheme) {
    return forwardedScheme.trim().toLowerCase() === 'https';
  }

  // 3. X-Forwarded-Ssl
  const forwardedSsl = c.req.header('x-forwarded-ssl');
  if (forwardedSsl) {
    return forwardedSsl.trim().toLowerCase() === 'on';
  }

  // 4. Standard Forwarded header (RFC 7239) — look for proto=https
  const forwarded = c.req.header('forwarded');
  if (forwarded) {
    const protoMatch = forwarded.match(/proto\s*=\s*"?(\w+)"?/i);
    if (protoMatch) {
      return protoMatch[1]!.toLowerCase() === 'https';
    }
  }

  // 5. Fall back to the raw request URL
  return c.req.url.startsWith('https');
}

/**
 * Build the external server URL (scheme + host) for the current request.
 *
 * Example: `https://personal.ants.dev`
 */
export function getServerUrl(c: Context): string {
  const proto = isSecure(c) ? 'https' : 'http';
  return `${proto}://${c.req.header('host')}`;
}
