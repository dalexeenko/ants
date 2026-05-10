/**
 * Group Manager Service
 *
 * Manages user groups, group membership, and group-based project access.
 * Groups allow assigning project roles to sets of users at once rather than
 * individually.
 *
 * The effective role for a user on a project is computed by taking the
 * highest privilege across their global role, personal project access, and
 * all group project access entries.
 */

import { v4 as uuid } from 'uuid';
import { eq, and } from 'drizzle-orm';
import {
  users,
  userGroups,
  userGroupMembers,
  groupProjectAccess,
  projectAccess,
} from '../db/schema.js';
import type {
  UserGroup,
  NewUserGroup,
  UserGroupMember,
  NewUserGroupMember,
  GroupProjectAccess,
  NewGroupProjectAccess,
} from '../db/schema.js';
import type { DrizzleDB } from '../db/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('GroupManager');

export type UserRole = 'admin' | 'operator' | 'viewer';

const VALID_ROLES: UserRole[] = ['admin', 'operator', 'viewer'];

/** Numeric weight for role comparison — higher is more privileged. */
const ROLE_WEIGHT: Record<UserRole, number> = {
  viewer: 0,
  operator: 1,
  admin: 2,
};

export class GroupManager {
  private db: DrizzleDB;

  constructor(db: DrizzleDB) {
    this.db = db;
  }

  // ── Group CRUD ─────────────────────────────────────────────────────────

  createGroup(
    name: string,
    options?: { description?: string; createdBy?: string }
  ): UserGroup {
    if (!name || name.length < 1) {
      throw new Error('Group name is required');
    }

    // Check for duplicate name
    const existing = this.db
      .select()
      .from(userGroups)
      .where(eq(userGroups.name, name))
      .get();
    if (existing) {
      throw new Error(`Group '${name}' already exists`);
    }

    const now = new Date();
    const group: NewUserGroup = {
      id: uuid(),
      name,
      description: options?.description ?? null,
      createdBy: options?.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    };

    this.db.insert(userGroups).values(group).run();

    log.info('Created group', name);
    return group as UserGroup;
  }

  getGroup(id: string): UserGroup | null {
    return this.db.select().from(userGroups).where(eq(userGroups.id, id)).get() ?? null;
  }

  listGroups(): UserGroup[] {
    return this.db.select().from(userGroups).all();
  }

  updateGroup(
    id: string,
    updates: { name?: string; description?: string }
  ): UserGroup | null {
    const existing = this.db
      .select()
      .from(userGroups)
      .where(eq(userGroups.id, id))
      .get();
    if (!existing) return null;

    if (updates.name !== undefined) {
      // Check for duplicate name (unless unchanged)
      if (updates.name !== existing.name) {
        const dup = this.db
          .select()
          .from(userGroups)
          .where(eq(userGroups.name, updates.name))
          .get();
        if (dup) {
          throw new Error(`Group '${updates.name}' already exists`);
        }
      }
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;

    this.db.update(userGroups).set(updateData).where(eq(userGroups.id, id)).run();

    const updated = this.db.select().from(userGroups).where(eq(userGroups.id, id)).get();
    return updated ?? null;
  }

  deleteGroup(id: string): boolean {
    const existing = this.db
      .select()
      .from(userGroups)
      .where(eq(userGroups.id, id))
      .get();
    if (!existing) return false;

    // Cascade deletes will remove members and group project access
    this.db.delete(userGroups).where(eq(userGroups.id, id)).run();

    log.info('Deleted group', existing.name);
    return true;
  }

  // ── Member Management ──────────────────────────────────────────────────

  addMember(groupId: string, userId: string): UserGroupMember {
    // Verify group exists
    const group = this.getGroup(groupId);
    if (!group) {
      throw new Error('Group not found');
    }

    // Verify user exists
    const user = this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      throw new Error('User not found');
    }

    // Check for existing membership
    const existing = this.db
      .select()
      .from(userGroupMembers)
      .where(
        and(
          eq(userGroupMembers.groupId, groupId),
          eq(userGroupMembers.userId, userId)
        )
      )
      .get();
    if (existing) {
      throw new Error('User is already a member of this group');
    }

    const member: NewUserGroupMember = {
      id: uuid(),
      userId,
      groupId,
      joinedAt: new Date(),
    };

    this.db.insert(userGroupMembers).values(member).run();

    log.info('Added user', userId, 'to group', group.name);
    return member as UserGroupMember;
  }

  removeMember(groupId: string, userId: string): boolean {
    const existing = this.db
      .select()
      .from(userGroupMembers)
      .where(
        and(
          eq(userGroupMembers.groupId, groupId),
          eq(userGroupMembers.userId, userId)
        )
      )
      .get();
    if (!existing) return false;

    this.db.delete(userGroupMembers).where(eq(userGroupMembers.id, existing.id)).run();

    log.info('Removed user', userId, 'from group', groupId);
    return true;
  }

