import { describe, it, expect, afterEach } from "vitest";
import {
  createInMemoryDatabase,
  sessions,
  messages,
  compactionHistory,
  mcpOAuthTokens,
  memoryEntries,
  anthropicTokens,
  type SessionRow,
  type MessageRow,
} from "../index.js";
import { eq } from "drizzle-orm";

describe("Database", () => {
  let testDb: ReturnType<typeof createInMemoryDatabase>;

  afterEach(() => {
    if (testDb) {
      testDb.close();
    }
  });

  describe("createInMemoryDatabase", () => {
    it("should create an in-memory database", () => {
      testDb = createInMemoryDatabase();
      expect(testDb.db).toBeDefined();
      expect(testDb.sqlite).toBeDefined();
      expect(typeof testDb.close).toBe("function");
    });
  });

  describe("Schema exports", () => {
    it("should export all table definitions", () => {
      expect(sessions).toBeDefined();
      expect(messages).toBeDefined();
      expect(compactionHistory).toBeDefined();
      expect(mcpOAuthTokens).toBeDefined();
      expect(memoryEntries).toBeDefined();
      expect(anthropicTokens).toBeDefined();
    });
  });

  describe("Sessions table", () => {
    it("should insert and query sessions", () => {
      testDb = createInMemoryDatabase();
      const { db } = testDb;

      const now = new Date();
      const sessionData = {
        id: "test-session-1",
        workingDirectory: "/test",
        provider: "anthropic",
        model: "claude-3-5-sonnet",
        createdAt: now,
        updatedAt: now,
      };

      db.insert(sessions).values(sessionData).run();

      const result = db
        .select()
        .from(sessions)
        .where(eq(sessions.id, "test-session-1"))
        .all();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("test-session-1");
      expect(result[0].workingDirectory).toBe("/test");
      expect(result[0].provider).toBe("anthropic");
      expect(result[0].model).toBe("claude-3-5-sonnet");
    });

    it("should support optional fields", () => {
      testDb = createInMemoryDatabase();
      const { db } = testDb;

      const now = new Date();
      db.insert(sessions).values({
        id: "test-session-2",
        parentId: "parent-session",
        workingDirectory: "/test",
        title: "Test Session",
        provider: "openai",
        model: "gpt-4",
        systemPrompt: "You are helpful.",
        compactionEnabled: true,
        compactionModel: "claude-3-haiku",
        compactionTokenThreshold: 50000,
        createdAt: now,
        updatedAt: now,
      }).run();

      const result = db
        .select()
        .from(sessions)
        .where(eq(sessions.id, "test-session-2"))
        .all();

      expect(result[0].parentId).toBe("parent-session");
      expect(result[0].title).toBe("Test Session");
      expect(result[0].compactionEnabled).toBe(true);
      expect(result[0].compactionModel).toBe("claude-3-haiku");
    });
  });

  describe("Messages table", () => {
    it("should insert and query messages", () => {
      testDb = createInMemoryDatabase();
      const { db } = testDb;

      const now = new Date();
      
      // First insert a session
      db.insert(sessions).values({
        id: "test-session",
        workingDirectory: "/test",
        provider: "anthropic",
        model: "claude-3-5-sonnet",
        createdAt: now,
        updatedAt: now,
      }).run();

      // Then insert messages
      db.insert(messages).values({
        id: "msg-1",
        sessionId: "test-session",
        role: "user",
        content: "Hello!",
        sequence: 0,
        createdAt: now,
      }).run();

      db.insert(messages).values({
        id: "msg-2",
        sessionId: "test-session",
        role: "assistant",
        content: "Hi there!",
        sequence: 1,
        createdAt: now,
      }).run();

      const result = db
        .select()
        .from(messages)
        .where(eq(messages.sessionId, "test-session"))
        .orderBy(messages.sequence)
        .all();

      expect(result).toHaveLength(2);
      expect(result[0].role).toBe("user");
      expect(result[1].role).toBe("assistant");
    });

    it("should support tool calls and results", () => {
      testDb = createInMemoryDatabase();
      const { db } = testDb;

      const now = new Date();
      
      db.insert(sessions).values({
        id: "test-session",
        workingDirectory: "/test",
        provider: "anthropic",
        model: "claude-3-5-sonnet",
        createdAt: now,
        updatedAt: now,
      }).run();

      const toolCalls = [
        { id: "call-1", name: "bash", arguments: { command: "ls" } }
      ];
      const toolResults = [
        { toolCallId: "call-1", content: "file1.txt\nfile2.txt" }
      ];

      db.insert(messages).values({
        id: "msg-with-tools",
        sessionId: "test-session",
        role: "assistant",
        content: "Let me check the files.",
        toolCalls,
        toolResults,
        sequence: 0,
        createdAt: now,
      }).run();

      const result = db
        .select()
        .from(messages)
        .where(eq(messages.id, "msg-with-tools"))
        .all();

      expect(result[0].toolCalls).toEqual(toolCalls);
      expect(result[0].toolResults).toEqual(toolResults);
    });
  });

  describe("Type exports", () => {
    it("should provide proper TypeScript types", () => {
      // This is a compile-time check - if types are wrong, TypeScript will fail
      const session: SessionRow = {
        id: "test",
        parentId: null,
        userId: null,
        workingDirectory: "/",
        title: null,
        provider: "anthropic",
        model: "claude-3",
        systemPrompt: null,
        compactionEnabled: true,
        compactionModel: null,
        compactionTokenThreshold: null,
        tokenEstimate: 0,
        messageCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const message: MessageRow = {
        id: "test-msg",
        sessionId: "test",
        role: "user",
        content: "Hello",
        toolCalls: null,
        toolResults: null,
        isCompactionSummary: false,
        tokenCount: null,
        sequence: 0,
        createdAt: new Date(),
      };

      expect(session.id).toBe("test");
      expect(message.role).toBe("user");
    });
  });
});
