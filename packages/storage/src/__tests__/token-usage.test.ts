/**
 * Tests for token usage persistence in SessionManager.
 *
 * Tests incrementTokenUsage() and getTokenUsage() methods that persist
 * actual API-reported token stats to the sessions table.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createInMemoryDatabase, SessionManager } from "../index.js";
import type { NodeDatabaseConnection } from "../index.js";

describe("SessionManager token usage", () => {
  let connection: NodeDatabaseConnection;
  let manager: SessionManager;
  let sessionId: string;

  beforeEach(async () => {
    connection = createInMemoryDatabase();
    manager = new SessionManager(connection.db);
    const session = await manager.createSession({
      workingDirectory: "/test",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
    });
    sessionId = session.id;
  });

  afterEach(() => {
    connection?.close();
  });

  describe("getTokenUsage", () => {
    it("returns zeroes for a new session", async () => {
      const usage = await manager.getTokenUsage(sessionId);
      expect(usage).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        estimatedCost: 0,
        requestCount: 0,
      });
    });

    it("returns null for non-existent session", async () => {
      const usage = await manager.getTokenUsage("nonexistent");
      expect(usage).toBeNull();
    });
  });

  describe("incrementTokenUsage", () => {
    it("increments all token stats atomically", async () => {
      await manager.incrementTokenUsage(sessionId, {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cacheCreationInputTokens: 10,
        cacheReadInputTokens: 20,
        estimatedCost: 0.005,
      });

      const usage = await manager.getTokenUsage(sessionId);
      expect(usage).toEqual({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cacheCreationInputTokens: 10,
        cacheReadInputTokens: 20,
        estimatedCost: 0.005,
        requestCount: 1,
      });
    });

    it("accumulates across multiple calls", async () => {
      // Simulate 3 LLM calls
      for (let i = 0; i < 3; i++) {
        await manager.incrementTokenUsage(sessionId, {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          cacheCreationInputTokens: 10,
          cacheReadInputTokens: 20,
          estimatedCost: 0.005,
        });
      }

      const usage = await manager.getTokenUsage(sessionId);
      expect(usage).toEqual({
        promptTokens: 300,
        completionTokens: 150,
        totalTokens: 450,
        cacheCreationInputTokens: 30,
        cacheReadInputTokens: 60,
        estimatedCost: expect.closeTo(0.015, 5),
        requestCount: 3,
      });
    });

    it("handles zero cache tokens gracefully", async () => {
      await manager.incrementTokenUsage(sessionId, {
        promptTokens: 200,
        completionTokens: 100,
        totalTokens: 300,
        estimatedCost: 0.01,
      });

      const usage = await manager.getTokenUsage(sessionId);
      expect(usage!.cacheCreationInputTokens).toBe(0);
      expect(usage!.cacheReadInputTokens).toBe(0);
      expect(usage!.promptTokens).toBe(200);
    });

    it("does not affect other sessions", async () => {
      const session2 = await manager.createSession({
        workingDirectory: "/test2",
        provider: "openai",
        model: "gpt-4o",
      });

      await manager.incrementTokenUsage(sessionId, {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        estimatedCost: 0.005,
      });

      const usage1 = await manager.getTokenUsage(sessionId);
      const usage2 = await manager.getTokenUsage(session2.id);

      expect(usage1!.promptTokens).toBe(100);
      expect(usage1!.requestCount).toBe(1);
      expect(usage2!.promptTokens).toBe(0);
      expect(usage2!.requestCount).toBe(0);
    });

    it("persists token stats that survive session reload", async () => {
      // Simulate usage during a session
      await manager.incrementTokenUsage(sessionId, {
        promptTokens: 500,
        completionTokens: 200,
        totalTokens: 700,
        cacheCreationInputTokens: 50,
        cacheReadInputTokens: 100,
        estimatedCost: 0.025,
      });

      // "Reload" — create a new SessionManager on the same DB
      const manager2 = new SessionManager(connection.db);
      const usage = await manager2.getTokenUsage(sessionId);

      expect(usage).toEqual({
        promptTokens: 500,
        completionTokens: 200,
        totalTokens: 700,
        cacheCreationInputTokens: 50,
        cacheReadInputTokens: 100,
        estimatedCost: 0.025,
        requestCount: 1,
      });
    });

    it("new sessions have token stats columns initialised to zero", async () => {
      const session = await manager.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session!.promptTokens).toBe(0);
      expect(session!.completionTokens).toBe(0);
      expect(session!.totalTokens).toBe(0);
      expect(session!.cacheCreationInputTokens).toBe(0);
      expect(session!.cacheReadInputTokens).toBe(0);
      expect(session!.estimatedCost).toBe(0);
      expect(session!.requestCount).toBe(0);
    });
  });
});