  listMembers(groupId: string): UserGroupMember[] {
    return this.db
      .select()
      .from(userGroupMembers)
      .where(eq(userGroupMembers.groupId, groupId))
      .all();
  }

  getGroupsForUser(userId: string): UserGroup[] {
    const memberships = this.db
      .select()
      .from(userGroupMembers)
      .where(eq(userGroupMembers.userId, userId))
      .all();

    if (memberships.length === 0) return [];

    const groups: UserGroup[] = [];
    for (const membership of memberships) {
      const group = this.db
        .select()
        .from(userGroups)
        .where(eq(userGroups.id, membership.groupId))
        .get();
      if (group) groups.push(group);
    }

    return groups;
  }

  // ── Group Project Access ───────────────────────────────────────────────

  setGroupProjectAccess(
    groupId: string,
    projectId: string,
    role: UserRole
  ): GroupProjectAccess {
    if (!VALID_ROLES.includes(role)) {
      throw new Error(`Invalid role: ${role}`);
    }

    const existing = this.db
      .select()
      .from(groupProjectAccess)
      .where(
        and(
          eq(groupProjectAccess.groupId, groupId),
          eq(groupProjectAccess.projectId, projectId)
        )
      )
      .get();

    if (existing) {
      this.db
        .update(groupProjectAccess)
        .set({ role })
        .where(eq(groupProjectAccess.id, existing.id))
        .run();
      return { ...existing, role };
    }

    const access: NewGroupProjectAccess = {
      id: uuid(),
      groupId,
      projectId,
      role,
      createdAt: new Date(),
    };

    this.db.insert(groupProjectAccess).values(access).run();

    log.info('Set group project access', groupId, projectId, role);
    return access as GroupProjectAccess;
  }

  removeGroupProjectAccess(groupId: string, projectId: string): boolean {
    const existing = this.db
      .select()
      .from(groupProjectAccess)
      .where(
        and(
          eq(groupProjectAccess.groupId, groupId),
          eq(groupProjectAccess.projectId, projectId)
        )
      )
      .get();
    if (!existing) return false;

    this.db
      .delete(groupProjectAccess)
      .where(eq(groupProjectAccess.id, existing.id))
      .run();

    log.info('Removed group project access', groupId, projectId);
    return true;
  }

  getGroupProjectAccess(
    groupId: string,
    projectId: string
  ): GroupProjectAccess | null {
    return (
      this.db
        .select()
        .from(groupProjectAccess)
        .where(
          and(
            eq(groupProjectAccess.groupId, groupId),
            eq(groupProjectAccess.projectId, projectId)
          )
        )
        .get() ?? null
    );
  }

  listGroupProjectAccess(groupId: string): GroupProjectAccess[] {
    return this.db
      .select()
      .from(groupProjectAccess)
      .where(eq(groupProjectAccess.groupId, groupId))
      .all();
  }

  // ── Effective Role Computation ─────────────────────────────────────────

  /**
   * Compute the effective role for a user on a specific project.
   *
   * Resolution order (highest privilege wins):
   *   1. User's global role
   *   2. User's personal project access (projectAccess table)
   *   3. All groups the user belongs to (groupProjectAccess table)
   *
   * @returns The highest-privilege role, or null if the user doesn't exist
   *          or is disabled.
   */
  getEffectiveRole(userId: string, projectId: string): UserRole | null {
    const user = this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!user || !user.enabled) return null;

    const globalRole = user.role as UserRole;

    // Admins always get admin — short-circuit
    if (globalRole === 'admin') return 'admin';

    let highestWeight = ROLE_WEIGHT[globalRole];

    // Check personal project access
    const personalAccess = this.db
      .select()
      .from(projectAccess)
      .where(
        and(
          eq(projectAccess.userId, userId),
          eq(projectAccess.projectId, projectId)
        )
      )
      .get();

    if (personalAccess) {
      const personalWeight = ROLE_WEIGHT[personalAccess.role as UserRole] ?? 0;
      if (personalWeight > highestWeight) {
        highestWeight = personalWeight;
      }
    }

    // If already admin, no need to check groups
    if (highestWeight >= ROLE_WEIGHT.admin) return 'admin';

    // Check group-based project access
    const memberships = this.db
      .select()
      .from(userGroupMembers)
      .where(eq(userGroupMembers.userId, userId))
      .all();

    for (const membership of memberships) {
      const groupAccess = this.db
        .select()
        .from(groupProjectAccess)
        .where(
          and(
            eq(groupProjectAccess.groupId, membership.groupId),
            eq(groupProjectAccess.projectId, projectId)
          )
        )
        .get();

      if (groupAccess) {
        const groupWeight = ROLE_WEIGHT[groupAccess.role as UserRole] ?? 0;
        if (groupWeight > highestWeight) {
          highestWeight = groupWeight;
        }
      }
    }

    // Convert weight back to role
    for (const [role, weight] of Object.entries(ROLE_WEIGHT)) {
      if (weight === highestWeight) return role as UserRole;
    }

    return globalRole;
  }
}
