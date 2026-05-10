/**
 * User Management Service
 * Handles user CRUD, authentication, token management, and RBAC.
 *
 * Design principles for self-hosted:
 * - Works alongside the existing bearer token auth (backwards compatible)
 * - Multi-user mode is opt-in via OPENMGR_MULTI_USER=true
 * - Auto-creates initial admin user on first run
 * - No external auth dependencies (simple password-based using crypto.scrypt)
 * - Roles: admin (full access), operator (manage projects), viewer (read-only)
 */

import { randomBytes, createHash, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { eq, and, ne } from 'drizzle-orm';
import { users, userTokens, projectAccess } from '../db/schema.js';
import type { User, NewUser, UserToken, NewUserToken, ProjectAccess, NewProjectAccess } from '../db/schema.js';
import type { DrizzleDB } from '../db/index.js';
import { SYSTEM_USER_ID } from './system-user.js';
import { createLogger, banner } from '../utils/logger.js';

const log = createLogger('UserManager');

const scryptAsync = promisify(scrypt);

export type UserRole = 'admin' | 'operator' | 'viewer';

const VALID_ROLES: UserRole[] = ['admin', 'operator', 'viewer'];

// Password hashing using crypto.scrypt (no external dependencies)
const SCRYPT_KEYLEN = 64;
const SALT_LEN = 32;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN).toString('hex');
  const derived = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const parts = hash.split(':');
  if (parts[0] !== 'scrypt' || parts.length !== 3) {
    return false;
  }
  const salt = parts[1];
  const storedKey = Buffer.from(parts[2], 'hex');
  const derived = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return timingSafeEqual(storedKey, derived);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

function generateId(): string {
  return randomBytes(16).toString('hex');
}

/** Strip passwordHash from a user object for safe API responses */
function sanitizeUser(user: User): Omit<User, 'passwordHash'> {
  const { passwordHash: _, ...safe } = user;
  return safe;
}

export class UserManager {
  private db: DrizzleDB;

  constructor(db: DrizzleDB) {
    this.db = db;
  }

  // ── User CRUD ──────────────────────────────────────────────────────────

