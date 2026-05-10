/**
 * @ants/agent-auth-react-native
 *
 * React Native OAuth authentication for Ants Agent using Expo libraries.
 *
 * This package provides:
 * - SecureTokenStore: Token storage using expo-secure-store
 * - ExpoPKCEUtils: PKCE utilities using expo-crypto
 * - ExpoAuthSessionHandler: OAuth flow using expo-auth-session
 * - createExpoOAuthHandler: Factory to create complete OAuth handler
 *
 * @example
 * ```typescript
 * import { createExpoOAuthHandler } from "@ants/agent-auth-react-native";
 * import * as AuthSession from "expo-auth-session";
 * import * as Crypto from "expo-crypto";
 * import * as SecureStore from "expo-secure-store";
 * import * as WebBrowser from "expo-web-browser";
 *
 * const authHandler = createExpoOAuthHandler({
 *   AuthSession,
 *   Crypto,
 *   SecureStore,
 *   WebBrowser,
 *   appScheme: "myapp",
 * });
 *
 * // Login
 * const tokens = await authHandler.login();
 *
 * // Get access token for API calls
 * const accessToken = await authHandler.getValidAccessToken();
 * ```
 */

import type {
  OAuthTokens,
  OAuthTokenStore,
  PKCEUtils,
  OAuthFlowHandler,
} from "@ants/agent-auth-core";
import {
  ANTHROPIC_OAUTH_CONFIG,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  shouldRefreshTokens,
  base64UrlEncode,
  base64ToBase64Url,
} from "@ants/agent-auth-core";

// Re-export types from core
export type {
  OAuthTokens,
  OAuthTokenStore,
  PKCEUtils,
  OAuthFlowHandler,
} from "@ants/agent-auth-core";
export {
  ANTHROPIC_OAUTH_CONFIG,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  shouldRefreshTokens,
} from "@ants/agent-auth-core";

/**
 * Minimal interface for expo-secure-store.
 */
export interface ExpoSecureStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/**
 * Minimal interface for expo-crypto.
 */
export interface ExpoCrypto {
  getRandomBytesAsync(byteCount: number): Promise<Uint8Array>;
  digestStringAsync(
    algorithm: "SHA-256",
    data: string,
    options?: { encoding: "BASE64" }
  ): Promise<string>;
  CryptoDigestAlgorithm: { SHA256: "SHA-256" };
  CryptoEncoding: { BASE64: "BASE64" };
}

/**
 * Minimal interface for expo-web-browser.
 */
export interface ExpoWebBrowser {
  openBrowserAsync(url: string): Promise<{ type: string }>;
  maybeCompleteAuthSession(): { type: string };
}

/**
 * Minimal interface for expo-auth-session.
 */
export interface ExpoAuthSession {
  makeRedirectUri(options?: {
    scheme?: string;
    path?: string;
    preferLocalhost?: boolean;
  }): string;
  startAsync(options: {
    authUrl: string;
    returnUrl?: string;
  }): Promise<{
    type: "success" | "cancel" | "error" | "dismiss";
    params?: Record<string, string>;
    error?: Error;
  }>;
}

/**
 * Token storage key for secure store.
 */
const TOKEN_STORAGE_KEY = "ants_oauth_tokens";

/**
 * Stored token format in secure store.
 */
interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/**
 * Token store implementation using expo-secure-store.
 */
export class SecureTokenStore implements OAuthTokenStore {
  constructor(private secureStore: ExpoSecureStore) {}

  async loadTokens(): Promise<OAuthTokens | null> {
    try {
      const data = await this.secureStore.getItemAsync(TOKEN_STORAGE_KEY);
      if (!data) return null;

      const stored: StoredTokens = JSON.parse(data);
      return {
        accessToken: stored.accessToken,
        refreshToken: stored.refreshToken,
        expiresAt: stored.expiresAt,
      };
    } catch {
      return null;
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const stored: StoredTokens = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    };
    await this.secureStore.setItemAsync(
      TOKEN_STORAGE_KEY,
      JSON.stringify(stored)
    );
  }

  async clearTokens(): Promise<void> {
    try {
      await this.secureStore.deleteItemAsync(TOKEN_STORAGE_KEY);
    } catch {
      // Ignore errors on delete
    }
  }
}

/**
 * PKCE utilities using expo-crypto.
 */
export class ExpoPKCEUtils implements PKCEUtils {
  constructor(private crypto: ExpoCrypto) {}

  async generateCodeVerifier(): Promise<string> {
    const bytes = await this.crypto.getRandomBytesAsync(32);
    return base64UrlEncode(bytes);
  }

  async generateCodeChallenge(verifier: string): Promise<string> {
    const hash = await this.crypto.digestStringAsync(
      this.crypto.CryptoDigestAlgorithm.SHA256,
      verifier,
      { encoding: this.crypto.CryptoEncoding.BASE64 }
    );
    return base64ToBase64Url(hash);
  }
}

/**
 * Options for creating an Expo OAuth handler.
 */
export interface ExpoOAuthHandlerOptions {
  /** expo-auth-session module */
  AuthSession: ExpoAuthSession;
  /** expo-crypto module */
  Crypto: ExpoCrypto;
  /** expo-secure-store module */
  SecureStore: ExpoSecureStore;
  /** expo-web-browser module */
  WebBrowser: ExpoWebBrowser;
  /** App URL scheme for deep linking (e.g., "myapp") */
  appScheme: string;
  /** Optional path for OAuth callback (default: "oauth/callback") */
  callbackPath?: string;
}

