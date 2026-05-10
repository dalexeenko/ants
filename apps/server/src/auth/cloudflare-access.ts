/**
 * Cloudflare Access auth provider.
 *
 * Validates the `Cf-Access-Jwt-Assertion` header (RS256 JWT) against
 * Cloudflare's JWKS endpoint for the configured team domain.
 *
 * Enabled by setting OPENMGR_CF_ACCESS_TEAM_DOMAIN and OPENMGR_CF_ACCESS_AUD.
 *
 * @see https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTPayload, JWTVerifyGetKey } from 'jose';
import type { Context } from 'hono';
import type { AuthProvider, AuthResult } from './provider.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('auth:cf-access');

/** Header that Cloudflare Access always sets on proxied requests */
const CF_ACCESS_JWT_HEADER = 'cf-access-jwt-assertion';

export interface CloudflareAccessConfig {
  /** Full team domain URL, e.g. "https://myteam.cloudflareaccess.com" */
  teamDomain: string;
  /** Application Audience (AUD) tag from the Access application config */
  aud: string;
  /** Whether to extract the email from the JWT and set it as the auth identity (default: true) */
  setIdentity?: boolean;
}

export class CloudflareAccessAuthProvider implements AuthProvider {
  readonly name = 'Cloudflare Access';

  private readonly teamDomain: string;
  private readonly aud: string;
  private readonly setIdentity: boolean;
  private readonly jwks: JWTVerifyGetKey;

  constructor(config: CloudflareAccessConfig) {
    this.teamDomain = config.teamDomain;
    this.aud = config.aud;
    this.setIdentity = config.setIdentity ?? true;

    // createRemoteJWKSet fetches and caches keys automatically,
    // handling Cloudflare's 6-week key rotation.
    this.jwks = createRemoteJWKSet(
      new URL(`${this.teamDomain}/cdn-cgi/access/certs`),
    );
  }

  async authenticate(c: Context): Promise<AuthResult | null> {
    const token = c.req.header(CF_ACCESS_JWT_HEADER);

    // No CF Access header → not our credential type; let the chain continue.
    if (!token) {
      return null;
    }

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.teamDomain,
        audience: this.aud,
      });

      const email = typeof payload.email === 'string' ? payload.email : undefined;

      return {
        authenticated: true,
        identity: this.setIdentity
          ? { provider: 'cloudflare-access', email }
          : { provider: 'cloudflare-access' },
      };
    } catch (error) {
      // The CF Access header was present but the JWT is invalid/expired/wrong-aud.
      // Reject immediately — do not fall through to other providers.
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.warn(`Cloudflare Access JWT verification failed: ${message}`);
      return { authenticated: false };
    }
  }
}
