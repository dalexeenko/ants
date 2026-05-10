/**
 * Anthropic OAuth implementation.
 *
 * This module provides OAuth authentication for Anthropic APIs using
 * the platform-agnostic core from @openmgr/agent-auth-core.
 *
 * Uses WebCrypto API for cross-platform compatibility (Node.js, React Native, browsers).
 */

import type {
  OAuthTokens,
  OAuthTokenStore,
  PKCEUtils,
  OAuthFlowHandler,
} from "@openmgr/agent-auth-core";
import {
  ANTHROPIC_OAUTH_CONFIG,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken as coreRefreshAccessToken,
  shouldRefreshTokens,
} from "@openmgr/agent-auth-core";

// Re-export types and functions from core
export type { OAuthTokens, OAuthTokenStore, PKCEUtils, OAuthFlowHandler };
export {
  ANTHROPIC_OAUTH_CONFIG,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  shouldRefreshTokens,
};

/**
 * Convert a Uint8Array to base64url string.
 */
function toBase64Url(buffer: Uint8Array): string {
  // Convert to base64
  let binary = "";
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i]!);
  }
  const base64 = btoa(binary);
  // Convert to base64url
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Cross-platform PKCE utilities using WebCrypto API.
 * Compatible with Node.js, React Native, and browsers.
 */
export class WebCryptoPKCEUtils implements PKCEUtils {
  async generateCodeVerifier(): Promise<string> {
    const buffer = new Uint8Array(32);
    crypto.getRandomValues(buffer);
    return toBase64Url(buffer);
  }

  async generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return toBase64Url(new Uint8Array(hash));
  }
}

/**
 * Generate a PKCE code verifier (synchronous).
 * Uses crypto.getRandomValues which is synchronous across all platforms.
 */
export function generateCodeVerifier(): string {
  const buffer = new Uint8Array(32);
  crypto.getRandomValues(buffer);
  return toBase64Url(buffer);
}

/**
 * Generate a PKCE code challenge from a verifier.
 */
export async function generateCodeChallenge(
  verifier: string
): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return toBase64Url(new Uint8Array(hash));
}

// Re-export refreshAccessToken from core
export { coreRefreshAccessToken as refreshAccessToken };

/**
 * Result of a successful login.
 */
export interface LoginResult {
  tokens: OAuthTokens;
}

/**
 * Authorization URL and verifier for PKCE flow.
 */
export interface AuthorizationInfo {
  url: string;
  verifier: string;
}

/**
 * Generate an authorization URL for the OAuth flow.
 * Note: This is async because generateCodeChallenge uses WebCrypto's async digest.
 */
export async function generateAuthorizationUrl(): Promise<AuthorizationInfo> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const url = buildAuthorizationUrl(
    codeChallenge,
    ANTHROPIC_OAUTH_CONFIG.defaultRedirectUri,
    codeVerifier
  );

  return {
    url,
    verifier: codeVerifier,
  };
}

/**
 * Exchange an authorization code for tokens and save to store.
 *
 * @param code - The authorization code
 * @param verifier - The PKCE code verifier
 * @param tokenStore - The token store to save tokens to
 */
export async function exchangeCode(
  code: string,
  verifier: string,
  tokenStore: OAuthTokenStore
): Promise<OAuthTokens> {
  const tokens = await exchangeCodeForTokens(code, verifier);
  await tokenStore.saveTokens(tokens);
  return tokens;
}

/**
 * Perform the full OAuth login flow.
 *
 * @param tokenStore - The token store to save tokens to
 * @param openBrowser - Function to open the browser with the auth URL
 * @param getCode - Function to get the authorization code from the user
 */
export async function login(
  tokenStore: OAuthTokenStore,
  openBrowser: (url: string) => void | Promise<void>,
  getCode: () => Promise<string>
): Promise<LoginResult> {
  const { url, verifier } = await generateAuthorizationUrl();

  await openBrowser(url);

  const code = await getCode();
  const tokens = await exchangeCode(code.trim(), verifier, tokenStore);

  return { tokens };
}

/**
 * Check if the user is logged in.
 *
 * @param tokenStore - The token store to check
 */
export async function isLoggedIn(tokenStore: OAuthTokenStore): Promise<boolean> {
  const tokens = await tokenStore.loadTokens();
  return tokens !== null;
}

/**
 * Get a valid access token, refreshing if necessary.
 *
 * @param tokenStore - The token store to load/save tokens
 */
export async function getValidAccessToken(
  tokenStore: OAuthTokenStore
): Promise<string | null> {
  const tokens = await tokenStore.loadTokens();
  if (!tokens) return null;

  if (!shouldRefreshTokens(tokens)) {
    return tokens.accessToken;
  }

  try {
    const refreshed = await coreRefreshAccessToken(tokens.refreshToken);
    await tokenStore.saveTokens(refreshed);
    return refreshed.accessToken;
  } catch {
    return null;
  }
}

/**
 * Create an OAuth flow handler.
 *
 * @param tokenStore - The token store implementation
 * @param openBrowser - Function to open the browser
 * @param getCode - Function to get the authorization code from user
 */
export function createOAuthHandler(
  tokenStore: OAuthTokenStore,
  openBrowser: (url: string) => Promise<void>,
  getCode: () => Promise<string>
): OAuthFlowHandler {
  return {
    async login(): Promise<OAuthTokens> {
      const result = await login(tokenStore, openBrowser, getCode);
      return result.tokens;
    },

    async isLoggedIn(): Promise<boolean> {
      return isLoggedIn(tokenStore);
    },

    async logout(): Promise<void> {
      return tokenStore.clearTokens();
    },

    async getValidAccessToken(): Promise<string | null> {
      return getValidAccessToken(tokenStore);
    },
  };
}
