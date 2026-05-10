import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { refreshAccessToken as refreshAnthropicToken } from '@openmgr/agent-auth-core';
import type { DrizzleDB } from '../db/index.js';
import { apiKeys } from '../db/schema.js';
import { EncryptionService } from './encryption.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('agent-auth');

export interface OAuthCredentials {
  type: 'oauth';
  refresh: string;
  access: string;
  expires: number;
  accountId?: string;
}

export interface ApiKeyCredentials {
  type: 'api';
  key: string;
}

export type AuthCredentials = OAuthCredentials | ApiKeyCredentials;

export interface AuthJson {
  [providerId: string]: AuthCredentials;
}

/**
 * Manages OAuth and API key credentials for LLM providers.
 *
 * Credentials are stored in the `api_keys` table's `encrypted_oauth` column,
 * encrypted with AES-256-GCM via the shared EncryptionService.
 */
export class AgentAuthService {
  private db: DrizzleDB;
  private encryption: EncryptionService;

  constructor(db: DrizzleDB, encryption: EncryptionService) {
    this.db = db;
    this.encryption = encryption;
  }

  async setProvider(providerId: string, credentials: AuthCredentials): Promise<void> {
    const encrypted = this.encryption.encrypt(JSON.stringify(credentials));
    const now = new Date();

    const existing = this.db.select().from(apiKeys).where(eq(apiKeys.providerId, providerId)).all();

    if (existing.length > 0) {
      this.db.update(apiKeys).set({
        encryptedOauth: encrypted,
        updatedAt: now,
      }).where(eq(apiKeys.providerId, providerId)).run();
    } else {
      // Provider row doesn't exist yet — create one with empty encryptedValues
      this.db.insert(apiKeys).values({
        id: uuidv4(),
        providerId,
        encryptedValues: this.encryption.encryptObject({}),
        encryptedOauth: encrypted,
        createdAt: now,
        updatedAt: now,
      }).run();
    }
  }

  async removeProvider(providerId: string): Promise<void> {
    const existing = this.db.select().from(apiKeys).where(eq(apiKeys.providerId, providerId)).all();
    if (existing.length > 0) {
      this.db.update(apiKeys).set({
        encryptedOauth: null,
        updatedAt: new Date(),
      }).where(eq(apiKeys.providerId, providerId)).run();
    }
  }

  async getProvider(providerId: string): Promise<AuthCredentials | undefined> {
    const rows = this.db.select().from(apiKeys).where(eq(apiKeys.providerId, providerId)).all();
    const row = rows[0];
    if (!row?.encryptedOauth) return undefined;

    try {
      return JSON.parse(this.encryption.decrypt(row.encryptedOauth)) as AuthCredentials;
    } catch {
      log.error(`Failed to decrypt OAuth credentials for provider: ${providerId}`);
      return undefined;
    }
  }

  async refreshOAuthToken(providerId: string): Promise<OAuthCredentials | null> {
    const credentials = await this.getProvider(providerId);
    if (!credentials || credentials.type !== 'oauth') {
      return null;
    }

    // Use the auth-core library for Anthropic OAuth refresh
    if (providerId === 'anthropic') {
      try {
        const tokens = await refreshAnthropicToken(credentials.refresh);
        const updated: OAuthCredentials = {
          type: 'oauth',
          refresh: tokens.refreshToken,
          access: tokens.accessToken,
          expires: tokens.expiresAt,
          accountId: credentials.accountId,
        };
        await this.setProvider(providerId, updated);
        return updated;
      } catch (error) {
        log.error(`OAuth refresh error for ${providerId}:`, error);
        return null;
      }
    }

    // Fallback for other providers (OpenAI, Google) that aren't yet in auth-core
    const endpoints: Record<string, string> = {
      openai: 'https://auth.openai.com/oauth/token',
      google: 'https://oauth2.googleapis.com/token',
    };

    const clientIds: Record<string, string> = {
      openai: 'app_EMoamEEZ73f0CkXaXp7hrann',
    };

    const endpoint = endpoints[providerId];
    const clientId = clientIds[providerId];
    
    if (!endpoint) {
      log.error(`No OAuth endpoint configured for provider: ${providerId}`);
      return null;
    }

    try {
      const body: Record<string, string> = {
        grant_type: 'refresh_token',
        refresh_token: credentials.refresh,
      };
      
      if (clientId) {
        body.client_id = clientId;
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        log.error(`OAuth refresh failed for ${providerId}: ${response.status} ${text}`);
        return null;
      }

      const json = await response.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
      };

      const updated: OAuthCredentials = {
        type: 'oauth',
        refresh: json.refresh_token ?? credentials.refresh,
        access: json.access_token,
        expires: Date.now() + json.expires_in * 1000,
        accountId: credentials.accountId,
      };

      await this.setProvider(providerId, updated);
      return updated;
    } catch (error) {
      log.error(`OAuth refresh error for ${providerId}:`, error);
      return null;
    }
  }

  async getValidAccessToken(providerId: string): Promise<string | null> {
    const credentials = await this.getProvider(providerId);
    if (!credentials) {
      return null;
    }

    if (credentials.type === 'api') {
      return credentials.key;
    }

    if (credentials.expires > Date.now() + 60000) {
      return credentials.access;
    }

    const refreshed = await this.refreshOAuthToken(providerId);
    return refreshed?.access ?? null;
  }
}
