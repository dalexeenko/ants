import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// ---------- helpers ----------

/** Minimal valid API response with one provider and one model. */
function makeApiResponse(overrides?: Record<string, unknown>) {
  return {
    anthropic: {
      id: 'anthropic',
      name: 'Anthropic',
      models: {
        'claude-sonnet-4-20250514': {
          id: 'claude-sonnet-4-20250514',
          name: 'Claude Sonnet 4',
          family: 'claude',
          cost: { input: 3, output: 15 },
          limit: { context: 200000, output: 8192 },
          modalities: { input: ['text', 'image'], output: ['text'] },
          tool_call: true,
          reasoning: false,
          release_date: '2025-05-14',
        },
      },
    },
    ...overrides,
  };
}

/** Create a minimal Response-like object for fetch mocking. */
function mockResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  const { status = 200, headers = {} } = init;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

// ---------- test suite ----------

describe('modelsApi', () => {
  let fetchMock: Mock;

  // We re-import the module for every test so the module-level cache
  // (`cachedProviders`, `cachedEtag`, etc.) is reset.
  async function loadModule() {
    const mod = await import('../modelsApi');
    return mod;
  }

  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  // ---- 1. Fetching models from the API ----

  describe('getAvailableProviders', () => {
    it('fetches and parses providers from the API', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(makeApiResponse(), {
          headers: { etag: '"abc123"' },
        }),
      );

      const { getAvailableProviders } = await loadModule();
      const providers = await getAvailableProviders();

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledWith('https://models.dev/api.json', {
        headers: {},
      });

      expect(providers).toHaveLength(1);
      expect(providers[0].id).toBe('anthropic');
      expect(providers[0].name).toBe('Anthropic');
      expect(providers[0].models).toHaveLength(1);
      expect(providers[0].models[0]).toMatchObject({
        id: 'claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        provider: 'anthropic',
        contextLength: 200000,
      });
    });

    it('only includes supported providers', async () => {
      const response = makeApiResponse({
        unsupported_provider: {
          id: 'unsupported_provider',
          name: 'Unsupported',
          models: {
            'model-1': {
              id: 'model-1',
              name: 'Model One',
              modalities: { output: ['text'] },
            },
          },
        },
      });

      fetchMock.mockResolvedValueOnce(mockResponse(response));

      const { getAvailableProviders, SUPPORTED_PROVIDER_IDS } =
        await loadModule();
      const providers = await getAvailableProviders();

      for (const p of providers) {
        expect(SUPPORTED_PROVIDER_IDS).toContain(p.id);
      }
      expect(providers.find((p) => p.id === 'unsupported_provider')).toBeUndefined();
    });

    it('filters out models without text output modality', async () => {
      const response = {
        anthropic: {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'text-model': {
              id: 'text-model',
              name: 'Text Model',
              modalities: { output: ['text'] },
            },
            'embedding-model': {
              id: 'embedding-model',
              name: 'Embedding Model',
              modalities: { output: ['embedding'] },
            },
          },
        },
      };

      fetchMock.mockResolvedValueOnce(mockResponse(response));

      const { getAvailableProviders } = await loadModule();
      const providers = await getAvailableProviders();

      expect(providers).toHaveLength(1);
      const models = providers[0].models;
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('text-model');
    });

    it('includes models with no modalities (defaults to text)', async () => {
      const response = {
        openai: {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-4o': {
              id: 'gpt-4o',
              name: 'GPT-4o',
              // no modalities field
            },
          },
        },
      };

      fetchMock.mockResolvedValueOnce(mockResponse(response));

      const { getAvailableProviders } = await loadModule();
      const providers = await getAvailableProviders();
      const openai = providers.find((p) => p.id === 'openai');
      expect(openai).toBeDefined();
      expect(openai!.models).toHaveLength(1);
    });

    it('skips providers with no models after filtering', async () => {
      const response = {
        groq: {
          id: 'groq',
          name: 'Groq',
          models: {
            'embed-only': {
              id: 'embed-only',
              name: 'Embed Only',
              modalities: { output: ['embedding'] },
            },
          },
        },
      };

      fetchMock.mockResolvedValueOnce(mockResponse(response));

      const { getAvailableProviders } = await loadModule();
      const providers = await getAvailableProviders();
      expect(providers.find((p) => p.id === 'groq')).toBeUndefined();
    });
  });

  describe('getAllModels', () => {
    it('returns a flat list of models across all providers', async () => {
      const response = {
        anthropic: {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-1': { id: 'claude-1', name: 'Claude 1', modalities: { output: ['text'] } },
          },
        },
        openai: {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o', modalities: { output: ['text'] } },
          },
        },
      };

      fetchMock.mockResolvedValueOnce(mockResponse(response));

      const { getAllModels } = await loadModule();
      const models = await getAllModels();

      expect(models).toHaveLength(2);
      expect(models.map((m) => m.id)).toEqual(
        expect.arrayContaining(['claude-1', 'gpt-4o']),
      );
    });
  });

  describe('getModelsForProvider', () => {
    it('returns models for a specific provider', async () => {
      const response = {
        anthropic: {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-1': { id: 'claude-1', name: 'Claude 1', modalities: { output: ['text'] } },
          },
        },
        openai: {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o', modalities: { output: ['text'] } },
          },
        },
      };

      fetchMock.mockResolvedValueOnce(mockResponse(response));

      const { getModelsForProvider } = await loadModule();
      const models = await getModelsForProvider('openai');

      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('gpt-4o');
    });

    it('returns empty array for unknown provider', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(makeApiResponse()));

      const { getModelsForProvider } = await loadModule();
      const models = await getModelsForProvider('nonexistent');

      expect(models).toEqual([]);
    });
  });

  // ---- 2. ETag caching (304 responses) ----

  describe('ETag caching', () => {
    it('sends If-None-Match header when ETag is cached', async () => {
      // First fetch - populates cache and ETag
      fetchMock.mockResolvedValueOnce(
        mockResponse(makeApiResponse(), {
          headers: { etag: '"etag-v1"' },
        }),
      );

      const { getAvailableProviders, refreshModels } = await loadModule();
      await getAvailableProviders();

      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Second fetch via refreshModels (bypasses staleness timer)
      // Note: refreshModels nulls cachedEtag to force a fresh fetch,
      // so If-None-Match won't be sent. We need to test the stale path instead.
      // Let's manually trigger a stale revalidation by advancing time.
      fetchMock.mockResolvedValueOnce(
        mockResponse(null, { status: 304 }),
      );

      // refreshModels clears the etag, so use a different approach:
      // advance time to make cache stale, then call getAvailableProviders
      vi.useFakeTimers();
      vi.advanceTimersByTime(6 * 60 * 1000); // 6 minutes > 5 min STALE_MS

      // Call getAvailableProviders - since cache is stale, it kicks off background revalidation
      const staleResult = await getAvailableProviders();
      expect(staleResult).toHaveLength(1); // returns stale cache immediately

      // Wait for the background fetch to complete
      await vi.runAllTimersAsync();
      vi.useRealTimers();

      // The background fetch should have sent If-None-Match
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][1]).toEqual({
        headers: { 'If-None-Match': '"etag-v1"' },
      });
    });

    it('returns cached data on 304 Not Modified', async () => {
      // First fetch
      fetchMock.mockResolvedValueOnce(
        mockResponse(makeApiResponse(), {
          headers: { etag: '"etag-v1"' },
        }),
      );

      const { getAvailableProviders } = await loadModule();
      const first = await getAvailableProviders();

      // Advance time to make stale
      vi.useFakeTimers();
      vi.advanceTimersByTime(6 * 60 * 1000);

      // Return 304
      fetchMock.mockResolvedValueOnce(
        mockResponse(null, { status: 304 }),
      );

      // Stale path: returns cache immediately and does background revalidation
      const second = await getAvailableProviders();

      // Wait for background fetch
      await vi.runAllTimersAsync();
      vi.useRealTimers();

      // Both calls should return the same data
      expect(second).toEqual(first);
    });

    it('returns fresh cache within STALE_MS without re-fetching', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(makeApiResponse()));

      const { getAvailableProviders } = await loadModule();
      await getAvailableProviders();

      // Second call should use cache (no new fetch)
      const second = await getAvailableProviders();

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(second).toHaveLength(1);
    });
  });

  // ---- 3. Error handling ----

  describe('error handling', () => {
    it('returns fallback providers on network error (no cache)', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const { getAvailableProviders } = await loadModule();
      const providers = await getAvailableProviders();

      // Should return the hardcoded fallback
      expect(providers.length).toBeGreaterThan(0);
      expect(providers.find((p) => p.id === 'anthropic')).toBeDefined();
      expect(providers.find((p) => p.id === 'openai')).toBeDefined();
    });

    it('returns cached data on network error when cache exists', async () => {
      // First fetch succeeds
      fetchMock.mockResolvedValueOnce(mockResponse(makeApiResponse()));

      const { getAvailableProviders, refreshModels } = await loadModule();
      const first = await getAvailableProviders();

      // Force refresh that fails
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await refreshModels();
      expect(result).toEqual(first);
    });

    it('returns fallback on non-ok HTTP status (no cache)', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(null, { status: 500 }),
      );

      const { getAvailableProviders } = await loadModule();
      const providers = await getAvailableProviders();

      // Should return fallback
      expect(providers.length).toBeGreaterThan(0);
      expect(providers.find((p) => p.id === 'anthropic')).toBeDefined();
    });

    it('returns cached data on non-ok HTTP status when cache exists', async () => {
      // First fetch succeeds
      fetchMock.mockResolvedValueOnce(mockResponse(makeApiResponse()));

      const { getAvailableProviders, refreshModels } = await loadModule();
      const first = await getAvailableProviders();

      // Force refresh that returns 500
      fetchMock.mockResolvedValueOnce(
        mockResponse(null, { status: 500 }),
      );

      const result = await refreshModels();
      expect(result).toEqual(first);
    });

    it('handles invalid JSON gracefully', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      } as unknown as Response);

      const { getAvailableProviders } = await loadModule();
      const providers = await getAvailableProviders();

      // Falls into catch block, returns fallback
      expect(providers.length).toBeGreaterThan(0);
    });

    it('logs a warning on network error', async () => {
      const warnSpy = vi.spyOn(console, 'warn');
      fetchMock.mockRejectedValueOnce(new Error('timeout'));

      const { getAvailableProviders } = await loadModule();
      await getAvailableProviders();

      expect(warnSpy).toHaveBeenCalledWith(
        '[WARN] [modelsApi]',
        'Network error fetching models.dev:',
        expect.any(Error),
      );
    });

    it('logs a warning on non-ok status', async () => {
      const warnSpy = vi.spyOn(console, 'warn');
      fetchMock.mockResolvedValueOnce(
        mockResponse(null, { status: 503 }),
      );

      const { getAvailableProviders } = await loadModule();
      await getAvailableProviders();

      expect(warnSpy).toHaveBeenCalledWith(
        '[WARN] [modelsApi]',
        'Failed to fetch models.dev: 503',
      );
    });
  });

  // ---- 4. Model filtering / sorting ----

  describe('model filtering and sorting', () => {
    it('sorts models by release_date descending (newest first)', async () => {
      const response = {
        anthropic: {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            old: {
              id: 'old',
              name: 'Old Model',
              release_date: '2023-01-01',
              modalities: { output: ['text'] },
            },
            new: {
              id: 'new',
              name: 'New Model',
              release_date: '2025-06-01',
              modalities: { output: ['text'] },
            },
            mid: {
              id: 'mid',
              name: 'Mid Model',
              release_date: '2024-06-01',
              modalities: { output: ['text'] },
            },
          },
        },
      };

      fetchMock.mockResolvedValueOnce(mockResponse(response));

      const { getAvailableProviders } = await loadModule();
      const providers = await getAvailableProviders();
      const modelIds = providers[0].models.map((m) => m.id);

      expect(modelIds).toEqual(['new', 'mid', 'old']);
    });

    it('puts models with release_date before those without', async () => {
      const response = {
        openai: {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'no-date': {
              id: 'no-date',
              name: 'No Date',
              modalities: { output: ['text'] },
            },
            'has-date': {
              id: 'has-date',
              name: 'Has Date',
              release_date: '2024-01-01',
              modalities: { output: ['text'] },
            },
          },
        },
      };

      fetchMock.mockResolvedValueOnce(mockResponse(response));

      const { getAvailableProviders } = await loadModule();
      const providers = await getAvailableProviders();
      const modelIds = providers[0].models.map((m) => m.id);

      expect(modelIds[0]).toBe('has-date');
    });

    it('sorts alphabetically when no release dates', async () => {
      const response = {
        google: {
          id: 'google',
          name: 'Google',
          models: {
            'zebra': {
              id: 'zebra',
              name: 'Zebra',
              modalities: { output: ['text'] },
            },
            'alpha': {
              id: 'alpha',
              name: 'Alpha',
              modalities: { output: ['text'] },
            },
          },
        },
      };

      fetchMock.mockResolvedValueOnce(mockResponse(response));

      const { getAvailableProviders } = await loadModule();
      const providers = await getAvailableProviders();
      const modelNames = providers[0].models.map((m) => m.name);

      expect(modelNames).toEqual(['Alpha', 'Zebra']);
    });

    it('builds description with context length', async () => {
      const response = {
        anthropic: {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            m1: {
              id: 'm1',
              name: 'Model',
              limit: { context: 200000 },
              modalities: { output: ['text'] },
            },
          },
        },
      };

      fetchMock.mockResolvedValueOnce(mockResponse(response));

      const { getAvailableProviders } = await loadModule();
      const providers = await getAvailableProviders();

      expect(providers[0].models[0].description).toContain('200K ctx');
    });

    it('builds description with million context length', async () => {
      const response = {
        google: {
          id: 'google',
          name: 'Google',
          models: {
            m1: {
              id: 'm1',
              name: 'Model',
              limit: { context: 2000000 },
              modalities: { output: ['text'] },
            },
          },
        },
      };

      fetchMock.mockResolvedValueOnce(mockResponse(response));

      const { getAvailableProviders } = await loadModule();
      const providers = await getAvailableProviders();

      expect(providers[0].models[0].description).toContain('2.0M ctx');
    });

    it('builds description with cost info', async () => {
      const response = {
        anthropic: {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            m1: {
              id: 'm1',
              name: 'Model',
              cost: { input: 3, output: 15 },
              modalities: { output: ['text'] },
            },
          },
        },
      };

      fetchMock.mockResolvedValueOnce(mockResponse(response));

      const { getAvailableProviders } = await loadModule();
      const providers = await getAvailableProviders();

      expect(providers[0].models[0].description).toContain('$3/15 per 1M tok');
    });

    it('builds description with reasoning and tools tags', async () => {
      const response = {
        anthropic: {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            m1: {
              id: 'm1',
              name: 'Model',
              reasoning: true,
              tool_call: true,
              modalities: { output: ['text'] },
            },
          },
        },
      };

      fetchMock.mockResolvedValueOnce(mockResponse(response));

      const { getAvailableProviders } = await loadModule();
      const providers = await getAvailableProviders();
      const desc = providers[0].models[0].description!;

      expect(desc).toContain('reasoning');
      expect(desc).toContain('tools');
    });

    it('builds empty description when no metadata', async () => {
      const response = {
        anthropic: {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            m1: {
              id: 'm1',
              name: 'Model',
              modalities: { output: ['text'] },
            },
          },
        },
      };

      fetchMock.mockResolvedValueOnce(mockResponse(response));

      const { getAvailableProviders } = await loadModule();
      const providers = await getAvailableProviders();

      expect(providers[0].models[0].description).toBe('');
    });
  });

  // ---- 5. Cache invalidation ----

  describe('cache invalidation', () => {
    it('refreshModels bypasses ETag by clearing cachedEtag', async () => {
      // First fetch with ETag
      fetchMock.mockResolvedValueOnce(
        mockResponse(makeApiResponse(), {
          headers: { etag: '"etag-v1"' },
        }),
      );

      const { getAvailableProviders, refreshModels } = await loadModule();
      await getAvailableProviders();

      // refreshModels should NOT send If-None-Match (etag is cleared)
      const updatedResponse = {
        anthropic: {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-new': {
              id: 'claude-new',
              name: 'Claude New',
              modalities: { output: ['text'] },
            },
          },
        },
      };
      fetchMock.mockResolvedValueOnce(
        mockResponse(updatedResponse, {
          headers: { etag: '"etag-v2"' },
        }),
      );

      const refreshed = await refreshModels();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      // The refresh call should NOT have If-None-Match
      expect(fetchMock.mock.calls[1][1]).toEqual({ headers: {} });
      expect(refreshed[0].models[0].id).toBe('claude-new');
    });

    it('refreshModels updates the cache for subsequent calls', async () => {
      // First fetch
      fetchMock.mockResolvedValueOnce(mockResponse(makeApiResponse()));

      const { getAvailableProviders, refreshModels } = await loadModule();
      await getAvailableProviders();

      // Refresh with new data
      const updatedResponse = {
        openai: {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-5': {
              id: 'gpt-5',
              name: 'GPT-5',
              modalities: { output: ['text'] },
            },
          },
        },
      };
      fetchMock.mockResolvedValueOnce(mockResponse(updatedResponse));

      await refreshModels();

      // Subsequent call should return the refreshed data from cache
      const providers = await getAvailableProviders();

      // Only 2 fetches total (initial + refresh); third call uses cache
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(providers.find((p) => p.id === 'openai')).toBeDefined();
      expect(providers.find((p) => p.id === 'openai')!.models[0].id).toBe(
        'gpt-5',
      );
    });

    it('stale cache triggers background revalidation', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(makeApiResponse()));

      const { getAvailableProviders } = await loadModule();
      await getAvailableProviders();

      // Advance time past STALE_MS
      vi.useFakeTimers();
      vi.advanceTimersByTime(6 * 60 * 1000);

      // Prepare updated response for background fetch
      const updatedResponse = {
        anthropic: {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            'claude-updated': {
              id: 'claude-updated',
              name: 'Claude Updated',
              modalities: { output: ['text'] },
            },
          },
        },
      };
      fetchMock.mockResolvedValueOnce(mockResponse(updatedResponse));

      // This returns stale cache but kicks off background fetch
      const staleResult = await getAvailableProviders();
      expect(staleResult[0].models[0].id).toBe('claude-sonnet-4-20250514');

      // Wait for background fetch to complete
      await vi.runAllTimersAsync();
      vi.useRealTimers();

      // Now cache should be updated; next call returns fresh data
      const fresh = await getAvailableProviders();
      expect(fresh[0].models[0].id).toBe('claude-updated');
    });

    it('deduplicates concurrent fetch requests', async () => {
      // Use a slow-resolving fetch
      let resolveFetch!: (value: Response) => void;
      fetchMock.mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
      );

      const { getAvailableProviders } = await loadModule();

      // Start two concurrent calls before fetch resolves
      const p1 = getAvailableProviders();
      const p2 = getAvailableProviders();

      // Only one fetch should have been issued
      expect(fetchMock).toHaveBeenCalledOnce();

      // Resolve the fetch
      resolveFetch(mockResponse(makeApiResponse()));

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toEqual(r2);
    });
  });

  // ---- SUPPORTED_PROVIDER_IDS export ----

  describe('SUPPORTED_PROVIDER_IDS', () => {
    it('exports the expected provider IDs', async () => {
      const { SUPPORTED_PROVIDER_IDS } = await loadModule();
      expect(SUPPORTED_PROVIDER_IDS).toEqual([
        'anthropic',
        'openai',
        'google',
        'openrouter',
        'groq',
        'xai',
      ]);
    });
  });
});
