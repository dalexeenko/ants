import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createProviderRoutes } from './providers.js';
import type { ApiKeyManager, ProviderDefinition, ProviderStatus, ApiKeysResponse, MaskedValue } from '../services/api-key-manager.js';

function makeMaskedValue(isSet: boolean): MaskedValue {
  return { isSet, masked: isSet ? 'sk-****' : null };
}

function makeProviderStatus(
  id: string,
  name: string,
  envVar: string,
  isConfigured: boolean,
): ProviderStatus {
  return {
    id,
    name,
    fields: [{ envVar, label: 'API Key', required: true }],
    docsUrl: `https://example.com/${id}`,
    isConfigured,
    values: { [envVar]: makeMaskedValue(isConfigured) },
  };
}

const MOCK_DEFINITIONS: ProviderDefinition[] = [
  { id: 'openai', name: 'OpenAI', docsUrl: 'https://example.com/openai', fields: [{ envVar: 'OPENAI_API_KEY', label: 'API Key', required: true }] },
  { id: 'anthropic', name: 'Anthropic', docsUrl: 'https://example.com/anthropic', supportsOAuth: true, fields: [{ envVar: 'ANTHROPIC_API_KEY', label: 'API Key', required: true }] },
];

describe('providers routes', () => {
  let app: Hono;
  let mockApiKeyManager: Partial<ApiKeyManager>;

  beforeEach(() => {
    mockApiKeyManager = {
      getProviderDefinitions: vi.fn().mockReturnValue(MOCK_DEFINITIONS),
      listApiKeys: vi.fn().mockResolvedValue({
        providers: [
          makeProviderStatus('openai', 'OpenAI', 'OPENAI_API_KEY', true),
          makeProviderStatus('anthropic', 'Anthropic', 'ANTHROPIC_API_KEY', false),
        ],
        custom: [],
        pendingRestart: false,
      } satisfies ApiKeysResponse),
      getProviderKeys: vi.fn().mockResolvedValue({
        keys: { OPENAI_API_KEY: makeMaskedValue(true) },
      }),
      setProviderKeys: vi.fn().mockResolvedValue({
        success: true,
        values: { OPENAI_API_KEY: makeMaskedValue(true) },
      }),
      deleteProviderKeys: vi.fn().mockResolvedValue(true),
    };

    app = new Hono();
    const providerRoutes = createProviderRoutes(mockApiKeyManager as ApiKeyManager);
    app.route('/providers', providerRoutes);
  });

  describe('GET /providers', () => {
    it('should list all providers', async () => {
      const res = await app.request('/providers');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.providers).toHaveLength(2);
      expect(body.providers[0].providerId).toBe('openai');
      expect(body.providers[0].hasApiKey).toBe(true);
      expect(body.providers[0].envVar).toBe('OPENAI_API_KEY');
      expect(body.providers[1].providerId).toBe('anthropic');
      expect(body.providers[1].hasApiKey).toBe(false);
    });

    it('should return providers even when none are configured', async () => {
      (mockApiKeyManager.listApiKeys as ReturnType<typeof vi.fn>).mockResolvedValue({
        providers: [
          makeProviderStatus('openai', 'OpenAI', 'OPENAI_API_KEY', false),
          makeProviderStatus('anthropic', 'Anthropic', 'ANTHROPIC_API_KEY', false),
        ],
        custom: [],
        pendingRestart: false,
      });

      const res = await app.request('/providers');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.providers).toHaveLength(2);
      expect(body.providers.every((p: { hasApiKey: boolean }) => !p.hasApiKey)).toBe(true);
    });
  });

  describe('GET /providers/:providerId', () => {
    it('should get provider details with API key configured', async () => {
      const res = await app.request('/providers/openai');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.providerId).toBe('openai');
      expect(body.name).toBe('OpenAI');
      expect(body.envVar).toBe('OPENAI_API_KEY');
      expect(body.hasApiKey).toBe(true);
    });

    it('should get provider details without API key', async () => {
      (mockApiKeyManager.listApiKeys as ReturnType<typeof vi.fn>).mockResolvedValue({
        providers: [
          makeProviderStatus('openai', 'OpenAI', 'OPENAI_API_KEY', false),
          makeProviderStatus('anthropic', 'Anthropic', 'ANTHROPIC_API_KEY', false),
        ],
        custom: [],
        pendingRestart: false,
      });

      const res = await app.request('/providers/anthropic');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.providerId).toBe('anthropic');
      expect(body.hasApiKey).toBe(false);
    });

    it('should return 404 for unknown provider', async () => {
      (mockApiKeyManager.getProviderDefinitions as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const res = await app.request('/providers/unknown');

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Unknown provider');
    });
  });

  describe('PUT /providers/:providerId', () => {
    it('should set API key for provider', async () => {
      const res = await app.request('/providers/openai', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: 'sk-new-test-key' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.providerId).toBe('openai');
      expect(body.name).toBe('OpenAI');
      expect(body.hasApiKey).toBe(true);
      expect(mockApiKeyManager.setProviderKeys).toHaveBeenCalledWith(
        'openai',
        { OPENAI_API_KEY: 'sk-new-test-key' },
      );
    });

    it('should return 400 when apiKey is missing', async () => {
      const res = await app.request('/providers/openai', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('apiKey is required');
    });

    it('should return 400 when apiKey is empty', async () => {
      const res = await app.request('/providers/openai', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: '' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('apiKey is required');
    });

    it('should return 404 for unknown provider', async () => {
      (mockApiKeyManager.getProviderDefinitions as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const res = await app.request('/providers/unknown', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: 'sk-test' }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Unknown provider');
    });
  });

  describe('DELETE /providers/:providerId', () => {
    it('should delete API key for provider', async () => {
      const res = await app.request('/providers/openai', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(mockApiKeyManager.deleteProviderKeys).toHaveBeenCalledWith('openai');
    });

    it('should return 404 when no API key exists', async () => {
      (mockApiKeyManager.deleteProviderKeys as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const res = await app.request('/providers/anthropic', { method: 'DELETE' });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('No API key found for provider');
    });
  });
});
