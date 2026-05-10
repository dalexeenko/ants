/**
 * UsageTracker - Tracks token usage and cost across agent sessions.
 * 
 * Accumulates prompt/completion tokens per session, supports budget enforcement,
 * and provides cost estimation based on model pricing.
 */

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Tokens written to prompt cache (Anthropic: cache_creation_input_tokens) */
  cacheCreationInputTokens?: number;
  /** Tokens read from prompt cache (Anthropic: cache_read_input_tokens, OpenAI: cached_tokens, Google: cachedContentTokenCount) */
  cacheReadInputTokens?: number;
}

export interface UsageRecord {
  sessionId: string;
  parentSessionId?: string;
  model: string;
  provider: string;
  usage: TokenUsage;
  estimatedCost: number;
  requestCount: number;
  startedAt: number;
  updatedAt: number;
}

export interface UsageBudget {
  /** Maximum total tokens (prompt + completion) */
  maxTokens?: number;
  /** Maximum estimated cost in USD */
  maxCost?: number;
  /** Maximum number of LLM requests */
  maxRequests?: number;
}

export interface UsageSummary {
  /** Total usage across all sessions */
  total: TokenUsage & { estimatedCost: number; requestCount: number };
  /** Per-session breakdown */
  sessions: UsageRecord[];
}

/**
 * Pricing per 1M tokens for common models.
 * {
 *   input: cost per 1M input tokens,
 *   output: cost per 1M output tokens,
 *   cacheWrite: cost per 1M cache creation tokens (optional, defaults to input * 1.25),
 *   cacheRead: cost per 1M cache read tokens (optional, defaults to input * 0.1),
 * }
 */
export interface ModelPricing {
  input: number;
  output: number;
  /** Cost per 1M cache write/creation tokens. Defaults to input * 1.25 if unset. */
  cacheWrite?: number;
  /** Cost per 1M cache read tokens. Defaults to input * 0.1 if unset. */
  cacheRead?: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic — cache write = 1.25x input, cache read = 0.1x input
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.30 },
  "claude-opus-4-20250514": { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.50 },
  "claude-haiku-4-20250514": { input: 0.80, output: 4.0, cacheWrite: 1.0, cacheRead: 0.08 },
  "claude-3-5-sonnet-20241022": { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.30 },
  "claude-3-5-haiku-20241022": { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.10 },
  "claude-3-opus-20240229": { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.50 },
  "claude-3-haiku-20240307": { input: 0.25, output: 1.25, cacheWrite: 0.30, cacheRead: 0.03 },
  // OpenAI — cached tokens are 50% of input price (automatic caching, no write premium)
  "gpt-4o": { input: 2.5, output: 10.0, cacheRead: 1.25 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cacheRead: 0.075 },
  "gpt-4-turbo": { input: 10.0, output: 30.0, cacheRead: 5.0 },
  "o1": { input: 15.0, output: 60.0, cacheRead: 7.50 },
  "o1-mini": { input: 3.0, output: 12.0, cacheRead: 1.50 },
  "o3-mini": { input: 1.10, output: 4.40, cacheRead: 0.55 },
  // Google — cached tokens are 25% of input price
  "gemini-2.0-flash": { input: 0.10, output: 0.40, cacheRead: 0.025 },
  "gemini-2.0-pro": { input: 1.25, output: 10.0, cacheRead: 0.3125 },
  "gemini-1.5-pro": { input: 1.25, output: 5.0, cacheRead: 0.3125 },
  "gemini-1.5-flash": { input: 0.075, output: 0.30, cacheRead: 0.01875 },
};

/**
 * Default pricing for unknown models (conservative estimate).
 */
const DEFAULT_PRICING: ModelPricing = { input: 3.0, output: 15.0 };

/**
 * Callback invoked after each usage record is accumulated.
 * Receives the session ID, the delta (per-request) usage, and the computed cost delta.
 */
export type UsageRecordCallback = (
  sessionId: string,
  delta: TokenUsage,
  costDelta: number,
) => void;

export class UsageTracker {
  private records: Map<string, UsageRecord> = new Map();
  private budget?: UsageBudget;
  private onRecordCallback?: UsageRecordCallback;

  constructor(budget?: UsageBudget) {
    this.budget = budget;
  }

  /**
   * Set a callback that fires after every usage recording.
   * Used by the storage plugin to persist token stats to the database.
   */
  setOnRecordCallback(callback: UsageRecordCallback | undefined): void {
    this.onRecordCallback = callback;
  }

