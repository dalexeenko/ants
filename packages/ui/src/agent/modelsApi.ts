/**
 * Models.dev API client with in-memory caching and ETag support.
 *
 * Fetches the live model catalog from https://models.dev/api.json and caches it.
 * Uses the ETag header for conditional requests so repeat fetches only download
 * data when the catalog has actually changed.
 */

import type { ModelInfo, ProviderInfo } from './types';
import { createLogger } from '../utils/logger';

const log = createLogger('modelsApi');

const API_URL = 'https://models.dev/api.json';

/** How long before we attempt a revalidation (5 minutes). */
const STALE_MS = 5 * 60 * 1000;

/** Providers we actually have runtime support for. */
export const SUPPORTED_PROVIDER_IDS = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'groq',
  'xai',
] as const;

export type SupportedProviderId = (typeof SUPPORTED_PROVIDER_IDS)[number];

// ---------- raw API types ----------

interface ModelsDevModel {
  id: string;
  name: string;
  family?: string;
  cost?: {
    input?: number;
    output?: number;
  };
  limit?: {
    context?: number;
    output?: number;
  };
  modalities?: {
    input?: string[];
    output?: string[];
  };
  tool_call?: boolean;
  reasoning?: boolean;
  release_date?: string;
}

interface ModelsDevProvider {
  id: string;
  name?: string;
  models: Record<string, ModelsDevModel>;
}

type ModelsDevResponse = Record<string, ModelsDevProvider>;

// ---------- cache state ----------

let cachedProviders: ProviderInfo[] | null = null;
let cachedEtag: string | null = null;
let lastFetchTime = 0;
let fetchPromise: Promise<ProviderInfo[]> | null = null;

// ---------- public API ----------

/**
 * Get the full list of available providers and their models.
 * Returns cached data immediately if fresh, otherwise revalidates in the
 * background and still returns the stale cache synchronously.
 *
 * On first load (no cache), this will block until the fetch completes.
 */
export async function getAvailableProviders(): Promise<ProviderInfo[]> {
  const now = Date.now();
  const isStale = now - lastFetchTime > STALE_MS;

  // If we have a cache and it's fresh, return immediately
  if (cachedProviders && !isStale) {
    return cachedProviders;
  }

  // If we have a cache but it's stale, kick off a background revalidation
  // and return the stale data now.
  if (cachedProviders && isStale) {
    if (!fetchPromise) {
      fetchPromise = fetchAndParse().finally(() => { fetchPromise = null; });
    }
    return cachedProviders;
  }

  // No cache at all – must wait for the fetch.
  if (!fetchPromise) {
    fetchPromise = fetchAndParse().finally(() => { fetchPromise = null; });
  }
  return fetchPromise;
}

/**
 * Get a flat list of all models across supported providers.
 */
export async function getAllModels(): Promise<ModelInfo[]> {
  const providers = await getAvailableProviders();
  return providers.flatMap((p) => p.models);
}

/**
 * Get models for a single provider.
 */
export async function getModelsForProvider(
  providerId: string,
): Promise<ModelInfo[]> {
  const providers = await getAvailableProviders();
  const provider = providers.find((p) => p.id === providerId);
  return provider?.models ?? [];
}

/**
 * Force a fresh fetch, ignoring cache.
 */
export async function refreshModels(): Promise<ProviderInfo[]> {
  cachedEtag = null; // bypass conditional request
  return fetchAndParse();
}

// ---------- internals ----------

async function fetchAndParse(): Promise<ProviderInfo[]> {
  try {
    const headers: Record<string, string> = {};
    if (cachedEtag) {
      headers['If-None-Match'] = cachedEtag;
    }

    const response = await fetch(API_URL, { headers });

    // 304 Not Modified – our cache is still valid
    if (response.status === 304) {
      lastFetchTime = Date.now();
      return cachedProviders!;
    }

    if (!response.ok) {
      log.warn(`Failed to fetch models.dev: ${response.status}`);
      return cachedProviders ?? buildFallback();
    }

    // Save ETag for next conditional request
    const etag = response.headers.get('etag');
    if (etag) {
      cachedEtag = etag;
    }

    const raw: ModelsDevResponse = await response.json();
    cachedProviders = parseResponse(raw);
    lastFetchTime = Date.now();

    return cachedProviders;
  } catch (err) {
    log.warn('Network error fetching models.dev:', err);
    return cachedProviders ?? buildFallback();
  }
}

function parseResponse(raw: ModelsDevResponse): ProviderInfo[] {
  const providers: ProviderInfo[] = [];

  for (const providerId of SUPPORTED_PROVIDER_IDS) {
    const entry = raw[providerId];
    if (!entry?.models) continue;

    const models: ModelInfo[] = Object.values(entry.models)
      .filter((m) => {
        // Only include models that can do text generation (not embedding-only)
        const outputModalities = m.modalities?.output ?? ['text'];
        return outputModalities.includes('text');
      })
      .map((m) => ({
        id: m.id,
        name: m.name,
        provider: providerId,
        contextLength: m.limit?.context,
        description: buildDescription(m),
      }))
      // Sort: newest first (by release_date), then alphabetically
      .sort((a, b) => {
        // We embed release_date in description for sorting; use the raw data
        const rawModels = Object.values(entry.models);
        const aRaw = rawModels.find((r) => r.id === a.id);
        const bRaw = rawModels.find((r) => r.id === b.id);
        const aDate = aRaw?.release_date ?? '';
        const bDate = bRaw?.release_date ?? '';
        if (aDate && bDate) return bDate.localeCompare(aDate);
        if (aDate) return -1;
        if (bDate) return 1;
        return a.name.localeCompare(b.name);
      });

    if (models.length > 0) {
      providers.push({
        id: providerId,
        name: entry.name ?? providerId,
        models,
      });
    }
  }

  return providers;
}

function buildDescription(m: ModelsDevModel): string {
  const parts: string[] = [];

  if (m.limit?.context) {
    const ctx = m.limit.context;
    parts.push(ctx >= 1_000_000 ? `${(ctx / 1_000_000).toFixed(1)}M ctx` : `${Math.round(ctx / 1000)}K ctx`);
  }

  if (m.cost?.input != null && m.cost?.output != null) {
    parts.push(`$${m.cost.input}/${m.cost.output} per 1M tok`);
  }

  if (m.reasoning) parts.push('reasoning');
  if (m.tool_call) parts.push('tools');

  return parts.join(' · ') || '';
}

/**
 * Hardcoded fallback in case models.dev is unreachable on first load.
 */
function buildFallback(): ProviderInfo[] {
  return [
    {
      id: 'anthropic',
      name: 'Anthropic',
      models: [
        { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', description: 'Latest Claude model' },
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic', description: 'Fast and efficient' },
      ],
    },
    {
      id: 'openai',
      name: 'OpenAI',
      models: [
        { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', description: 'Multimodal flagship' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', description: 'Fast and affordable' },
      ],
    },
    {
      id: 'google',
      name: 'Google',
      models: [
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google', description: 'Latest Gemini' },
      ],
    },
    {
      id: 'openrouter',
      name: 'OpenRouter',
      models: [
        { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'openrouter' },
      ],
    },
    {
      id: 'groq',
      name: 'Groq',
      models: [
        { id: 'llama-3.1-70b-versatile', name: 'Llama 3.1 70B', provider: 'groq', description: 'Fast inference' },
      ],
    },
    {
      id: 'xai',
      name: 'xAI',
      models: [
        { id: 'grok-2', name: 'Grok 2', provider: 'xai', description: 'Latest Grok' },
      ],
    },
  ];
}
