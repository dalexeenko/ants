export interface CompactionConfig {
  enabled: boolean;
  tokenThreshold: number;
  messageThreshold?: number;
  summaryMaxTokens: number;
  model?: string;
  autoCompact: boolean;
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  enabled: true,
  tokenThreshold: 0.8,
  summaryMaxTokens: 2000,
  autoCompact: true,
};

export interface CompactionStats {
  currentTokens: number;
  threshold: number;
  messagesToCompact: number;
}

export interface CompactionResult {
  compactionId: string;
  summary: string;
  originalTokens: number;
  compactedTokens: number;
  messagesPruned: number;
  compressionRatio: number;
}

export const MODEL_LIMITS: Record<string, number> = {
  // Anthropic
  "claude-sonnet-4-20250514": 200000,
  "claude-opus-4-20250514": 200000,
  "claude-haiku-4-20250514": 200000,
  "claude-3-5-sonnet-20241022": 200000,
  "claude-3-5-haiku-20241022": 200000,
  "claude-3-opus-20240229": 200000,
  "claude-3-haiku-20240307": 200000,
  // OpenAI
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "gpt-4-turbo": 128000,
  "gpt-4": 8192,
  "gpt-3.5-turbo": 16385,
  "o1": 200000,
  "o1-mini": 128000,
  "o3-mini": 200000,
  // Google
  "gemini-2.0-flash": 1048576,
  "gemini-2.0-pro": 1048576,
  "gemini-1.5-pro": 2097152,
  "gemini-1.5-flash": 1048576,
};

export function getModelLimit(model: string): number {
  return MODEL_LIMITS[model] ?? 128000;
}
