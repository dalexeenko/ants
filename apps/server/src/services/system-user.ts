/**
 * System User Service
 *
 * Creates and manages the `system` user — a special user that owns all
 * objects in single-user mode.  The system user is created on every startup
 * if it does not already exist and can never be used for interactive login.
 */

import { eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { users } from '../db/schema.js';
import type { DrizzleDB } from '../db/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('system-user');

export const SYSTEM_USER_ID = 'system';
export const SYSTEM_USER_USERNAME = 'system';

/**
 * Ensures the system user exists.  Called on every startup.
 *
 * The system user owns all objects in single-user mode and serves as the
 * default owner for existing data.  Its password hash is a placeholder that
 * will never pass verification, so the account cannot be used for login.
 */
export async function ensureSystemUser(db: DrizzleDB): Promise<void> {
  const existing = db.select().from(users).where(eq(users.id, SYSTEM_USER_ID)).get();
  if (existing) return;

  const now = new Date();

  // The system user can never log in — use a placeholder hash that won't
  // match any real scrypt output.
  const placeholderHash = 'system:nologin';

  db.insert(users).values({
    id: SYSTEM_USER_ID,
    username: SYSTEM_USER_USERNAME,
    displayName: 'System',
    email: null,
    passwordHash: placeholderHash,
    role: 'admin',
    enabled: true,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
  }).run();

  log.info('Created system user');
}
