/**
 * Tests for UsageTracker — specifically the hydrate() method and
 * onRecordCallback used for persisting token stats to the database.
 */
import { describe, it, expect, vi } from "vitest";
import { UsageTracker } from "../usage/tracker.js";
import type { TokenUsage, UsageRecordCallback } from "../usage/tracker.js";

function usage(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return {
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    cacheCreationInputTokens: 10,
    cacheReadInputTokens: 20,
    ...overrides,
  };
}

describe("UsageTracker", () => {
  describe("hydrate", () => {
    it("should pre-populate a session record from persisted data", () => {
      const tracker = new UsageTracker();

      tracker.hydrate("session-1", "claude-sonnet-4-20250514", "anthropic", {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        cacheCreationInputTokens: 100,
        cacheReadInputTokens: 200,
        estimatedCost: 0.05,
        requestCount: 10,
      });

      const record = tracker.getRecord("session-1");
      expect(record).toBeDefined();
      expect(record!.usage.promptTokens).toBe(1000);
      expect(record!.usage.completionTokens).toBe(500);
      expect(record!.usage.totalTokens).toBe(1500);
      expect(record!.usage.cacheCreationInputTokens).toBe(100);
      expect(record!.usage.cacheReadInputTokens).toBe(200);
      expect(record!.estimatedCost).toBe(0.05);
      expect(record!.requestCount).toBe(10);
      expect(record!.model).toBe("claude-sonnet-4-20250514");
      expect(record!.provider).toBe("anthropic");
    });

    it("should set parentSessionId when provided", () => {
      const tracker = new UsageTracker();

      tracker.hydrate("child-1", "gpt-4o", "openai", {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
        requestCount: 0,
      }, "parent-1");

      const record = tracker.getRecord("child-1");
      expect(record).toBeDefined();
      expect(record!.parentSessionId).toBe("parent-1");
    });

    it("should allow subsequent record() calls to accumulate on top of hydrated data", () => {
      const tracker = new UsageTracker();

      // Hydrate with persisted data
      tracker.hydrate("session-1", "claude-sonnet-4-20250514", "anthropic", {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        cacheCreationInputTokens: 100,
        cacheReadInputTokens: 200,
        estimatedCost: 0.05,
        requestCount: 10,
      });

      // Record new usage on top
      tracker.record("session-1", "claude-sonnet-4-20250514", "anthropic", usage());

      const record = tracker.getRecord("session-1");
      expect(record!.usage.promptTokens).toBe(1100);
      expect(record!.usage.completionTokens).toBe(550);
      expect(record!.usage.totalTokens).toBe(1650);
      expect(record!.usage.cacheCreationInputTokens).toBe(110);
      expect(record!.usage.cacheReadInputTokens).toBe(220);
      expect(record!.requestCount).toBe(11);
      // estimatedCost should be hydrated value + new cost
      expect(record!.estimatedCost).toBeGreaterThan(0.05);
    });

    it("should be reflected in getSummary()", () => {
      const tracker = new UsageTracker();

      tracker.hydrate("session-1", "claude-sonnet-4-20250514", "anthropic", {
        promptTokens: 500,
        completionTokens: 250,
        totalTokens: 750,
        estimatedCost: 0.02,
        requestCount: 5,
      });

      const summary = tracker.getSummary();
      expect(summary.total.promptTokens).toBe(500);
      expect(summary.total.completionTokens).toBe(250);
      expect(summary.total.totalTokens).toBe(750);
      expect(summary.total.estimatedCost).toBe(0.02);
      expect(summary.total.requestCount).toBe(5);
      expect(summary.sessions).toHaveLength(1);
    });

    it("should overwrite existing record for the same session", () => {
      const tracker = new UsageTracker();

      tracker.hydrate("session-1", "claude-sonnet-4-20250514", "anthropic", {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        estimatedCost: 0.01,
        requestCount: 1,
      });

      // Hydrate again (e.g. session reload)
      tracker.hydrate("session-1", "claude-sonnet-4-20250514", "anthropic", {
        promptTokens: 200,
        completionTokens: 100,
        totalTokens: 300,
        estimatedCost: 0.02,
        requestCount: 2,
      });

      const record = tracker.getRecord("session-1");
      expect(record!.usage.promptTokens).toBe(200);
      expect(record!.requestCount).toBe(2);
    });
  });

  describe("onRecordCallback", () => {
    it("should fire after each record() call with delta usage and cost", () => {
      const tracker = new UsageTracker();
      const callback = vi.fn<Parameters<UsageRecordCallback>, void>();
      tracker.setOnRecordCallback(callback);

      const delta = usage();
      tracker.record("session-1", "claude-sonnet-4-20250514", "anthropic", delta);

      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith(
        "session-1",
        delta,
        expect.any(Number),
      );
      // Cost should be positive
      const costDelta = callback.mock.calls[0]![2];
      expect(costDelta).toBeGreaterThan(0);
    });

    it("should fire on every record() call", () => {
      const tracker = new UsageTracker();
      const callback = vi.fn();
      tracker.setOnRecordCallback(callback);

      tracker.record("s1", "claude-sonnet-4-20250514", "anthropic", usage());
      tracker.record("s1", "claude-sonnet-4-20250514", "anthropic", usage());
      tracker.record("s2", "gpt-4o", "openai", usage());

      expect(callback).toHaveBeenCalledTimes(3);
      // First two calls for session s1, third for s2
      expect(callback.mock.calls[0]![0]).toBe("s1");
      expect(callback.mock.calls[1]![0]).toBe("s1");
      expect(callback.mock.calls[2]![0]).toBe("s2");
    });

    it("should not fire after callback is cleared", () => {
      const tracker = new UsageTracker();
      const callback = vi.fn();
      tracker.setOnRecordCallback(callback);

      tracker.record("s1", "claude-sonnet-4-20250514", "anthropic", usage());
      expect(callback).toHaveBeenCalledOnce();

      tracker.setOnRecordCallback(undefined);
      tracker.record("s1", "claude-sonnet-4-20250514", "anthropic", usage());
      expect(callback).toHaveBeenCalledOnce(); // still 1
    });

    it("should not throw if callback throws", () => {
      const tracker = new UsageTracker();
      tracker.setOnRecordCallback(() => {
        throw new Error("persistence failed");
      });

      // record() should not throw even if callback does
      expect(() => {
        tracker.record("s1", "claude-sonnet-4-20250514", "anthropic", usage());
      }).not.toThrow();

      // The usage should still be recorded
      const record = tracker.getRecord("s1");
      expect(record).toBeDefined();
      expect(record!.usage.promptTokens).toBe(100);
    });

    it("should not fire during hydrate()", () => {
      const tracker = new UsageTracker();
      const callback = vi.fn();
      tracker.setOnRecordCallback(callback);

      tracker.hydrate("s1", "claude-sonnet-4-20250514", "anthropic", {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        estimatedCost: 0.05,
        requestCount: 10,
      });

      expect(callback).not.toHaveBeenCalled();
    });
  });
});
