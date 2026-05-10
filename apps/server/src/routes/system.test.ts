import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSystemRoutes } from './system.js';
import type { ServerConfig } from '../config.js';
import type { AntsAgentManager } from '../services/ants-agent-manager.js';
import type { ApiKeyManager } from '../services/api-key-manager.js';

describe('system routes', () => {
  let app: Hono;
  let mockConfig: ServerConfig;
  let mockAgentManager: Partial<AntsAgentManager>;
  let mockApiKeyManager: Partial<ApiKeyManager>;

  beforeEach(() => {
    mockConfig = {
      dataDir: '/tmp/ants-test-data',
      workspacesDir: '/tmp/ants-test-workspaces',
      port: 3000,
      host: 'localhost',
    } as ServerConfig;

    mockAgentManager = {
      isInstalled: vi.fn().mockResolvedValue(true),
      getVersion: vi.fn().mockResolvedValue('1.0.0'),
      getAgentPath: vi.fn().mockReturnValue('/usr/local/bin/ants-agent'),
      install: vi.fn().mockResolvedValue(undefined),
      restartAllServers: vi.fn().mockResolvedValue({ restarted: ['proj-1'], failed: [] }),
    };

    mockApiKeyManager = {
      pendingRestart: false,
      listApiKeys: vi.fn().mockResolvedValue([
        { providerId: 'openai', name: 'OpenAI', configured: true },
        { providerId: 'anthropic', name: 'Anthropic', configured: false },
      ]),
      getProviderKeys: vi.fn().mockResolvedValue({
        providerId: 'openai',
        name: 'OpenAI',
        fields: [{ key: 'OPENAI_API_KEY', label: 'API Key', hasValue: true }],
      }),
      setProviderKeys: vi.fn().mockResolvedValue({
        providerId: 'openai',
        success: true,
      }),
      deleteProviderKeys: vi.fn().mockResolvedValue(true),
      setOAuthCredentials: vi.fn().mockResolvedValue({ success: true }),
      deleteOAuthCredentials: vi.fn().mockResolvedValue(true),
      refreshOAuthToken: vi.fn().mockResolvedValue({ success: true, expiresAt: Date.now() + 3600000 }),
      listCustomEnvVars: vi.fn().mockResolvedValue([
        { id: 'custom-1', name: 'My Custom Key', envVar: 'CUSTOM_KEY' },
      ]),
      createCustomEnvVar: vi.fn().mockResolvedValue({
        id: 'custom-2',
        name: 'New Key',
        envVar: 'NEW_KEY',
      }),
      updateCustomEnvVar: vi.fn().mockResolvedValue({
        id: 'custom-1',
        name: 'Updated Key',
        envVar: 'CUSTOM_KEY',
      }),
      deleteCustomEnvVar: vi.fn().mockResolvedValue(true),
      clearPendingRestart: vi.fn(),
    };

    app = new Hono();
    const systemRoutes = createSystemRoutes(
      mockConfig,
      mockAgentManager as AntsAgentManager,
      mockApiKeyManager as ApiKeyManager
    );
    app.route('/system', systemRoutes);
  });

  describe('GET /system/agent', () => {
    it('should return agent status when installed', async () => {
      const res = await app.request('/system/agent');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.installed).toBe(true);
      expect(body.version).toBe('1.0.0');
      expect(body.path).toBe('/usr/local/bin/ants-agent');
    });

    it('should return agent status when not installed', async () => {
      (mockAgentManager.isInstalled as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const res = await app.request('/system/agent');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.installed).toBe(false);
      expect(body.version).toBeNull();
      expect(body.path).toBeNull();
    });
  });

  describe('POST /system/agent/install', () => {
    it('should return success when already installed', async () => {
      const res = await app.request('/system/agent/install', { method: 'POST' });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.message).toBe('Ants Agent is already installed');
      expect(body.version).toBe('1.0.0');
    });

    it('should install agent when not installed', async () => {
      (mockAgentManager.isInstalled as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const res = await app.request('/system/agent/install', { method: 'POST' });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.message).toBe('Ants Agent installed successfully');
      expect(mockAgentManager.install).toHaveBeenCalled();
    });

    it('should return 500 on installation failure', async () => {
      (mockAgentManager.isInstalled as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      (mockAgentManager.install as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Installation failed')
      );

      const res = await app.request('/system/agent/install', { method: 'POST' });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Installation failed');
    });
  });

  describe('GET /system/disk', () => {
    it('should return disk usage information', async () => {
      const res = await app.request('/system/disk');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.dataDir).toBeDefined();
      expect(body.dataDir.path).toBe('/tmp/ants-test-data');
      expect(body.workspacesDir).toBeDefined();
      expect(body.workspacesDir.path).toBe('/tmp/ants-test-workspaces');
      expect(body.total).toBeDefined();
      expect(typeof body.total.sizeBytes).toBe('number');
      expect(typeof body.total.sizeHuman).toBe('string');
    });
  });

  describe('GET /system/uptime', () => {
    it('should return uptime information', async () => {
      const res = await app.request('/system/uptime');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(typeof body.uptimeSeconds).toBe('number');
      expect(typeof body.uptimeHuman).toBe('string');
      expect(body.memoryUsage).toBeDefined();
      expect(body.nodeVersion).toBeDefined();
      expect(body.platform).toBeDefined();
      expect(body.arch).toBeDefined();
    });
  });

  describe('GET /system/api-keys', () => {
    it('should list all API keys', async () => {
      const res = await app.request('/system/api-keys');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(2);
      expect(body[0].providerId).toBe('openai');
      expect(body[0].configured).toBe(true);
      expect(body[1].providerId).toBe('anthropic');
      expect(body[1].configured).toBe(false);
    });
  });

  describe('GET /system/api-keys/:providerId', () => {
    it('should get provider keys', async () => {
      const res = await app.request('/system/api-keys/openai');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.providerId).toBe('openai');
      expect(body.fields).toHaveLength(1);
      expect(body.fields[0].hasValue).toBe(true);
    });

    it('should return 404 for unknown provider', async () => {
      (mockApiKeyManager.getProviderKeys as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/system/api-keys/unknown');

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Provider not found');
    });
  });

  describe('PUT /system/api-keys/:providerId', () => {
    it('should set provider keys', async () => {
      const res = await app.request('/system/api-keys/openai', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: { OPENAI_API_KEY: 'sk-test-key' } }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(mockApiKeyManager.setProviderKeys).toHaveBeenCalledWith('openai', {
        OPENAI_API_KEY: 'sk-test-key',
      });
    });

    it('should return 400 when values is missing', async () => {
      const res = await app.request('/system/api-keys/openai', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('values is required');
    });

    it('should return 400 on validation error', async () => {
      (mockApiKeyManager.setProviderKeys as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Invalid API key format')
      );

      const res = await app.request('/system/api-keys/openai', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: { OPENAI_API_KEY: 'invalid' } }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Invalid API key format');
    });
  });

  describe('DELETE /system/api-keys/:providerId', () => {
    it('should delete provider keys', async () => {
      const res = await app.request('/system/api-keys/openai', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.pendingRestart).toBe(false);
    });

    it('should return 404 when no keys exist', async () => {
      (mockApiKeyManager.deleteProviderKeys as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const res = await app.request('/system/api-keys/unknown', { method: 'DELETE' });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Provider not found or no keys configured');
    });
  });

  describe('PUT /system/api-keys/:providerId/oauth', () => {
    it('should set OAuth credentials', async () => {
      const res = await app.request('/system/api-keys/github/oauth', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refresh: 'refresh-token',
          access: 'access-token',
          expires: Date.now() + 3600000,
          accountId: 'user-123',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(mockApiKeyManager.setOAuthCredentials).toHaveBeenCalled();
    });

    it('should return 400 when required fields are missing', async () => {
      const res = await app.request('/system/api-keys/github/oauth', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: 'refresh-token' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('access is required');
    });

    it('should return 400 on OAuth error', async () => {
      (mockApiKeyManager.setOAuthCredentials as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('OAuth provider not supported')
      );

      const res = await app.request('/system/api-keys/unknown/oauth', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refresh: 'refresh-token',
          access: 'access-token',
          expires: Date.now() + 3600000,
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('OAuth provider not supported');
    });
  });

  describe('DELETE /system/api-keys/:providerId/oauth', () => {
    it('should delete OAuth credentials', async () => {
      const res = await app.request('/system/api-keys/github/oauth', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it('should return 404 when no OAuth credentials exist', async () => {
      (mockApiKeyManager.deleteOAuthCredentials as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const res = await app.request('/system/api-keys/unknown/oauth', { method: 'DELETE' });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('No OAuth credentials found for provider');
    });
  });

  describe('POST /system/api-keys/:providerId/oauth/refresh', () => {
    it('should refresh OAuth token', async () => {
      const res = await app.request('/system/api-keys/github/oauth/refresh', { method: 'POST' });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.expiresAt).toBeDefined();
    });

    it('should return 400 when refresh fails', async () => {
      (mockApiKeyManager.refreshOAuthToken as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
      });

      const res = await app.request('/system/api-keys/github/oauth/refresh', { method: 'POST' });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Failed to refresh OAuth token');
    });

    it('should return 500 on refresh error', async () => {
      (mockApiKeyManager.refreshOAuthToken as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Token expired')
      );

      const res = await app.request('/system/api-keys/github/oauth/refresh', { method: 'POST' });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Token expired');
    });
  });

  describe('GET /system/api-keys/custom', () => {
    it('should list custom env vars', async () => {
      const res = await app.request('/system/api-keys/custom');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.custom).toHaveLength(1);
      expect(body.custom[0].id).toBe('custom-1');
      expect(body.custom[0].name).toBe('My Custom Key');
    });
  });

  describe('POST /system/api-keys/custom', () => {
    it('should create custom env var', async () => {
      const res = await app.request('/system/api-keys/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Key',
          envVar: 'NEW_KEY',
          value: 'secret-value',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBe('custom-2');
      expect(body.name).toBe('New Key');
      expect(mockApiKeyManager.createCustomEnvVar).toHaveBeenCalledWith(
        'New Key',
        'NEW_KEY',
        'secret-value'
      );
    });

    it('should return 400 when required fields are missing', async () => {
      const res = await app.request('/system/api-keys/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('envVar is required');
    });

    it('should return 400 on creation error', async () => {
      (mockApiKeyManager.createCustomEnvVar as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Duplicate env var name')
      );

      const res = await app.request('/system/api-keys/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Duplicate',
          envVar: 'CUSTOM_KEY',
          value: 'value',
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Duplicate env var name');
    });
  });

  describe('PUT /system/api-keys/custom/:id', () => {
    it('should update custom env var', async () => {
      const res = await app.request('/system/api-keys/custom/custom-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Key' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('Updated Key');
    });

    it('should return 404 when not found', async () => {
      (mockApiKeyManager.updateCustomEnvVar as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const res = await app.request('/system/api-keys/custom/non-existent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Custom env var not found');
    });
  });

  describe('DELETE /system/api-keys/custom/:id', () => {
    it('should delete custom env var', async () => {
      const res = await app.request('/system/api-keys/custom/custom-1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it('should return 404 when not found', async () => {
      (mockApiKeyManager.deleteCustomEnvVar as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const res = await app.request('/system/api-keys/custom/non-existent', { method: 'DELETE' });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Custom env var not found');
    });
  });

  describe('POST /system/restart-all-projects', () => {
    it('should restart all projects successfully', async () => {
      const res = await app.request('/system/restart-all-projects', { method: 'POST' });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.restarted).toEqual(['proj-1']);
      expect(body.failed).toEqual([]);
      expect(body.pendingRestart).toBe(false);
      expect(mockApiKeyManager.clearPendingRestart).toHaveBeenCalled();
    });

    it('should report failures', async () => {
      (mockAgentManager.restartAllServers as ReturnType<typeof vi.fn>).mockResolvedValue({
        restarted: ['proj-1'],
        failed: [{ id: 'proj-2', error: 'Connection refused' }],
      });

      const res = await app.request('/system/restart-all-projects', { method: 'POST' });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.failed).toHaveLength(1);
    });
  });

  describe('POST /system/cleanup/sessions', () => {
    it('should cleanup old sessions with default days', async () => {
      const res = await app.request('/system/cleanup/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deletedSessions).toBeDefined();
      expect(body.freedBytes).toBeDefined();
      expect(body.freedHuman).toBeDefined();
      expect(body.olderThanDays).toBe(30);
    });

    it('should cleanup sessions older than specified days', async () => {
      const res = await app.request('/system/cleanup/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ olderThanDays: 7 }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.olderThanDays).toBe(7);
    });
  });
});
