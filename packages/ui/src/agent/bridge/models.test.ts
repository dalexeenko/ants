import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createModelMethods } from './models';
import type { BridgeDeps } from './types';
import type { ModelInfo, AuthStatus } from '../types';

// Mock modelsApi — use vi.hoisted so the variable is available to the hoisted vi.mock factory
const { mockProviders } = vi.hoisted(() => ({
  mockProviders: [
    {
      id: 'anthropic',
      name: 'Anthropic',
      models: [
        { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic' },
        { id: 'claude-haiku-35-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic' },
      ],
    },
    {
      id: 'openai',
      name: 'OpenAI',
      models: [
        { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
      ],
    },
    {
      id: 'google',
      name: 'Google',
      models: [
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google' },
      ],
    },
  ],
}));

vi.mock('../modelsApi', () => ({
  getAvailableProviders: vi.fn().mockResolvedValue(mockProviders),
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function createMockDeps(overrides: {
  authStatus?: Partial<AuthStatus>;
  hasApiKey?: (provider: string) => Promise<boolean>;
  remoteServer?: { url: string } | null;
  remoteFetchResponse?: any;
} = {}): BridgeDeps {
  const defaultAuthStatus: AuthStatus = {
    anthropic: { authenticated: false, method: undefined },
    openai: { hasApiKey: false },
    google: { hasApiKey: false },
  } as AuthStatus;

  const authStatus = { ...defaultAuthStatus, ...overrides.authStatus };
  const hasApiKeyFn = overrides.hasApiKey ?? vi.fn().mockResolvedValue(false);
  const remoteServer = overrides.remoteServer ?? null;

  return {
    config: {
      storage: {
        getAuthStatus: vi.fn().mockResolvedValue(authStatus),
        hasApiKey: hasApiKeyFn,
      },
    },
    state: {
      localAgents: new Map(),
      sessionModelOverrides: new Map(),
    },
    helpers: {
      getRemoteServerForProject: vi.fn().mockReturnValue(remoteServer),
      remoteFetch: overrides.remoteFetchResponse
        ? vi.fn().mockResolvedValue(overrides.remoteFetchResponse)
        : vi.fn(),
    },
  } as unknown as BridgeDeps;
}

describe('createModelMethods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getModels - credential filtering', () => {
    it('should return no models when no providers have credentials', async () => {
      const deps = createMockDeps();
      const methods = createModelMethods(deps);
      const models = await methods.getModels('proj-1');
      expect(models).toHaveLength(0);
    });

    it('should return only anthropic models when only anthropic has credentials via OAuth', async () => {
      const deps = createMockDeps({
        authStatus: {
          anthropic: { authenticated: true, method: 'oauth' },
        } as Partial<AuthStatus>,
      });
      const methods = createModelMethods(deps);
      const models = await methods.getModels('proj-1');
      expect(models).toHaveLength(2);
      expect(models.every((m: ModelInfo) => m.provider === 'anthropic')).toBe(true);
    });

    it('should return anthropic models when only anthropic has API key via storage', async () => {
      const deps = createMockDeps({
        hasApiKey: vi.fn().mockImplementation(async (provider: string) => provider === 'anthropic'),
      });
      const methods = createModelMethods(deps);
      const models = await methods.getModels('proj-1');
      expect(models).toHaveLength(2);
      expect(models.every((m: ModelInfo) => m.provider === 'anthropic')).toBe(true);
    });

    it('should return openai models when openai has hasApiKey in auth status', async () => {
      const deps = createMockDeps({
        authStatus: {
          openai: { hasApiKey: true },
        } as Partial<AuthStatus>,
      });
      const methods = createModelMethods(deps);
      const models = await methods.getModels('proj-1');
      expect(models).toHaveLength(1);
      expect(models[0].provider).toBe('openai');
    });

    it('should return openai models when openai has key via storage.hasApiKey fallback', async () => {
      const deps = createMockDeps({
        hasApiKey: vi.fn().mockImplementation(async (provider: string) => provider === 'openai'),
      });
      const methods = createModelMethods(deps);
      const models = await methods.getModels('proj-1');
      expect(models).toHaveLength(1);
      expect(models[0].provider).toBe('openai');
    });

    it('should return models from multiple providers that have credentials', async () => {
      const deps = createMockDeps({
        authStatus: {
          anthropic: { authenticated: true, method: 'apikey' },
          openai: { hasApiKey: true },
        } as Partial<AuthStatus>,
      });
      const methods = createModelMethods(deps);
      const models = await methods.getModels('proj-1');
      expect(models).toHaveLength(3); // 2 anthropic + 1 openai
      const providers = new Set(models.map((m: ModelInfo) => m.provider));
      expect(providers).toContain('anthropic');
      expect(providers).toContain('openai');
      expect(providers).not.toContain('google');
    });

    it('should return all models when all providers have credentials', async () => {
      const deps = createMockDeps({
        authStatus: {
          anthropic: { authenticated: true, method: 'apikey' },
          openai: { hasApiKey: true },
          google: { hasApiKey: true },
        } as Partial<AuthStatus>,
      });
      const methods = createModelMethods(deps);
      const models = await methods.getModels('proj-1');
      expect(models).toHaveLength(4); // 2 anthropic + 1 openai + 1 google
    });

    it('should skip providers not in auth status and without storage key', async () => {
      // google has no entry in authStatus and hasApiKey returns false
      const deps = createMockDeps({
        authStatus: {
          anthropic: { authenticated: true, method: 'apikey' },
          openai: { hasApiKey: true },
          // google not specified
        } as Partial<AuthStatus>,
      });
      const methods = createModelMethods(deps);
      const models = await methods.getModels('proj-1');
      expect(models.some((m: ModelInfo) => m.provider === 'google')).toBe(false);
    });
  });

  describe('getModels - remote server bypass', () => {
    it('should return remote models without credential filtering', async () => {
      const remoteModels = [
        { id: 'remote-model-1', name: 'Remote Model 1', provider: 'custom' },
        { id: 'remote-model-2', name: 'Remote Model 2', provider: 'custom' },
      ];
      const deps = createMockDeps({
        remoteServer: { url: 'https://remote.example.com' },
        remoteFetchResponse: {
          ok: true,
          json: vi.fn().mockResolvedValue({ models: remoteModels }),
        },
      });
      const methods = createModelMethods(deps);
      const models = await methods.getModels('proj-1');
      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('remote-model-1');
    });

    it('should fall back to local models if remote fetch fails', async () => {
      const deps = createMockDeps({
        remoteServer: { url: 'https://remote.example.com' },
        remoteFetchResponse: { ok: false, status: 500 },
        authStatus: {
          anthropic: { authenticated: true, method: 'apikey' },
        } as Partial<AuthStatus>,
      });
      const methods = createModelMethods(deps);
      const models = await methods.getModels('proj-1');
      // Should fall through to local models since remote failed
      expect(models).toHaveLength(2);
      expect(models.every((m: ModelInfo) => m.provider === 'anthropic')).toBe(true);
    });
  });

  describe('session model overrides', () => {
    it('should return null when no session model override exists', async () => {
      const deps = createMockDeps();
      const methods = createModelMethods(deps);
      const model = await methods.getSessionModel('proj-1', 'session-1');
      expect(model).toBeNull();
    });

    it('should store and retrieve session model override', async () => {
      const deps = createMockDeps();
      const methods = createModelMethods(deps);
      await methods.setSessionModel('proj-1', 'session-1', 'openai', 'gpt-4o');
      const model = await methods.getSessionModel('proj-1', 'session-1');
      expect(model).toEqual({ provider: 'openai', model: 'gpt-4o' });
    });

    it('should clear session model override', async () => {
      const deps = createMockDeps();
      const methods = createModelMethods(deps);
      await methods.setSessionModel('proj-1', 'session-1', 'openai', 'gpt-4o');
      await methods.clearSessionModel('proj-1', 'session-1');
      const model = await methods.getSessionModel('proj-1', 'session-1');
      expect(model).toBeNull();
    });
  });
});
