/**
 * @ants/agent-auth-core
 *
 * Platform-agnostic OAuth types and utilities for Ants Agent.
 *
 * This package provides:
 * - OAuth types and interfaces
 * - Token storage abstraction
 * - PKCE utilities interface
 * - Anthropic OAuth configuration
 *
 * Platform-specific implementations:
 * - Node.js: @ants/agent-auth-anthropic
 * - React Native: @ants/agent-auth-react-native
 */

/**
 * OAuth tokens.
 */
export interface OAuthTokens {
  /** The access token for API requests */
  accessToken: string;
  /** The refresh token for obtaining new access tokens */
  refreshToken: string;
  /** Timestamp (ms) when the access token expires */
  expiresAt: number;
}

/**
 * OAuth token store interface.
 * Implementations handle platform-specific storage.
 */
export interface OAuthTokenStore {
  /** Load stored tokens */
  loadTokens(): Promise<OAuthTokens | null>;
  /** Save tokens */
  saveTokens(tokens: OAuthTokens): Promise<void>;
  /** Clear stored tokens */
  clearTokens(): Promise<void>;
}

/**
 * PKCE (Proof Key for Code Exchange) utilities interface.
 * Implementations handle platform-specific crypto.
 */
export interface PKCEUtils {
  /** Generate a random code verifier */
  generateCodeVerifier(): Promise<string>;
  /** Generate code challenge from verifier (SHA256 + base64url) */
  generateCodeChallenge(verifier: string): Promise<string>;
}

/**
 * OAuth callback handler interface.
 * Handles receiving the authorization code after user authorization.
 */
export interface OAuthCallbackHandler {
  /** Get the redirect URI for the OAuth flow */
  getRedirectUri(): string;
  /** Wait for and return the authorization code */
  waitForCallback(state: string, timeout?: number): Promise<string>;
  /** Clean up any resources (e.g., close server) */
  cleanup?(): void;
}

/**
 * OAuth flow handler interface.
 * Orchestrates the complete OAuth flow.
 */
export interface OAuthFlowHandler {
  /** Start the OAuth flow and return tokens */
  login(): Promise<OAuthTokens>;
  /** Check if user is logged in */
  isLoggedIn(): Promise<boolean>;
  /** Logout and clear tokens */
  logout(): Promise<void>;
  /** Get valid access token, refreshing if needed */
  getValidAccessToken(): Promise<string | null>;
}

/**
 * Authorization info returned when starting OAuth flow.
 */
export interface AuthorizationInfo {
  /** The full authorization URL to open */
  url: string;
  /** The code verifier for PKCE */
  verifier: string;
}

/**
 * Anthropic OAuth configuration.
 */
export const ANTHROPIC_OAUTH_CONFIG = {
  clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  authorizationUrl: "https://claude.ai/oauth/authorize",
  tokenUrl: "https://console.anthropic.com/v1/oauth/token",
  /** Default redirect URI for manual code entry (CLI) */
  defaultRedirectUri: "https://console.anthropic.com/oauth/code/callback",
  scope: "org:create_api_key user:profile user:inference",
} as const;

/**
 * Buffer time (in seconds) before token expiry to trigger refresh.
 */
export const TOKEN_REFRESH_BUFFER_SECONDS = 300;

/**
 * Generate an authorization URL for Anthropic OAuth.
 *
 * @param codeChallenge - The PKCE code challenge
 * @param redirectUri - The redirect URI (defaults to Anthropic's code callback)
 * @param state - Optional state parameter (defaults to code verifier)
 */
export function buildAuthorizationUrl(
  codeChallenge: string,
  redirectUri: string = ANTHROPIC_OAUTH_CONFIG.defaultRedirectUri,
  state?: string
): string {
  const authUrl = new URL(ANTHROPIC_OAUTH_CONFIG.authorizationUrl);
  authUrl.searchParams.set("code", "true");
  authUrl.searchParams.set("client_id", ANTHROPIC_OAUTH_CONFIG.clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", ANTHROPIC_OAUTH_CONFIG.scope);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  if (state) {
    authUrl.searchParams.set("state", state);
  }

  return authUrl.toString();
}

/**
 * Exchange an authorization code for tokens.
 *
 * @param code - The authorization code from the callback
 * @param verifier - The PKCE code verifier
 * @param redirectUri - The redirect URI used in the authorization request
 * @param customFetch - Optional custom fetch function (for React Native)
 */
export async function exchangeCodeForTokens(
  code: string,
  verifier: string,
  redirectUri: string = ANTHROPIC_OAUTH_CONFIG.defaultRedirectUri,
  customFetch?: typeof fetch
): Promise<OAuthTokens> {
  // Handle code format: "code#state"
  const splits = code.split("#");
  const authCode = splits[0];
  const state = splits[1];

  const fetchFn = customFetch ?? fetch;

  const response = await fetchFn(ANTHROPIC_OAUTH_CONFIG.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      code: authCode,
      state: state,
      grant_type: "authorization_code",
      client_id: ANTHROPIC_OAUTH_CONFIG.clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/**
 * Refresh an access token using a refresh token.
 *
 * @param refreshToken - The refresh token
 * @param customFetch - Optional custom fetch function (for React Native)
 */
export async function refreshAccessToken(
  refreshToken: string,
  customFetch?: typeof fetch
): Promise<OAuthTokens> {
  const fetchFn = customFetch ?? fetch;
  const response = await fetchFn(ANTHROPIC_OAUTH_CONFIG.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: ANTHROPIC_OAUTH_CONFIG.clientId,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/**
 * Check if tokens need refresh (with buffer time).
 */
export function shouldRefreshTokens(tokens: OAuthTokens): boolean {
  const now = Date.now();
  return tokens.expiresAt - TOKEN_REFRESH_BUFFER_SECONDS * 1000 <= now;
}

/**
 * Base64url encode a Uint8Array.
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  // Convert to base64
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const base64 = btoa(binary);

  // Convert to base64url
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Convert base64 to base64url format.
 */
export function base64ToBase64Url(base64: string): string {
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Create an OAuth flow handler with the given components.
 *
 * @param tokenStore - Platform-specific token storage
 * @param pkce - Platform-specific PKCE utilities
 * @param callbackHandler - Platform-specific callback handler
 * @param openBrowser - Function to open browser (platform-specific)
 */
export function createOAuthFlowHandler(
  tokenStore: OAuthTokenStore,
  pkce: PKCEUtils,
  callbackHandler: OAuthCallbackHandler,
  openBrowser: (url: string) => Promise<void>
): OAuthFlowHandler {
  return {
    async login(): Promise<OAuthTokens> {
      const verifier = await pkce.generateCodeVerifier();
      const challenge = await pkce.generateCodeChallenge(verifier);
      const redirectUri = callbackHandler.getRedirectUri();

      const authUrl = buildAuthorizationUrl(challenge, redirectUri, verifier);

      await openBrowser(authUrl);

      const code = await callbackHandler.waitForCallback(verifier);
      callbackHandler.cleanup?.();

      const tokens = await exchangeCodeForTokens(code, verifier, redirectUri);
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
        return null;
      }
    },
  };
}
