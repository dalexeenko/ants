/**
 * Models.dev API client with in-memory caching and ETag support.
 *
 * Server-side equivalent of the UI package's modelsApi.ts.
 * Fetches https://models.dev/api.json, caches the parsed result,
 * and uses ETag / If-None-Match for bandwidth-efficient revalidation.
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('models-api');

const API_URL = 'https://models.dev/api.json';

/** Revalidate after 5 minutes */
const STALE_MS = 5 * 60 * 1000;

/** Providers we have runtime support for */
const SUPPORTED_PROVIDER_IDS = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'groq',
  'xai',
] as const;

// ---------- types ----------

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextLength?: number;
  description?: string;
}

interface ProviderInfo {
  id: string;
  name: string;
  models: ModelInfo[];
}

interface ModelsDevModel {
  id: string;
  name: string;
  family?: string;
  cost?: { input?: number; output?: number };
  limit?: { context?: number; output?: number };
  modalities?: { input?: string[]; output?: string[] };
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

// ---------- cache ----------

let cachedProviders: ProviderInfo[] | null = null;
let cachedEtag: string | null = null;
let lastFetchTime = 0;
let fetchPromise: Promise<ProviderInfo[]> | null = null;

// ---------- public ----------

/**
 * Fetch the model catalog from models.dev (cached + ETag revalidation).
 */
export async function fetchModelsFromApi(): Promise<ProviderInfo[]> {
  const now = Date.now();
  const isStale = now - lastFetchTime > STALE_MS;

  if (cachedProviders && !isStale) {
    return cachedProviders;
  }

  if (cachedProviders && isStale) {
    if (!fetchPromise) {
      fetchPromise = doFetch().finally(() => { fetchPromise = null; });
    }
    return cachedProviders;
  }

  if (!fetchPromise) {
    fetchPromise = doFetch().finally(() => { fetchPromise = null; });
  }
  return fetchPromise;
}

// ---------- internals ----------

async function doFetch(): Promise<ProviderInfo[]> {
  try {
    const headers: Record<string, string> = {};
    if (cachedEtag) {
      headers['If-None-Match'] = cachedEtag;
    }

    const res = await fetch(API_URL, { headers });

    if (res.status === 304) {
      lastFetchTime = Date.now();
      return cachedProviders!;
    }

    if (!res.ok) {
      log.warn(`models.dev returned ${res.status}`);
      return cachedProviders ?? fallback();
    }

    const etag = res.headers.get('etag');
    if (etag) cachedEtag = etag;

    const raw = await res.json() as ModelsDevResponse;
    cachedProviders = parse(raw);
    lastFetchTime = Date.now();
    return cachedProviders;
  } catch (err) {
    log.warn('Failed to fetch models.dev:', err);
    return cachedProviders ?? fallback();
  }
}

function parse(raw: ModelsDevResponse): ProviderInfo[] {
  const result: ProviderInfo[] = [];

  for (const pid of SUPPORTED_PROVIDER_IDS) {
    const entry = raw[pid];
    if (!entry?.models) continue;

    const models: ModelInfo[] = Object.values(entry.models)
      .filter((m) => {
        const out = m.modalities?.output ?? ['text'];
        return out.includes('text');
      })
      .map((m) => ({
        id: m.id,
        name: m.name,
        provider: pid,
        contextLength: m.limit?.context,
        description: desc(m),
      }))
      .sort((a, b) => {
        const raw2 = Object.values(entry.models);
        const ad = raw2.find((r) => r.id === a.id)?.release_date ?? '';
        const bd = raw2.find((r) => r.id === b.id)?.release_date ?? '';
        if (ad && bd) return bd.localeCompare(ad);
        if (ad) return -1;
        if (bd) return 1;
        return a.name.localeCompare(b.name);
      });

    if (models.length > 0) {
      result.push({ id: pid, name: entry.name ?? pid, models });
    }
  }

  return result;
}

function desc(m: ModelsDevModel): string {
  const parts: string[] = [];
  if (m.limit?.context) {
    const c = m.limit.context;
    parts.push(c >= 1_000_000 ? `${(c / 1_000_000).toFixed(1)}M ctx` : `${Math.round(c / 1000)}K ctx`);
  }
  if (m.cost?.input != null && m.cost?.output != null) {
    parts.push(`$${m.cost.input}/${m.cost.output} per 1M tok`);
  }
  if (m.reasoning) parts.push('reasoning');
  if (m.tool_call) parts.push('tools');
  return parts.join(' · ') || '';
}

function fallback(): ProviderInfo[] {
  return [
    {
      id: 'anthropic', name: 'Anthropic', models: [
        { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', description: 'Latest Claude model' },
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic', description: 'Fast and efficient' },
      ],
    },
    {
      id: 'openai', name: 'OpenAI', models: [
        { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', description: 'Multimodal flagship' },
      ],
    },
  ];
}