/**
 * Create an OAuth flow handler using Expo libraries.
 *
 * This is the main entry point for React Native OAuth authentication.
 *
 * @example
 * ```typescript
 * import { createExpoOAuthHandler } from "@ants/agent-auth-react-native";
 * import * as AuthSession from "expo-auth-session";
 * import * as Crypto from "expo-crypto";
 * import * as SecureStore from "expo-secure-store";
 * import * as WebBrowser from "expo-web-browser";
 *
 * // Complete the auth session when app opens from redirect
 * WebBrowser.maybeCompleteAuthSession();
 *
 * const authHandler = createExpoOAuthHandler({
 *   AuthSession,
 *   Crypto,
 *   SecureStore,
 *   WebBrowser,
 *   appScheme: "myapp",
 * });
 *
 * // Check login status
 * const isLoggedIn = await authHandler.isLoggedIn();
 *
 * // Login (opens browser, returns tokens)
 * const tokens = await authHandler.login();
 *
 * // Get valid access token for API calls
 * const accessToken = await authHandler.getValidAccessToken();
 *
 * // Logout
 * await authHandler.logout();
 * ```
 */
export function createExpoOAuthHandler(
  options: ExpoOAuthHandlerOptions
): OAuthFlowHandler {
  const { AuthSession, Crypto, SecureStore, WebBrowser, appScheme, callbackPath = "oauth/callback" } = options;

  const tokenStore = new SecureTokenStore(SecureStore);
  const pkce = new ExpoPKCEUtils(Crypto);

  // Build redirect URI using expo-auth-session
  const redirectUri = AuthSession.makeRedirectUri({
    scheme: appScheme,
    path: callbackPath,
  });

  return {
    async login(): Promise<OAuthTokens> {
      // Generate PKCE values
      const verifier = await pkce.generateCodeVerifier();
      const challenge = await pkce.generateCodeChallenge(verifier);

      // Build authorization URL
      const authUrl = buildAuthorizationUrl(challenge, redirectUri, verifier);

      // Start auth session (opens browser, waits for redirect)
      const result = await AuthSession.startAsync({
        authUrl,
        returnUrl: redirectUri,
      });

      // Complete the auth session
      WebBrowser.maybeCompleteAuthSession();

      if (result.type !== "success" || !result.params) {
        throw new Error(`OAuth failed: ${result.type}${result.error ? ` - ${result.error.message}` : ""}`);
      }

      // Get the code from params
      const code = result.params["code"];
      if (!code) {
        throw new Error("No authorization code in response");
      }

      // Exchange code for tokens
      const tokens = await exchangeCodeForTokens(code, verifier, redirectUri);

      // Save tokens
      await tokenStore.saveTokens(tokens);

      return tokens;
    },

    async isLoggedIn(): Promise<boolean> {
      const tokens = await tokenStore.loadTokens();
      return tokens !== null;
    },

    async logout(): Promise<void> {
      await tokenStore.clearTokens();
    },

    async getValidAccessToken(): Promise<string | null> {
      const tokens = await tokenStore.loadTokens();
      if (!tokens) return null;

      if (!shouldRefreshTokens(tokens)) {
        return tokens.accessToken;
      }

      try {
        const refreshed = await refreshAccessToken(tokens.refreshToken);
        await tokenStore.saveTokens(refreshed);
        return refreshed.accessToken;
      } catch {
        // Token refresh failed, clear tokens
        await tokenStore.clearTokens();
        return null;
      }
    },
  };
}

/**
 * Create a manual OAuth flow handler for testing or custom flows.
 * This version requires you to handle the browser and code retrieval yourself.
 *
 * @param SecureStore - expo-secure-store module
 * @param Crypto - expo-crypto module
 * @param customFetch - Optional custom fetch function (for React Native streaming support)
 */
export function createManualOAuthHandler(
  SecureStore: ExpoSecureStore,
  Crypto: ExpoCrypto,
  customFetch?: typeof fetch
): {
  tokenStore: OAuthTokenStore;
  pkce: PKCEUtils;
  generateAuthUrl: () => Promise<{ url: string; verifier: string }>;
  completeLogin: (code: string, verifier: string) => Promise<OAuthTokens>;
  getValidAccessToken: () => Promise<string | null>;
  logout: () => Promise<void>;
  isLoggedIn: () => Promise<boolean>;
} {
  const tokenStore = new SecureTokenStore(SecureStore);
  const pkce = new ExpoPKCEUtils(Crypto);
  const fetchFn = customFetch ?? fetch;

  return {
    tokenStore,
    pkce,

    async generateAuthUrl(): Promise<{ url: string; verifier: string }> {
      const verifier = await pkce.generateCodeVerifier();
      const challenge = await pkce.generateCodeChallenge(verifier);
      // Must pass verifier as state parameter for Anthropic OAuth
      const url = buildAuthorizationUrl(challenge, undefined, verifier);
      return { url, verifier };
    },

    async completeLogin(code: string, verifier: string): Promise<OAuthTokens> {
      const tokens = await exchangeCodeForTokens(code, verifier, undefined, fetchFn);
      await tokenStore.saveTokens(tokens);
      return tokens;
    },

    async getValidAccessToken(): Promise<string | null> {
      const tokens = await tokenStore.loadTokens();
      if (!tokens) return null;

      if (!shouldRefreshTokens(tokens)) {
        return tokens.accessToken;
      }

      try {
        const refreshed = await refreshAccessToken(tokens.refreshToken, fetchFn);
        await tokenStore.saveTokens(refreshed);
        return refreshed.accessToken;
      } catch {
        return null;
      }
    },

    async logout(): Promise<void> {
      await tokenStore.clearTokens();
    },

    async isLoggedIn(): Promise<boolean> {
      const tokens = await tokenStore.loadTokens();
      return tokens !== null;
    },
  };
}
