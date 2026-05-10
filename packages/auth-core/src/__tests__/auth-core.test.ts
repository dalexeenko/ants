import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ANTHROPIC_OAUTH_CONFIG,
  TOKEN_REFRESH_BUFFER_SECONDS,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  shouldRefreshTokens,
  base64UrlEncode,
  base64ToBase64Url,
  createOAuthFlowHandler,
  type OAuthTokens,
  type OAuthTokenStore,
  type PKCEUtils,
  type OAuthCallbackHandler,
} from "../index.js";

describe("ANTHROPIC_OAUTH_CONFIG", () => {
  it("should have correct client ID", () => {
    expect(ANTHROPIC_OAUTH_CONFIG.clientId).toBe(
      "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
    );
  });

  it("should have correct authorization URL", () => {
    expect(ANTHROPIC_OAUTH_CONFIG.authorizationUrl).toBe(
      "https://claude.ai/oauth/authorize"
    );
  });

  it("should have correct token URL", () => {
    expect(ANTHROPIC_OAUTH_CONFIG.tokenUrl).toBe(
      "https://console.anthropic.com/v1/oauth/token"
    );
  });

  it("should have correct default redirect URI", () => {
    expect(ANTHROPIC_OAUTH_CONFIG.defaultRedirectUri).toBe(
      "https://console.anthropic.com/oauth/code/callback"
    );
  });

  it("should have correct scope", () => {
    expect(ANTHROPIC_OAUTH_CONFIG.scope).toBe(
      "org:create_api_key user:profile user:inference"
    );
  });
});

describe("buildAuthorizationUrl", () => {
  it("should build URL with all required parameters", () => {
    const codeChallenge = "test-challenge";
    const url = buildAuthorizationUrl(codeChallenge);
    const parsed = new URL(url);

    expect(parsed.origin).toBe("https://claude.ai");
    expect(parsed.pathname).toBe("/oauth/authorize");
    expect(parsed.searchParams.get("code")).toBe("true");
    expect(parsed.searchParams.get("client_id")).toBe(
      ANTHROPIC_OAUTH_CONFIG.clientId
    );
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      ANTHROPIC_OAUTH_CONFIG.defaultRedirectUri
    );
    expect(parsed.searchParams.get("scope")).toBe(ANTHROPIC_OAUTH_CONFIG.scope);
    expect(parsed.searchParams.get("code_challenge")).toBe(codeChallenge);
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("should use custom redirect URI when provided", () => {
    const codeChallenge = "test-challenge";
    const customRedirect = "myapp://oauth/callback";
    const url = buildAuthorizationUrl(codeChallenge, customRedirect);
    const parsed = new URL(url);

    expect(parsed.searchParams.get("redirect_uri")).toBe(customRedirect);
  });

  it("should include state when provided", () => {
    const codeChallenge = "test-challenge";
    const state = "test-state-verifier";
    const url = buildAuthorizationUrl(codeChallenge, undefined, state);
    const parsed = new URL(url);

    expect(parsed.searchParams.get("state")).toBe(state);
  });

  it("should not include state when not provided", () => {
    const codeChallenge = "test-challenge";
    const url = buildAuthorizationUrl(codeChallenge);
    const parsed = new URL(url);

    expect(parsed.searchParams.get("state")).toBeNull();
  });
});

describe("shouldRefreshTokens", () => {
  it("should return false for fresh tokens", () => {
    const tokens: OAuthTokens = {
      accessToken: "test-access",
      refreshToken: "test-refresh",
      expiresAt: Date.now() + 3600 * 1000, // 1 hour from now
    };

    expect(shouldRefreshTokens(tokens)).toBe(false);
  });

  it("should return true for tokens within buffer time", () => {
    const tokens: OAuthTokens = {
      accessToken: "test-access",
      refreshToken: "test-refresh",
      // Within buffer time (300 seconds default)
      expiresAt: Date.now() + (TOKEN_REFRESH_BUFFER_SECONDS - 10) * 1000,
    };

    expect(shouldRefreshTokens(tokens)).toBe(true);
  });

  it("should return true for expired tokens", () => {
    const tokens: OAuthTokens = {
      accessToken: "test-access",
      refreshToken: "test-refresh",
      expiresAt: Date.now() - 1000, // Already expired
    };

    expect(shouldRefreshTokens(tokens)).toBe(true);
  });
});

describe("base64UrlEncode", () => {
  it("should encode bytes to base64url", () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const encoded = base64UrlEncode(bytes);

    expect(encoded).toBe("SGVsbG8");
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
  });

  it("should handle empty array", () => {
    const bytes = new Uint8Array([]);
    const encoded = base64UrlEncode(bytes);

    expect(encoded).toBe("");
  });
});

