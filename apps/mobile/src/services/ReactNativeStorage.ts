/**
 * React Native Storage Implementation
 * 
 * Uses expo-secure-store for API keys and OAuth tokens.
 * OAuth uses CLI-style flow where user pastes the code back into the app.
 * 
 * NOTE: This implementation is for native mobile only (iOS/Android).
 * It will not work on React Native Web.
 */

import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import type { PlatformStorage } from '@ants/ui';
import type { AuthStatus, ApiKeyInfo, OAuthInitResult } from '@ants/ui';
import { createLogger } from '@ants/ui';
import { createManualOAuthHandler, type OAuthTokens } from '@ants/agent-auth-react-native';

const log = createLogger('ReactNativeStorage');

// Storage keys
const STORAGE_KEYS = {
  API_KEY_PREFIX: 'ants_api_key_',
  PROJECTS_DIRECTORY: 'ants_projects_directory',
} as const;

/**
 * React Native storage implementation using expo-secure-store.
 * 
 * OAuth uses the CLI-style flow:
 * 1. initiateOAuth() generates URL with code callback redirect
 * 2. User opens URL in browser, authorizes, gets code displayed
 * 3. User pastes code back into app
 * 4. completeOAuth() exchanges code for tokens
 */
export class ReactNativeStorage implements PlatformStorage {
  // Type assertion needed due to slight differences in expo-crypto types
  // Don't pass custom fetch - the token exchange doesn't need streaming
  // and expo/fetch conflicts with React Native's runtime
  private oauthHandler = createManualOAuthHandler(
    SecureStore, 
    Crypto as unknown as Parameters<typeof createManualOAuthHandler>[1]
  );

  // ============ Auth Status ============

  async getAuthStatus(): Promise<AuthStatus> {
    const hasAnthropicKey = await this.hasApiKey('anthropic');
    const hasOpenAIKey = await this.hasApiKey('openai');
    const hasGoogleKey = await this.hasApiKey('google');
    const hasOpenRouterKey = await this.hasApiKey('openrouter');
    const hasGroqKey = await this.hasApiKey('groq');
    const hasXAIKey = await this.hasApiKey('xai');
    
    // Check for OAuth tokens
    const hasOAuth = await this.oauthHandler.isLoggedIn();

    return {
      anthropic: {
        authenticated: hasOAuth || hasAnthropicKey,
        method: hasOAuth ? 'oauth' : (hasAnthropicKey ? 'apikey' : null),
      },
      openai: { hasApiKey: hasOpenAIKey },
      google: { hasApiKey: hasGoogleKey },
      openrouter: { hasApiKey: hasOpenRouterKey },
      groq: { hasApiKey: hasGroqKey },
      xai: { hasApiKey: hasXAIKey },
    };
  }

  // ============ OAuth ============
  // Uses CLI-style flow: user gets code displayed and pastes it back

  async initiateOAuth(_provider: 'anthropic'): Promise<OAuthInitResult> {
    log.info('initiateOAuth starting...');
    try {
      const { url, verifier } = await this.oauthHandler.generateAuthUrl();
      log.info('initiateOAuth got URL and verifier');
      return { url, verifier };
    } catch (error) {
      log.error('initiateOAuth error:', error);
      throw error;
    }
  }

  async completeOAuth(_provider: 'anthropic', code: string, verifier: string): Promise<void> {
    log.info('completeOAuth starting with code length:', code.length);
    try {
      log.debug('completeOAuth calling completeLogin...');
      await this.oauthHandler.completeLogin(code, verifier);
      log.info('completeOAuth success!');
    } catch (error) {
      log.error('completeOAuth error:', error);
      log.debug('completeOAuth error type:', typeof error);
      log.debug('completeOAuth error constructor:', error?.constructor?.name);
      throw error;
    }
  }

  async disconnectOAuth(_provider: 'anthropic'): Promise<void> {
    await this.oauthHandler.logout();
  }

  // ============ API Keys ============

  async listApiKeys(): Promise<ApiKeyInfo[]> {
    const providers = ['anthropic', 'openai', 'google', 'openrouter', 'groq', 'xai'];
    const keys: ApiKeyInfo[] = [];

    for (const provider of providers) {
      if (await this.hasApiKey(provider)) {
        keys.push({
          provider,
          hasKey: true,
        });
      }
    }

    return keys;
  }

  async getApiKey(provider: string): Promise<string | null> {
    // For Anthropic, check OAuth first
    if (provider === 'anthropic') {
      const oauthToken = await this.oauthHandler.getValidAccessToken();
      if (oauthToken) {
        return oauthToken;
      }
    }

    const key = `${STORAGE_KEYS.API_KEY_PREFIX}${provider}`;
    try {
      return await SecureStore.getItemAsync(key);
    } catch (error) {
      log.error(`Failed to get API key for ${provider}:`, error);
      return null;
    }
  }

  async setApiKey(provider: string, apiKey: string): Promise<void> {
    const key = `${STORAGE_KEYS.API_KEY_PREFIX}${provider}`;
    try {
      await SecureStore.setItemAsync(key, apiKey);
    } catch (error) {
      log.error(`Failed to set API key for ${provider}:`, error);
      throw new Error(`Failed to securely store API key: ${error}`);
    }
  }

  async deleteApiKey(provider: string): Promise<void> {
    const key = `${STORAGE_KEYS.API_KEY_PREFIX}${provider}`;
    try {
      await SecureStore.deleteItemAsync(key);
    } catch (error) {
      log.error(`Failed to delete API key for ${provider}:`, error);
      // Don't throw - deletion should be idempotent
    }
  }

  async hasApiKey(provider: string): Promise<boolean> {
    const key = `${STORAGE_KEYS.API_KEY_PREFIX}${provider}`;
    try {
      const apiKey = await SecureStore.getItemAsync(key);
      return apiKey !== null && apiKey.length > 0;
    } catch {
      return false;
    }
  }

  // ============ OAuth Tokens (for anthropicAuthPlugin) ============
  
  /**
   * Get the full OAuth tokens for the Anthropic auth plugin.
   * Returns null if not logged in via OAuth.
   */
  async getOAuthTokens(): Promise<OAuthTokens | null> {
    return this.oauthHandler.tokenStore.loadTokens();
  }

  /**
   * Callback to save refreshed OAuth tokens.
   * Used by anthropicAuthPlugin when tokens are refreshed.
   */
  async saveOAuthTokens(tokens: OAuthTokens): Promise<void> {
    await this.oauthHandler.tokenStore.saveTokens(tokens);
  }

  // ============ Settings ============

  async getProjectsDirectory(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(STORAGE_KEYS.PROJECTS_DIRECTORY);
    } catch {
      return null;
    }
  }

  async setProjectsDirectory(path: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(STORAGE_KEYS.PROJECTS_DIRECTORY, path);
    } catch (error) {
      log.error('Failed to set projects directory:', error);
    }
  }
}

/**
 * Create a React Native storage instance.
 */
export function createReactNativeStorage(): ReactNativeStorage {
  return new ReactNativeStorage();
}