  /**
   * Record token usage from an LLM response.
   */
  record(
    sessionId: string,
    model: string,
    provider: string,
    usage: TokenUsage,
    parentSessionId?: string
  ): void {
    const existing = this.records.get(sessionId);

    const costDelta = this.estimateCost(model, usage);

    if (existing) {
      existing.usage.promptTokens += usage.promptTokens;
      existing.usage.completionTokens += usage.completionTokens;
      existing.usage.totalTokens += usage.totalTokens;
      existing.usage.cacheCreationInputTokens = (existing.usage.cacheCreationInputTokens ?? 0) + (usage.cacheCreationInputTokens ?? 0);
      existing.usage.cacheReadInputTokens = (existing.usage.cacheReadInputTokens ?? 0) + (usage.cacheReadInputTokens ?? 0);
      existing.estimatedCost += costDelta;
      existing.requestCount += 1;
      existing.updatedAt = Date.now();
    } else {
      this.records.set(sessionId, {
        sessionId,
        parentSessionId,
        model,
        provider,
        usage: { ...usage },
        estimatedCost: costDelta,
        requestCount: 1,
        startedAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    // Notify listener (e.g. storage plugin) of the delta
    if (this.onRecordCallback) {
      try {
        this.onRecordCallback(sessionId, usage, costDelta);
      } catch {
        // Non-critical — don't let persistence errors break the agent loop
      }
    }
  }

  /**
   * Estimate cost in USD for a given usage.
   * 
   * When cache token counts are available, the cost is calculated as:
   * - Cache write tokens charged at cacheWrite rate (or input * 1.25)
   * - Cache read tokens charged at cacheRead rate (or input * 0.1)
   * - Remaining prompt tokens (total prompt - cache write - cache read) at input rate
   * - Completion tokens at output rate
   */
  estimateCost(model: string, usage: TokenUsage): number {
    const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
    
    const cacheWriteTokens = usage.cacheCreationInputTokens ?? 0;
    const cacheReadTokens = usage.cacheReadInputTokens ?? 0;
    
    // Regular input tokens = total prompt minus cache tokens
    const regularInputTokens = Math.max(0, usage.promptTokens - cacheWriteTokens - cacheReadTokens);
    
    const cacheWriteRate = pricing.cacheWrite ?? (pricing.input * 1.25);
    const cacheReadRate = pricing.cacheRead ?? (pricing.input * 0.1);
    
    const inputCost = (regularInputTokens / 1_000_000) * pricing.input;
    const cacheWriteCost = (cacheWriteTokens / 1_000_000) * cacheWriteRate;
    const cacheReadCost = (cacheReadTokens / 1_000_000) * cacheReadRate;
    const outputCost = (usage.completionTokens / 1_000_000) * pricing.output;
    
    return inputCost + cacheWriteCost + cacheReadCost + outputCost;
  }

  /**
   * Check if a session has exceeded its budget.
   * Returns the reason string if exceeded, or null if within budget.
   */
  checkBudget(sessionId?: string): string | null {
    if (!this.budget) return null;

    const usage = sessionId ? this.getSessionUsage(sessionId) : this.getTotalUsage();

    if (this.budget.maxTokens && usage.totalTokens >= this.budget.maxTokens) {
      return `Token budget exceeded: ${usage.totalTokens}/${this.budget.maxTokens}`;
    }

    if (this.budget.maxCost) {
      const cost = sessionId
        ? (this.records.get(sessionId)?.estimatedCost ?? 0)
        : this.getTotalCost();
      if (cost >= this.budget.maxCost) {
        return `Cost budget exceeded: $${cost.toFixed(4)}/$${this.budget.maxCost.toFixed(4)}`;
      }
    }

    if (this.budget.maxRequests) {
      const requests = sessionId
        ? (this.records.get(sessionId)?.requestCount ?? 0)
        : Array.from(this.records.values()).reduce((sum, r) => sum + r.requestCount, 0);
      if (requests >= this.budget.maxRequests) {
        return `Request budget exceeded: ${requests}/${this.budget.maxRequests}`;
      }
    }

    return null;
  }

  /**
   * Get usage for a specific session.
   */
  getSessionUsage(sessionId: string): TokenUsage {
    const record = this.records.get(sessionId);
    if (!record) {
      return { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
    }
    return { ...record.usage };
  }

  /**
   * Get total usage across all sessions.
   */
  getTotalUsage(): TokenUsage {
    const total: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
    for (const record of this.records.values()) {
      total.promptTokens += record.usage.promptTokens;
      total.completionTokens += record.usage.completionTokens;
      total.totalTokens += record.usage.totalTokens;
      total.cacheCreationInputTokens! += record.usage.cacheCreationInputTokens ?? 0;
      total.cacheReadInputTokens! += record.usage.cacheReadInputTokens ?? 0;
    }
    return total;
  }

  /**
   * Get total estimated cost across all sessions.
   */
  getTotalCost(): number {
    let total = 0;
    for (const record of this.records.values()) {
      total += record.estimatedCost;
    }
    return total;
  }

  /**
   * Get cost for a specific parent session including all its children.
   */
  getTreeCost(parentSessionId: string): number {
    let total = 0;
    for (const record of this.records.values()) {
      if (record.sessionId === parentSessionId || record.parentSessionId === parentSessionId) {
        total += record.estimatedCost;
      }
    }
    return total;
  }

  /**
   * Get a full usage summary.
   */
  getSummary(): UsageSummary {
    const total = this.getTotalUsage();
    return {
      total: {
        ...total,
        estimatedCost: this.getTotalCost(),
        requestCount: Array.from(this.records.values()).reduce((sum, r) => sum + r.requestCount, 0),
      },
      sessions: Array.from(this.records.values()),
    };
  }

  /**
   * Get the record for a session.
   */
  getRecord(sessionId: string): UsageRecord | undefined {
    return this.records.get(sessionId);
  }

  /**
   * Update the budget.
   */
  setBudget(budget: UsageBudget | undefined): void {
    this.budget = budget;
  }

  /**
   * Get the current budget.
   */
  getBudget(): UsageBudget | undefined {
    return this.budget ? { ...this.budget } : undefined;
  }

  /**
   * Hydrate the tracker with previously persisted usage data for a session.
   * Call this when loading a session from the database to restore cumulative stats.
   */
  hydrate(
    sessionId: string,
    model: string,
    provider: string,
    usage: TokenUsage & { estimatedCost: number; requestCount: number },
    parentSessionId?: string,
  ): void {
    this.records.set(sessionId, {
      sessionId,
      parentSessionId,
      model,
      provider,
      usage: {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        cacheCreationInputTokens: usage.cacheCreationInputTokens,
        cacheReadInputTokens: usage.cacheReadInputTokens,
      },
      estimatedCost: usage.estimatedCost,
      requestCount: usage.requestCount,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  /**
   * Clear all usage records.
   */
  clear(): void {
    this.records.clear();
  }
}
