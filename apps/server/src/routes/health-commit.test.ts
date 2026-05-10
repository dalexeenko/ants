import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import type { ServerConfig } from '../config.js';

/**
 * Tests for the server version in health endpoints.
 *
 * The version is resolved at module load time from OPENMGR_SERVER_VERSION,
 * so we set the env var BEFORE re-importing the module.
 */
describe('health routes with OPENMGR_SERVER_VERSION set', () => {
  const TEST_VERSION = 'v1.2.3';
  const originalEnv = process.env.OPENMGR_SERVER_VERSION;

  const mockConfig = {
    secret: 'test-secret',
    dataDir: '/tmp/test',
    workspacesDir: '/tmp/test/workspaces',
  } as ServerConfig;

  const mockAgentManager = {
    isInstalled: vi.fn().mockResolvedValue(true),
    getVersion: vi.fn().mockResolvedValue('1.0.0'),
    getDockerManager: vi.fn().mockReturnValue({
      checkAvailability: vi.fn().mockResolvedValue({
        available: false,
        version: null,
        insideDocker: false,
        dindAvailable: false,
      }),
    }),
  };

  let createHealthRoutes: typeof import('./health.js').createHealthRoutes;
  let createAuthenticatedHealthRoutes: typeof import('./health.js').createAuthenticatedHealthRoutes;

  beforeAll(async () => {
    process.env.OPENMGR_SERVER_VERSION = TEST_VERSION;
    vi.resetModules();
    const mod = await vi.importActual<typeof import('./health.js')>('./health.js');
    createHealthRoutes = mod.createHealthRoutes;
    createAuthenticatedHealthRoutes = mod.createAuthenticatedHealthRoutes;
  });

  afterAll(() => {
    if (originalEnv === undefined) {
      delete process.env.OPENMGR_SERVER_VERSION;
    } else {
      process.env.OPENMGR_SERVER_VERSION = originalEnv;
    }
    vi.resetModules();
  });

  it('should include version in GET /health response', async () => {
    const app = new Hono();
    app.route('/', createHealthRoutes(mockConfig, mockAgentManager as any));

    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(TEST_VERSION);
  });

  it('should include version in GET /info response', async () => {
    const app = new Hono();
    app.route('/', createHealthRoutes(mockConfig, mockAgentManager as any));

    const res = await app.request('/info');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(TEST_VERSION);
  });

  it('should include version in authenticated health response', async () => {
    const { createAuthMiddleware, BearerAuthProvider } = await import('../auth/index.js');
    const app = new Hono();
    const authMiddleware = createAuthMiddleware([new BearerAuthProvider(mockConfig.secret!)]);
    app.use('/health/auth', authMiddleware);
    app.route('/health/auth', createAuthenticatedHealthRoutes(mockConfig, mockAgentManager as any));

    const res = await app.request('/health/auth', {
      headers: { Authorization: `Bearer ${mockConfig.secret}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(TEST_VERSION);
  });
});
