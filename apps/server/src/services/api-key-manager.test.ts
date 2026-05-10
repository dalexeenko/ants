import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ApiKeyManager } from './api-key-manager.js';
import { EncryptionService } from './encryption.js';
import { createTestDatabase, type TestDB } from '../test-utils/db.js';

// Mock AgentAuthService to return empty auth
vi.mock('./agent-auth.js', () => ({
  AgentAuthService: vi.fn().mockImplementation(() => ({
    getProvider: vi.fn().mockReturnValue(undefined),
    setProvider: vi.fn(),
    removeProvider: vi.fn(),
    read: vi.fn().mockReturnValue({}),
    write: vi.fn(),
  }))
}));

describe('ApiKeyManager', () => {
  let db: TestDB;
  let sqlite: Database.Database;
  let encryption: EncryptionService;
  let manager: ApiKeyManager;
  const validKey = Buffer.alloc(32, 'a').toString('base64');

  beforeEach(() => {
    ({ sqlite, db } = createTestDatabase());
    
    encryption = new EncryptionService(validKey);
    manager = new ApiKeyManager(db, encryption);
  });

  afterEach(() => {
    sqlite.close();
  });

  describe('getProviderDefinitions', () => {
    it('should return list of provider definitions', () => {
      const providers = manager.getProviderDefinitions();
      
      expect(providers.length).toBeGreaterThan(0);
      expect(providers.find(p => p.id === 'anthropic')).toBeDefined();
      expect(providers.find(p => p.id === 'openai')).toBeDefined();
      expect(providers.find(p => p.id === 'aws-bedrock')).toBeDefined();
    });

    it('should have valid provider structure', () => {
      const providers = manager.getProviderDefinitions();
      const anthropic = providers.find(p => p.id === 'anthropic')!;
      
      expect(anthropic.name).toBe('Anthropic');
      expect(anthropic.docsUrl).toContain('anthropic.com');
      expect(anthropic.fields.length).toBeGreaterThan(0);
      expect(anthropic.fields[0].envVar).toBe('ANTHROPIC_API_KEY');
    });
  });

  describe('setProviderKeys/getProviderKeys', () => {
    it('should set and retrieve provider keys', async () => {
      const values = { ANTHROPIC_API_KEY: 'sk-ant-test-key-12345' };
      
      await manager.setProviderKeys('anthropic', values);
      const result = await manager.getProviderKeys('anthropic');
      
      expect(result).not.toBeNull();
      expect(result!.keys['ANTHROPIC_API_KEY'].isSet).toBe(true);
      expect(result!.keys['ANTHROPIC_API_KEY'].masked).toContain('sk-ant');
    });

    it('should update existing provider keys', async () => {
      await manager.setProviderKeys('anthropic', { ANTHROPIC_API_KEY: 'old-key-123456789' });
      await manager.setProviderKeys('anthropic', { ANTHROPIC_API_KEY: 'new-key-987654321' });
      
      const result = await manager.getProviderKeys('anthropic');
      expect(result!.keys['ANTHROPIC_API_KEY'].masked).toContain('new-ke');
      expect(result!.keys['ANTHROPIC_API_KEY'].masked).toContain('4321');
    });

    it('should set pendingRestart flag when keys change', async () => {
      expect(manager.pendingRestart).toBe(false);
      
      await manager.setProviderKeys('anthropic', { ANTHROPIC_API_KEY: 'test-key-12345678' });
      
      expect(manager.pendingRestart).toBe(true);
    });

    it('should return null for unknown provider', async () => {
      const result = await manager.getProviderKeys('unknown-provider');
      expect(result).toBeNull();
    });

    it('should throw for unknown provider on set', async () => {
      await expect(
        manager.setProviderKeys('unknown-provider', { KEY: 'value' })
      ).rejects.toThrow('Unknown provider');
    });
  });

  describe('deleteProviderKeys', () => {
    it('should delete provider keys', async () => {
      await manager.setProviderKeys('anthropic', { ANTHROPIC_API_KEY: 'test-key-12345678' });
      manager.clearPendingRestart();
      
      const deleted = await manager.deleteProviderKeys('anthropic');
      
      expect(deleted).toBe(true);
      expect(manager.pendingRestart).toBe(true);
      
      const result = await manager.getProviderKeys('anthropic');
      expect(result!.keys['ANTHROPIC_API_KEY'].isSet).toBe(false);
    });

    it('should return false for non-existent provider', async () => {
      const deleted = await manager.deleteProviderKeys('anthropic');
      expect(deleted).toBe(false);
    });
  });

  describe('listApiKeys', () => {
    it('should list all providers with status', async () => {
      await manager.setProviderKeys('anthropic', { ANTHROPIC_API_KEY: 'test-key-12345678' });
      
      const result = await manager.listApiKeys();
      
      expect(result.providers.length).toBeGreaterThan(0);
      
      const anthropic = result.providers.find(p => p.id === 'anthropic')!;
      expect(anthropic.isConfigured).toBe(true);
      
      const openai = result.providers.find(p => p.id === 'openai')!;
      expect(openai.isConfigured).toBe(false);
    });
  });

  describe('custom environment variables', () => {
    it('should create a custom env var', async () => {
      const result = await manager.createCustomEnvVar('GitHub Token', 'GITHUB_TOKEN', 'ghp_test12345678');
      
      expect(result.id).toBeDefined();
      expect(result.name).toBe('GitHub Token');
      expect(result.envVar).toBe('GITHUB_TOKEN');
      expect(result.value.isSet).toBe(true);
      expect(result.value.masked).toContain('ghp_te');
    });

    it('should list custom env vars', async () => {
      await manager.createCustomEnvVar('Token 1', 'TOKEN_1', 'value123456789');
      await manager.createCustomEnvVar('Token 2', 'TOKEN_2', 'value987654321');
      
      const result = await manager.listCustomEnvVars();
      
      expect(result.length).toBe(2);
    });

    it('should update custom env var', async () => {
      const created = await manager.createCustomEnvVar('Old Name', 'MY_VAR', 'value12345678');
      manager.clearPendingRestart();
      
      const updated = await manager.updateCustomEnvVar(created.id, { name: 'New Name' });
      
      expect(updated!.name).toBe('New Name');
      expect(manager.pendingRestart).toBe(false);
      
      const updated2 = await manager.updateCustomEnvVar(created.id, { value: 'new-value-12345' });
      expect(manager.pendingRestart).toBe(true);
    });

    it('should delete custom env var', async () => {
      const created = await manager.createCustomEnvVar('To Delete', 'DELETE_ME', 'value12345678');
      
      const deleted = await manager.deleteCustomEnvVar(created.id);
      
      expect(deleted).toBe(true);
      
      const list = await manager.listCustomEnvVars();
      expect(list.length).toBe(0);
    });
  });

  describe('getAllEnvVars', () => {
    it('should return all decrypted env vars', async () => {
      await manager.setProviderKeys('anthropic', { ANTHROPIC_API_KEY: 'sk-ant-key' });
      await manager.setProviderKeys('openai', { OPENAI_API_KEY: 'sk-openai-key' });
      await manager.createCustomEnvVar('GitHub', 'GITHUB_TOKEN', 'ghp_token');
      
      const envVars = await manager.getAllEnvVars();
      
      expect(envVars['ANTHROPIC_API_KEY']).toBe('sk-ant-key');
      expect(envVars['OPENAI_API_KEY']).toBe('sk-openai-key');
      expect(envVars['GITHUB_TOKEN']).toBe('ghp_token');
    });

    it('should return empty object when no keys configured', async () => {
      const envVars = await manager.getAllEnvVars();
      expect(envVars).toEqual({});
    });
  });

  describe('pendingRestart', () => {
    it('should track and clear pending restart', async () => {
      expect(manager.pendingRestart).toBe(false);
      
      await manager.setProviderKeys('anthropic', { ANTHROPIC_API_KEY: 'key12345678' });
      expect(manager.pendingRestart).toBe(true);
      
      manager.clearPendingRestart();
      expect(manager.pendingRestart).toBe(false);
    });
  });
});