describe("base64ToBase64Url", () => {
  it("should convert + to -", () => {
    const result = base64ToBase64Url("a+b+c");
    expect(result).toBe("a-b-c");
  });

  it("should convert / to _", () => {
    const result = base64ToBase64Url("a/b/c");
    expect(result).toBe("a_b_c");
  });

  it("should remove trailing =", () => {
    const result = base64ToBase64Url("abc===");
    expect(result).toBe("abc");
  });

  it("should handle combined transformations", () => {
    const result = base64ToBase64Url("a+b/c==");
    expect(result).toBe("a-b_c");
  });
});

describe("exchangeCodeForTokens", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("should exchange code for tokens", async () => {
    const mockTokens = {
      access_token: "access-123",
      refresh_token: "refresh-456",
      expires_in: 3600,
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockTokens),
    });

    const tokens = await exchangeCodeForTokens("auth-code", "verifier");

    expect(tokens.accessToken).toBe("access-123");
    expect(tokens.refreshToken).toBe("refresh-456");
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());

    expect(fetchMock).toHaveBeenCalledWith(
      ANTHROPIC_OAUTH_CONFIG.tokenUrl,
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.stringContaining("auth-code"),
      })
    );
  });

  it("should handle code#state format", async () => {
    const mockTokens = {
      access_token: "access-123",
      refresh_token: "refresh-456",
      expires_in: 3600,
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockTokens),
    });

    await exchangeCodeForTokens("auth-code#state-value", "verifier");

    const call = fetchMock.mock.calls[0]!;
    const body = JSON.parse(call[1].body);
    expect(body.code).toBe("auth-code");
    expect(body.state).toBe("state-value");
  });

  it("should throw on error response", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve("Invalid code"),
    });

    await expect(exchangeCodeForTokens("bad-code", "verifier")).rejects.toThrow(
      "Token exchange failed"
    );
  });
});

describe("refreshAccessToken", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("should refresh access token", async () => {
    const mockTokens = {
      access_token: "new-access-123",
      refresh_token: "new-refresh-456",
      expires_in: 3600,
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockTokens),
    });

    const tokens = await refreshAccessToken("old-refresh");

    expect(tokens.accessToken).toBe("new-access-123");
    expect(tokens.refreshToken).toBe("new-refresh-456");

    expect(fetchMock).toHaveBeenCalledWith(
      ANTHROPIC_OAUTH_CONFIG.tokenUrl,
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("refresh_token"),
      })
    );
  });

  it("should keep old refresh token if not returned", async () => {
    const mockTokens = {
      access_token: "new-access-123",
      expires_in: 3600,
      // No refresh_token returned
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockTokens),
    });

    const tokens = await refreshAccessToken("old-refresh");

    expect(tokens.accessToken).toBe("new-access-123");
    expect(tokens.refreshToken).toBe("old-refresh");
  });

  it("should throw on error response", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve("Invalid refresh token"),
    });

    await expect(refreshAccessToken("bad-refresh")).rejects.toThrow(
      "Token refresh failed"
    );
  });
});

