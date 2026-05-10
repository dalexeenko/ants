import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestDatabase, type TestDatabase } from '../test-utils/db.js';
import { createSetupRoutes } from './setup.js';
import { UserManager } from '../services/user-manager.js';
import { WebSessionService } from '../services/web-session.js';
import { ensureSystemUser } from '../services/system-user.js';
import type { ServerConfig } from '../config.js';

describe('setup routes', () => {
  let testDb: TestDatabase;
  let userManager: UserManager;
  let webSessionService: WebSessionService;

  const mockAuditLogger = {
    log: vi.fn(),
  };

  function createApp(setupToken?: string) {
    const config = {
      multiUser: true,
      setupToken,
    } as ServerConfig;

    const app = new Hono();
    app.route('/setup', createSetupRoutes({
      config,
      userManager,
      auditLogger: mockAuditLogger as any,
      webSessionService,
    }));
    return app;
  }

  beforeEach(async () => {
    testDb = createTestDatabase();
    await ensureSystemUser(testDb.db as any);
    userManager = new UserManager(testDb.db as any);
    webSessionService = new WebSessionService(testDb.db as any);
    mockAuditLogger.log.mockClear();
  });

  afterEach(() => {
    testDb.sqlite.close();
  });

  describe('GET /setup/status', () => {
    it('should indicate setup is needed when no admin exists', async () => {
      const app = createApp();
      const res = await app.request('/setup/status');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.needsSetup).toBe(true);
      expect(body.setupTokenRequired).toBe(false);
    });

    it('should indicate setup token is required when configured', async () => {
      const app = createApp('my-secret-token');
      const res = await app.request('/setup/status');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.needsSetup).toBe(true);
      expect(body.setupTokenRequired).toBe(true);
    });

    it('should indicate setup is not needed after admin is created', async () => {
      await userManager.createUser('admin', 'password123', 'admin');
      const app = createApp();
      const res = await app.request('/setup/status');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.needsSetup).toBe(false);
    });
  });

  describe('POST /setup (no setup token)', () => {
    it('should create admin user with valid credentials', async () => {
      const app = createApp();
      const res = await app.request('/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'myadmin', password: 'securepass123' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.user.username).toBe('myadmin');
      expect(body.user.role).toBe('admin');
    });

    it('should set a session cookie', async () => {
      const app = createApp();
      const res = await app.request('/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'password123' }),
      });

      expect(res.status).toBe(201);
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain('openmgr_session=');
    });

    it('should log an audit event', async () => {
      const app = createApp();
      await app.request('/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'password123' }),
      });

      expect(mockAuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'setup.completed',
          username: 'admin',
        }),
      );
    });

    it('should reject if setup already completed', async () => {
      await userManager.createUser('existing', 'password123', 'admin');

      const app = createApp();
      const res = await app.request('/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'password123' }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toContain('already been completed');
    });

    it('should reject missing username', async () => {
      const app = createApp();
      const res = await app.request('/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'password123' }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject missing password', async () => {
      const app = createApp();
      const res = await app.request('/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin' }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject short password', async () => {
      const app = createApp();
      const res = await app.request('/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'short' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('8 characters');
    });

    it('should reject short username', async () => {
      const app = createApp();
      const res = await app.request('/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'a', password: 'password123' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('2 characters');
    });

    it('should prevent second setup even without token requirement', async () => {
      const app = createApp();

      // First setup succeeds
      const res1 = await app.request('/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'password123' }),
      });
      expect(res1.status).toBe(201);

      // Second setup fails
      const res2 = await app.request('/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin2', password: 'password456' }),
      });
      expect(res2.status).toBe(409);
    });
  });

  describe('POST /setup (with setup token)', () => {
    const setupToken = 'my-secret-setup-token';

    it('should require the setup token when configured', async () => {
      const app = createApp(setupToken);
      const res = await app.request('/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'password123' }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain('Setup token is required');
    });

    it('should reject an invalid setup token', async () => {
      const app = createApp(setupToken);
      const res = await app.request('/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'admin',
          password: 'password123',
          setupToken: 'wrong-token',
        }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain('Invalid setup token');
    });

    it('should accept the correct setup token', async () => {
      const app = createApp(setupToken);
      const res = await app.request('/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'admin',
          password: 'password123',
          setupToken,
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.user.username).toBe('admin');
    });

    it('should log the setup method as token', async () => {
      const app = createApp(setupToken);
      await app.request('/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'admin',
          password: 'password123',
          setupToken,
        }),
      });

      expect(mockAuditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'setup.completed',
          details: expect.stringContaining('token'),
        }),
      );
    });
  });
});
