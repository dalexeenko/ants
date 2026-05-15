import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import type { DrizzleDB } from '../db/index.js';
import { apiKeys, customEnvVars } from '../db/schema.js';
import { EncryptionService, maskSecret } from './encryption.js';
import { AgentAuthService, type AuthCredentials, type OAuthCredentials } from './agent-auth.js';

export type AuthMethod = 'api_key' | 'oauth';

export interface ApiKeyField {
  envVar: string;
  label: string;
  placeholder?: string;
  required: boolean;
}

export interface ProviderDefinition {
  id: string;
  name: string;
  fields: ApiKeyField[];
  docsUrl: string;
  supportsOAuth?: boolean;
}

export interface MaskedValue {
  isSet: boolean;
  masked: string | null;
}

export interface ProviderStatus {
  id: string;
  name: string;
  fields: ApiKeyField[];
  docsUrl: string;
  supportsOAuth?: boolean;
  isConfigured: boolean;
  hasApiKey: boolean;
  authMethod?: AuthMethod;
  values: Record<string, MaskedValue>;
  oauth?: {
    hasRefreshToken: boolean;
    expiresAt?: number;
  };
}

export interface CustomEnvVarStatus {
  id: string;
  name: string;
  envVar: string;
  value: MaskedValue;
}

export interface ApiKeysResponse {
  providers: ProviderStatus[];
  custom: CustomEnvVarStatus[];
  pendingRestart: boolean;
}

const PROVIDERS: ProviderDefinition[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    docsUrl: 'https://docs.anthropic.com/en/api/getting-started',
    supportsOAuth: true,
    fields: [
      { envVar: 'ANTHROPIC_API_KEY', label: 'API Key', placeholder: 'sk-ant-...', required: true }
    ]
  },
  {
    id: 'openai',
    name: 'OpenAI',
    docsUrl: 'https://platform.openai.com/docs/api-reference',
    supportsOAuth: true,
    fields: [
      { envVar: 'OPENAI_API_KEY', label: 'API Key', placeholder: 'sk-...', required: true }
    ]
  },
  {
    id: 'google',
    name: 'Google AI',
    docsUrl: 'https://ai.google.dev/docs',
    fields: [
      { envVar: 'GOOGLE_API_KEY', label: 'API Key', required: true }
    ]
  },
  {
    id: 'xai',
    name: 'xAI',
    docsUrl: 'https://docs.x.ai/',
    fields: [
      { envVar: 'XAI_API_KEY', label: 'API Key', required: true }
    ]
  },
  {
    id: 'aws-bedrock',
    name: 'AWS Bedrock',
    docsUrl: 'https://docs.aws.amazon.com/bedrock/',
    fields: [
      { envVar: 'AWS_ACCESS_KEY_ID', label: 'Access Key ID', placeholder: 'AKIA...', required: true },
      { envVar: 'AWS_SECRET_ACCESS_KEY', label: 'Secret Access Key', required: true },
      { envVar: 'AWS_REGION', label: 'Region', placeholder: 'us-east-1', required: false }
    ]
  },
  {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/ai-services/openai/',
    fields: [
      { envVar: 'AZURE_OPENAI_API_KEY', label: 'API Key', required: true },
      { envVar: 'AZURE_OPENAI_ENDPOINT', label: 'Endpoint', placeholder: 'https://xxx.openai.azure.com', required: true },
      { envVar: 'AZURE_RESOURCE_NAME', label: 'Resource Name', required: false }
    ]
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    docsUrl: 'https://openrouter.ai/docs',
    fields: [
      { envVar: 'OPENROUTER_API_KEY', label: 'API Key', placeholder: 'sk-or-...', required: true }
    ]
  },
  {
    id: 'groq',
    name: 'Groq',
    docsUrl: 'https://console.groq.com/docs',
    fields: [
      { envVar: 'GROQ_API_KEY', label: 'API Key', required: true }
    ]
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    docsUrl: 'https://platform.deepseek.com/api-docs',
    fields: [
      { envVar: 'DEEPSEEK_API_KEY', label: 'API Key', required: true }
    ]
  },
  {
    id: 'google-vertex',
    name: 'Google Vertex AI',
    docsUrl: 'https://cloud.google.com/vertex-ai/docs',
    fields: [
      { envVar: 'GOOGLE_APPLICATION_CREDENTIALS', label: 'Service Account Key Path', required: true }
    ]
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    docsUrl: 'https://docs.mistral.ai/',
    fields: [
      { envVar: 'MISTRAL_API_KEY', label: 'API Key', required: true }
    ]
  },
  {
    id: 'cohere',
    name: 'Cohere',
    docsUrl: 'https://docs.cohere.com/',
    fields: [
      { envVar: 'COHERE_API_KEY', label: 'API Key', required: true }
    ]
  },
  {
    id: 'together',
    name: 'Together AI',
    docsUrl: 'https://docs.together.ai/',
    fields: [
      { envVar: 'TOGETHER_API_KEY', label: 'API Key', required: true }
    ]
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    docsUrl: 'https://docs.fireworks.ai/',
    fields: [
      { envVar: 'FIREWORKS_API_KEY', label: 'API Key', required: true }
    ]
  },
];

