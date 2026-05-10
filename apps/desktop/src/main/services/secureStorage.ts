import keytar from 'keytar';
import type { AuthStatus, ApiKeyInfo, OAuthInitResult } from '@ants/ui';
import {
  generateAuthorizationUrl,
  exchangeCodeForTokens,
} from '@ants/agent-auth-anthropic';

// Service name for keytar - all secrets stored under this namespace
const SERVICE_NAME = 'com.ants.desktop';

// Key names for different credentials
const KEYTAR_KEYS = {
  API_KEY_PREFIX: 'api-key-',
  ANTHROPIC_ACCESS_TOKEN: 'anthropic-access-token',
  ANTHROPIC_REFRESH_TOKEN: 'anthropic-refresh-token',
  ANTHROPIC_EXPIRES_AT: 'anthropic-expires-at',
  PROJECTS_DIRECTORY: 'projects-directory',
} as const;

/**
 * In-memory cache for keytar credentials.
 *
 * On macOS, every individual keytar call can trigger a Keychain Access
 * permission dialog — especially for unsigned Electron dev builds.
 * This cache reduces keychain hits to:
 *   - 1 bulk read on startup (findCredentials)
 *   - 1 write per mutation (setPassword/deletePassword)
 * All subsequent reads are served from memory.
 */
export class SecureStorage {
  /** In-memory mirror of all credentials for SERVICE_NAME */
  private cache: Map<string, string> = new Map();
  /** Resolves when the initial bulk load finishes */
  private ready: Promise<void>;

  constructor() {
    this.ready = this.loadAll();
  }

  /**
   * Bulk-load all credentials for our service into the in-memory cache.
   * This issues a single native keychain call (findCredentials) instead
   * of one per key.
   */
  private async loadAll(): Promise<void> {
    try {
      const entries = await keytar.findCredentials(SERVICE_NAME);
      for (const { account, password } of entries) {
        this.cache.set(account, password);
      }
    } catch (e) {
      // If the keychain is unavailable (CI, headless Linux, etc.),
      // degrade gracefully — the cache stays empty, reads return null.
      console.warn('[SecureStorage] Failed to load credentials from keychain:', e);
    }
  }

  // ========== Low-level cache-aware keytar wrappers ==========

  private async get(account: string): Promise<string | null> {
    await this.ready;
    return this.cache.get(account) ?? null;
  }

  private async set(account: string, value: string): Promise<void> {
    await this.ready;
    this.cache.set(account, value);
    await keytar.setPassword(SERVICE_NAME, account, value);
  }

  private async del(account: string): Promise<void> {
    await this.ready;
    this.cache.delete(account);
    await keytar.deletePassword(SERVICE_NAME, account).catch(() => {});
  }

  // ============ API Keys ============

  async setApiKey(provider: string, key: string): Promise<void> {
    await this.set(`${KEYTAR_KEYS.API_KEY_PREFIX}${provider}`, key);
  }

  async getApiKey(provider: string): Promise<string | null> {
    return this.get(`${KEYTAR_KEYS.API_KEY_PREFIX}${provider}`);
  }

  async deleteApiKey(provider: string): Promise<void> {
    await this.del(`${KEYTAR_KEYS.API_KEY_PREFIX}${provider}`);
  }

  async listApiKeys(): Promise<ApiKeyInfo[]> {
    const providers = ['anthropic', 'openai', 'google', 'openrouter', 'groq', 'xai'];

    // All reads come from the in-memory cache — no keychain calls
    const results = await Promise.all(
      providers.map(async (provider) => ({
        provider,
        hasKey: !!(await this.getApiKey(provider)),
      }))
    );

    return results;
  }

  async hasApiKey(provider: string): Promise<boolean> {
    const key = await this.getApiKey(provider);
    return !!key;
  }

  // ============ OAuth ============

