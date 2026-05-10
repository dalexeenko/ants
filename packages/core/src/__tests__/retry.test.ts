/**
 * Tests for retry/circuit breaker module.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  withRetry,
  isTransientError,
  CircuitBreaker,
  DEFAULT_RETRY_POLICY,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  type RetryPolicy,
} from "../retry/index.js";

describe("isTransientError", () => {
  it.each([
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "network error",
    "socket hang up",
    "rate limit exceeded",
    "too many requests",
    "429 Too Many Requests",
    "500 Internal Server Error",
    "502 Bad Gateway",
    "503 Service Unavailable",
    "504 Gateway Timeout",
    "connection timed out",
  ])("should classify '%s' as transient", (msg) => {
    expect(isTransientError(new Error(msg))).toBe(true);
  });

  it.each([
    "Invalid parameters",
    "Not found",
    "Permission denied",
    "Syntax error",
    "Unknown tool",
  ])("should classify '%s' as non-transient", (msg) => {
    expect(isTransientError(new Error(msg))).toBe(false);
  });
});

describe("withRetry", () => {
  it("should return result on first success (no retries needed)", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { ...DEFAULT_RETRY_POLICY, maxRetries: 3 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should not retry when maxRetries is 0", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    await expect(withRetry(fn, { ...DEFAULT_RETRY_POLICY, maxRetries: 0 })).rejects.toThrow("ECONNRESET");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should retry on transient errors", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce("recovered");

    const result = await withRetry(fn, {
      ...DEFAULT_RETRY_POLICY,
      maxRetries: 2,
      initialDelayMs: 1, // fast for tests
    });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("should not retry non-transient errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Invalid parameters"));
    await expect(
      withRetry(fn, { ...DEFAULT_RETRY_POLICY, maxRetries: 3, initialDelayMs: 1 })
    ).rejects.toThrow("Invalid parameters");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should respect custom retryableErrors list", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("custom retryable"))
      .mockResolvedValueOnce("ok");

    const policy: RetryPolicy = {
      ...DEFAULT_RETRY_POLICY,
      maxRetries: 2,
      initialDelayMs: 1,
      retryableErrors: ["custom retryable"],
    };
    const result = await withRetry(fn, policy);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("should respect nonRetryableErrors list", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("ECONNRESET special"));
    const policy: RetryPolicy = {
      ...DEFAULT_RETRY_POLICY,
      maxRetries: 3,
      initialDelayMs: 1,
      nonRetryableErrors: ["special"],
    };
    await expect(withRetry(fn, policy)).rejects.toThrow("ECONNRESET special");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should stop retrying when abortSignal fires", async () => {
    const controller = new AbortController();
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockImplementation(async () => {
        // Should never reach here
        return "should not reach";
      });

    // Abort after the first call
    setTimeout(() => controller.abort(), 5);

    await expect(
      withRetry(fn, { ...DEFAULT_RETRY_POLICY, maxRetries: 5, initialDelayMs: 50 }, controller.signal)
    ).rejects.toThrow();
  });

  it("should stop immediately if already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(
      withRetry(fn, { ...DEFAULT_RETRY_POLICY, maxRetries: 3 }, controller.signal)
    ).rejects.toThrow("Aborted");
    expect(fn).toHaveBeenCalledTimes(0);
  });
});

describe("CircuitBreaker", () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 100,
      halfOpenSuccessThreshold: 1,
    });
  });

  it("should start in closed state", () => {
    expect(breaker.getState("tool-a").state).toBe("closed");
    expect(breaker.canExecute("tool-a")).toBe(true);
  });

  it("should remain closed below failure threshold", () => {
    breaker.recordFailure("tool-a");
    breaker.recordFailure("tool-a");
    expect(breaker.getState("tool-a").state).toBe("closed");
    expect(breaker.canExecute("tool-a")).toBe(true);
  });

  it("should open after reaching failure threshold", () => {
    breaker.recordFailure("tool-a");
    breaker.recordFailure("tool-a");
    breaker.recordFailure("tool-a");
    expect(breaker.getState("tool-a").state).toBe("open");
    expect(breaker.canExecute("tool-a")).toBe(false);
  });

  it("should reset failure count on success", () => {
    breaker.recordFailure("tool-a");
    breaker.recordFailure("tool-a");
    breaker.recordSuccess("tool-a");
    expect(breaker.getState("tool-a").failureCount).toBe(0);
    // Should not open even with more failures
    breaker.recordFailure("tool-a");
    breaker.recordFailure("tool-a");
    expect(breaker.getState("tool-a").state).toBe("closed");
  });

  it("should transition to half-open after timeout", async () => {
    breaker.recordFailure("tool-a");
    breaker.recordFailure("tool-a");
    breaker.recordFailure("tool-a");
    expect(breaker.canExecute("tool-a")).toBe(false);

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 150));
    expect(breaker.canExecute("tool-a")).toBe(true);
    expect(breaker.getState("tool-a").state).toBe("half-open");
  });

  it("should close after success in half-open state", async () => {
    breaker.recordFailure("tool-a");
    breaker.recordFailure("tool-a");
    breaker.recordFailure("tool-a");

    await new Promise((r) => setTimeout(r, 150));
    breaker.canExecute("tool-a"); // triggers half-open
    breaker.recordSuccess("tool-a");

    expect(breaker.getState("tool-a").state).toBe("closed");
    expect(breaker.getState("tool-a").failureCount).toBe(0);
  });

  it("should reopen after failure in half-open state", async () => {
    breaker.recordFailure("tool-a");
    breaker.recordFailure("tool-a");
    breaker.recordFailure("tool-a");

    await new Promise((r) => setTimeout(r, 150));
    breaker.canExecute("tool-a"); // triggers half-open
    breaker.recordFailure("tool-a");

    expect(breaker.getState("tool-a").state).toBe("open");
  });

  it("should track state independently per tool", () => {
    breaker.recordFailure("tool-a");
    breaker.recordFailure("tool-a");
    breaker.recordFailure("tool-a");

    expect(breaker.canExecute("tool-a")).toBe(false);
    expect(breaker.canExecute("tool-b")).toBe(true);
  });

  it("should reset a specific tool", () => {
    breaker.recordFailure("tool-a");
    breaker.recordFailure("tool-a");
    breaker.recordFailure("tool-a");
    breaker.reset("tool-a");
    expect(breaker.getState("tool-a").state).toBe("closed");
    expect(breaker.canExecute("tool-a")).toBe(true);
  });

  it("should reset all tools", () => {
    breaker.recordFailure("tool-a");
    breaker.recordFailure("tool-a");
    breaker.recordFailure("tool-a");
    breaker.recordFailure("tool-b");
    breaker.recordFailure("tool-b");
    breaker.recordFailure("tool-b");

    breaker.resetAll();
    expect(breaker.canExecute("tool-a")).toBe(true);
    expect(breaker.canExecute("tool-b")).toBe(true);
  });
});
