import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStorage } from "../storage.js";
import { closeAllMemoryDbs, createInMemoryDb } from "../database.js";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

describe("MemoryStorage", () => {
  let storage: MemoryStorage;
  let testDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-test-"));
  });

  afterEach(() => {
    // Clean up
    closeAllMemoryDbs();
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe("CRUD operations", () => {
    beforeEach(() => {
      storage = new MemoryStorage(testDir);
    });

    it("should create a memory", async () => {
      const result = await storage.create({
        content: "Test memory content",
        scope: "/test",
        tags: ["test", "example"],
        author: "tester",
      });

      expect(result.id).toBeDefined();
      expect(result.content).toBe("Test memory content");
      expect(result.scope).toBe("/test");
      expect(result.tags).toEqual(["test", "example"]);
      expect(result.author).toBe("tester");
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it("should use default scope when not provided", async () => {
      const result = await storage.create({
        content: "Memory without scope",
      });

      expect(result.scope).toBe("/");
      expect(result.tags).toEqual([]);
    });

    it("should get a memory by id", async () => {
      const created = await storage.create({
        content: "Get test",
        scope: "/get-test",
      });

      const retrieved = await storage.get(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.content).toBe("Get test");
    });

    it("should return null for non-existent memory", async () => {
      const result = await storage.get("non-existent-id");
      expect(result).toBeNull();
    });

    it("should update a memory", async () => {
      const created = await storage.create({
        content: "Original content",
        scope: "/update-test",
        tags: ["original"],
      });

      const updated = await storage.update(created.id, {
        content: "Updated content",
        tags: ["updated", "modified"],
      });

      expect(updated).not.toBeNull();
      expect(updated!.content).toBe("Updated content");
      expect(updated!.tags).toEqual(["updated", "modified"]);
      expect(updated!.scope).toBe("/update-test");
    });

    it("should return null when updating non-existent memory", async () => {
      const result = await storage.update("non-existent-id", {
        content: "New content",
      });
      expect(result).toBeNull();
    });

    it("should delete a memory", async () => {
      const created = await storage.create({
        content: "Delete test",
      });

      const deleted = await storage.delete(created.id);
      expect(deleted).toBe(true);

      const retrieved = await storage.get(created.id);
      expect(retrieved).toBeNull();
    });

    it("should return false when deleting non-existent memory", async () => {
      const result = await storage.delete("non-existent-id");
      expect(result).toBe(false);
    });
  });

  describe("list", () => {
    beforeEach(async () => {
      storage = new MemoryStorage(testDir);
      
      // Create test memories
      await storage.create({ content: "Memory 1", scope: "/", tags: ["a"] });
      await storage.create({ content: "Memory 2", scope: "/project", tags: ["b"] });
      await storage.create({ content: "Memory 3", scope: "/project/src", tags: ["a", "b"] });
    });

    it("should list all memories", async () => {
      const memories = await storage.list();
      expect(memories.length).toBe(3);
    });

    it("should filter by scope", async () => {
      const memories = await storage.list({ scope: "/project" });
      expect(memories.length).toBe(2);
      expect(memories.every(m => m.scope.startsWith("/project"))).toBe(true);
    });

    it("should filter by tags", async () => {
      const memories = await storage.list({ tags: ["a"] });
      expect(memories.length).toBe(2);
    });

    it("should apply limit", async () => {
      const memories = await storage.list({ limit: 2 });
      expect(memories.length).toBe(2);
    });

    it("should apply offset", async () => {
      const allMemories = await storage.list();
      const offsetMemories = await storage.list({ offset: 1 });
      expect(offsetMemories.length).toBe(allMemories.length - 1);
    });
  });

  describe("count", () => {
    beforeEach(() => {
      storage = new MemoryStorage(testDir);
    });

    it("should return 0 for empty storage", async () => {
      const count = await storage.count();
      expect(count).toBe(0);
    });

    it("should return correct count after adding memories", async () => {
      await storage.create({ content: "Memory 1" });
      await storage.create({ content: "Memory 2" });
      await storage.create({ content: "Memory 3" });

      const count = await storage.count();
      expect(count).toBe(3);
    });
  });

  describe("getScopedMemories", () => {
    beforeEach(async () => {
      storage = new MemoryStorage(testDir);
      
      await storage.create({ content: "Root memory", scope: "/" });
      await storage.create({ content: "Project memory", scope: "/project" });
      await storage.create({ content: "Src memory", scope: "/project/src" });
      await storage.create({ content: "Other memory", scope: "/other" });
    });

    it("should return memories from current and parent scopes", async () => {
      const memories = await storage.getScopedMemories("/project/src");
      expect(memories.length).toBe(3);
      
      const scopes = memories.map(m => m.scope);
      expect(scopes).toContain("/");
      expect(scopes).toContain("/project");
      expect(scopes).toContain("/project/src");
      expect(scopes).not.toContain("/other");
    });

    it("should return only root memory for root path", async () => {
      const memories = await storage.getScopedMemories("/");
      expect(memories.length).toBe(1);
      expect(memories[0].scope).toBe("/");
    });
  });

  describe("checkEmbeddingsStatus", () => {
    beforeEach(async () => {
      storage = new MemoryStorage(testDir);
      await storage.create({ content: "Test memory" });
    });

    it("should return embeddings status", async () => {
      const status = await storage.checkEmbeddingsStatus();
      
      expect(typeof status.available).toBe("boolean");
      expect(typeof status.totalMemories).toBe("number");
      expect(typeof status.memoriesWithEmbeddings).toBe("number");
      expect(status.totalMemories).toBe(1);
    });
  });
});