  async createUser(
    username: string,
    password: string,
    role: UserRole,
    options?: { displayName?: string; email?: string; enabled?: boolean }
  ): Promise<Omit<User, 'passwordHash'>> {
    if (!VALID_ROLES.includes(role)) {
      throw new Error(`Invalid role: ${role}`);
    }
    if (!username || username.length < 2) {
      throw new Error('Username must be at least 2 characters');
    }
    if (!password || password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }

    // Check for duplicate username
    const existing = await this.getUserByUsername(username);
    if (existing) {
      throw new Error(`Username '${username}' is already taken`);
    }

    const now = new Date();
    const passwordHash = await hashPassword(password);

    const newUser: NewUser = {
      id: generateId(),
      username,
      displayName: options?.displayName ?? null,
      email: options?.email ?? null,
      passwordHash,
      role,
      enabled: options?.enabled ?? true,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.db.insert(users).values(newUser).run();

    return sanitizeUser(newUser as User);
  }

  async getUser(id: string): Promise<Omit<User, 'passwordHash'> | null> {
    const result = this.db.select().from(users).where(eq(users.id, id)).get();
    return result ? sanitizeUser(result) : null;
  }

  async getUserByUsername(username: string): Promise<User | null> {
    return this.db.select().from(users).where(eq(users.username, username)).get() ?? null;
  }

  async listUsers(): Promise<Omit<User, 'passwordHash'>[]> {
    const result = this.db.select().from(users).all();
    return result.map(sanitizeUser);
  }

  async updateUser(
    id: string,
    updates: {
      displayName?: string;
      email?: string;
      role?: UserRole;
      enabled?: boolean;
    }
  ): Promise<Omit<User, 'passwordHash'> | null> {
    const existing = this.db.select().from(users).where(eq(users.id, id)).get();
    if (!existing) return null;

    if (updates.role && !VALID_ROLES.includes(updates.role)) {
      throw new Error(`Invalid role: ${updates.role}`);
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.displayName !== undefined) updateData.displayName = updates.displayName;
    if (updates.email !== undefined) updateData.email = updates.email;
    if (updates.role !== undefined) updateData.role = updates.role;
    if (updates.enabled !== undefined) updateData.enabled = updates.enabled;

    this.db.update(users).set(updateData).where(eq(users.id, id)).run();

    const updated = this.db.select().from(users).where(eq(users.id, id)).get();
    return updated ? sanitizeUser(updated) : null;
  }

  async deleteUser(id: string): Promise<boolean> {
    const existing = this.db.select().from(users).where(eq(users.id, id)).get();
    if (!existing) return false;

    this.db.delete(users).where(eq(users.id, id)).run();
    return true;
  }

  // ── Authentication ─────────────────────────────────────────────────────

  async authenticatePassword(
    username: string,
    password: string
  ): Promise<{ user: Omit<User, 'passwordHash'>; token: string } | null> {
    const user = await this.getUserByUsername(username);
    if (!user || !user.enabled) return null;

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) return null;

    // Update last login
    this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id)).run();

    // Create a session token
    const { token, tokenInfo } = await this.createToken(user.id, 'login-session');

    return { user: sanitizeUser(user), token };
  }

  async validateToken(token: string): Promise<Omit<User, 'passwordHash'> | null> {
    const hash = hashToken(token);
    const tokenRecord = this.db
      .select()
      .from(userTokens)
      .where(eq(userTokens.tokenHash, hash))
      .get();

    if (!tokenRecord) return null;

    // Check expiry
    if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
      // Token expired, clean it up
      this.db.delete(userTokens).where(eq(userTokens.id, tokenRecord.id)).run();
      return null;
    }

    // Update last used
    this.db
      .update(userTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(userTokens.id, tokenRecord.id))
      .run();

    // Get user
    const user = this.db
      .select()
      .from(users)
      .where(eq(users.id, tokenRecord.userId))
      .get();

    if (!user || !user.enabled) return null;

    return sanitizeUser(user);
  }

  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string
  ): Promise<boolean> {
    const user = this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) return false;

    const valid = await verifyPassword(oldPassword, user.passwordHash);
    if (!valid) return false;

    if (!newPassword || newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters');
    }

    const passwordHash = await hashPassword(newPassword);
    this.db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .run();

    return true;
  }

  // ── Token Management ───────────────────────────────────────────────────

  async createToken(
    userId: string,
    name: string,
    expiresAt?: Date
  ): Promise<{ token: string; tokenInfo: Omit<UserToken, 'tokenHash'> }> {
    const user = this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      throw new Error('User not found');
    }

    const token = generateToken();
    const tokenHash = hashToken(token);
    const now = new Date();

    const newToken: NewUserToken = {
      id: generateId(),
      userId,
      tokenHash,
      name,
      lastUsedAt: null,
      expiresAt: expiresAt ?? null,
      createdAt: now,
    };

    this.db.insert(userTokens).values(newToken).run();

    const { tokenHash: _, ...tokenInfo } = newToken as UserToken;
    return { token, tokenInfo };
  }

  async listTokens(userId: string): Promise<Omit<UserToken, 'tokenHash'>[]> {
    const results = this.db
      .select()
      .from(userTokens)
      .where(eq(userTokens.userId, userId))
      .all();

    return results.map(({ tokenHash: _, ...rest }) => rest);
  }

  async revokeToken(tokenId: string): Promise<boolean> {
    const existing = this.db
      .select()
      .from(userTokens)
      .where(eq(userTokens.id, tokenId))
      .get();
    if (!existing) return false;

    this.db.delete(userTokens).where(eq(userTokens.id, tokenId)).run();
    return true;
  }

  /** Revoke a token by its raw value (used for logout) */
  async revokeTokenByValue(token: string): Promise<boolean> {
    const hash = hashToken(token);
    const existing = this.db
      .select()
      .from(userTokens)
      .where(eq(userTokens.tokenHash, hash))
      .get();
    if (!existing) return false;

    this.db.delete(userTokens).where(eq(userTokens.id, existing.id)).run();
    return true;
  }

  // ── RBAC ───────────────────────────────────────────────────────────────

  async checkAccess(
    userId: string,
    projectId?: string,
    action?: string
  ): Promise<boolean> {
    const user = this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!user || !user.enabled) return false;

    const role = user.role as UserRole;

    // Admins can do everything
    if (role === 'admin') return true;

    // Determine what the action needs
    if (action) {
      // User management actions are admin-only
      if (action.startsWith('user.')) return false;
      // Audit log viewing is admin-only
      if (action === 'audit.view') return false;
    }

    // If no projectId, check general role permissions
    if (!projectId) {
      if (action === 'project.create') return this.canManageProjects(role);
      if (action === 'project.view') return this.canViewProjects(role);
      return this.canViewProjects(role);
    }

    // Check project-specific access
    const access = await this.getProjectAccess(userId, projectId);
    const effectiveRole = access ? (access.role as UserRole) : role;

    if (action) {
      if (action.includes('view') || action.includes('list')) {
        return this.canViewProjects(effectiveRole);
      }
      if (action.includes('prompt') || action.includes('send')) {
        return this.canSendPrompts(effectiveRole);
      }
      if (action.includes('create') || action.includes('update') || action.includes('delete')) {
        return this.canManageProjects(effectiveRole);
      }
    }

    return this.canViewProjects(effectiveRole);
  }

  async getProjectAccess(userId: string, projectId: string): Promise<ProjectAccess | null> {
    return (
      this.db
        .select()
        .from(projectAccess)
        .where(
          and(
            eq(projectAccess.userId, userId),
            eq(projectAccess.projectId, projectId)
          )
        )
        .get() ?? null
    );
  }

  async setProjectAccess(
    userId: string,
    projectId: string,
    role: UserRole
  ): Promise<ProjectAccess> {
    if (!VALID_ROLES.includes(role)) {
      throw new Error(`Invalid role: ${role}`);
    }

    const existing = await this.getProjectAccess(userId, projectId);

    if (existing) {
      this.db
        .update(projectAccess)
        .set({ role })
        .where(eq(projectAccess.id, existing.id))
        .run();
      return { ...existing, role };
    }

    const newAccess: NewProjectAccess = {
      id: generateId(),
      userId,
      projectId,
      role,
      createdAt: new Date(),
    };

    this.db.insert(projectAccess).values(newAccess).run();
    return newAccess as ProjectAccess;
  }

  async removeProjectAccess(userId: string, projectId: string): Promise<boolean> {
    const existing = await this.getProjectAccess(userId, projectId);
    if (!existing) return false;

    this.db.delete(projectAccess).where(eq(projectAccess.id, existing.id)).run();
    return true;
  }

  /** List all project access entries for a user */
  async listProjectAccess(userId: string): Promise<ProjectAccess[]> {
    return this.db
      .select()
      .from(projectAccess)
      .where(eq(projectAccess.userId, userId))
      .all();
  }

  // ── Role Checks ────────────────────────────────────────────────────────

  canManageUsers(role: UserRole): boolean {
    return role === 'admin';
  }

  canManageProjects(role: UserRole): boolean {
    return role === 'admin' || role === 'operator';
  }

  canSendPrompts(role: UserRole): boolean {
    return role === 'admin' || role === 'operator';
  }

  canViewProjects(role: UserRole): boolean {
    return VALID_ROLES.includes(role);
  }

  // ── Initial Setup ──────────────────────────────────────────────────────

  /**
   * Returns true when no real (non-system) users exist yet.
   * The server should enter "setup mode" and expose the POST /setup
   * endpoint so the first admin can create their account.
   */
  needsSetup(): boolean {
    const realUsers = this.db
      .select()
      .from(users)
      .where(ne(users.id, SYSTEM_USER_ID))
      .all();
    return realUsers.length === 0;
  }

  /**
   * Complete initial setup by creating the first admin user.
   *
   * @param username  - desired admin username
   * @param password  - desired admin password (min 8 chars)
   * @returns the created admin user (without passwordHash)
   * @throws if setup has already been completed (admin exists)
   */
  async completeSetup(
    username: string,
    password: string,
  ): Promise<Omit<User, 'passwordHash'>> {
    if (!this.needsSetup()) {
      throw new Error('Setup has already been completed');
    }

    return this.createUser(username, password, 'admin', {
      displayName: 'Administrator',
    });
  }
}
