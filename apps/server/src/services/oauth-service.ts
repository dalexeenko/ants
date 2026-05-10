/**
 * OAuth Service — manages social auth provider configs and handles OAuth flows.
 *
 * Supports Google, GitHub, Microsoft/Azure AD, and Generic OIDC.
 * Provider credentials are stored encrypted in the oauth_providers table.
 * User identities are linked via the oauth_accounts table.
 */

import { randomBytes, createHash } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { oauthProviders, oauthAccounts, users } from '../db/schema.js';
import type { OauthProvider, NewOauthProvider, OauthAccount, NewOauthAccount, User, NewUser } from '../db/schema.js';
import type { DrizzleDB } from '../db/index.js';
import type { EncryptionService } from './encryption.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('OAuthService');

// ── Well-known OAuth endpoints ────────────────────────────────────────

interface OAuthEndpoints {
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scopes: string[];
}

const WELL_KNOWN_ENDPOINTS: Record<string, OAuthEndpoints> = {
  google: {
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userinfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scopes: ['openid', 'email', 'profile'],
  },
  github: {
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userinfoUrl: 'https://api.github.com/user',
    scopes: ['user:email', 'read:user'],
  },
  microsoft: {
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userinfoUrl: 'https://graph.microsoft.com/v1.0/me',
    scopes: ['openid', 'email', 'profile', 'User.Read'],
  },
};

// ── Types ─────────────────────────────────────────────────────────────

export type OAuthProviderType = 'google' | 'github' | 'microsoft' | 'oidc';

