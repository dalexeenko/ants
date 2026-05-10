import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createInMemoryDatabase, SessionManager } from "../index.js";
import type { NodeDatabaseConnection } from "../index.js";

describe("SessionManager", () => {
  let connection: NodeDatabaseConnection;
  let manager: SessionManager;

  beforeEach(() => {
    connection = createInMemoryDatabase();
    manager = new SessionManager(connection.db);
    // No need to create tables - createInMemoryDatabase() already does it
  });

  afterEach(() => {
    connection?.close();
  });

  describe("createSession", () => {
    it("creates a session with required fields", async () => {
      const session = await manager.createSession({
        workingDirectory: "/test",
        provider: "anthropic",
        model: "claude-3-opus",
      });

      expect(session.id).toBeDefined();
      expect(session.workingDirectory).toBe("/test");
      expect(session.provider).toBe("anthropic");
      expect(session.model).toBe("claude-3-opus");
      expect(session.compactionEnabled).toBe(true);
      expect(session.tokenEstimate).toBe(0);
      expect(session.messageCount).toBe(0);
    });

    it("creates a session with custom id", async () => {
      const session = await manager.createSession({
        id: "custom-id",
        workingDirectory: "/test",
        provider: "anthropic",
        model: "claude-3-opus",
      });

      expect(session.id).toBe("custom-id");
    });

    it("creates a session with optional fields", async () => {
      const session = await manager.createSession({
        workingDirectory: "/test",
        provider: "anthropic",
        model: "claude-3-opus",
        title: "Test Session",
        systemPrompt: "You are a helpful assistant",
        compactionEnabled: false,
        compactionTokenThreshold: 50000,
      });

      expect(session.title).toBe("Test Session");
      expect(session.systemPrompt).toBe("You are a helpful assistant");
      expect(session.compactionEnabled).toBe(false);
      expect(session.compactionTokenThreshold).toBe(50000);
    });
  });

  describe("getSession", () => {
    it("returns null for non-existent session", async () => {
      const session = await manager.getSession("non-existent");
      expect(session).toBeNull();
    });

    it("returns the session if it exists", async () => {
      const created = await manager.createSession({
        workingDirectory: "/test",
        provider: "anthropic",
        model: "claude-3-opus",
      });

      const fetched = await manager.getSession(created.id);
      expect(fetched).toEqual(created);
    });
  });

  describe("updateSession", () => {
    it("updates session fields", async () => {
      const session = await manager.createSession({
        workingDirectory: "/test",
        provider: "anthropic",
        model: "claude-3-opus",
      });

      const updated = await manager.updateSession(session.id, {
        title: "Updated Title",
        tokenEstimate: 1000,
      });

      expect(updated?.title).toBe("Updated Title");
      expect(updated?.tokenEstimate).toBe(1000);
    });
  });

  describe("addMessage", () => {
    it("adds a message to a session", async () => {
      const session = await manager.createSession({
        workingDirectory: "/test",
        provider: "anthropic",
        model: "claude-3-opus",
      });

      const message = await manager.addMessage({
        sessionId: session.id,
        role: "user",
        content: "Hello",
        sequence: 0,
        tokenCount: 10,
      });

      expect(message.id).toBeDefined();
      expect(message.sessionId).toBe(session.id);
      expect(message.role).toBe("user");
      expect(message.content).toBe("Hello");
      expect(message.sequence).toBe(0);

      // Check session was updated
      const updatedSession = await manager.getSession(session.id);
      expect(updatedSession?.messageCount).toBe(1);
      expect(updatedSession?.tokenEstimate).toBe(10);
    });

    it("adds multiple messages in sequence", async () => {
      const session = await manager.createSession({
        workingDirectory: "/test",
        provider: "anthropic",
        model: "claude-3-opus",
      });

      await manager.addMessage({
        sessionId: session.id,
        role: "user",
        content: "Hello",
        sequence: 0,
      });

      await manager.addMessage({
        sessionId: session.id,
        role: "assistant",
        content: "Hi there!",
        sequence: 1,
      });

      const messages = await manager.getSessionMessages(session.id);
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("user");
      expect(messages[1].role).toBe("assistant");
    });
  });

  describe("getSessionMessages", () => {
    it("returns messages in sequence order", async () => {
      const session = await manager.createSession({
        workingDirectory: "/test",
        provider: "anthropic",
        model: "claude-3-opus",
      });

      // Add messages out of order
      await manager.addMessage({
        sessionId: session.id,
        role: "assistant",
        content: "Response",
        sequence: 1,
      });

      await manager.addMessage({
        sessionId: session.id,
        role: "user",
        content: "Question",
        sequence: 0,
      });

      const messages = await manager.getSessionMessages(session.id);
      expect(messages[0].sequence).toBe(0);
      expect(messages[1].sequence).toBe(1);
    });
  });

  describe("getNextSequence", () => {
    it("returns 0 for empty session", async () => {
      const session = await manager.createSession({
        workingDirectory: "/test",
        provider: "anthropic",
        model: "claude-3-opus",
      });

      const nextSeq = await manager.getNextSequence(session.id);
      expect(nextSeq).toBe(0);
    });

    it("returns next sequence number", async () => {
      const session = await manager.createSession({
        workingDirectory: "/test",
        provider: "anthropic",
        model: "claude-3-opus",
      });

      await manager.addMessage({
        sessionId: session.id,
        role: "user",
        content: "Hello",
        sequence: 0,
      });

      const nextSeq = await manager.getNextSequence(session.id);
      expect(nextSeq).toBe(1);
    });
  });

  describe("recordCompaction", () => {
    it("records compaction history", async () => {
      const session = await manager.createSession({
        workingDirectory: "/test",
        provider: "anthropic",
        model: "claude-3-opus",
      });

      const compaction = await manager.recordCompaction({
        sessionId: session.id,
        summary: "Summary of conversation",
        originalTokens: 10000,
        compactedTokens: 500,
        messagesPruned: 20,
        fromSequence: 0,
        toSequence: 19,
      });

      expect(compaction.id).toBeDefined();
      expect(compaction.summary).toBe("Summary of conversation");
      expect(compaction.originalTokens).toBe(10000);
      expect(compaction.compactedTokens).toBe(500);

      const history = await manager.getCompactionHistory(session.id);
      expect(history).toHaveLength(1);
    });
  });

  describe("getSessionMessagesPaginated", () => {
    let session: Awaited<ReturnType<typeof manager.createSession>>;

    beforeEach(async () => {
      session = await manager.createSession({
        workingDirectory: "/test",
        provider: "anthropic",
        model: "claude-3-opus",
      });
    });

    async function addMessages(count: number) {
      for (let i = 0; i < count; i++) {
        await manager.addMessage({
          sessionId: session.id,
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Message ${i}`,
          sequence: i,
        });
      }
    }

    it("returns the most recent messages when no cursor is given", async () => {
      await addMessages(10);

      const result = await manager.getSessionMessagesPaginated(session.id, 5);

      expect(result.messages).toHaveLength(5);
      expect(result.hasMore).toBe(true);
      // Should return the last 5 messages (sequences 5-9) in ascending order
      expect(result.messages[0].sequence).toBe(5);
      expect(result.messages[4].sequence).toBe(9);
    });

    it("returns all messages when limit exceeds count", async () => {
      await addMessages(3);

      const result = await manager.getSessionMessagesPaginated(session.id, 10);

      expect(result.messages).toHaveLength(3);
      expect(result.hasMore).toBe(false);
      expect(result.messages[0].sequence).toBe(0);
      expect(result.messages[2].sequence).toBe(2);
    });

    it("returns empty array for session with no messages", async () => {
      const result = await manager.getSessionMessagesPaginated(session.id, 10);

      expect(result.messages).toHaveLength(0);
      expect(result.hasMore).toBe(false);
    });

    it("uses beforeSequence as a cursor for older pages", async () => {
      await addMessages(10);

      // First page: most recent 3
      const page1 = await manager.getSessionMessagesPaginated(session.id, 3);
      expect(page1.messages).toHaveLength(3);
      expect(page1.hasMore).toBe(true);
      expect(page1.messages[0].sequence).toBe(7);

      // Second page: before sequence 7
      const page2 = await manager.getSessionMessagesPaginated(
        session.id,
        3,
        page1.messages[0].sequence,
      );
      expect(page2.messages).toHaveLength(3);
      expect(page2.hasMore).toBe(true);
      expect(page2.messages[0].sequence).toBe(4);
      expect(page2.messages[2].sequence).toBe(6);

      // Third page: before sequence 4
      const page3 = await manager.getSessionMessagesPaginated(
        session.id,
        3,
        page2.messages[0].sequence,
      );
      expect(page3.messages).toHaveLength(3);
      expect(page3.hasMore).toBe(true);
      expect(page3.messages[0].sequence).toBe(1);
      expect(page3.messages[2].sequence).toBe(3);

      // Fourth page: before sequence 1, only 1 message left
      const page4 = await manager.getSessionMessagesPaginated(
        session.id,
        3,
        page3.messages[0].sequence,
      );
      expect(page4.messages).toHaveLength(1);
      expect(page4.hasMore).toBe(false);
      expect(page4.messages[0].sequence).toBe(0);
    });

    it("returns messages in ascending sequence order", async () => {
      await addMessages(5);

      const result = await manager.getSessionMessagesPaginated(session.id, 3);

      for (let i = 1; i < result.messages.length; i++) {
        expect(result.messages[i].sequence).toBeGreaterThan(
          result.messages[i - 1].sequence,
        );
      }
    });

    it("returns empty when beforeSequence is 0", async () => {
      await addMessages(5);

      const result = await manager.getSessionMessagesPaginated(session.id, 10, 0);

      expect(result.messages).toHaveLength(0);
      expect(result.hasMore).toBe(false);
    });

    it("correctly paginates through all messages without gaps or duplicates", async () => {
      await addMessages(20);

      const allSequences: number[] = [];
      let hasMore = true;
      let cursor: number | undefined;

      while (hasMore) {
        const page = await manager.getSessionMessagesPaginated(
          session.id,
          5,
          cursor,
        );
        for (const m of page.messages) {
          allSequences.push(m.sequence);
        }
        hasMore = page.hasMore;
        if (page.messages.length > 0) {
          cursor = page.messages[0].sequence;
        }
      }

      // Should have all 20 messages
      expect(allSequences).toHaveLength(20);
      // Should be in ascending order with no gaps
      const sorted = [...allSequences].sort((a, b) => a - b);
      expect(sorted).toEqual(Array.from({ length: 20 }, (_, i) => i));
    });

    it("preserves message content and role", async () => {
      await manager.addMessage({
        sessionId: session.id,
        role: "user",
        content: "Hello",
        sequence: 0,
        tokenCount: 5,
      });
      await manager.addMessage({
        sessionId: session.id,
        role: "assistant",
        content: "Hi there!",
        sequence: 1,
        tokenCount: 8,
      });

      const result = await manager.getSessionMessagesPaginated(session.id, 10);

      expect(result.messages[0].role).toBe("user");
      expect(result.messages[0].content).toBe("Hello");
      expect(result.messages[1].role).toBe("assistant");
      expect(result.messages[1].content).toBe("Hi there!");
    });

    it("handles limit of 1 correctly", async () => {
      await addMessages(3);

      const result = await manager.getSessionMessagesPaginated(session.id, 1);

      expect(result.messages).toHaveLength(1);
      expect(result.hasMore).toBe(true);
      expect(result.messages[0].sequence).toBe(2);
    });
  });
});
