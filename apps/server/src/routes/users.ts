import { Hono } from 'hono';
import type { UserManager, UserRole } from '../services/user-manager.js';
import type { AuditLogger } from '../services/audit-logger.js';
import type { AuthUser } from '../auth/index.js';
import { requireRole } from '../auth/index.js';
import { parseBody } from '../utils/validation.js';
import {
  LoginSchema,
  CreateUserSchema,
  UpdateUserSchema,
  CreateTokenSchema,
  SetProjectAccessSchema,
} from '../schemas/index.js';

function getClientIp(c: any): string | undefined {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    undefined
  );
}

export function createUserRoutes(userManager: UserManager, auditLogger: AuditLogger) {
  const app = new Hono();

  // ── POST /login ─ Authenticate with username/password, returns token ──
  app.post('/login', async (c) => {
    const body = await parseBody(c, LoginSchema);

    const result = await userManager.authenticatePassword(body.username, body.password);

    if (!result) {
      auditLogger.log({
        username: body.username,
        action: 'user.login_failed',
        ipAddress: getClientIp(c),
      });
      return c.json({ error: 'Invalid username or password' }, 401);
    }

    auditLogger.log({
      userId: result.user.id,
      username: result.user.username,
      action: 'user.login',
      ipAddress: getClientIp(c),
    });

    return c.json({
      user: result.user,
      token: result.token,
    });
  });

  // ── POST /logout ─ Revoke current token ───────────────────────────────
  app.post('/logout', async (c) => {
    const user = (c as any).get('user') as AuthUser | undefined;
    if (!user) {
      // Shared secret doesn't have a token to revoke
      return c.json({ success: true });
    }

    const authHeader = c.req.header('Authorization');
    const token = authHeader?.split(' ')[1];
    if (token) {
      await userManager.revokeTokenByValue(token);
    }

    auditLogger.log({
      userId: user.id,
      username: user.username,
      action: 'user.logout',
      ipAddress: getClientIp(c),
    });

    return c.json({ success: true });
  });

  // ── GET / ─ List users (admin only) ───────────────────────────────────
  app.get('/', requireRole('admin'), async (c) => {
    const users = await userManager.listUsers();
    return c.json({ users });
  });

  // ── POST / ─ Create user (admin only) ─────────────────────────────────
  app.post('/', requireRole('admin'), async (c) => {
    const body = await parseBody(c, CreateUserSchema);

    try {
      const user = await userManager.createUser(body.username, body.password, body.role, {
        displayName: body.displayName,
        email: body.email,
      });

      const currentUser = (c as any).get('user') as AuthUser | undefined;
      auditLogger.log({
        userId: currentUser?.id,
        username: currentUser?.username,
        action: 'user.create',
        resourceType: 'user',
        resourceId: user.id,
        details: JSON.stringify({ username: body.username, role: body.role }),
        ipAddress: getClientIp(c),
      });

      return c.json(user, 201);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Failed to create user' },
        400
      );
    }
  });

  // ── GET /:id ─ Get user ───────────────────────────────────────────────
  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const currentUser = (c as any).get('user') as AuthUser | undefined;

    // Non-admin users can only view themselves
    if (currentUser && currentUser.role !== 'admin' && currentUser.id !== id) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    const user = await userManager.getUser(id);
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    return c.json(user);
  });

  // ── PATCH /:id ─ Update user (admin, or self for limited fields) ──────
  app.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const currentUser = (c as any).get('user') as AuthUser | undefined;
    const body = await parseBody(c, UpdateUserSchema);

    const isAdmin = !currentUser || currentUser.role === 'admin';
    const isSelf = currentUser && currentUser.id === id;

    if (!isAdmin && !isSelf) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    // Handle password change
    if (body.oldPassword && body.newPassword) {
      if (!isSelf && !isAdmin) {
        return c.json({ error: 'Can only change your own password' }, 403);
      }
      try {
        // For admin changing another user's password, we don't require old password
        // But for self, we do
        if (isSelf) {
          const changed = await userManager.changePassword(id, body.oldPassword, body.newPassword);
          if (!changed) {
            return c.json({ error: 'Current password is incorrect' }, 400);
          }
        }
      } catch (error) {
        return c.json(
          { error: error instanceof Error ? error.message : 'Failed to change password' },
          400
        );
      }
    }

    // Non-admins can only update their own displayName and email
    const updates: Record<string, unknown> = {};
    if (body.displayName !== undefined) updates.displayName = body.displayName;
    if (body.email !== undefined) updates.email = body.email;

    // Only admins can change role and enabled status
    if (isAdmin) {
      if (body.role !== undefined) updates.role = body.role;
      if (body.enabled !== undefined) updates.enabled = body.enabled;
    }

    try {
      const user = await userManager.updateUser(id, updates as any);
      if (!user) {
        return c.json({ error: 'User not found' }, 404);
      }

      auditLogger.log({
        userId: currentUser?.id,
        username: currentUser?.username,
        action: 'user.update',
        resourceType: 'user',
        resourceId: id,
        details: JSON.stringify(Object.keys(updates)),
        ipAddress: getClientIp(c),
      });

      return c.json(user);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Failed to update user' },
        400
      );
    }
  });

  // ── DELETE /:id ─ Delete user (admin only) ────────────────────────────
  app.delete('/:id', requireRole('admin'), async (c) => {
    const id = c.req.param('id');
    const currentUser = (c as any).get('user') as AuthUser | undefined;

    // Prevent admin from deleting themselves
    if (currentUser && currentUser.id === id) {
      return c.json({ error: 'Cannot delete your own account' }, 400);
    }

    const user = await userManager.getUser(id);
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    const deleted = await userManager.deleteUser(id);
    if (!deleted) {
      return c.json({ error: 'User not found' }, 404);
    }

    auditLogger.log({
      userId: currentUser?.id,
      username: currentUser?.username,
      action: 'user.delete',
      resourceType: 'user',
      resourceId: id,
      details: JSON.stringify({ username: user.username }),
      ipAddress: getClientIp(c),
    });

    return c.json({ success: true });
  });

  // ── GET /:id/tokens ─ List tokens ─────────────────────────────────────
  app.get('/:id/tokens', async (c) => {
    const id = c.req.param('id');
    const currentUser = (c as any).get('user') as AuthUser | undefined;

    // Users can only list their own tokens, admins can list any
    if (currentUser && currentUser.role !== 'admin' && currentUser.id !== id) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    const tokens = await userManager.listTokens(id);
    return c.json({ tokens });
  });

  // ── POST /:id/tokens ─ Create token ───────────────────────────────────
  app.post('/:id/tokens', async (c) => {
    const id = c.req.param('id');
    const currentUser = (c as any).get('user') as AuthUser | undefined;

    // Users can only create tokens for themselves, admins for anyone
    if (currentUser && currentUser.role !== 'admin' && currentUser.id !== id) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    const body = await parseBody(c, CreateTokenSchema);

    try {
      const expiresAt = body.expiresAt ? new Date(body.expiresAt) : undefined;
      const { token, tokenInfo } = await userManager.createToken(id, body.name, expiresAt);

      auditLogger.log({
        userId: currentUser?.id,
        username: currentUser?.username,
        action: 'user.token.create',
        resourceType: 'user_token',
        resourceId: tokenInfo.id,
        details: JSON.stringify({ name: body.name, userId: id }),
        ipAddress: getClientIp(c),
      });

      return c.json({ token, tokenInfo }, 201);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Failed to create token' },
        400
      );
    }
  });

  // ── DELETE /:id/tokens/:tokenId ─ Revoke token ────────────────────────
  app.delete('/:id/tokens/:tokenId', async (c) => {
    const id = c.req.param('id');
    const tokenId = c.req.param('tokenId');
    const currentUser = (c as any).get('user') as AuthUser | undefined;

    // Users can only revoke their own tokens, admins can revoke any
    if (currentUser && currentUser.role !== 'admin' && currentUser.id !== id) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    const revoked = await userManager.revokeToken(tokenId);
    if (!revoked) {
      return c.json({ error: 'Token not found' }, 404);
    }

    auditLogger.log({
      userId: currentUser?.id,
      username: currentUser?.username,
      action: 'user.token.revoke',
      resourceType: 'user_token',
      resourceId: tokenId,
      ipAddress: getClientIp(c),
    });

    return c.json({ success: true });
  });

  // ── GET /:id/projects ─ List project access ───────────────────────────
  app.get('/:id/projects', async (c) => {
    const id = c.req.param('id');
    const currentUser = (c as any).get('user') as AuthUser | undefined;

    if (currentUser && currentUser.role !== 'admin' && currentUser.id !== id) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    const access = await userManager.listProjectAccess(id);
    return c.json({ projectAccess: access });
  });

  // ── PUT /:id/projects/:projectId ─ Set project access ─────────────────
  app.put('/:id/projects/:projectId', requireRole('admin'), async (c) => {
    const userId = c.req.param('id');
    const projectId = c.req.param('projectId');
    const body = await parseBody(c, SetProjectAccessSchema);

    try {
      const access = await userManager.setProjectAccess(userId, projectId, body.role);

      const currentUser = (c as any).get('user') as AuthUser | undefined;
      auditLogger.log({
        userId: currentUser?.id,
        username: currentUser?.username,
        action: 'user.project_access.set',
        resourceType: 'project_access',
        resourceId: `${userId}:${projectId}`,
        details: JSON.stringify({ userId, projectId, role: body.role }),
        ipAddress: getClientIp(c),
      });

      return c.json(access);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Failed to set project access' },
        400
      );
    }
  });

  // ── DELETE /:id/projects/:projectId ─ Remove project access ───────────
  app.delete('/:id/projects/:projectId', requireRole('admin'), async (c) => {
    const userId = c.req.param('id');
    const projectId = c.req.param('projectId');

    const removed = await userManager.removeProjectAccess(userId, projectId);
    if (!removed) {
      return c.json({ error: 'Project access not found' }, 404);
    }

    const currentUser = (c as any).get('user') as AuthUser | undefined;
    auditLogger.log({
      userId: currentUser?.id,
      username: currentUser?.username,
      action: 'user.project_access.remove',
      resourceType: 'project_access',
      resourceId: `${userId}:${projectId}`,
      ipAddress: getClientIp(c),
    });

    return c.json({ success: true });
  });

  // ── GET /audit ─ Get audit log (admin only) ───────────────────────────
  // Note: This is mounted at /users/audit in the router
  app.get('/audit', requireRole('admin'), async (c) => {
    const userId = c.req.query('userId');
    const action = c.req.query('action');
    const resourceType = c.req.query('resourceType');
    const resourceId = c.req.query('resourceId');
    const limit = parseInt(c.req.query('limit') || '100', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);

    const entries = auditLogger.getAuditLog({
      userId: userId || undefined,
      action: action || undefined,
      resourceType: resourceType || undefined,
      resourceId: resourceId || undefined,
      limit,
      offset,
    });

    return c.json({ entries });
  });

  return app;
}
