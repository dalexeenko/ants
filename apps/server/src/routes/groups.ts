/**
 * Group Management routes
 * API for managing user groups, group membership, and group project access.
 * All endpoints require authentication; most require the admin role.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { GroupManager } from '../services/group-manager.js';
import type { AuditLogger } from '../services/audit-logger.js';
import type { AuthUser } from '../auth/index.js';
import { requireRole } from '../auth/index.js';
import { parseBody } from '../utils/validation.js';
import { getErrorMessage } from '../utils/errors.js';
import {
  CreateGroupSchema,
  UpdateGroupSchema,
  AddGroupMemberSchema,
  SetGroupProjectAccessSchema,
} from '../schemas/index.js';

function getClientIp(c: any): string | undefined {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    undefined
  );
}

export function createGroupRoutes(groupManager: GroupManager, auditLogger: AuditLogger) {
  const app = new Hono();

  // ── GET / ─ List all groups (admin only) ────────────────────────────────
  app.get('/', requireRole('admin'), async (c) => {
    const groups = groupManager.listGroups();
    return c.json({ groups });
  });

  // ── POST / ─ Create a group (admin only) ────────────────────────────────
  app.post('/', requireRole('admin'), async (c) => {
    const body = await parseBody(c, CreateGroupSchema);
    const currentUser = (c as any).get('user') as AuthUser | undefined;

    try {
      const group = groupManager.createGroup(body.name, {
        description: body.description,
        createdBy: currentUser?.id,
      });

      auditLogger.log({
        userId: currentUser?.id,
        username: currentUser?.username,
        action: 'group.create',
        resourceType: 'group',
        resourceId: group.id,
        details: JSON.stringify({ name: body.name }),
        ipAddress: getClientIp(c),
      });

      return c.json(group, 201);
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      return c.json(
        { error: error instanceof Error ? error.message : 'Failed to create group' },
        400
      );
    }
  });

  // ── GET /:id ─ Get a group (admin only) ─────────────────────────────────
  app.get('/:id', requireRole('admin'), async (c) => {
    const id = c.req.param('id');
    const group = groupManager.getGroup(id);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }
    return c.json(group);
  });

  // ── PATCH /:id ─ Update a group (admin only) ───────────────────────────
  app.patch('/:id', requireRole('admin'), async (c) => {
    const id = c.req.param('id');
    const body = await parseBody(c, UpdateGroupSchema);
    const currentUser = (c as any).get('user') as AuthUser | undefined;

    try {
      const group = groupManager.updateGroup(id, {
        name: body.name,
        description: body.description,
      });

      if (!group) {
        return c.json({ error: 'Group not found' }, 404);
      }

      auditLogger.log({
        userId: currentUser?.id,
        username: currentUser?.username,
        action: 'group.update',
        resourceType: 'group',
        resourceId: id,
        details: JSON.stringify(Object.keys(body)),
        ipAddress: getClientIp(c),
      });

      return c.json(group);
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      return c.json(
        { error: error instanceof Error ? error.message : 'Failed to update group' },
        400
      );
    }
  });

  // ── DELETE /:id ─ Delete a group (admin only) ──────────────────────────
  app.delete('/:id', requireRole('admin'), async (c) => {
    const id = c.req.param('id');
    const currentUser = (c as any).get('user') as AuthUser | undefined;

    const group = groupManager.getGroup(id);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }

    const deleted = groupManager.deleteGroup(id);
    if (!deleted) {
      return c.json({ error: 'Group not found' }, 404);
    }

    auditLogger.log({
      userId: currentUser?.id,
      username: currentUser?.username,
      action: 'group.delete',
      resourceType: 'group',
      resourceId: id,
      details: JSON.stringify({ name: group.name }),
      ipAddress: getClientIp(c),
    });

    return c.json({ success: true });
  });

  // ── GET /:id/members ─ List group members (admin only) ─────────────────
  app.get('/:id/members', requireRole('admin'), async (c) => {
    const id = c.req.param('id');

    const group = groupManager.getGroup(id);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }

    const members = groupManager.listMembers(id);
    return c.json({ members });
  });

  // ── POST /:id/members ─ Add a member (admin only) ─────────────────────
  app.post('/:id/members', requireRole('admin'), async (c) => {
    const id = c.req.param('id');
    const body = await parseBody(c, AddGroupMemberSchema);
    const currentUser = (c as any).get('user') as AuthUser | undefined;

    try {
      const member = groupManager.addMember(id, body.userId);

      auditLogger.log({
        userId: currentUser?.id,
        username: currentUser?.username,
        action: 'group.member.add',
        resourceType: 'group_member',
        resourceId: `${id}:${body.userId}`,
        details: JSON.stringify({ groupId: id, userId: body.userId }),
        ipAddress: getClientIp(c),
      });

      return c.json(member, 201);
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      return c.json(
        { error: error instanceof Error ? error.message : 'Failed to add member' },
        400
      );
    }
  });

  // ── DELETE /:id/members/:userId ─ Remove a member (admin only) ────────
  app.delete('/:id/members/:userId', requireRole('admin'), async (c) => {
    const id = c.req.param('id');
    const userId = c.req.param('userId');
    const currentUser = (c as any).get('user') as AuthUser | undefined;

    const removed = groupManager.removeMember(id, userId);
    if (!removed) {
      return c.json({ error: 'Member not found' }, 404);
    }

    auditLogger.log({
      userId: currentUser?.id,
      username: currentUser?.username,
      action: 'group.member.remove',
      resourceType: 'group_member',
      resourceId: `${id}:${userId}`,
      details: JSON.stringify({ groupId: id, userId }),
      ipAddress: getClientIp(c),
    });

    return c.json({ success: true });
  });

  // ── GET /:id/projects ─ List group project access (admin only) ────────
  app.get('/:id/projects', requireRole('admin'), async (c) => {
    const id = c.req.param('id');

    const group = groupManager.getGroup(id);
    if (!group) {
      return c.json({ error: 'Group not found' }, 404);
    }

    const projectAccess = groupManager.listGroupProjectAccess(id);
    return c.json({ projectAccess });
  });

  // ── PUT /:id/projects/:projectId ─ Set group project access (admin only)
  app.put('/:id/projects/:projectId', requireRole('admin'), async (c) => {
    const groupId = c.req.param('id');
    const projectId = c.req.param('projectId');
    const body = await parseBody(c, SetGroupProjectAccessSchema);
    const currentUser = (c as any).get('user') as AuthUser | undefined;

    try {
      const access = groupManager.setGroupProjectAccess(groupId, projectId, body.role);

      auditLogger.log({
        userId: currentUser?.id,
        username: currentUser?.username,
        action: 'group.project_access.set',
        resourceType: 'group_project_access',
        resourceId: `${groupId}:${projectId}`,
        details: JSON.stringify({ groupId, projectId, role: body.role }),
        ipAddress: getClientIp(c),
      });

      return c.json(access);
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      return c.json(
        { error: error instanceof Error ? error.message : 'Failed to set project access' },
        400
      );
    }
  });

  // ── DELETE /:id/projects/:projectId ─ Remove group project access (admin only)
  app.delete('/:id/projects/:projectId', requireRole('admin'), async (c) => {
    const groupId = c.req.param('id');
    const projectId = c.req.param('projectId');
    const currentUser = (c as any).get('user') as AuthUser | undefined;

    const removed = groupManager.removeGroupProjectAccess(groupId, projectId);
    if (!removed) {
      return c.json({ error: 'Project access not found' }, 404);
    }

    auditLogger.log({
      userId: currentUser?.id,
      username: currentUser?.username,
      action: 'group.project_access.remove',
      resourceType: 'group_project_access',
      resourceId: `${groupId}:${projectId}`,
      ipAddress: getClientIp(c),
    });

    return c.json({ success: true });
  });

  return app;
}
