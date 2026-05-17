/**
 * Retry and error recovery module for tool execution.
 * 
 * Provides configurable retry policies with exponential backoff,
 * circuit breaker pattern, and error classification.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Retry policy for tool execution.
 */
export interface RetryPolicy {
  /** Maximum number of retry attempts (default: 0 = no retries) */
  maxRetries: number;

  /** Initial delay in milliseconds before first retry (default: 1000) */
  initialDelayMs: number;

  /** Maximum delay in milliseconds between retries (default: 30000) */
  maxDelayMs: number;

  /** Backoff multiplier (default: 2.0 for exponential) */
  backoffMultiplier: number;

  /** Jitter factor (0-1) to add randomness to delays (default: 0.1) */
  jitterFactor: number;

  /** Error types that should be retried (default: all transient errors) */
  retryableErrors?: string[];

  /** Error types that should never be retried */
  nonRetryableErrors?: string[];
}

/**
 * Circuit breaker state for a tool.
 */
export interface CircuitBreakerState {
  /** Current state */
  state: "closed" | "open" | "half-open";

  /** Number of consecutive failures */
  failureCount: number;

  /** Timestamp when the circuit was opened */
  openedAt?: number;

  /** Timestamp of the last failure */
  lastFailureAt?: number;
}

/**
 * Circuit breaker configuration.
 */
export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening the circuit (default: 5) */
  failureThreshold: number;

  /** Time in milliseconds before attempting to half-open (default: 60000) */
  resetTimeoutMs: number;

  /** Number of successful calls in half-open to close the circuit (default: 1) */
  halfOpenSuccessThreshold: number;
}

// ============================================================================
// Defaults
// ============================================================================

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 0,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2.0,
  jitterFactor: 0.1,
};

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 60000,
  halfOpenSuccessThreshold: 1,
};

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Classify whether an error is transient (retryable) or permanent.
 */
export function isTransientError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Network errors. Includes the most common Node.js libuv/dns error codes
  // we see in the wild: ENOTFOUND (DNS failed to resolve), EAI_AGAIN (DNS
  // transient failure), ECONNRESET, ECONNREFUSED, ETIMEDOUT, EPIPE,
  // EHOSTUNREACH, ENETUNREACH, and the undici wrappers around them.
  if (
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("etimedout") ||
    message.includes("epipe") ||
    message.includes("enotfound") ||
    message.includes("eai_again") ||
    message.includes("ehostunreach") ||
    message.includes("enetunreach") ||
    message.includes("getaddrinfo") ||
    message.includes("network") ||
    message.includes("socket hang up") ||
    message.includes("dns") ||
    message.includes("fetch failed")
  ) {
    return true;
  }

  // Rate limiting
  if (
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("429") ||
    message.includes("quota")
  ) {
    return true;
  }

  // Temporary server errors
  if (
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504") ||
    message.includes("internal server error") ||
    message.includes("service unavailable") ||
    message.includes("bad gateway")
  ) {
    return true;
  }

  // Timeout
  if (message.includes("timeout") || message.includes("timed out")) {
    return true;
  }

  return false;
}

// ============================================================================
// Retry Executor
// ============================================================================

/**
 * Execute a function with retry logic.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  abortSignal?: AbortSignal
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    try {
      if (abortSignal?.aborted) {
        throw new Error("Aborted");
      }

      return await fn();
    } catch (err) {
      lastError = err as Error;

      // Don't retry if we've exhausted attempts
      if (attempt === policy.maxRetries) {
        break;
      }

      // Don't retry non-transient errors
      if (!shouldRetry(lastError, policy)) {
        break;
      }

      // Don't retry if aborted
      if (abortSignal?.aborted) {
        break;
      }

      // Calculate delay with exponential backoff and jitter
      const baseDelay = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt);
      const jitter = baseDelay * policy.jitterFactor * (Math.random() * 2 - 1);
      const delay = Math.min(baseDelay + jitter, policy.maxDelayMs);

      // Wait before retrying
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        if (abortSignal) {
          const onAbort = () => {
            clearTimeout(timer);
            reject(new Error("Aborted"));
          };
          abortSignal.addEventListener("abort", onAbort, { once: true });
        }
      });
    }
  }

  throw lastError ?? new Error("Retry failed with no error");
}

function shouldRetry(error: Error, policy: RetryPolicy): boolean {
  // Check explicit non-retryable patterns
  if (policy.nonRetryableErrors?.length) {
    const msg = error.message.toLowerCase();
    if (policy.nonRetryableErrors.some((pattern) => msg.includes(pattern.toLowerCase()))) {
      return false;
    }
  }

  // Check explicit retryable patterns
  if (policy.retryableErrors?.length) {
    const msg = error.message.toLowerCase();
    return policy.retryableErrors.some((pattern) => msg.includes(pattern.toLowerCase()));
  }

  // Default: retry transient errors
  return isTransientError(error);
}

// ============================================================================
// Circuit Breaker
// ============================================================================

export class CircuitBreaker {
  private states: Map<string, CircuitBreakerState> = new Map();
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  }

  /**
   * Check if a tool is allowed to execute.
   */
  canExecute(toolName: string): boolean {
    const state = this.getState(toolName);

    switch (state.state) {
      case "closed":
        return true;

      case "open": {
        // Check if enough time has passed to try half-open
        const elapsed = Date.now() - (state.openedAt ?? 0);
        if (elapsed >= this.config.resetTimeoutMs) {
          state.state = "half-open";
          return true;
        }
        return false;
      }

      case "half-open":
        return true;

      default:
        return true;
    }
  }

  /**
   * Record a successful tool execution.
   */
  recordSuccess(toolName: string): void {
    const state = this.getState(toolName);

    if (state.state === "half-open") {
      // Reset to closed after successful half-open attempt
      state.state = "closed";
      state.failureCount = 0;
    } else {
      state.failureCount = 0;
    }
  }

  /**
   * Record a failed tool execution.
   */
  recordFailure(toolName: string): void {
    const state = this.getState(toolName);
    state.failureCount += 1;
    state.lastFailureAt = Date.now();

    if (state.state === "half-open") {
      // Failure during half-open: reopen the circuit
      state.state = "open";
      state.openedAt = Date.now();
    } else if (state.failureCount >= this.config.failureThreshold) {
      state.state = "open";
      state.openedAt = Date.now();
    }
  }

  /**
   * Get the state of a tool's circuit breaker.
   */
  getState(toolName: string): CircuitBreakerState {
    let state = this.states.get(toolName);
    if (!state) {
      state = { state: "closed", failureCount: 0 };
      this.states.set(toolName, state);
    }
    return state;
  }

  /**
   * Reset a specific tool's circuit breaker.
   */
  reset(toolName: string): void {
    this.states.delete(toolName);
  }

  /**
   * Reset all circuit breakers.
   */
  resetAll(): void {
    this.states.clear();
  }
}