  async initiateOAuth(provider: 'anthropic'): Promise<OAuthInitResult> {
    if (provider === 'anthropic') {
      // Generate OAuth URL with PKCE (async due to WebCrypto)
      const { url, verifier } = await generateAuthorizationUrl();
      return { url, verifier };
    }
    throw new Error(`Unsupported OAuth provider: ${provider}`);
  }

  async completeOAuth(provider: 'anthropic', code: string, verifier: string): Promise<void> {
    if (provider === 'anthropic') {
      // Exchange code for tokens (no token store needed - we handle storage ourselves)
      const tokens = await exchangeCodeForTokens(code, verifier);

      // Store tokens securely in keytar
      await this.setAnthropicTokens({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      });
      return;
    }
    throw new Error(`Unsupported OAuth provider: ${provider}`);
  }

  async disconnectOAuth(provider: 'anthropic'): Promise<void> {
    if (provider === 'anthropic') {
      await this.del(KEYTAR_KEYS.ANTHROPIC_ACCESS_TOKEN);
      await this.del(KEYTAR_KEYS.ANTHROPIC_REFRESH_TOKEN);
      await this.del(KEYTAR_KEYS.ANTHROPIC_EXPIRES_AT);
    }
  }

  async setAnthropicTokens(tokens: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
  }): Promise<void> {
    await this.set(KEYTAR_KEYS.ANTHROPIC_ACCESS_TOKEN, tokens.accessToken);

    if (tokens.refreshToken) {
      await this.set(KEYTAR_KEYS.ANTHROPIC_REFRESH_TOKEN, tokens.refreshToken);
    }

    if (tokens.expiresAt !== undefined) {
      await this.set(KEYTAR_KEYS.ANTHROPIC_EXPIRES_AT, String(tokens.expiresAt));
    }
  }

  async getAnthropicTokens(): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
  } | null> {
    const accessToken = await this.get(KEYTAR_KEYS.ANTHROPIC_ACCESS_TOKEN);

    if (!accessToken) {
      return null;
    }

    const refreshToken = await this.get(KEYTAR_KEYS.ANTHROPIC_REFRESH_TOKEN);
    const expiresAtStr = await this.get(KEYTAR_KEYS.ANTHROPIC_EXPIRES_AT);

    return {
      accessToken,
      refreshToken: refreshToken ?? undefined,
      expiresAt: expiresAtStr ? parseInt(expiresAtStr, 10) : undefined,
    };
  }

  // ============ Auth Status ============

  async getAuthStatus(): Promise<AuthStatus> {
    // All reads served from in-memory cache — zero keychain calls
    const [
      anthropicOAuth,
      anthropicKey,
      openaiKey,
      googleKey,
      openrouterKey,
      groqKey,
      xaiKey,
    ] = await Promise.all([
      this.getAnthropicTokens(),
      this.hasApiKey('anthropic'),
      this.hasApiKey('openai'),
      this.hasApiKey('google'),
      this.hasApiKey('openrouter'),
      this.hasApiKey('groq'),
      this.hasApiKey('xai'),
    ]);

    const hasAnthropicOAuth = !!anthropicOAuth?.accessToken;
    const hasAnthropicApiKey = anthropicKey;

    return {
      anthropic: {
        authenticated: hasAnthropicOAuth || hasAnthropicApiKey,
        method: hasAnthropicOAuth ? 'oauth' : hasAnthropicApiKey ? 'apikey' : null,
      },
      openai: { hasApiKey: openaiKey },
      google: { hasApiKey: googleKey },
      openrouter: { hasApiKey: openrouterKey },
      groq: { hasApiKey: groqKey },
      xai: { hasApiKey: xaiKey },
    };
  }

  // ============ Settings ============

  async getProjectsDirectory(): Promise<string | null> {
    return this.get(KEYTAR_KEYS.PROJECTS_DIRECTORY);
  }

  async setProjectsDirectory(path: string): Promise<void> {
    await this.set(KEYTAR_KEYS.PROJECTS_DIRECTORY, path);
  }

}