describe("createOAuthFlowHandler", () => {
  let tokenStore: OAuthTokenStore;
  let pkce: PKCEUtils;
  let callbackHandler: OAuthCallbackHandler;
  let openBrowser: (url: string) => Promise<void>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    tokenStore = {
      loadTokens: vi.fn(),
      saveTokens: vi.fn(),
      clearTokens: vi.fn(),
    };

    pkce = {
      generateCodeVerifier: vi.fn().mockResolvedValue("test-verifier"),
      generateCodeChallenge: vi.fn().mockResolvedValue("test-challenge"),
    };

    callbackHandler = {
      getRedirectUri: vi.fn().mockReturnValue("myapp://callback"),
      waitForCallback: vi.fn().mockResolvedValue("auth-code"),
      cleanup: vi.fn(),
    };

    openBrowser = vi.fn().mockResolvedValue(undefined) as unknown as (url: string) => Promise<void>;
  });

  it("should create a flow handler with login method", async () => {
    const mockTokens = {
      access_token: "access-123",
      refresh_token: "refresh-456",
      expires_in: 3600,
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockTokens),
    });

    const handler = createOAuthFlowHandler(
      tokenStore,
      pkce,
      callbackHandler,
      openBrowser
    );

    const tokens = await handler.login();

    expect(pkce.generateCodeVerifier).toHaveBeenCalled();
    expect(pkce.generateCodeChallenge).toHaveBeenCalledWith("test-verifier");
    expect(openBrowser).toHaveBeenCalled();
    expect(callbackHandler.waitForCallback).toHaveBeenCalledWith("test-verifier");
    expect(callbackHandler.cleanup).toHaveBeenCalled();
    expect(tokenStore.saveTokens).toHaveBeenCalled();
    expect(tokens.accessToken).toBe("access-123");
  });

  it("should check if logged in", async () => {
    const handler = createOAuthFlowHandler(
      tokenStore,
      pkce,
      callbackHandler,
      openBrowser
    );

    (tokenStore.loadTokens as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    expect(await handler.isLoggedIn()).toBe(false);

    (tokenStore.loadTokens as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      accessToken: "test",
      refreshToken: "test",
      expiresAt: Date.now() + 3600000,
    });
    expect(await handler.isLoggedIn()).toBe(true);
  });

  it("should logout by clearing tokens", async () => {
    const handler = createOAuthFlowHandler(
      tokenStore,
      pkce,
      callbackHandler,
      openBrowser
    );

    await handler.logout();

    expect(tokenStore.clearTokens).toHaveBeenCalled();
  });

  it("should get valid access token when not expired", async () => {
    const handler = createOAuthFlowHandler(
      tokenStore,
      pkce,
      callbackHandler,
      openBrowser
    );

    (tokenStore.loadTokens as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      accessToken: "valid-token",
      refreshToken: "refresh",
      expiresAt: Date.now() + 3600000, // 1 hour from now
    });

    const token = await handler.getValidAccessToken();

    expect(token).toBe("valid-token");
  });

  it("should refresh token when expired", async () => {
    const handler = createOAuthFlowHandler(
      tokenStore,
      pkce,
      callbackHandler,
      openBrowser
    );

    (tokenStore.loadTokens as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      accessToken: "old-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() - 1000, // Expired
    });

    const mockRefreshed = {
      access_token: "new-token",
      refresh_token: "new-refresh",
      expires_in: 3600,
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockRefreshed),
    });

    const token = await handler.getValidAccessToken();

    expect(token).toBe("new-token");
    expect(tokenStore.saveTokens).toHaveBeenCalled();
  });

  it("should return null when not logged in", async () => {
    const handler = createOAuthFlowHandler(
      tokenStore,
      pkce,
      callbackHandler,
      openBrowser
    );

    (tokenStore.loadTokens as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const token = await handler.getValidAccessToken();

    expect(token).toBeNull();
  });
});
