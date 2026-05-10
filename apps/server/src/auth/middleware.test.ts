import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createAuthMiddleware, requireRole } from './middleware.js';
import type { AuthProvider, AuthResult } from './provider.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Stub provider that returns a fixed result */
function stubProvider(name: string, result: AuthResult | null): AuthProvider {
  return {
    name,
    authenticate: vi.fn().mockResolvedValue(result),
  };
}

function createApp(providers: AuthProvider[]) {
  const app = new Hono();
  app.use('*', createAuthMiddleware(providers));
  app.get('/test', (c) => {
    const identity = (c as any).get('authIdentity');
    const user = (c as any).get('user');
    return c.json({ ok: true, identity, user: user ?? null });
  });
  return app;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('createAuthMiddleware', () => {
  it('should reject with 401 when no providers are configured', async () => {
    const app = createApp([]);
    const res = await app.request('/test');

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Missing or invalid authentication');
  });

  it('should reject with 401 when all providers return null', async () => {
    const p1 = stubProvider('a', null);
    const p2 = stubProvider('b', null);
    const app = createApp([p1, p2]);

    const res = await app.request('/test');

    expect(res.status).toBe(401);
    expect(p1.authenticate).toHaveBeenCalledTimes(1);
    expect(p2.authenticate).toHaveBeenCalledTimes(1);
  });

  it('should reject immediately when a provider returns authenticated: false', async () => {
    const p1 = stubProvider('a', { authenticated: false });
    const p2 = stubProvider('b', { authenticated: true, identity: { provider: 'b' } });
    const app = createApp([p1, p2]);

    const res = await app.request('/test');

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Invalid credentials');
    // Second provider should never be called
    expect(p2.authenticate).not.toHaveBeenCalled();
  });

  it('should pass through when a provider returns authenticated: true', async () => {
    const p1 = stubProvider('a', {
      authenticated: true,
      identity: { provider: 'test-provider', email: 'user@example.com' },
    });
    const app = createApp([p1]);

    const res = await app.request('/test');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.identity).toEqual({ provider: 'test-provider', email: 'user@example.com' });
  });

  it('should set user on context when provider returns a user', async () => {
    const mockUser = { id: 'u1', username: 'alice', role: 'admin', email: 'alice@example.com' };
    const p1 = stubProvider('a', {
      authenticated: true,
      identity: { provider: 'bearer', email: 'alice@example.com' },
      user: mockUser as any,
    });
    const app = createApp([p1]);

    const res = await app.request('/test');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({ id: 'u1', username: 'alice' });
  });

  it('should skip null providers and use the first non-null result', async () => {
    const p1 = stubProvider('skip', null);
    const p2 = stubProvider('match', {
      authenticated: true,
      identity: { provider: 'second' },
    });
    const p3 = stubProvider('never-reached', {
      authenticated: true,
      identity: { provider: 'third' },
    });
    const app = createApp([p1, p2, p3]);

    const res = await app.request('/test');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.identity.provider).toBe('second');
    // Third provider should not be called
    expect(p3.authenticate).not.toHaveBeenCalled();
  });

  it('should skip null providers and reject on authenticated: false', async () => {
    const p1 = stubProvider('skip', null);
    const p2 = stubProvider('reject', { authenticated: false });
    const app = createApp([p1, p2]);

    const res = await app.request('/test');

    expect(res.status).toBe(401);
  });
});

describe('requireRole', () => {
  function createRoleApp(providers: AuthProvider[], ...roles: string[]) {
    const app = new Hono();
    app.use('*', createAuthMiddleware(providers));
    app.use('*', requireRole(...(roles as any)));
    app.get('/test', (c) => c.json({ ok: true }));
    return app;
  }

  it('should allow access when no user is set (system-level access)', async () => {
    const p1 = stubProvider('system', {
      authenticated: true,
      identity: { provider: 'bearer' },
      // No user — system-level access
    });
    const app = createRoleApp([p1], 'admin');

    const res = await app.request('/test');

    expect(res.status).toBe(200);
  });

  it('should allow access when user has an allowed role', async () => {
    const mockUser = { id: 'u1', username: 'alice', role: 'admin' };
    const p1 = stubProvider('user', {
      authenticated: true,
      identity: { provider: 'bearer' },
      user: mockUser as any,
    });
    const app = createRoleApp([p1], 'admin', 'operator');

    const res = await app.request('/test');

    expect(res.status).toBe(200);
  });

  it('should reject with 403 when user lacks the required role', async () => {
    const mockUser = { id: 'u1', username: 'viewer-user', role: 'viewer' };
    const p1 = stubProvider('user', {
      authenticated: true,
      identity: { provider: 'bearer' },
      user: mockUser as any,
    });
    const app = createRoleApp([p1], 'admin');

    const res = await app.request('/test');

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Insufficient permissions');
  });
});
