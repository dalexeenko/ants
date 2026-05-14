/**
 * Gate for serving the optional web app UI (`/app`) behind a validated
 * `ants_session` cookie — same contract as {@link CookieAuthProvider}.
 */

import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { WebSessionService } from '../services/web-session.js';

const SESSION_COOKIE = 'ants_session';

export function hasValidWebUiSession(c: Context, webSessionService: WebSessionService): boolean {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return false;
  return webSessionService.validateSession(token) !== null;
}
