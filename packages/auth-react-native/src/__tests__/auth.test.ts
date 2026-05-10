import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SecureTokenStore,
  ExpoPKCEUtils,
  createManualOAuthHandler,
  ANTHROPIC_OAUTH_CONFIG,
} from "../index.js";
import type { ExpoSecureStore, ExpoCrypto } from "../index.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockSecureStore() {
  return {
    getItemAsync: vi.fn<(key: string) => Promise<string | null>>(),
    setItemAsync: vi.fn<(key: string, value: string) => Promise<void>>(),
    deleteItemAsync: vi.fn<(key: string) => Promise<void>>(),
  };
}

function createMockCrypto() {
  return {
    getRandomBytesAsync: vi.fn<(byteCount: number) => Promise<Uint8Array>>(),
    digestStringAsync: vi.fn<
      (
        algorithm: "SHA-256",
        data: string,
        options?: { encoding: "BASE64" }
      ) => Promise<string>
    >(),
    CryptoDigestAlgorithm: { SHA256: "SHA-256" as const },
    CryptoEncoding: { BASE64: "BASE64" as const },
  };
}

// ---------------------------------------------------------------------------
// SecureTokenStore
// ---------------------------------------------------------------------------

describe("SecureTokenStore", () => {
  let mockStore: ReturnType<typeof createMockSecureStore>;
  let tokenStore: SecureTokenStore;

  beforeEach(() => {
    mockStore = createMockSecureStore();
    tokenStore = new SecureTokenStore(mockStore);
  });

  describe("loadTokens", () => {
    it("returns parsed tokens when store has valid JSON", async () => {
      const stored = {
        accessToken: "access-abc",
        refreshToken: "refresh-xyz",
        expiresAt: 1700000000000,
      };
      mockStore.getItemAsync.mockResolvedValue(JSON.stringify(stored));

      const tokens = await tokenStore.loadTokens();

      expect(tokens).toEqual({
        accessToken: "access-abc",
        refreshToken: "refresh-xyz",
        expiresAt: 1700000000000,
      });
      expect(mockStore.getItemAsync).toHaveBeenCalledWith(
        "ants_oauth_tokens"
      );
    });

    it("returns null when store is empty", async () => {
      mockStore.getItemAsync.mockResolvedValue(null);

      const tokens = await tokenStore.loadTokens();

      expect(tokens).toBeNull();
    });

    it("returns null when store has invalid JSON", async () => {
      mockStore.getItemAsync.mockResolvedValue("not-valid-json{{{");

      const tokens = await tokenStore.loadTokens();

      expect(tokens).toBeNull();
    });
  });

  describe("saveTokens", () => {
    it("stores tokens as JSON string", async () => {
      const tokens = {
        accessToken: "access-123",
        refreshToken: "refresh-456",
        expiresAt: 1700000000000,
      };

      await tokenStore.saveTokens(tokens);

      expect(mockStore.setItemAsync).toHaveBeenCalledWith(
        "ants_oauth_tokens",
        JSON.stringify({
          accessToken: "access-123",
          refreshToken: "refresh-456",
          expiresAt: 1700000000000,
        })
      );
    });
  });

  describe("clearTokens", () => {
    it("calls deleteItemAsync with the storage key", async () => {
      mockStore.deleteItemAsync.mockResolvedValue(undefined);

      await tokenStore.clearTokens();

      expect(mockStore.deleteItemAsync).toHaveBeenCalledWith(
        "ants_oauth_tokens"
      );
    });

    it("does not throw when deleteItemAsync rejects", async () => {
      mockStore.deleteItemAsync.mockRejectedValue(new Error("delete failed"));

      await expect(tokenStore.clearTokens()).resolves.toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// ExpoPKCEUtils
// ---------------------------------------------------------------------------

describe("ExpoPKCEUtils", () => {
  let mockCrypto: ReturnType<typeof createMockCrypto>;
  let pkce: ExpoPKCEUtils;

  beforeEach(() => {
    mockCrypto = createMockCrypto();
    pkce = new ExpoPKCEUtils(mockCrypto);
  });

  describe("generateCodeVerifier", () => {
    it("returns a base64url-encoded string from random bytes", async () => {
      // 32 bytes of known data
      const knownBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        knownBytes[i] = i;
      }
      mockCrypto.getRandomBytesAsync.mockResolvedValue(knownBytes);

      const verifier = await pkce.generateCodeVerifier();

      expect(mockCrypto.getRandomBytesAsync).toHaveBeenCalledWith(32);
      // base64url: no +, /, or trailing =
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(verifier.length).toBeGreaterThan(0);
    });
  });

  describe("generateCodeChallenge", () => {
    it("calls digestStringAsync with SHA-256 and returns base64url result", async () => {
      // digestStringAsync returns standard base64; the code converts to base64url
      mockCrypto.digestStringAsync.mockResolvedValue("abc+def/ghi=");

      const challenge = await pkce.generateCodeChallenge("my-verifier");

      expect(mockCrypto.digestStringAsync).toHaveBeenCalledWith(
        "SHA-256",
        "my-verifier",
        { encoding: "BASE64" }
      );
      // + => -, / => _, trailing = removed
      expect(challenge).toBe("abc-def_ghi");
    });
  });
});

// ---------------------------------------------------------------------------
// createManualOAuthHandler
// ---------------------------------------------------------------------------

describe("createManualOAuthHandler", () => {
  let mockStore: ReturnType<typeof createMockSecureStore>;
  let mockCrypto: ReturnType<typeof createMockCrypto>;

  beforeEach(() => {
    mockStore = createMockSecureStore();
    mockCrypto = createMockCrypto();
  });

  it("returns an object with expected methods and properties", () => {
    const handler = createManualOAuthHandler(mockStore, mockCrypto);

    expect(handler).toHaveProperty("isLoggedIn");
    expect(handler).toHaveProperty("getValidAccessToken");
    expect(handler).toHaveProperty("logout");
    expect(handler).toHaveProperty("generateAuthUrl");
    expect(handler).toHaveProperty("completeLogin");
    expect(handler).toHaveProperty("tokenStore");
    expect(handler).toHaveProperty("pkce");
  });

  describe("isLoggedIn", () => {
    it("returns false when no tokens are stored", async () => {
      mockStore.getItemAsync.mockResolvedValue(null);

      const handler = createManualOAuthHandler(mockStore, mockCrypto);
      const result = await handler.isLoggedIn();

      expect(result).toBe(false);
    });

    it("returns true when valid tokens exist", async () => {
      const stored = {
        accessToken: "access-abc",
        refreshToken: "refresh-xyz",
        expiresAt: Date.now() + 3600_000,
      };
      mockStore.getItemAsync.mockResolvedValue(JSON.stringify(stored));

      const handler = createManualOAuthHandler(mockStore, mockCrypto);
      const result = await handler.isLoggedIn();

      expect(result).toBe(true);
    });
  });

  describe("logout", () => {
    it("clears tokens from the store", async () => {
      mockStore.deleteItemAsync.mockResolvedValue(undefined);

      const handler = createManualOAuthHandler(mockStore, mockCrypto);
      await handler.logout();

      expect(mockStore.deleteItemAsync).toHaveBeenCalledWith(
        "ants_oauth_tokens"
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Re-exported constants from auth-core
// ---------------------------------------------------------------------------

describe("ANTHROPIC_OAUTH_CONFIG", () => {
  it("has expected fields", () => {
    expect(ANTHROPIC_OAUTH_CONFIG).toHaveProperty("clientId");
    expect(ANTHROPIC_OAUTH_CONFIG).toHaveProperty("authorizationUrl");
    expect(ANTHROPIC_OAUTH_CONFIG).toHaveProperty("tokenUrl");
    expect(ANTHROPIC_OAUTH_CONFIG).toHaveProperty("defaultRedirectUri");
    expect(ANTHROPIC_OAUTH_CONFIG).toHaveProperty("scope");
  });

  it("contains non-empty string values", () => {
    expect(typeof ANTHROPIC_OAUTH_CONFIG.clientId).toBe("string");
    expect(ANTHROPIC_OAUTH_CONFIG.clientId.length).toBeGreaterThan(0);
    expect(ANTHROPIC_OAUTH_CONFIG.authorizationUrl).toMatch(/^https:\/\//);
    expect(ANTHROPIC_OAUTH_CONFIG.tokenUrl).toMatch(/^https:\/\//);
  });
});
