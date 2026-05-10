import { describe, it, expect, vi } from "vitest";
import { worktreeCreateTool } from "../tools/create.js";
import { worktreeListTool } from "../tools/list.js";
import { worktreeSwitchTool } from "../tools/switch.js";
import { worktreeRemoveTool } from "../tools/remove.js";
import type { ToolContext } from "@ants/agent-core";
import type { WorktreeInfo } from "../types.js";

// ---------------------------------------------------------------------------
// Mock WorktreeManager
// ---------------------------------------------------------------------------

function createMockManager(overrides: Record<string, unknown> = {}) {
  return {
    create: vi.fn(async (): Promise<WorktreeInfo> => ({
      path: "/repo/.worktrees/repo-feature",
      branch: "feature",
      head: "abc1234567890def",
      isMain: false,
    })),
    list: vi.fn(async (): Promise<WorktreeInfo[]> => [
      { path: "/repo", branch: "main", head: "abc12345", isMain: true },
      { path: "/repo/.worktrees/repo-feature", branch: "feature", head: "def67890", isMain: false },
    ]),
    switch: vi.fn(async (): Promise<WorktreeInfo> => ({
      path: "/repo/.worktrees/repo-feature",
      branch: "feature",
      head: "def67890abcdef12",
      isMain: false,
    })),
    remove: vi.fn(async () => {}),
    current: vi.fn(async (): Promise<WorktreeInfo | null> => ({
      path: "/repo",
      branch: "main",
      head: "abc12345",
      isMain: true,
    })),
    ...overrides,
  };
}

function createMockContext(manager?: unknown): ToolContext {
  return {
    workingDirectory: "/repo",
    abortSignal: new AbortController().signal,
    extensions: manager
      ? { "worktree.manager": manager }
      : {},
  } as ToolContext;
}

// ---------------------------------------------------------------------------
// worktree_create
// ---------------------------------------------------------------------------