export class ApiKeyManager {
  private db: DrizzleDB;
  private encryption: EncryptionService;
  private agentAuth: AgentAuthService;
  private _pendingRestart: boolean = false;

  constructor(db: DrizzleDB, encryption: EncryptionService) {
    this.db = db;
    this.encryption = encryption;
    this.agentAuth = new AgentAuthService(db, encryption);
  }

  get pendingRestart(): boolean {
    return this._pendingRestart;
  }

  clearPendingRestart(): void {
    this._pendingRestart = false;
  }

  getProviderDefinitions(): ProviderDefinition[] {
    return PROVIDERS;
  }

  async listApiKeys(): Promise<ApiKeysResponse> {
    const rows = this.db.select().from(apiKeys).all();
    const customRows = this.db.select().from(customEnvVars).all();

    const configuredProviders = new Map<string, Record<string, string>>();
    for (const row of rows) {
      try {
        const decrypted = this.encryption.decryptObject(row.encryptedValues);
        configuredProviders.set(row.providerId, decrypted);
      } catch {
        continue;
      }
    }

    const providers: ProviderStatus[] = await Promise.all(PROVIDERS.map(async (provider) => {
      const values = configuredProviders.get(provider.id);
      const maskedValues: Record<string, MaskedValue> = {};
      
      for (const field of provider.fields) {
        const value = values?.[field.envVar];
        maskedValues[field.envVar] = {
          isSet: !!value,
          masked: value ? maskSecret(value) : null,
        };
      }

      const requiredFields = provider.fields.filter(f => f.required);
      const hasApiKey = requiredFields.every(f => values?.[f.envVar]);
      
      const oauthCreds = provider.supportsOAuth ? await this.agentAuth.getProvider(provider.id) : undefined;
      const hasOAuth = oauthCreds?.type === 'oauth' && !!oauthCreds.refresh;
      
      const isConfigured = hasApiKey || hasOAuth;
      const authMethod: AuthMethod | undefined = hasOAuth ? 'oauth' : (hasApiKey ? 'api_key' : undefined);

      return {
        ...provider,
        isConfigured,
        hasApiKey,
        authMethod,
        values: maskedValues,
        oauth: provider.supportsOAuth ? {
          hasRefreshToken: hasOAuth,
          expiresAt: oauthCreds?.type === 'oauth' ? oauthCreds.expires : undefined,
        } : undefined,
      };
    }));

    const custom: CustomEnvVarStatus[] = customRows.map(row => {
      let decryptedValue: string | null = null;
      try {
        decryptedValue = this.encryption.decrypt(row.encryptedValue);
      } catch {
        // ignore
      }

      return {
        id: row.id,
        name: row.name,
        envVar: row.envVar,
        value: {
          isSet: !!decryptedValue,
          masked: decryptedValue ? maskSecret(decryptedValue) : null,
        },
      };
    });

    return {
      providers,
      custom,
      pendingRestart: this._pendingRestart,
    };
  }

