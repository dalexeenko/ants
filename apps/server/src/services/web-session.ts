/**
 * Web Session Service
 *
 * Manages cookie-based sessions for the server web UI.
 * Session tokens are 32-byte random values; only their SHA-256 hashes are
 * stored in the database so a database leak does not compromise active
 * sessions.
 */

import { randomBytes, createHash } from 'crypto';
import { eq, lt } from 'drizzle-orm';
import { webSessions } from '../db/schema.js';
import type { DrizzleDB } from '../db/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('WebSessionService');

/** How long a session is valid (7 days in milliseconds). */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateId(): string {
  return randomBytes(16).toString('hex');
}

export class WebSessionService {
  private db: DrizzleDB;

  constructor(db: DrizzleDB) {
    this.db = db;
  }

  /**
   * Create a new session for the given user.
   *
   * @returns The raw session token (to be set as an HTTP cookie).
   */
  createSession(userId: string): string {
    const token = generateToken();
    const tokenHash = hashToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

    this.db.insert(webSessions).values({
      id: generateId(),
      userId,
      tokenHash,
      expiresAt,
      createdAt: now,
    }).run();

    log.debug('Created web session for user', userId);

    return token;
  }

  /**
   * Validate a session token.
   *
   * @returns The userId associated with the session, or null if the token is
   *          invalid or expired.
   */
  validateSession(token: string): string | null {
    const tokenHash = hashToken(token);

    const session = this.db
      .select()
      .from(webSessions)
      .where(eq(webSessions.tokenHash, tokenHash))
      .get();

    if (!session) return null;

    // Check expiry
    if (session.expiresAt < new Date()) {
      // Expired — clean it up
      this.db.delete(webSessions).where(eq(webSessions.id, session.id)).run();
      log.debug('Expired web session removed', session.id);
      return null;
    }

    return session.userId;
  }

  /**
   * Delete (invalidate) a session by its raw token.  Used for logout.
   */
  deleteSession(token: string): boolean {
    const tokenHash = hashToken(token);

    const session = this.db
      .select()
      .from(webSessions)
      .where(eq(webSessions.tokenHash, tokenHash))
      .get();

    if (!session) return false;

    this.db.delete(webSessions).where(eq(webSessions.id, session.id)).run();

    log.debug('Deleted web session', session.id);
    return true;
  }

  /**
   * Remove all expired sessions from the database.
   *
   * @returns The number of sessions removed.
   */
  cleanupExpired(): number {
    const now = new Date();

    // Count before deleting so we can report
    const expired = this.db
      .select()
      .from(webSessions)
      .where(lt(webSessions.expiresAt, now))
      .all();

    if (expired.length === 0) return 0;

    this.db.delete(webSessions).where(lt(webSessions.expiresAt, now)).run();

    log.info(`Cleaned up ${expired.length} expired web session(s)`);
    return expired.length;
  }
}
