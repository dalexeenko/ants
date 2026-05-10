import { describe, it, expect } from "vitest";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  WebCryptoPKCEUtils,
  generateAuthorizationUrl,
  buildAuthorizationUrl,
  shouldRefreshTokens,
  ANTHROPIC_OAUTH_CONFIG,
} from "../oauth.js";

const BASE64URL_REGEX = /^[A-Za-z0-9_-]+$/;

describe("generateCodeVerifier", () => {
  it("returns a string of at least 43 characters", () => {
    const verifier = generateCodeVerifier();
    expect(typeof verifier).toBe("string");
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });

  it("returns only base64url characters", () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(BASE64URL_REGEX);
  });

  it("returns a different value each call", () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });
});

describe("generateCodeChallenge", () => {
  it("returns a base64url string", async () => {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    expect(typeof challenge).toBe("string");
    expect(challenge).toMatch(BASE64URL_REGEX);
  });

  it("is deterministic for the same input", async () => {
    const verifier = "test-verifier-deterministic";
    const a = await generateCodeChallenge(verifier);
    const b = await generateCodeChallenge(verifier);
    expect(a).toBe(b);
  });

  it("produces different challenges for different verifiers", async () => {
    const a = await generateCodeChallenge("verifier-one");
    const b = await generateCodeChallenge("verifier-two");
    expect(a).not.toBe(b);
  });
});

describe("WebCryptoPKCEUtils", () => {
  it("can be instantiated", () => {
    const utils = new WebCryptoPKCEUtils();
    expect(utils).toBeInstanceOf(WebCryptoPKCEUtils);
  });

  it("generateCodeVerifier returns a base64url string of 43+ chars", async () => {
    const utils = new WebCryptoPKCEUtils();
    const verifier = await utils.generateCodeVerifier();
    expect(typeof verifier).toBe("string");
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).toMatch(BASE64URL_REGEX);
  });

  it("generateCodeChallenge returns a deterministic base64url string", async () => {
    const utils = new WebCryptoPKCEUtils();
    const challenge1 = await utils.generateCodeChallenge("fixed-input");
    const challenge2 = await utils.generateCodeChallenge("fixed-input");
    expect(challenge1).toMatch(BASE64URL_REGEX);
    expect(challenge1).toBe(challenge2);
  });
});

describe("generateAuthorizationUrl", () => {
  it("returns an object with url and verifier", async () => {
    const result = await generateAuthorizationUrl();
    expect(result).toHaveProperty("url");
    expect(result).toHaveProperty("verifier");
    expect(typeof result.url).toBe("string");
    expect(typeof result.verifier).toBe("string");
  });

  it("url contains the expected authorization domain", async () => {
    const { url } = await generateAuthorizationUrl();
    expect(url).toContain("https://claude.ai/oauth/authorize");
  });

  it("verifier is a valid base64url string", async () => {
    const { verifier } = await generateAuthorizationUrl();
    expect(verifier).toMatch(BASE64URL_REGEX);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });
});

describe("buildAuthorizationUrl", () => {
  it("returns a URL string", () => {
    const url = buildAuthorizationUrl("test-challenge");
    expect(typeof url).toBe("string");
    expect(() => new URL(url)).not.toThrow();
  });

  it("includes the correct query parameters", () => {
    const url = buildAuthorizationUrl("my-code-challenge");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("client_id")).toBe(
      ANTHROPIC_OAUTH_CONFIG.clientId
    );
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      ANTHROPIC_OAUTH_CONFIG.defaultRedirectUri
    );
    expect(parsed.searchParams.get("scope")).toBe(
      ANTHROPIC_OAUTH_CONFIG.scope
    );
    expect(parsed.searchParams.get("code_challenge")).toBe("my-code-challenge");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("uses a custom redirect URI when provided", () => {
    const customRedirect = "http://localhost:3000/callback";
    const url = buildAuthorizationUrl("challenge", customRedirect);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("redirect_uri")).toBe(customRedirect);
  });

  it("includes state parameter when provided", () => {
    const url = buildAuthorizationUrl("challenge", undefined, "my-state");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("state")).toBe("my-state");
  });
});

describe("shouldRefreshTokens", () => {
  it("returns false for tokens that are not expired", () => {
    const tokens = {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: Date.now() + 3600 * 1000, // 1 hour from now
    };
    expect(shouldRefreshTokens(tokens)).toBe(false);
  });

  it("returns true for tokens that are already expired", () => {
    const tokens = {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: Date.now() - 1000, // 1 second ago
    };
    expect(shouldRefreshTokens(tokens)).toBe(true);
  });

  it("returns true for tokens within the refresh buffer (5 minutes)", () => {
    const tokens = {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: Date.now() + 60 * 1000, // 1 minute from now (within 300s buffer)
    };
    expect(shouldRefreshTokens(tokens)).toBe(true);
  });
});

describe("ANTHROPIC_OAUTH_CONFIG", () => {
  it("has a clientId", () => {
    expect(typeof ANTHROPIC_OAUTH_CONFIG.clientId).toBe("string");
    expect(ANTHROPIC_OAUTH_CONFIG.clientId.length).toBeGreaterThan(0);
  });

  it("has an authorizationUrl", () => {
    expect(ANTHROPIC_OAUTH_CONFIG.authorizationUrl).toBe(
      "https://claude.ai/oauth/authorize"
    );
  });

  it("has a tokenUrl", () => {
    expect(ANTHROPIC_OAUTH_CONFIG.tokenUrl).toBe(
      "https://console.anthropic.com/v1/oauth/token"
    );
  });

  it("has a defaultRedirectUri", () => {
    expect(typeof ANTHROPIC_OAUTH_CONFIG.defaultRedirectUri).toBe("string");
    expect(ANTHROPIC_OAUTH_CONFIG.defaultRedirectUri).toContain("https://");
  });

  it("has a scope", () => {
    expect(typeof ANTHROPIC_OAUTH_CONFIG.scope).toBe("string");
    expect(ANTHROPIC_OAUTH_CONFIG.scope.length).toBeGreaterThan(0);
  });
});