describe("worktreeCreateTool", () => {
  it("should have correct metadata", () => {
    expect(worktreeCreateTool.name).toBe("worktree_create");
    expect(worktreeCreateTool.description).toBeDefined();
    expect(worktreeCreateTool.description!.length).toBeGreaterThan(0);
  });

  it("should return error when manager is not available", async () => {
    const ctx = createMockContext();
    const result = await worktreeCreateTool.execute(
      { branch: "feature", createBranch: true },
      ctx
    );
    expect(result.output).toContain("not initialized");
    expect(result.metadata?.error).toBe(true);
  });

  it("should create and switch to a worktree", async () => {
    const manager = createMockManager();
    const ctx = createMockContext(manager);
    const result = await worktreeCreateTool.execute(
      { branch: "feature", createBranch: true },
      ctx
    );

    expect(manager.create).toHaveBeenCalledWith({
      branch: "feature",
      baseBranch: undefined,
      createBranch: true,
    });
    expect(manager.switch).toHaveBeenCalledWith(
      "/repo/.worktrees/repo-feature"
    );

    const parsed = JSON.parse(result.output);
    expect(parsed.success).toBe(true);
    expect(parsed.worktree.branch).toBe("feature");
  });

  it("should pass baseBranch to manager", async () => {
    const manager = createMockManager();
    const ctx = createMockContext(manager);
    await worktreeCreateTool.execute(
      { branch: "feature", baseBranch: "develop", createBranch: true },
      ctx
    );

    expect(manager.create).toHaveBeenCalledWith({
      branch: "feature",
      baseBranch: "develop",
      createBranch: true,
    });
  });

  it("should handle errors gracefully", async () => {
    const manager = createMockManager({
      create: vi.fn().mockRejectedValue(new Error("branch already exists")),
    });
    const ctx = createMockContext(manager);
    const result = await worktreeCreateTool.execute(
      { branch: "feature", createBranch: true },
      ctx
    );

    expect(result.output).toContain("Failed to create worktree");
    expect(result.output).toContain("branch already exists");
    expect(result.metadata?.error).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// worktree_list
// ---------------------------------------------------------------------------

describe("worktreeListTool", () => {
  it("should have correct metadata", () => {
    expect(worktreeListTool.name).toBe("worktree_list");
    expect(worktreeListTool.description).toBeDefined();
  });

  it("should return error when manager is not available", async () => {
    const ctx = createMockContext();
    const result = await worktreeListTool.execute({} as Record<string, never>, ctx);
    expect(result.output).toContain("not initialized");
    expect(result.metadata?.error).toBe(true);
  });

  it("should list worktrees with current indicator", async () => {
    const manager = createMockManager();
    const ctx = createMockContext(manager);
    const result = await worktreeListTool.execute({} as Record<string, never>, ctx);

    const parsed = JSON.parse(result.output);
    expect(parsed.count).toBe(2);
    expect(parsed.worktrees).toHaveLength(2);
    expect(parsed.worktrees[0].isMain).toBe(true);
    expect(parsed.worktrees[0].isCurrent).toBe(true);
    expect(parsed.worktrees[1].isCurrent).toBe(false);
    expect(parsed.currentWorktree).toBe("/repo");
  });

  it("should truncate head to 8 characters", async () => {
    const manager = createMockManager();
    const ctx = createMockContext(manager);
    const result = await worktreeListTool.execute({} as Record<string, never>, ctx);

    const parsed = JSON.parse(result.output);
    expect(parsed.worktrees[0].head).toBe("abc12345");
    expect(parsed.worktrees[0].head.length).toBeLessThanOrEqual(8);
  });

  it("should handle errors gracefully", async () => {
    const manager = createMockManager({
      list: vi.fn().mockRejectedValue(new Error("git error")),
    });
    const ctx = createMockContext(manager);
    const result = await worktreeListTool.execute({} as Record<string, never>, ctx);

    expect(result.output).toContain("Failed to list worktrees");
    expect(result.metadata?.error).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// worktree_switch
// ---------------------------------------------------------------------------

describe("worktreeSwitchTool", () => {
  it("should have correct metadata", () => {
    expect(worktreeSwitchTool.name).toBe("worktree_switch");
    expect(worktreeSwitchTool.description).toBeDefined();
  });

  it("should return error when manager is not available", async () => {
    const ctx = createMockContext();
    const result = await worktreeSwitchTool.execute(
      { path: "/repo/.worktrees/repo-feature" },
      ctx
    );
    expect(result.output).toContain("not initialized");
    expect(result.metadata?.error).toBe(true);
  });

  it("should switch to the specified worktree", async () => {
    const manager = createMockManager();
    const ctx = createMockContext(manager);
    const result = await worktreeSwitchTool.execute(
      { path: "/repo/.worktrees/repo-feature" },
      ctx
    );

    expect(manager.switch).toHaveBeenCalledWith(
      "/repo/.worktrees/repo-feature"
    );

    const parsed = JSON.parse(result.output);
    expect(parsed.success).toBe(true);
    expect(parsed.worktree.branch).toBe("feature");
  });

  it("should handle errors gracefully", async () => {
    const manager = createMockManager({
      switch: vi.fn().mockRejectedValue(new Error("Not a valid worktree")),
    });
    const ctx = createMockContext(manager);
    const result = await worktreeSwitchTool.execute(
      { path: "/nonexistent" },
      ctx
    );

    expect(result.output).toContain("Failed to switch worktree");
    expect(result.output).toContain("Not a valid worktree");
    expect(result.metadata?.error).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// worktree_remove
// ---------------------------------------------------------------------------

describe("worktreeRemoveTool", () => {
  it("should have correct metadata", () => {
    expect(worktreeRemoveTool.name).toBe("worktree_remove");
    expect(worktreeRemoveTool.description).toBeDefined();
  });

  it("should return error when manager is not available", async () => {
    const ctx = createMockContext();
    const result = await worktreeRemoveTool.execute(
      { path: "/repo/.worktrees/repo-feature" },
      ctx
    );
    expect(result.output).toContain("not initialized");
    expect(result.metadata?.error).toBe(true);
  });

  it("should remove a worktree", async () => {
    const manager = createMockManager();
    const ctx = createMockContext(manager);
    const result = await worktreeRemoveTool.execute(
      { path: "/repo/.worktrees/repo-feature" },
      ctx
    );

    expect(manager.remove).toHaveBeenCalledWith(
      "/repo/.worktrees/repo-feature",
      { force: undefined }
    );

    const parsed = JSON.parse(result.output);
    expect(parsed.success).toBe(true);
    expect(parsed.note).toContain("not deleted");
  });

  it("should pass force option", async () => {
    const manager = createMockManager();
    const ctx = createMockContext(manager);
    await worktreeRemoveTool.execute(
      { path: "/repo/.worktrees/repo-feature", force: true },
      ctx
    );

    expect(manager.remove).toHaveBeenCalledWith(
      "/repo/.worktrees/repo-feature",
      { force: true }
    );
  });

  it("should handle errors gracefully", async () => {
    const manager = createMockManager({
      remove: vi.fn().mockRejectedValue(new Error("Cannot remove the main worktree")),
    });
    const ctx = createMockContext(manager);
    const result = await worktreeRemoveTool.execute(
      { path: "/repo" },
      ctx
    );

    expect(result.output).toContain("Failed to remove worktree");
    expect(result.output).toContain("Cannot remove the main worktree");
    expect(result.metadata?.error).toBe(true);
  });
});
