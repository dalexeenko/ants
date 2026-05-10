/**
 * Host header validation middleware.
 *
 * Protects against DNS rebinding attacks by rejecting requests whose
 * Host header doesn't match an allowed value.
 *
 * localhost, 127.0.0.1, [::1], and ::1 are always permitted regardless
 * of configuration.
 */

import type { MiddlewareHandler } from 'hono';
import { createLogger } from './logger.js';

const log = createLogger('host-validation');

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Create a Hono middleware that validates the Host header.
 *
 * @param allowedHosts - List of allowed hostnames (lowercased).
 *   If the list includes '*', the middleware is a no-op (all hosts allowed).
 *   If the list is empty, only localhost variants are permitted.
 */
export function createHostValidation(allowedHosts: string[]): MiddlewareHandler | null {
  if (allowedHosts.includes('*')) {
    return null;
  }

  const allowedHostSet = new Set(allowedHosts.map(h => h.toLowerCase()));

  return async (c, next) => {
    // Skip validation for health check endpoints — load balancer probes
    // come from internal VPC IPs with no meaningful Host header.
    const path = c.req.path;
    if (path === '/health' || path === '/api/beta/health') {
      await next();
      return;
    }

    const hostHeader = (c.req.header('host') || '').toLowerCase();

    // Fast path: check the raw header first (covers bare ::1, localhost, etc.)
    if (LOCALHOST_HOSTS.has(hostHeader) || allowedHostSet.has(hostHeader)) {
      await next();
      return;
    }

    // Extract hostname, stripping the port suffix.
    // IPv6 addresses in Host headers use bracket notation: [::1]:port
    // so we strip ']:port' for bracketed addresses, and ':port' for the rest.
    let hostname: string;
    if (hostHeader.startsWith('[')) {
      // Bracketed IPv6 — strip port after closing bracket
      hostname = hostHeader.replace(/\]:\d+$/, ']');
    } else {
      hostname = hostHeader.replace(/:\d+$/, '');
    }

    if (LOCALHOST_HOSTS.has(hostname) || allowedHostSet.has(hostname)) {
      await next();
    } else {
      log.warn(`Rejected request with disallowed Host header: ${hostHeader}`);
      return c.json({ error: 'Invalid Host header' }, 421);
    }
  };
}
