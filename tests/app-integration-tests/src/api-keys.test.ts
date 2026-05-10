import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ServerHarness, type ServerInfo } from './server-harness.js';

describe('API Keys and Authentication', () => {
  let harness: ServerHarness;
  let server: ServerInfo;

  beforeAll(async () => {
    harness = new ServerHarness();
    server = await harness.start();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  describe('GET /system/api-keys', () => {
    it('should list all providers with status', async () => {
      const response = await harness.fetch('/system/api-keys');
      
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data.providers).toBeDefined();
      expect(Array.isArray(data.providers)).toBe(true);
      
      // Should have common providers
      const providerIds = data.providers.map((p: { id: string }) => p.id);
      expect(providerIds).toContain('anthropic');
      expect(providerIds).toContain('openai');
    });
  });

  describe('PUT /system/api-keys/:providerId', () => {
    it('should set API key for a provider', async () => {
      const response = await harness.fetch('/system/api-keys/anthropic', {
        method: 'PUT',
        body: JSON.stringify({
          values: { ANTHROPIC_API_KEY: 'sk-ant-test-key-12345678901234567890' },
        }),
      });
      
      expect(response.ok).toBe(true);
      
      // Verify it was set
      const listResponse = await harness.fetch('/system/api-keys');
      const data = await listResponse.json();
      const anthropic = data.providers.find((p: { id: string }) => p.id === 'anthropic');
      
      expect(anthropic.isConfigured).toBe(true);
    });

    it('should reject unknown provider', async () => {
      const response = await harness.fetch('/system/api-keys/unknown-provider', {
        method: 'PUT',
        body: JSON.stringify({
          values: { SOME_KEY: 'value' },
        }),
      });
      
      expect(response.ok).toBe(false);
    });
  });

  describe('DELETE /system/api-keys/:providerId', () => {
    it('should delete API key for a provider', async () => {
      // First set a key
      await harness.fetch('/system/api-keys/anthropic', {
        method: 'PUT',
        body: JSON.stringify({
          values: { ANTHROPIC_API_KEY: 'sk-ant-to-delete-12345678901234' },
        }),
      });
      
      // Delete it
      const deleteResponse = await harness.fetch('/system/api-keys/anthropic', {
        method: 'DELETE',
      });
      
      expect(deleteResponse.ok).toBe(true);
      
      // Verify it's gone
      const listResponse = await harness.fetch('/system/api-keys');
      const data = await listResponse.json();
      const anthropic = data.providers.find((p: { id: string }) => p.id === 'anthropic');
      
      expect(anthropic.isConfigured).toBe(false);
    });
  });

  describe('Provider Routes', () => {
    describe('GET /providers', () => {
      it('should list available providers', async () => {
        const response = await harness.fetch('/providers');
        
        expect(response.ok).toBe(true);
        
        const data = await response.json();
        // API returns { providers: [...] }
        expect(data.providers).toBeDefined();
        expect(Array.isArray(data.providers)).toBe(true);
      });
    });

    describe('GET /providers/:id', () => {
      it('should get provider details', async () => {
        const response = await harness.fetch('/providers/anthropic');
        
        expect(response.ok).toBe(true);
        
        const provider = await response.json();
        expect(provider.providerId).toBe('anthropic');
      });
    });
  });

  describe('Authentication Edge Cases', () => {
    it('should reject requests with malformed bearer token', async () => {
      const response = await fetch(`${server.url}/api/beta/projects`, {
        headers: {
          'Authorization': 'Bearer',
        },
      });
      
      expect(response.status).toBe(401);
    });

    it('should reject requests with wrong scheme', async () => {
      const response = await fetch(`${server.url}/api/beta/projects`, {
        headers: {
          'Authorization': `Basic ${Buffer.from('user:pass').toString('base64')}`,
        },
      });
      
      expect(response.status).toBe(401);
    });
  });
});