  async getProviderKeys(providerId: string): Promise<{
    keys: Record<string, MaskedValue>;
    oauth?: {
      configured: boolean;
      hasRefreshToken: boolean;
      expiresAt?: number;
    };
  } | null> {
    const provider = PROVIDERS.find(p => p.id === providerId);
    if (!provider) {
      return null;
    }

    const rows = this.db.select().from(apiKeys).where(eq(apiKeys.providerId, providerId)).all();
    
    const keys: Record<string, MaskedValue> = {};
    
    if (rows.length === 0) {
      for (const field of provider.fields) {
        keys[field.envVar] = { isSet: false, masked: null };
      }
    } else {
      try {
        const values = this.encryption.decryptObject(rows[0].encryptedValues);
        for (const field of provider.fields) {
          const value = values[field.envVar];
          keys[field.envVar] = {
            isSet: !!value,
            masked: value ? maskSecret(value) : null,
          };
        }
      } catch {
        for (const field of provider.fields) {
          keys[field.envVar] = { isSet: false, masked: null };
        }
      }
    }

    // Include OAuth status if the provider supports it
    let oauth: { configured: boolean; hasRefreshToken: boolean; expiresAt?: number } | undefined;
    if (provider.supportsOAuth) {
      const oauthCreds = await this.agentAuth.getProvider(providerId);
      const hasOAuth = oauthCreds?.type === 'oauth' && !!oauthCreds.refresh;
      oauth = {
        configured: hasOAuth,
        hasRefreshToken: hasOAuth,
        expiresAt: oauthCreds?.type === 'oauth' ? oauthCreds.expires : undefined,
      };
    }

    return { keys, oauth };
  }

  async setProviderKeys(providerId: string, values: Record<string, string>): Promise<{ success: boolean; values: Record<string, MaskedValue> }> {
    const provider = PROVIDERS.find(p => p.id === providerId);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    const encrypted = this.encryption.encryptObject(values);
    const now = new Date();

    const existing = this.db.select().from(apiKeys).where(eq(apiKeys.providerId, providerId)).all();

    if (existing.length > 0) {
      this.db.update(apiKeys).set({
        encryptedValues: encrypted,
        updatedAt: now,
      }).where(eq(apiKeys.providerId, providerId)).run();
    } else {
      this.db.insert(apiKeys).values({
        id: uuidv4(),
        providerId,
        encryptedValues: encrypted,
        createdAt: now,
        updatedAt: now,
      }).run();
    }

    this._pendingRestart = true;

    const maskedValues: Record<string, MaskedValue> = {};
    for (const field of provider.fields) {
      const value = values[field.envVar];
      maskedValues[field.envVar] = {
        isSet: !!value,
        masked: value ? maskSecret(value) : null,
      };
    }

    return { success: true, values: maskedValues };
  }

  async deleteProviderKeys(providerId: string): Promise<boolean> {
    const result = this.db.delete(apiKeys).where(eq(apiKeys.providerId, providerId)).run();
    await this.agentAuth.removeProvider(providerId);
    if (result.changes > 0) {
      this._pendingRestart = true;
      return true;
    }
    return false;
  }

  async setOAuthCredentials(
    providerId: string,
    credentials: { refresh: string; access: string; expires: number; accountId?: string }
  ): Promise<{ success: boolean; expiresAt: number }> {
    const provider = PROVIDERS.find(p => p.id === providerId);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }
    if (!provider.supportsOAuth) {
      throw new Error(`Provider ${providerId} does not support OAuth`);
    }

    await this.agentAuth.setProvider(providerId, {
      type: 'oauth',
      refresh: credentials.refresh,
      access: credentials.access,
      expires: credentials.expires,
      accountId: credentials.accountId,
    });

    this._pendingRestart = true;

