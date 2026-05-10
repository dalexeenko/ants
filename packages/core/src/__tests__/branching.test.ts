/**
 * Tests for conversation branching (ConversationTree).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { ConversationTree } from "../branching/index.js";
import type { Message } from "../types.js";

function msg(id: string, role: "user" | "assistant", content: string): Message {
  return { id, role, content, createdAt: Date.now() };
}

describe("ConversationTree", () => {
  let tree: ConversationTree;

  beforeEach(() => {
    tree = new ConversationTree();
  });

  // =========================================================================
  // Basic message management
  // =========================================================================

  describe("messages", () => {
    it("should start with empty messages", () => {
      expect(tree.getMessages()).toEqual([]);
    });

    it("should add messages and retrieve them in order", () => {
      tree.addMessage(msg("1", "user", "Hello"));
      tree.addMessage(msg("2", "assistant", "Hi!"));
      tree.addMessage(msg("3", "user", "How are you?"));

      const messages = tree.getMessages();
      expect(messages).toHaveLength(3);
      expect(messages[0]!.content).toBe("Hello");
      expect(messages[1]!.content).toBe("Hi!");
      expect(messages[2]!.content).toBe("How are you?");
    });

    it("should increment node count on add", () => {
      expect(tree.nodeCount).toBe(0);
      tree.addMessage(msg("1", "user", "A"));
      expect(tree.nodeCount).toBe(1);
      tree.addMessage(msg("2", "assistant", "B"));
      expect(tree.nodeCount).toBe(2);
    });
  });

  // =========================================================================
  // Branching
  // =========================================================================

  describe("branching", () => {
    it("should start with one 'main' branch", () => {
      const branches = tree.getBranches();
      expect(branches).toHaveLength(1);
      expect(branches[0]!.name).toBe("main");
      expect(branches[0]!.isActive).toBe(true);
    });

    it("should create a new branch from current head", () => {
      tree.addMessage(msg("1", "user", "Hello"));
      tree.addMessage(msg("2", "assistant", "Hi"));

      const branch = tree.createBranch("experiment");
      expect(branch.name).toBe("experiment");
      expect(branch.forkPointId).toBeTruthy();
      expect(tree.branchCount).toBe(2);
    });

    it("should switch between branches", () => {
      tree.addMessage(msg("1", "user", "Hello"));
      tree.addMessage(msg("2", "assistant", "Hi"));

      const branch = tree.createBranch("alt");
      tree.switchBranch(branch.id);

      expect(tree.getActiveBranch().id).toBe(branch.id);
      // Messages on alt branch should be same (forked from head)
      expect(tree.getMessages()).toHaveLength(2);

      // Add message to alt branch
      tree.addMessage(msg("3", "user", "Alt message"));
      expect(tree.getMessages()).toHaveLength(3);

      // Switch back to main — should NOT have the alt message
      tree.switchBranch("main");
      expect(tree.getMessages()).toHaveLength(2);
    });

    it("should throw when switching to nonexistent branch", () => {
      expect(() => tree.switchBranch("nonexistent")).toThrow("Branch not found");
    });

    it("should delete a branch", () => {
      tree.addMessage(msg("1", "user", "Hello"));
      const branch = tree.createBranch("temp");
      expect(tree.branchCount).toBe(2);
      expect(tree.deleteBranch(branch.id)).toBe(true);
      expect(tree.branchCount).toBe(1);
    });

    it("should not delete the main branch", () => {
      expect(() => tree.deleteBranch("main")).toThrow("Cannot delete the main branch");
    });

    it("should not delete the active branch", () => {
      tree.addMessage(msg("1", "user", "Hello"));
      const branch = tree.createBranch("active");
      tree.switchBranch(branch.id);
      expect(() => tree.deleteBranch(branch.id)).toThrow("Cannot delete the active branch");
    });
  });

  // =========================================================================
  // Fork points
  // =========================================================================

  describe("fork points", () => {
    it("should detect fork points", () => {
      tree.addMessage(msg("1", "user", "Hello"));
      const m2 = tree.addMessage(msg("2", "assistant", "Hi"));

      // Not a fork point yet
      expect(tree.isForkPoint(m2.id)).toBe(false);

      // Create a branch from m2
      const branch = tree.createBranch("branch-a");
      tree.switchBranch(branch.id);
      tree.addMessage(msg("3a", "user", "Branch A"));

      tree.switchBranch("main");
      tree.addMessage(msg("3b", "user", "Main branch"));

      // Now m2 has two children
      expect(tree.isForkPoint(m2.id)).toBe(true);
      expect(tree.getChildren(m2.id)).toHaveLength(2);
    });
  });

  // =========================================================================
  // Rollback
  // =========================================================================

  describe("rollback", () => {
    it("should rollback to a specific node", () => {
      const n1 = tree.addMessage(msg("1", "user", "Hello"));
      tree.addMessage(msg("2", "assistant", "Hi"));
      tree.addMessage(msg("3", "user", "More"));

      expect(tree.getMessages()).toHaveLength(3);
      tree.rollback(n1.id);
      expect(tree.getMessages()).toHaveLength(1);
    });

    it("should rollback by N messages", () => {
      tree.addMessage(msg("1", "user", "A"));
      tree.addMessage(msg("2", "assistant", "B"));
      tree.addMessage(msg("3", "user", "C"));
      tree.addMessage(msg("4", "assistant", "D"));

      tree.rollbackN(2);
      expect(tree.getMessages()).toHaveLength(2);
    });

    it("should throw when rolling back too many messages", () => {
      tree.addMessage(msg("1", "user", "A"));
      tree.addMessage(msg("2", "assistant", "B"));
      expect(() => tree.rollbackN(5)).toThrow("Cannot rollback");
    });

    it("should throw when rolling back to nonexistent node", () => {
      expect(() => tree.rollback("nonexistent")).toThrow("Node not found");
    });
  });

  // =========================================================================
  // Clear
  // =========================================================================

  describe("clear", () => {
    it("should reset tree to initial state", () => {
      tree.addMessage(msg("1", "user", "A"));
      tree.addMessage(msg("2", "assistant", "B"));
      tree.createBranch("branch");

      tree.clear();
      expect(tree.nodeCount).toBe(0);
      expect(tree.branchCount).toBe(1); // main branch recreated
      expect(tree.getMessages()).toEqual([]);
      expect(tree.getActiveBranch().name).toBe("main");
    });
  });
});
