import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { BearerAuthProvider, UserTokenAuthProvider } from './bearer.js';
import { createAuthMiddleware } from './middleware.js';

const TEST_SECRET = 'test-secret-token';

// ── Helpers ─────────────────────────────────────────────────────────────────

function createSecretApp(secret = TEST_SECRET) {
  const provider = new BearerAuthProvider(secret);
  const app = new Hono();
  app.use('*', createAuthMiddleware([provider]));
  app.get('/protected', (c) => {
    const identity = (c as any).get('authIdentity');
    const user = (c as any).get('user');
    return c.json({ ok: true, identity, user: user ?? null });
  });
  return app;
}

function createUserTokenApp(userManager: any) {
  const provider = new UserTokenAuthProvider(userManager);
  const app = new Hono();
  app.use('*', createAuthMiddleware([provider]));
  app.get('/protected', (c) => {
    const identity = (c as any).get('authIdentity');
    const user = (c as any).get('user');
    return c.json({ ok: true, identity, user: user ?? null });
  });
  return app;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('BearerAuthProvider (shared secret)', () => {
  it('should have the correct name', () => {
    const provider = new BearerAuthProvider(TEST_SECRET);
    expect(provider.name).toBe('Bearer Token');
  });

  it('should reject requests without Authorization header (returns null)', async () => {
    const app = createSecretApp();
    const res = await app.request('/protected');

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Missing or invalid authentication');
  });

  it('should reject requests with non-Bearer scheme', async () => {
    const app = createSecretApp();
    const res = await app.request('/protected', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Invalid credentials');
  });

  it('should reject requests with invalid token', async () => {
    const app = createSecretApp();
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer wrong-token' },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Invalid credentials');
  });

  it('should allow requests with valid shared secret', async () => {
    const app = createSecretApp();
    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${TEST_SECRET}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.identity).toEqual({ provider: 'bearer' });
    expect(body.user).toBeNull();
  });

  it('should reject requests with Bearer + extra whitespace', async () => {
    const app = createSecretApp();
    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer  ${TEST_SECRET}` },
    });

    expect(res.status).toBe(401);
  });

  it('should reject requests with empty Bearer token', async () => {
    const app = createSecretApp();
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer ' },
    });

    expect(res.status).toBe(401);
  });

  it('should NOT validate user tokens (no userManager)', async () => {
    const app = createSecretApp();
    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer user-token-123' },
    });

    // Should reject — BearerAuthProvider only knows about the shared secret
    expect(res.status).toBe(401);
  });

  describe('chain fallthrough', () => {
    it('should return null for missing Authorization header (allows other providers)', async () => {
      const provider = new BearerAuthProvider(TEST_SECRET);
      const app = new Hono();
      let result: any;
      app.get('/test', async (c) => {
        result = await provider.authenticate(c);
        return c.json({ result });
      });

      await app.request('/test');
      expect(result).toBeNull();
    });
  });
});

describe('UserTokenAuthProvider (per-user tokens)', () => {
  const mockUser = {
    id: 'user-1',
    username: 'alice',
    email: 'alice@example.com',
    role: 'operator',
    displayName: 'Alice',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('should have the correct name', () => {
    const provider = new UserTokenAuthProvider({ validateToken: vi.fn() } as any);
    expect(provider.name).toBe('User Token');
  });

  it('should authenticate via valid user token', async () => {
    const mockUserManager = {
      validateToken: vi.fn().mockResolvedValue(mockUser),
    };
    const app = createUserTokenApp(mockUserManager);

    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer user-token-123' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.identity).toEqual({ provider: 'bearer', email: 'alice@example.com' });
    expect(body.user).toMatchObject({ id: 'user-1', username: 'alice' });
    expect(mockUserManager.validateToken).toHaveBeenCalledWith('user-token-123');
  });

  it('should reject when user token is invalid', async () => {
    const mockUserManager = {
      validateToken: vi.fn().mockResolvedValue(null),
    };
    const app = createUserTokenApp(mockUserManager);

    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer bad-token' },
    });

    expect(res.status).toBe(401);
  });

  it('should NOT accept a shared server secret', async () => {
    // UserTokenAuthProvider doesn't know about any shared secret
    const mockUserManager = {
      validateToken: vi.fn().mockResolvedValue(null),
    };
    const app = createUserTokenApp(mockUserManager);

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${TEST_SECRET}` },
    });

    // The shared secret is not a valid user token
    expect(res.status).toBe(401);
    expect(mockUserManager.validateToken).toHaveBeenCalledWith(TEST_SECRET);
  });

  it('should handle user with null email', async () => {
    const userNoEmail = { ...mockUser, email: null };
    const mockUserManager = {
      validateToken: vi.fn().mockResolvedValue(userNoEmail),
    };
    const app = createUserTokenApp(mockUserManager);

    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer user-token' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.identity.email).toBeUndefined();
  });

  it('should return null for missing Authorization header (allows other providers)', async () => {
    const mockUserManager = { validateToken: vi.fn() };
    const provider = new UserTokenAuthProvider(mockUserManager as any);
    const app = new Hono();
    let result: any;
    app.get('/test', async (c) => {
      result = await provider.authenticate(c);
      return c.json({ result });
    });

    await app.request('/test');
    expect(result).toBeNull();
    expect(mockUserManager.validateToken).not.toHaveBeenCalled();
  });
});
