import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { createHealthRoutes, createAuthenticatedHealthRoutes } from './health.js';
import { createAuthMiddleware, BearerAuthProvider } from '../auth/index.js';
import type { ServerConfig } from '../config.js';

describe('health routes', () => {
  const mockConfig: ServerConfig = {
    secret: 'test-secret',
    encryptionKey: 'dGVzdC1lbmNyeXB0aW9uLWtleS0xMjM0NTY3ODkw',
    port: 6647,
    host: '127.0.0.1',
    dataDir: '/tmp/test',
    workspacesDir: '/tmp/test/workspaces',
    autoInstallAgent: false,
    mockAgent: false,
    corsOrigins: ['http://localhost:3000'],
    multiUser: false,
    cfAccessSetIdentity: true,
    webApp: false,
    allowedHosts: [],
  };

  const mockAgentManager = {
    getRunningServers: vi.fn().mockReturnValue([]),
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

  function createApp() {
    const app = new Hono();
    const healthRoutes = createHealthRoutes(mockConfig, mockAgentManager as any);
    app.route('/', healthRoutes);
    return app;
  }

  function createAppWithAuth() {
    const app = new Hono();
    const healthRoutes = createHealthRoutes(mockConfig, mockAgentManager as any);
    app.route('/', healthRoutes);
    const authMiddleware = createAuthMiddleware([new BearerAuthProvider(mockConfig.secret!)]);
    app.use('/health/auth', authMiddleware);
    app.route('/health/auth', createAuthenticatedHealthRoutes(mockConfig, mockAgentManager as any));
    return app;
  }

  describe('GET /health', () => {
    it('should return status ok', async () => {
      const app = createApp();
      const res = await app.request('/health');
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
    });

    it('should not include version when ANTS_SERVER_VERSION is not set', async () => {
      const app = createApp();
      const res = await app.request('/health');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.version).toBeUndefined();
    });
  });

  describe('GET /info', () => {
    it('should return server info', async () => {
      const app = createApp();
      const res = await app.request('/info');
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.dataDir).toBe('/tmp/test');
      expect(body.workspacesDir).toBe('/tmp/test/workspaces');
      expect(body.agentInstalled).toBe(true);
    });

    it('should not include version when ANTS_SERVER_VERSION is not set', async () => {
      const app = createApp();
      const res = await app.request('/info');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.version).toBeUndefined();
    });
  });

  describe('GET /health/auth', () => {
    it('should return status ok with valid token', async () => {
      const app = createAppWithAuth();
      const res = await app.request('/health/auth', {
        headers: { 'Authorization': `Bearer ${mockConfig.secret}` },
      });
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.agentInstalled).toBe(true);
      expect(body.agentVersion).toBe('1.0.0');
    });

    it('should reject requests without a token', async () => {
      const app = createAppWithAuth();
      const res = await app.request('/health/auth');
      
      expect(res.status).toBe(401);
    });

    it('should reject requests with an invalid token', async () => {
      const app = createAppWithAuth();
      const res = await app.request('/health/auth', {
        headers: { 'Authorization': 'Bearer wrong-token' },
      });
      
      expect(res.status).toBe(401);
    });
  });
});