    return { success: true, expiresAt: credentials.expires };
  }

  async getOAuthCredentials(providerId: string): Promise<AuthCredentials | undefined> {
    return this.agentAuth.getProvider(providerId);
  }

  async deleteOAuthCredentials(providerId: string): Promise<boolean> {
    const existing = await this.agentAuth.getProvider(providerId);
    if (existing?.type === 'oauth') {
      await this.agentAuth.removeProvider(providerId);
      this._pendingRestart = true;
      return true;
    }
    return false;
  }

  async refreshOAuthToken(providerId: string): Promise<{ success: boolean; expiresAt?: number }> {
    const refreshed = await this.agentAuth.refreshOAuthToken(providerId);
    if (refreshed) {
      this._pendingRestart = true;
      return { success: true, expiresAt: refreshed.expires };
    }
    return { success: false };
  }

  async listCustomEnvVars(): Promise<CustomEnvVarStatus[]> {
    const rows = this.db.select().from(customEnvVars).all();
    
    return rows.map(row => {
      let decryptedValue: string | null = null;
      try {
        decryptedValue = this.encryption.decrypt(row.encryptedValue);
      } catch {
        // ignore
      }

      return {
        id: row.id,
        name: row.name,
        envVar: row.envVar,
        value: {
          isSet: !!decryptedValue,
          masked: decryptedValue ? maskSecret(decryptedValue) : null,
        },
      };
    });
  }

  async createCustomEnvVar(name: string, envVar: string, value: string): Promise<CustomEnvVarStatus> {
    const id = uuidv4();
    const now = new Date();
    const encrypted = this.encryption.encrypt(value);

    this.db.insert(customEnvVars).values({
      id,
      name,
      envVar,
      encryptedValue: encrypted,
      createdAt: now,
      updatedAt: now,
    }).run();

    this._pendingRestart = true;

    return {
      id,
      name,
      envVar,
      value: {
        isSet: true,
        masked: maskSecret(value),
      },
    };
  }

  async updateCustomEnvVar(id: string, updates: { name?: string; value?: string }): Promise<CustomEnvVarStatus | null> {
    const rows = this.db.select().from(customEnvVars).where(eq(customEnvVars.id, id)).all();
    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    const updateData: Partial<typeof customEnvVars.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (updates.name !== undefined) {
      updateData.name = updates.name;
    }
    if (updates.value !== undefined) {
      updateData.encryptedValue = this.encryption.encrypt(updates.value);
      this._pendingRestart = true;
    }

    this.db.update(customEnvVars).set(updateData).where(eq(customEnvVars.id, id)).run();

    let currentValue: string | null = null;
    try {
      currentValue = updates.value ?? this.encryption.decrypt(row.encryptedValue);
    } catch {
      // ignore
    }

    return {
      id,
      name: updates.name ?? row.name,
      envVar: row.envVar,
      value: {
        isSet: !!currentValue,
        masked: currentValue ? maskSecret(currentValue) : null,
      },
    };
  }

  async deleteCustomEnvVar(id: string): Promise<boolean> {
    const result = this.db.delete(customEnvVars).where(eq(customEnvVars.id, id)).run();
    if (result.changes > 0) {
      this._pendingRestart = true;
      return true;
    }
    return false;
  }

  async getAllEnvVars(): Promise<Record<string, string>> {
    const result: Record<string, string> = {};

    const apiKeyRows = this.db.select().from(apiKeys).all();
    for (const row of apiKeyRows) {
      try {
        const values = this.encryption.decryptObject(row.encryptedValues);
        Object.assign(result, values);
      } catch {
        continue;
      }
    }

    const customRows = this.db.select().from(customEnvVars).all();
    for (const row of customRows) {
      try {
        result[row.envVar] = this.encryption.decrypt(row.encryptedValue);
      } catch {
        continue;
      }
    }

    return result;
  }

  /**
   * Returns true if any provider has usable credentials — a stored API key,
   * a stored OAuth refresh token, or the corresponding env var present in
   * `process.env` (which agents inherit from the server process).
   */
  async hasAnyProviderCredentials(): Promise<boolean> {
    const status = await this.listApiKeys();
    if (status.providers.some(p => p.isConfigured)) return true;
    for (const provider of status.providers) {
      for (const field of provider.fields) {
        if (field.required && process.env[field.envVar]) return true;
      }
    }
    return false;
  }
}
