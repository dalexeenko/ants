import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestDatabase, type TestDatabase } from '../test-utils/db.js';
import { createAuthRoutes } from './auth.js';
import { UserManager } from '../services/user-manager.js';
import { WebSessionService } from '../services/web-session.js';
import { AuthCodeService } from '../services/auth-code.js';
import { ensureSystemUser } from '../services/system-user.js';
import type { ServerConfig } from '../config.js';

describe('auth routes', () => {
  let testDb: TestDatabase;
  let userManager: UserManager;
  let webSessionService: WebSessionService;
  let authCodeService: AuthCodeService;

  const mockAuditLogger = {
    log: vi.fn(),
  };

  function createApp(opts: { multiUser?: boolean } = {}) {
    const config = {
      multiUser: opts.multiUser ?? true,
      secret: 'test-secret',
    } as ServerConfig;

    const app = new Hono();
    app.route(
      '/auth',
      createAuthRoutes({
        config,
        webSessionService,
        authCodeService,
        userManager: opts.multiUser !== false ? userManager : undefined,
        auditLogger: opts.multiUser !== false ? (mockAuditLogger as any) : undefined,
      }),
    );
    return app;
  }

  beforeEach(async () => {
    testDb = createTestDatabase();
    await ensureSystemUser(testDb.db as any);
    userManager = new UserManager(testDb.db as any);
    webSessionService = new WebSessionService(testDb.db as any);
    authCodeService = new AuthCodeService(testDb.db as any);
    mockAuditLogger.log.mockClear();
  });

  afterEach(() => {
    testDb.sqlite.close();
  });

  describe('GET /auth/status', () => {
    it('should return needsSetup true in multi-user mode when no admin exists', async () => {
      const app = createApp({ multiUser: true });
      const res = await app.request('/auth/status');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.multiUser).toBe(true);
      expect(body.needsSetup).toBe(true);
    });

    it('should return needsSetup false in multi-user mode after admin is created', async () => {
      await userManager.createUser('admin', 'password123', 'admin');

      const app = createApp({ multiUser: true });
      const res = await app.request('/auth/status');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.multiUser).toBe(true);
      expect(body.needsSetup).toBe(false);
    });

    it('should return needsSetup false in single-user mode', async () => {
      const app = createApp({ multiUser: false });
      const res = await app.request('/auth/status');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.multiUser).toBe(false);
      expect(body.needsSetup).toBe(false);
    });

    it('should return needsSetup false after setup is completed via completeSetup', async () => {
      const app = createApp({ multiUser: true });

      // Before setup
      const res1 = await app.request('/auth/status');
      const body1 = await res1.json();
      expect(body1.needsSetup).toBe(true);

      // Complete setup
      await userManager.completeSetup('admin', 'password123');

      // After setup
      const res2 = await app.request('/auth/status');
      const body2 = await res2.json();
      expect(body2.needsSetup).toBe(false);
    });

    it('should include password but not bearer in authMethods for multi-user mode', async () => {
      const app = createApp({ multiUser: true });
      const res = await app.request('/auth/status');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.authMethods).toContain('password');
      expect(body.authMethods).not.toContain('bearer');
      expect(body.oauthProviders).toEqual([]);
    });

    it('should include bearer in authMethods for single-user mode', async () => {
      const app = createApp({ multiUser: false });
      const res = await app.request('/auth/status');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.authMethods).toContain('bearer');
      expect(body.authMethods).not.toContain('password');
    });

    it('should return currentUser as null when no session cookie', async () => {
      const app = createApp({ multiUser: true });
      const res = await app.request('/auth/status');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.currentUser).toBeNull();
    });
  });

  describe('POST /auth/login', () => {
    it('should reject login when no users exist (setup not completed)', async () => {
      const app = createApp({ multiUser: true });
      const res = await app.request('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'password123' }),
      });

      expect(res.status).toBe(401);
    });

    it('should allow login after setup is completed', async () => {
      await userManager.completeSetup('admin', 'password123');

      const app = createApp({ multiUser: true });
      const res = await app.request('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'password123' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.user.username).toBe('admin');
      expect(body.user.role).toBe('admin');
    });

    it('should set a session cookie on login', async () => {
      await userManager.completeSetup('admin', 'password123');

      const app = createApp({ multiUser: true });
      const res = await app.request('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'password123' }),
      });

      expect(res.status).toBe(200);
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain('openmgr_session=');
    });

    it('should reject login with wrong password', async () => {
      await userManager.completeSetup('admin', 'password123');

      const app = createApp({ multiUser: true });
      const res = await app.request('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'wrongpassword' }),
      });

      expect(res.status).toBe(401);
    });

    it('should reject login without credentials', async () => {
      const app = createApp({ multiUser: true });
      const res = await app.request('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it('should reject login in single-user mode', async () => {
      const app = createApp({ multiUser: false });
      const res = await app.request('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'password123' }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /auth/connect-token', () => {
    /** Helper: login and return the session cookie string */
    async function loginAndGetCookie(app: Hono): Promise<string> {
      const res = await app.request('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'password123' }),
      });
      const setCookieHeader = res.headers.get('set-cookie')!;
      // Extract just the cookie value (e.g. "openmgr_session=abc123; Path=/; ...")
      return setCookieHeader.split(';')[0];
    }

    it('should return 401 without a session cookie in multi-user mode', async () => {
      await userManager.completeSetup('admin', 'password123');
      const app = createApp({ multiUser: true });

      const res = await app.request('/auth/connect-token', {
        method: 'POST',
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Authentication required');
    });

    it('should return a code and server info when authenticated in multi-user mode', async () => {
      await userManager.completeSetup('admin', 'password123');
      const app = createApp({ multiUser: true });
      const cookie = await loginAndGetCookie(app);

      const res = await app.request('/auth/connect-token', {
        method: 'POST',
        headers: { Cookie: cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.code).toBeDefined();
      expect(typeof body.code).toBe('string');
      expect(body.code.length).toBeGreaterThan(0);
      expect(body.serverUrl).toBeDefined();
      expect(body.serverName).toBeDefined();
    });

    it('should return a code in single-user mode without a session', async () => {
      const app = createApp({ multiUser: false });

      const res = await app.request('/auth/connect-token', {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.code).toBeDefined();
      expect(typeof body.code).toBe('string');
    });

    it('should generate a code that can be exchanged via POST /auth/token', async () => {
      await userManager.completeSetup('admin', 'password123');
      const app = createApp({ multiUser: true });
      const cookie = await loginAndGetCookie(app);

      // Get the connect token
      const connectRes = await app.request('/auth/connect-token', {
        method: 'POST',
        headers: { Cookie: cookie },
      });
      const { code } = await connectRes.json() as { code: string };

      // Exchange it
      const tokenRes = await app.request('/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, redirect_uri: 'openmgr://connect' }),
      });

      expect(tokenRes.status).toBe(200);
      const tokenBody = await tokenRes.json();
      expect(tokenBody.token).toBeDefined();
      expect(tokenBody.user).toBeDefined();
      expect(tokenBody.user.username).toBe('admin');
    });

    it('should not allow the same code to be used twice', async () => {
      await userManager.completeSetup('admin', 'password123');
      const app = createApp({ multiUser: true });
      const cookie = await loginAndGetCookie(app);

      const connectRes = await app.request('/auth/connect-token', {
        method: 'POST',
        headers: { Cookie: cookie },
      });
      const { code } = await connectRes.json() as { code: string };

      // First exchange — should succeed
      const tokenRes1 = await app.request('/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, redirect_uri: 'openmgr://connect' }),
      });
      expect(tokenRes1.status).toBe(200);

      // Second exchange — should fail
      const tokenRes2 = await app.request('/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, redirect_uri: 'openmgr://connect' }),
      });
      expect(tokenRes2.status).toBe(400);
    });

    it('should reject exchange with wrong redirect_uri', async () => {
      await userManager.completeSetup('admin', 'password123');
      const app = createApp({ multiUser: true });
      const cookie = await loginAndGetCookie(app);

      const connectRes = await app.request('/auth/connect-token', {
        method: 'POST',
        headers: { Cookie: cookie },
      });
      const { code } = await connectRes.json() as { code: string };

      const tokenRes = await app.request('/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, redirect_uri: 'openmgr://auth/callback' }),
      });
      expect(tokenRes.status).toBe(400);
    });
  });
});
