import type { McpOAuthConfig } from "./types.js";

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt?: Date;
  scopes?: string;
}

/**
 * Interface for storing OAuth tokens.
 * Implement this to persist tokens (e.g., to a database).
 * The default implementation uses in-memory storage.
 */
export interface OAuthTokenStore {
  getTokens(serverName: string): Promise<OAuthTokens | null>;
  storeTokens(serverName: string, tokens: OAuthTokens): Promise<void>;
  clearTokens(serverName: string): Promise<void>;
}

/**
 * Interface for handling the OAuth callback.
 * Implementations can use different approaches:
 * - Node.js: Local HTTP server
 * - React Native: Deep linking
 * - Browser: Redirect or popup
 */
export interface OAuthCallbackHandler {
  /**
   * Start listening for the OAuth callback
   * @param state Expected state parameter for CSRF protection
   * @param timeout Timeout in milliseconds
   * @returns The authorization code
   */
  waitForCallback(state: string, timeout: number): Promise<string>;
  
  /**
   * Get the redirect URI for the OAuth flow
   */
  getRedirectUri(): string;
  
  /**
   * Clean up any resources (e.g., close server)
   */
  cleanup?(): void;
}

/**
 * In-memory token store (tokens are lost on restart)
 */
class InMemoryTokenStore implements OAuthTokenStore {
  private tokens: Map<string, OAuthTokens> = new Map();

  async getTokens(serverName: string): Promise<OAuthTokens | null> {
    return this.tokens.get(serverName) ?? null;
  }

  async storeTokens(serverName: string, tokens: OAuthTokens): Promise<void> {
    this.tokens.set(serverName, tokens);
  }

  async clearTokens(serverName: string): Promise<void> {
    this.tokens.delete(serverName);
  }
}

/**
 * Convert a Uint8Array to base64url encoding
 */
function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  // Convert to regular base64
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const base64 = btoa(binary);
  
  // Convert to base64url
  return base64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Generate random bytes using Web Crypto API
 */
function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  
  if (typeof globalThis !== "undefined" && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    // Fallback for environments without Web Crypto (should be rare)
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  
  return bytes;
}

/**
 * Generate a code verifier for PKCE
 */
function generateCodeVerifier(): string {
  return uint8ArrayToBase64Url(getRandomBytes(32));
}

/**
 * Generate a code challenge for PKCE using SHA-256
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  
  if (typeof globalThis !== "undefined" && globalThis.crypto?.subtle) {
    const hash = await globalThis.crypto.subtle.digest("SHA-256", data);
    return uint8ArrayToBase64Url(new Uint8Array(hash));
  }
  
  // Fallback: return verifier as plain (less secure, but works)
  // This should only happen in very old environments
  console.warn("Web Crypto API not available, using plain code challenge (less secure)");
  return verifier;
}

/**
 * Generate a random state string for CSRF protection
 */
function generateState(): string {
  return uint8ArrayToBase64Url(getRandomBytes(16));
}

export class McpOAuthManager {
  private tokenStore: OAuthTokenStore;
  private callbackHandler?: OAuthCallbackHandler;

  constructor(tokenStore?: OAuthTokenStore, callbackHandler?: OAuthCallbackHandler) {
    this.tokenStore = tokenStore ?? new InMemoryTokenStore();
    this.callbackHandler = callbackHandler;
  }

  /**
   * Set a custom token store (e.g., database-backed)
   */
  setTokenStore(store: OAuthTokenStore): void {
    this.tokenStore = store;
  }

  /**
   * Set a custom callback handler (e.g., local HTTP server, deep linking)
   */
  setCallbackHandler(handler: OAuthCallbackHandler): void {
    this.callbackHandler = handler;
  }

  async getStoredTokens(serverName: string): Promise<OAuthTokens | null> {
    return this.tokenStore.getTokens(serverName);
  }

  async storeTokens(serverName: string, tokens: OAuthTokens): Promise<void> {
    return this.tokenStore.storeTokens(serverName, tokens);
  }

  async clearTokens(serverName: string): Promise<void> {
    return this.tokenStore.clearTokens(serverName);
  }

  isTokenExpired(tokens: OAuthTokens): boolean {
    if (!tokens.expiresAt) return false;
    return new Date() >= tokens.expiresAt;
  }

  async refreshTokens(
    serverName: string,
    oauthConfig: McpOAuthConfig
  ): Promise<OAuthTokens | null> {
    const stored = await this.getStoredTokens(serverName);
    if (!stored?.refreshToken) return null;

    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: stored.refreshToken,
      client_id: oauthConfig.clientId,
    });

    if (oauthConfig.clientSecret) {
      params.set("client_secret", oauthConfig.clientSecret);
    }

    const response = await fetch(oauthConfig.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      token_type?: string;
      expires_in?: number;
      scope?: string;
    };

    const tokens: OAuthTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? stored.refreshToken,
      tokenType: data.token_type ?? "Bearer",
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : undefined,
      scopes: data.scope,
    };

    await this.storeTokens(serverName, tokens);
    return tokens;
  }

  async getValidTokens(
    serverName: string,
    oauthConfig: McpOAuthConfig
  ): Promise<OAuthTokens | null> {
    const stored = await this.getStoredTokens(serverName);
    if (!stored) return null;

    if (!this.isTokenExpired(stored)) {
      return stored;
    }

    return this.refreshTokens(serverName, oauthConfig);
  }

  /**
   * Initiate the OAuth authorization code flow with PKCE.
   * 
   * @param serverName Name of the MCP server
   * @param oauthConfig OAuth configuration
   * @param openBrowser Function to open the authorization URL in a browser
   * @returns The obtained OAuth tokens
   * @throws Error if no callback handler is configured
   */
  async initiateOAuthFlow(
    serverName: string,
    oauthConfig: McpOAuthConfig,
    openBrowser: (url: string) => Promise<void>
  ): Promise<OAuthTokens> {
    if (!this.callbackHandler) {
      throw new Error(
        "OAuth callback handler not configured. " +
        "In Node.js, use @openmgr/agent-node which provides a local HTTP server handler. " +
        "In React Native, configure a deep linking handler."
      );
    }

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateState();
    const redirectUri = this.callbackHandler.getRedirectUri();

    const authParams = new URLSearchParams({
      response_type: "code",
      client_id: oauthConfig.clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    if (oauthConfig.scopes?.length) {
      authParams.set("scope", oauthConfig.scopes.join(" "));
    }

    const authUrl = `${oauthConfig.authorizationUrl}?${authParams.toString()}`;

    // Start listening for callback before opening browser
    const codePromise = this.callbackHandler.waitForCallback(state, 120000);
    
    // Open browser
    await openBrowser(authUrl);
    
    // Wait for the callback
    const code = await codePromise;

    // Clean up callback handler
    this.callbackHandler.cleanup?.();

    // Exchange code for tokens
    const tokenParams = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: oauthConfig.clientId,
      code_verifier: codeVerifier,
    });

    if (oauthConfig.clientSecret) {
      tokenParams.set("client_secret", oauthConfig.clientSecret);
    }

    const tokenResponse = await fetch(oauthConfig.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: tokenParams.toString(),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Token exchange failed: ${errorText}`);
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      token_type?: string;
      expires_in?: number;
      scope?: string;
    };

    const tokens: OAuthTokens = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenType: tokenData.token_type ?? "Bearer",
      expiresAt: tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000)
        : undefined,
      scopes: tokenData.scope,
    };

    await this.storeTokens(serverName, tokens);
    return tokens;
  }
}

export const mcpOAuthManager = new McpOAuthManager();
