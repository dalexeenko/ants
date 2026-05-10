import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../test-utils/db.js';
import { AgentAuthService, type OAuthCredentials } from './agent-auth.js';
import { EncryptionService } from './encryption.js';
import { randomBytes } from 'crypto';

// Mock the auth-core module for Anthropic token refresh
vi.mock('@openmgr/agent-auth-core', () => ({
  refreshAccessToken: vi.fn(),
}));

import { refreshAccessToken } from '@openmgr/agent-auth-core';

// Generate a random 32-byte key for tests
const TEST_ENCRYPTION_KEY = randomBytes(32).toString('base64');

describe('AgentAuthService', () => {
  let service: AgentAuthService;
  let testDb: TestDatabase;
  let encryption: EncryptionService;

  beforeEach(() => {
    testDb = createTestDatabase();
    encryption = new EncryptionService(TEST_ENCRYPTION_KEY);
    service = new AgentAuthService(testDb.db as any, encryption);
    
    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    testDb.sqlite.close();
  });

  describe('setProvider/getProvider/removeProvider', () => {
    it('should set and get provider credentials', async () => {
      const credentials: OAuthCredentials = {
        type: 'oauth',
        refresh: 'refresh-token',
        access: 'access-token',
        expires: Date.now() + 3600000,
      };

      await service.setProvider('anthropic', credentials);
      const result = await service.getProvider('anthropic');

      expect(result).toBeDefined();
      expect(result?.type).toBe('oauth');
      if (result?.type === 'oauth') {
        expect(result.refresh).toBe('refresh-token');
        expect(result.access).toBe('access-token');
      }
    });

    it('should return undefined for non-existent provider', async () => {
      const result = await service.getProvider('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should remove provider credentials', async () => {
      const credentials: OAuthCredentials = {
        type: 'oauth',
        refresh: 'refresh-token',
        access: 'access-token',
        expires: Date.now() + 3600000,
      };

      await service.setProvider('anthropic', credentials);
      await service.removeProvider('anthropic');
      
      const result = await service.getProvider('anthropic');
      expect(result).toBeUndefined();
    });

    it('should update existing provider credentials', async () => {
      const initial: OAuthCredentials = {
        type: 'oauth',
        refresh: 'old-refresh',
        access: 'old-access',
        expires: Date.now() + 3600000,
      };

      await service.setProvider('anthropic', initial);

      const updated: OAuthCredentials = {
        type: 'oauth',
        refresh: 'new-refresh',
        access: 'new-access',
        expires: Date.now() + 7200000,
      };

      await service.setProvider('anthropic', updated);
      const result = await service.getProvider('anthropic');

      expect(result?.type).toBe('oauth');
      if (result?.type === 'oauth') {
        expect(result.refresh).toBe('new-refresh');
        expect(result.access).toBe('new-access');
      }
    });

    it('should store credentials encrypted in the database', async () => {
      const credentials: OAuthCredentials = {
        type: 'oauth',
        refresh: 'secret-refresh-token',
        access: 'secret-access-token',
        expires: Date.now() + 3600000,
      };

      await service.setProvider('anthropic', credentials);

      // Read raw row from DB — the encryptedOauth column should not contain plaintext
      const { apiKeys } = await import('../db/schema.js');
      const { eq } = await import('drizzle-orm');
      const rows = (testDb.db as any).select().from(apiKeys).where(eq(apiKeys.providerId, 'anthropic')).all();
      expect(rows).toHaveLength(1);
      expect(rows[0].encryptedOauth).toBeDefined();
      expect(rows[0].encryptedOauth).not.toContain('secret-refresh-token');
      expect(rows[0].encryptedOauth).not.toContain('secret-access-token');
    });
  });

  describe('refreshOAuthToken', () => {
    it('should return null when no credentials exist', async () => {
      const result = await service.refreshOAuthToken('anthropic');
      expect(result).toBeNull();
    });

    it('should return null when credentials are not OAuth type', async () => {
      await service.setProvider('anthropic', {
        type: 'api',
        key: 'api-key',
      });

      const result = await service.refreshOAuthToken('anthropic');
      expect(result).toBeNull();
    });

    it('should use auth-core for Anthropic token refresh', async () => {
      const initialCredentials: OAuthCredentials = {
        type: 'oauth',
        refresh: 'old-refresh-token',
        access: 'old-access-token',
        expires: Date.now() - 1000, // expired
        accountId: 'account-123',
      };
      await service.setProvider('anthropic', initialCredentials);

      const mockRefreshedTokens = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresAt: Date.now() + 3600000,
      };
      (refreshAccessToken as ReturnType<typeof vi.fn>).mockResolvedValue(mockRefreshedTokens);

      const result = await service.refreshOAuthToken('anthropic');

      expect(refreshAccessToken).toHaveBeenCalledWith('old-refresh-token');
      expect(result).not.toBeNull();
      expect(result?.type).toBe('oauth');
      expect(result?.access).toBe('new-access-token');
      expect(result?.refresh).toBe('new-refresh-token');
      expect(result?.accountId).toBe('account-123'); // should preserve accountId

      // Verify it was persisted
      const stored = await service.getProvider('anthropic');
      expect(stored?.type).toBe('oauth');
      if (stored?.type === 'oauth') {
        expect(stored.access).toBe('new-access-token');
      }
    });

    it('should return null when Anthropic token refresh fails', async () => {
      const initialCredentials: OAuthCredentials = {
        type: 'oauth',
        refresh: 'old-refresh-token',
        access: 'old-access-token',
        expires: Date.now() - 1000,
      };
      await service.setProvider('anthropic', initialCredentials);

      (refreshAccessToken as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Token refresh failed')
      );

      const result = await service.refreshOAuthToken('anthropic');

      expect(result).toBeNull();
    });

    it('should return null for unsupported providers without endpoints', async () => {
      const initialCredentials: OAuthCredentials = {
        type: 'oauth',
        refresh: 'refresh-token',
        access: 'access-token',
        expires: Date.now() - 1000,
      };
      await service.setProvider('unsupported-provider', initialCredentials);

      const result = await service.refreshOAuthToken('unsupported-provider');

      expect(result).toBeNull();
    });
  });

  describe('getValidAccessToken', () => {
    it('should return null when no credentials exist', async () => {
      const result = await service.getValidAccessToken('anthropic');
      expect(result).toBeNull();
    });

    it('should return API key for api credentials', async () => {
      await service.setProvider('anthropic', {
        type: 'api',
        key: 'my-api-key',
      });

      const result = await service.getValidAccessToken('anthropic');
      expect(result).toBe('my-api-key');
    });

    it('should return access token when not expired', async () => {
      const credentials: OAuthCredentials = {
        type: 'oauth',
        refresh: 'refresh-token',
        access: 'valid-access-token',
        expires: Date.now() + 120000, // expires in 2 minutes (more than 1 minute buffer)
      };
      await service.setProvider('anthropic', credentials);

      const result = await service.getValidAccessToken('anthropic');
      expect(result).toBe('valid-access-token');
    });

    it('should refresh token when about to expire', async () => {
      const credentials: OAuthCredentials = {
        type: 'oauth',
        refresh: 'refresh-token',
        access: 'expiring-access-token',
        expires: Date.now() + 30000, // expires in 30 seconds (less than 1 minute buffer)
      };
      await service.setProvider('anthropic', credentials);

      const mockRefreshedTokens = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresAt: Date.now() + 3600000,
      };
      (refreshAccessToken as ReturnType<typeof vi.fn>).mockResolvedValue(mockRefreshedTokens);

      const result = await service.getValidAccessToken('anthropic');
      expect(result).toBe('new-access-token');
    });
  });
});
