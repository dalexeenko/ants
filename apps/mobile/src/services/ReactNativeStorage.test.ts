/**
 * Tests for ReactNativeStorage
 */

import * as SecureStore from 'expo-secure-store';
import { createReactNativeStorage } from './ReactNativeStorage';
import { createManualOAuthHandler } from '@ants/agent-auth-react-native';

// Get mock functions
const mockSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;
const mockCreateOAuthHandler = createManualOAuthHandler as jest.MockedFunction<typeof createManualOAuthHandler>;

describe('ReactNativeStorage', () => {
  let storage: ReturnType<typeof createReactNativeStorage>;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the mock to default behavior
    mockCreateOAuthHandler.mockReturnValue({
      generateAuthUrl: jest.fn().mockResolvedValue({
        url: 'https://mock-oauth-url.com',
        verifier: 'mock-verifier',
      }),
      completeLogin: jest.fn().mockResolvedValue(undefined),
      logout: jest.fn().mockResolvedValue(undefined),
      isLoggedIn: jest.fn().mockResolvedValue(false),
      getValidAccessToken: jest.fn().mockResolvedValue(null),
      tokenStore: {
        loadTokens: jest.fn().mockResolvedValue(null),
        saveTokens: jest.fn().mockResolvedValue(undefined),
        clearTokens: jest.fn().mockResolvedValue(undefined),
      },
      pkce: {
        generateCodeVerifier: jest.fn(),
        generateCodeChallenge: jest.fn(),
      },
    });
    storage = createReactNativeStorage();
  });

  describe('API Keys', () => {
    it('should return null when no API key is stored', async () => {
      mockSecureStore.getItemAsync.mockResolvedValue(null);
      const key = await storage.getApiKey('openai');
      expect(key).toBeNull();
      expect(mockSecureStore.getItemAsync).toHaveBeenCalledWith('ants_api_key_openai');
    });

    it('should return stored API key', async () => {
      mockSecureStore.getItemAsync.mockResolvedValue('sk-test-key');
      const key = await storage.getApiKey('openai');
      expect(key).toBe('sk-test-key');
    });

    it('should set API key', async () => {
      await storage.setApiKey('openai', 'sk-new-key');
      expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
        'ants_api_key_openai',
        'sk-new-key'
      );
    });

    it('should delete API key', async () => {
      await storage.deleteApiKey('openai');
      expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('ants_api_key_openai');
    });

    it('should check if API key exists', async () => {
      mockSecureStore.getItemAsync.mockResolvedValue('sk-test-key');
      const hasKey = await storage.hasApiKey('openai');
      expect(hasKey).toBe(true);
    });

    it('should return false for missing API key', async () => {
      mockSecureStore.getItemAsync.mockResolvedValue(null);
      const hasKey = await storage.hasApiKey('openai');
      expect(hasKey).toBe(false);
    });

    it('should list all stored API keys', async () => {
      mockSecureStore.getItemAsync.mockImplementation((key: string) => {
        if (key === 'ants_api_key_anthropic') return Promise.resolve('sk-ant');
        if (key === 'ants_api_key_openai') return Promise.resolve('sk-oai');
        return Promise.resolve(null);
      });

      const keys = await storage.listApiKeys();
      expect(keys).toContainEqual({ provider: 'anthropic', hasKey: true });
      expect(keys).toContainEqual({ provider: 'openai', hasKey: true });
    });
  });

  describe('Auth Status', () => {
    it('should return unauthenticated status when no keys or OAuth', async () => {
      mockSecureStore.getItemAsync.mockResolvedValue(null);
      
      const status = await storage.getAuthStatus();
      
      expect(status.anthropic.authenticated).toBe(false);
      expect(status.anthropic.method).toBeNull();
      expect(status.openai.hasApiKey).toBe(false);
    });

    it('should return authenticated with API key', async () => {
      mockSecureStore.getItemAsync.mockImplementation((key: string) => {
        if (key === 'ants_api_key_anthropic') return Promise.resolve('sk-ant');
        return Promise.resolve(null);
      });

      const status = await storage.getAuthStatus();
      
      expect(status.anthropic.authenticated).toBe(true);
      expect(status.anthropic.method).toBe('apikey');
    });

    it('should return authenticated with OAuth when logged in', async () => {
      // Configure the mock to return logged in before creating storage
      mockCreateOAuthHandler.mockReturnValue({
        generateAuthUrl: jest.fn().mockResolvedValue({
          url: 'https://mock-oauth-url.com',
          verifier: 'mock-verifier',
        }),
        completeLogin: jest.fn().mockResolvedValue(undefined),
        logout: jest.fn().mockResolvedValue(undefined),
        isLoggedIn: jest.fn().mockResolvedValue(true), // Logged in!
        getValidAccessToken: jest.fn().mockResolvedValue('oauth-access-token'),
        tokenStore: {
          loadTokens: jest.fn().mockResolvedValue(null),
          saveTokens: jest.fn().mockResolvedValue(undefined),
          clearTokens: jest.fn().mockResolvedValue(undefined),
        },
        pkce: {
          generateCodeVerifier: jest.fn(),
          generateCodeChallenge: jest.fn(),
        },
      });

      // Create a fresh storage instance to pick up the mock
      storage = createReactNativeStorage();
      const status = await storage.getAuthStatus();
      
      expect(status.anthropic.authenticated).toBe(true);
      expect(status.anthropic.method).toBe('oauth');
    });
  });

  describe('OAuth', () => {
    it('should initiate OAuth flow', async () => {
      const result = await storage.initiateOAuth('anthropic');
      
      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('verifier');
    });

    it('should complete OAuth flow', async () => {
      await expect(
        storage.completeOAuth('anthropic', 'auth-code', 'verifier')
      ).resolves.toBeUndefined();
    });

    it('should disconnect OAuth', async () => {
      await expect(storage.disconnectOAuth('anthropic')).resolves.toBeUndefined();
    });
  });

  describe('Settings', () => {
    it('should get projects directory', async () => {
      mockSecureStore.getItemAsync.mockResolvedValue('/path/to/projects');
      
      const dir = await storage.getProjectsDirectory();
      
      expect(dir).toBe('/path/to/projects');
      expect(mockSecureStore.getItemAsync).toHaveBeenCalledWith('ants_projects_directory');
    });

    it('should return null when no projects directory is set', async () => {
      mockSecureStore.getItemAsync.mockResolvedValue(null);
      
      const dir = await storage.getProjectsDirectory();
      
      expect(dir).toBeNull();
    });

    it('should set projects directory', async () => {
      await storage.setProjectsDirectory('/new/path');
      
      expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
        'ants_projects_directory',
        '/new/path'
      );
    });
  });

  describe('OAuth Tokens', () => {
    it('should get OAuth tokens', async () => {
      const tokens = await storage.getOAuthTokens();
      // Default mock returns null
      expect(tokens).toBeNull();
    });

    it('should save OAuth tokens', async () => {
      const tokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 3600000,
      };
      
      await expect(storage.saveOAuthTokens(tokens)).resolves.toBeUndefined();
    });
  });

  describe('Anthropic API Key with OAuth fallback', () => {
    it('should return OAuth token for Anthropic when available', async () => {
      // Configure the mock to return OAuth token before creating storage
      mockCreateOAuthHandler.mockReturnValue({
        generateAuthUrl: jest.fn().mockResolvedValue({
          url: 'https://mock-oauth-url.com',
          verifier: 'mock-verifier',
        }),
        completeLogin: jest.fn().mockResolvedValue(undefined),
        logout: jest.fn().mockResolvedValue(undefined),
        isLoggedIn: jest.fn().mockResolvedValue(true),
        getValidAccessToken: jest.fn().mockResolvedValue('oauth-access-token'),
        tokenStore: {
          loadTokens: jest.fn().mockResolvedValue(null),
          saveTokens: jest.fn().mockResolvedValue(undefined),
          clearTokens: jest.fn().mockResolvedValue(undefined),
        },
        pkce: {
          generateCodeVerifier: jest.fn(),
          generateCodeChallenge: jest.fn(),
        },
      });

      storage = createReactNativeStorage();
      const key = await storage.getApiKey('anthropic');
      
      expect(key).toBe('oauth-access-token');
    });

    it('should fall back to API key for Anthropic when no OAuth', async () => {
      mockSecureStore.getItemAsync.mockResolvedValue('sk-anthropic-key');
      
      const key = await storage.getApiKey('anthropic');
      
      expect(key).toBe('sk-anthropic-key');
    });
  });
});