export interface OAuthProviderConfig {
  id: string;
  type: OAuthProviderType;
  clientId: string;
  clientSecret?: string; // only returned when creating/editing, never in list
  discoveryUrl?: string; // for OIDC
  config?: Record<string, unknown>; // extra provider config (e.g. tenant)
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface OAuthUserInfo {
  sub: string; // provider-specific account ID
  email?: string;
  name?: string;
  picture?: string;
  raw: Record<string, unknown>;
}

export interface OAuthFlowState {
  providerId: string;
  codeVerifier: string; // PKCE
  redirectUri?: string; // app connect redirect_uri (if this is an app auth flow)
  state?: string; // app connect state
}

interface OIDCDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

function generateId(): string {
  return randomBytes(16).toString('hex');
}

function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function createCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export class OAuthService {
  private db: DrizzleDB;
  private encryption: EncryptionService;
  // In-memory PKCE state store (keyed by state param)
  private flowStates = new Map<string, { state: OAuthFlowState; expiresAt: number }>();

  constructor(db: DrizzleDB, encryption: EncryptionService) {
    this.db = db;
    this.encryption = encryption;
  }

  // ── Provider CRUD ───────────────────────────────────────────────────

  async listProviders(): Promise<OAuthProviderConfig[]> {
    const rows = this.db.select().from(oauthProviders).all();
    return rows.map((r) => ({
      id: r.id,
      type: r.type as OAuthProviderType,
      clientId: r.clientId,
      discoveryUrl: r.discoveryUrl ?? undefined,
      config: r.config ? JSON.parse(r.config) : undefined,
      enabled: r.enabled,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async getProvider(id: string): Promise<OAuthProviderConfig | null> {
    const row = this.db.select().from(oauthProviders).where(eq(oauthProviders.id, id)).get();
    if (!row) return null;
    return {
      id: row.id,
      type: row.type as OAuthProviderType,
      clientId: row.clientId,
      discoveryUrl: row.discoveryUrl ?? undefined,
      config: row.config ? JSON.parse(row.config) : undefined,
      enabled: row.enabled,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async createProvider(opts: {
    type: OAuthProviderType;
    clientId: string;
    clientSecret: string;
    discoveryUrl?: string;
    config?: Record<string, unknown>;
  }): Promise<OAuthProviderConfig> {
    const now = new Date();
    const id = generateId();
    const row: NewOauthProvider = {
      id,
      type: opts.type,
      clientId: opts.clientId,
      encryptedClientSecret: this.encryption.encrypt(opts.clientSecret),
      discoveryUrl: opts.discoveryUrl ?? null,
      config: opts.config ? JSON.stringify(opts.config) : null,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(oauthProviders).values(row).run();
    return {
      id,
      type: opts.type as OAuthProviderType,
      clientId: opts.clientId,
      discoveryUrl: opts.discoveryUrl,
      config: opts.config,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
  }

  async updateProvider(
    id: string,
    updates: {
      clientId?: string;
      clientSecret?: string;
      discoveryUrl?: string;
      config?: Record<string, unknown>;
      enabled?: boolean;
    },
  ): Promise<OAuthProviderConfig | null> {
    const existing = this.db.select().from(oauthProviders).where(eq(oauthProviders.id, id)).get();
    if (!existing) return null;

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.clientId !== undefined) updateData.clientId = updates.clientId;
    if (updates.clientSecret !== undefined) {
      updateData.encryptedClientSecret = this.encryption.encrypt(updates.clientSecret);
    }
    if (updates.discoveryUrl !== undefined) updateData.discoveryUrl = updates.discoveryUrl;
    if (updates.config !== undefined) updateData.config = JSON.stringify(updates.config);
    if (updates.enabled !== undefined) updateData.enabled = updates.enabled;

    this.db.update(oauthProviders).set(updateData).where(eq(oauthProviders.id, id)).run();
    return this.getProvider(id);
  }

  async deleteProvider(id: string): Promise<boolean> {
    const existing = this.db.select().from(oauthProviders).where(eq(oauthProviders.id, id)).get();
    if (!existing) return false;
    this.db.delete(oauthProviders).where(eq(oauthProviders.id, id)).run();
    return true;
  }

  // ── OAuth Flow ──────────────────────────────────────────────────────

  /**
   * Build the authorize URL and store PKCE state.
   * Returns the URL to redirect the user to.
   */
  async getAuthorizeUrl(
    providerId: string,
    callbackUrl: string,
    appRedirect?: { redirectUri: string; state?: string },
  ): Promise<string> {
    const provider = this.db.select().from(oauthProviders).where(eq(oauthProviders.id, providerId)).get();
    if (!provider || !provider.enabled) {
      throw new Error('OAuth provider not found or disabled');
    }

    const endpoints = await this.getEndpoints(provider);
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = createCodeChallenge(codeVerifier);
    const state = randomBytes(16).toString('hex');

    // Store flow state for the callback
    this.flowStates.set(state, {
      state: {
        providerId,
        codeVerifier,
        redirectUri: appRedirect?.redirectUri,
        state: appRedirect?.state,
      },
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 min
    });

    // Cleanup expired states
    this.cleanupExpiredStates();

    const scopes = endpoints.scopes;
    const params = new URLSearchParams({
      client_id: provider.clientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    // GitHub doesn't support PKCE, remove it
    if (provider.type === 'github') {
      params.delete('code_challenge');
      params.delete('code_challenge_method');
    }

    return `${endpoints.authorizationUrl}?${params.toString()}`;
  }

  /**
   * Handle the OAuth callback — exchange code for tokens, get user info,
   * create/link the local user, return the user and optional app redirect.
   */
  async handleCallback(
    stateParam: string,
    code: string,
    callbackUrl: string,
  ): Promise<{
    user: Omit<User, 'passwordHash'>;
    appRedirect?: { redirectUri: string; state?: string };
  }> {
    // Look up and validate flow state
    const flowEntry = this.flowStates.get(stateParam);
    if (!flowEntry || flowEntry.expiresAt < Date.now()) {
      this.flowStates.delete(stateParam);
      throw new Error('Invalid or expired OAuth state');
    }
    const flowState = flowEntry.state;
    this.flowStates.delete(stateParam);

    const provider = this.db.select().from(oauthProviders).where(eq(oauthProviders.id, flowState.providerId)).get();
    if (!provider) {
      throw new Error('OAuth provider not found');
    }

    const endpoints = await this.getEndpoints(provider);
    const clientSecret = this.encryption.decrypt(provider.encryptedClientSecret);

    // Exchange code for tokens
    const tokenBody: Record<string, string> = {
      client_id: provider.clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: callbackUrl,
      grant_type: 'authorization_code',
    };

    // Add PKCE verifier (except GitHub which doesn't support it)
    if (provider.type !== 'github') {
      tokenBody.code_verifier = flowState.codeVerifier;
    }

    const tokenHeaders: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };

    const tokenResponse = await fetch(endpoints.tokenUrl, {
      method: 'POST',
      headers: tokenHeaders,
      body: new URLSearchParams(tokenBody).toString(),
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      log.error(`OAuth token exchange failed: ${tokenResponse.status} ${errText}`);
      throw new Error('Failed to exchange OAuth code for tokens');
    }

    const tokens = await tokenResponse.json() as { access_token: string; id_token?: string; token_type?: string };

    // Get user info
    const userInfo = await this.getUserInfo(provider.type as OAuthProviderType, endpoints, tokens.access_token);

    // Create or link user
    const user = await this.findOrCreateUser(provider.type as OAuthProviderType, userInfo);

    const result: { user: Omit<User, 'passwordHash'>; appRedirect?: { redirectUri: string; state?: string } } = {
      user,
    };

    if (flowState.redirectUri) {
      result.appRedirect = {
        redirectUri: flowState.redirectUri,
        state: flowState.state,
      };
    }

    return result;
  }

  // ── Internal helpers ────────────────────────────────────────────────

  private async getEndpoints(provider: OauthProvider): Promise<OAuthEndpoints> {
    const type = provider.type as OAuthProviderType;

    if (type !== 'oidc' && WELL_KNOWN_ENDPOINTS[type]) {
      const endpoints = { ...WELL_KNOWN_ENDPOINTS[type] };

      // Microsoft: support custom tenant
      if (type === 'microsoft') {
        const config = provider.config ? JSON.parse(provider.config) : {};
        const tenant = config.tenant || 'common';
        endpoints.authorizationUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`;
        endpoints.tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
      }

      return endpoints;
    }

    // OIDC — fetch from discovery document
    if (!provider.discoveryUrl) {
      throw new Error('OIDC provider requires a discovery URL');
    }

    const discoveryResponse = await fetch(provider.discoveryUrl);
    if (!discoveryResponse.ok) {
      throw new Error(`Failed to fetch OIDC discovery document: ${discoveryResponse.status}`);
    }
    const discovery = await discoveryResponse.json() as OIDCDiscovery;

    return {
      authorizationUrl: discovery.authorization_endpoint,
      tokenUrl: discovery.token_endpoint,
      userinfoUrl: discovery.userinfo_endpoint,
      scopes: ['openid', 'email', 'profile'],
    };
  }

  private async getUserInfo(
    type: OAuthProviderType,
    endpoints: OAuthEndpoints,
    accessToken: string,
  ): Promise<OAuthUserInfo> {
    const response = await fetch(endpoints.userinfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch user info: ${response.status}`);
    }

    const data = await response.json() as Record<string, unknown>;

    // Normalize based on provider
    switch (type) {
      case 'github':
        return {
          sub: String(data.id),
          email: data.email as string | undefined,
          name: data.name as string | undefined ?? data.login as string | undefined,
          picture: data.avatar_url as string | undefined,
          raw: data,
        };

      case 'google':
        return {
          sub: data.sub as string,
          email: data.email as string | undefined,
          name: data.name as string | undefined,
          picture: data.picture as string | undefined,
          raw: data,
        };

      case 'microsoft':
        return {
          sub: data.id as string,
          email: data.mail as string | undefined ?? data.userPrincipalName as string | undefined,
          name: data.displayName as string | undefined,
          picture: undefined, // MS Graph doesn't return photo URL directly
          raw: data,
        };

      case 'oidc':
      default:
        return {
          sub: data.sub as string ?? data.id as string ?? String(data),
          email: data.email as string | undefined,
          name: data.name as string | undefined ?? data.preferred_username as string | undefined,
          picture: data.picture as string | undefined,
          raw: data,
        };
    }
  }

  /**
   * For GitHub, the email may not be in the userinfo. Fetch it separately.
   */
  private async getGitHubEmail(accessToken: string): Promise<string | undefined> {
    try {
      const response = await fetch('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      if (!response.ok) return undefined;
      const emails = await response.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
      const primary = emails.find(e => e.primary && e.verified);
      return primary?.email ?? emails.find(e => e.verified)?.email;
    } catch {
      return undefined;
    }
  }

  /**
   * Find existing user by OAuth account link or email, or create a new user.
   * Links the OAuth account if needed.
   */
  private async findOrCreateUser(
    providerType: OAuthProviderType,
    userInfo: OAuthUserInfo,
  ): Promise<Omit<User, 'passwordHash'>> {
    // 1. Check if there's already an oauth_account link for this provider + sub
    const existingLink = this.db
      .select()
      .from(oauthAccounts)
      .where(
        and(
          eq(oauthAccounts.provider, providerType),
          eq(oauthAccounts.providerAccountId, userInfo.sub),
        ),
      )
      .get();

    if (existingLink) {
      const user = this.db.select().from(users).where(eq(users.id, existingLink.userId)).get();
      if (user) {
        // Update last login
        this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id)).run();
        // Update the oauth account profile
        this.db
          .update(oauthAccounts)
          .set({
            email: userInfo.email ?? existingLink.email,
            profile: JSON.stringify({ name: userInfo.name, picture: userInfo.picture }),
          })
          .where(eq(oauthAccounts.id, existingLink.id))
          .run();
        const { passwordHash: _, ...safe } = user;
        return safe;
      }
    }

    // 2. Check if there's an existing user with the same email
    if (userInfo.email) {
      const existingUser = this.db
        .select()
        .from(users)
        .where(eq(users.email, userInfo.email))
        .get();

      if (existingUser) {
        // Link the OAuth account to this existing user
        this.linkOAuthAccount(existingUser.id, providerType, userInfo);
        this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, existingUser.id)).run();
        const { passwordHash: _, ...safe } = existingUser;
        return safe;
      }
    }

    // 3. Create a new user
    const now = new Date();
    const allUsers = this.db.select().from(users).all();
    // First OAuth user becomes admin, subsequent become operator
    const role = allUsers.length === 0 ? 'admin' : 'operator';

    // Generate a unique username from email or provider info
    let username = userInfo.email?.split('@')[0] ?? userInfo.name?.toLowerCase().replace(/\s+/g, '.') ?? `${providerType}-user`;
    // Check for duplicates and add suffix if needed
    let suffix = 0;
    let candidateUsername = username;
    while (this.db.select().from(users).where(eq(users.username, candidateUsername)).get()) {
      suffix++;
      candidateUsername = `${username}${suffix}`;
    }
    username = candidateUsername;

    const newUser: NewUser = {
      id: generateId(),
      username,
      displayName: userInfo.name ?? null,
      email: userInfo.email ?? null,
      passwordHash: '', // OAuth users have no password
      role,
      enabled: true,
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    };

    this.db.insert(users).values(newUser).run();

    // Link the OAuth account
    this.linkOAuthAccount(newUser.id, providerType, userInfo);

    log.info(`Created new user ${username} via ${providerType} OAuth (role: ${role})`);
    const { passwordHash: _, ...safe } = newUser as User;
    return safe;
  }

  private linkOAuthAccount(userId: string, providerType: OAuthProviderType, userInfo: OAuthUserInfo): void {
    const newAccount: NewOauthAccount = {
      id: generateId(),
      userId,
      provider: providerType,
      providerAccountId: userInfo.sub,
      email: userInfo.email ?? null,
      profile: JSON.stringify({ name: userInfo.name, picture: userInfo.picture }),
      createdAt: new Date(),
    };
    this.db.insert(oauthAccounts).values(newAccount).run();
  }

  /** Get all OAuth accounts linked to a user */
  async getLinkedAccounts(userId: string): Promise<OauthAccount[]> {
    return this.db
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, userId))
      .all();
  }

  /** Unlink an OAuth account from a user */
  async unlinkAccount(accountId: string): Promise<boolean> {
    const existing = this.db.select().from(oauthAccounts).where(eq(oauthAccounts.id, accountId)).get();
    if (!existing) return false;
    this.db.delete(oauthAccounts).where(eq(oauthAccounts.id, accountId)).run();
    return true;
  }

  private cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [key, entry] of this.flowStates.entries()) {
      if (entry.expiresAt < now) {
        this.flowStates.delete(key);
      }
    }
  }
}
