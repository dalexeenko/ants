import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { CloudflareAccessAuthProvider } from './cloudflare-access.js';
import { createAuthMiddleware } from './middleware.js';
import { createServer, type Server } from 'http';

// ── Test key setup ──────────────────────────────────────────────────────────

let privateKey: CryptoKey;
let publicJwk: any;
let jwksServer: Server;
let jwksPort: number;
let teamDomain: string;

const TEST_AUD = 'test-aud-tag-12345';

beforeAll(async () => {
  // Generate an RS256 key pair for signing test JWTs
  const keys = await generateKeyPair('RS256');
  privateKey = keys.privateKey;
  const jwk = await exportJWK(keys.publicKey);
  jwk.kid = 'test-key-1';
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  publicJwk = jwk;

  // Start a tiny HTTP server that serves the JWKS endpoint
  return new Promise<void>((resolve) => {
    jwksServer = createServer((req, res) => {
      if (req.url === '/cdn-cgi/access/certs') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ keys: [publicJwk] }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    jwksServer.listen(0, '127.0.0.1', () => {
      const addr = jwksServer.address();
      if (addr && typeof addr === 'object') {
        jwksPort = addr.port;
        teamDomain = `http://127.0.0.1:${jwksPort}`;
      }
      resolve();
    });
  });
});

// We don't use afterAll to close the server because vitest handles cleanup.
// But let's be explicit:
import { afterAll } from 'vitest';
afterAll(() => {
  jwksServer?.close();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

async function signJwt(
  payload: Record<string, unknown>,
  options?: { kid?: string; issuer?: string; audience?: string; expiresIn?: string },
) {
  const jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: options?.kid ?? 'test-key-1' })
    .setIssuedAt();

  if (options?.issuer) jwt.setIssuer(options.issuer);
  if (options?.audience) jwt.setAudience(options.audience);
  if (options?.expiresIn) {
    jwt.setExpirationTime(options.expiresIn);
  } else {
    jwt.setExpirationTime('1h');
  }

  return jwt.sign(privateKey);
}

function createApp(config?: { setIdentity?: boolean }) {
  const provider = new CloudflareAccessAuthProvider({
    teamDomain,
    aud: TEST_AUD,
    setIdentity: config?.setIdentity,
  });
  const app = new Hono();
  app.use('*', createAuthMiddleware([provider]));
  app.get('/test', (c) => {
    const identity = (c as any).get('authIdentity');
    return c.json({ ok: true, identity: identity ?? null });
  });
  return app;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('CloudflareAccessAuthProvider', () => {
  it('should have the correct name', () => {
    const provider = new CloudflareAccessAuthProvider({
      teamDomain: 'https://test.cloudflareaccess.com',
      aud: 'aud',
    });
    expect(provider.name).toBe('Cloudflare Access');
  });

  it('should return null when no Cf-Access-Jwt-Assertion header is present', async () => {
    const app = createApp();
    const res = await app.request('/test');

    // No CF header → null → falls through → 401 (no other providers)
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Missing or invalid authentication');
  });

  it('should authenticate a valid JWT and extract email', async () => {
    const token = await signJwt(
      { email: 'user@example.com' },
      { issuer: teamDomain, audience: TEST_AUD },
    );
    const app = createApp();

    const res = await app.request('/test', {
      headers: { 'Cf-Access-Jwt-Assertion': token },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.identity).toEqual({
      provider: 'cloudflare-access',
      email: 'user@example.com',
    });
  });

  it('should reject an expired JWT', async () => {
    // Create a JWT that expired 1 hour ago
    const token = await signJwt(
      { email: 'user@example.com' },
      { issuer: teamDomain, audience: TEST_AUD, expiresIn: '-1h' },
    );
    const app = createApp();

    const res = await app.request('/test', {
      headers: { 'Cf-Access-Jwt-Assertion': token },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Invalid credentials');
  });

  it('should reject a JWT with wrong audience', async () => {
    const token = await signJwt(
      { email: 'user@example.com' },
      { issuer: teamDomain, audience: 'wrong-aud' },
    );
    const app = createApp();

    const res = await app.request('/test', {
      headers: { 'Cf-Access-Jwt-Assertion': token },
    });

    expect(res.status).toBe(401);
  });

  it('should reject a JWT with wrong issuer', async () => {
    const token = await signJwt(
      { email: 'user@example.com' },
      { issuer: 'https://wrong.cloudflareaccess.com', audience: TEST_AUD },
    );
    const app = createApp();

    const res = await app.request('/test', {
      headers: { 'Cf-Access-Jwt-Assertion': token },
    });

    expect(res.status).toBe(401);
  });

  it('should reject a completely invalid token string', async () => {
    const app = createApp();
    const res = await app.request('/test', {
      headers: { 'Cf-Access-Jwt-Assertion': 'not-a-jwt' },
    });

    expect(res.status).toBe(401);
  });

  it('should not include email when setIdentity is false', async () => {
    const token = await signJwt(
      { email: 'user@example.com' },
      { issuer: teamDomain, audience: TEST_AUD },
    );
    const app = createApp({ setIdentity: false });

    const res = await app.request('/test', {
      headers: { 'Cf-Access-Jwt-Assertion': token },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.identity).toEqual({ provider: 'cloudflare-access' });
    // Email should not be present
    expect(body.identity.email).toBeUndefined();
  });

  it('should handle JWT without email claim gracefully', async () => {
    const token = await signJwt(
      { sub: 'service-token' },
      { issuer: teamDomain, audience: TEST_AUD },
    );
    const app = createApp();

    const res = await app.request('/test', {
      headers: { 'Cf-Access-Jwt-Assertion': token },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.identity.provider).toBe('cloudflare-access');
    // No email claim in the JWT
    expect(body.identity.email).toBeUndefined();
  });
});

describe('CloudflareAccessAuthProvider chain integration', () => {
  it('should fall through to bearer when no CF header is present', async () => {
    const cfProvider = new CloudflareAccessAuthProvider({
      teamDomain,
      aud: TEST_AUD,
    });

    // Simulate a simple bearer-like provider
    const bearerProvider = {
      name: 'Bearer Token',
      authenticate: vi.fn().mockImplementation(async (c: any) => {
        const auth = c.req.header('Authorization');
        if (!auth) return null;
        if (auth === 'Bearer valid-secret') {
          return { authenticated: true, identity: { provider: 'bearer' } };
        }
        return { authenticated: false };
      }),
    };

    const app = new Hono();
    app.use('*', createAuthMiddleware([cfProvider, bearerProvider]));
    app.get('/test', (c) => {
      const identity = (c as any).get('authIdentity');
      return c.json({ ok: true, identity });
    });

    // Request with bearer token only (no CF header)
    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer valid-secret' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.identity.provider).toBe('bearer');
  });

  it('should reject immediately when CF header is present but invalid', async () => {
    const cfProvider = new CloudflareAccessAuthProvider({
      teamDomain,
      aud: TEST_AUD,
    });

    const bearerProvider = {
      name: 'Bearer Token',
      authenticate: vi.fn().mockResolvedValue({
        authenticated: true,
        identity: { provider: 'bearer' },
      }),
    };

    const app = new Hono();
    app.use('*', createAuthMiddleware([cfProvider, bearerProvider]));
    app.get('/test', (c) => c.json({ ok: true }));

    // Request with invalid CF header — should NOT fall through to bearer
    const res = await app.request('/test', {
      headers: {
        'Cf-Access-Jwt-Assertion': 'invalid-jwt',
        Authorization: 'Bearer valid-secret',
      },
    });

    expect(res.status).toBe(401);
    // Bearer provider should never be called
    expect(bearerProvider.authenticate).not.toHaveBeenCalled();
  });
});
