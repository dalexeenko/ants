/**
 * Authorization Code Service
 *
 * Manages one-time authorization codes for the app auth flow (similar to
 * OAuth 2.0 authorization code grant).  Codes are short-lived (30 seconds),
 * single-use, and bound to a specific redirect URI.  Only SHA-256 hashes
 * are stored in the database.
 */

import { randomBytes, createHash } from 'crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { authCodes } from '../db/schema.js';
import type { DrizzleDB } from '../db/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('AuthCodeService');

/** Authorization codes expire after 30 seconds. */
const CODE_TTL_MS = 30 * 1000;

function generateCode(): string {
  return randomBytes(32).toString('base64url');
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function generateId(): string {
  return randomBytes(16).toString('hex');
}

export class AuthCodeService {
  private db: DrizzleDB;

  constructor(db: DrizzleDB) {
    this.db = db;
  }

  /**
   * Create a new authorization code for the given user and redirect URI.
   *
   * @returns The raw authorization code (to be sent to the client).
   */
  createCode(userId: string, redirectUri: string): string {
    const code = generateCode();
    const codeHash = hashCode(code);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CODE_TTL_MS);

    this.db.insert(authCodes).values({
      id: generateId(),
      codeHash,
      userId,
      redirectUri,
      expiresAt,
      usedAt: null,
      createdAt: now,
    }).run();

    log.debug('Created auth code for user', userId);

    return code;
  }

  /**
   * Exchange an authorization code for a userId.
   *
   * Validates that the code exists, has not expired, has not already been
   * used, and that the redirect URI matches.  On success the code is marked
   * as used and the associated userId is returned.
   *
   * @returns The userId, or null if the code is invalid / expired / used.
   */
  exchangeCode(code: string, redirectUri: string): string | null {
    const codeHash = hashCode(code);

    const record = this.db
      .select()
      .from(authCodes)
      .where(eq(authCodes.codeHash, codeHash))
      .get();

    // Code not found
    if (!record) {
      log.debug('Auth code not found');
      return null;
    }

    // Already used
    if (record.usedAt) {
      log.debug('Auth code already used', record.id);
      return null;
    }

    // Expired
    if (record.expiresAt < new Date()) {
      log.debug('Auth code expired', record.id);
      return null;
    }

    // Redirect URI mismatch
    if (record.redirectUri !== redirectUri) {
      log.debug('Auth code redirect URI mismatch', record.id);
      return null;
    }

    // Mark as used
    this.db
      .update(authCodes)
      .set({ usedAt: new Date() })
      .where(eq(authCodes.id, record.id))
      .run();

    log.debug('Auth code exchanged for user', record.userId);
    return record.userId;
  }
}
