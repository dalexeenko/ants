import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorktreeManager } from "../manager.js";
import { ProjectWorktreeManager } from "../project-worktree-manager.js";
import type { CommandExecutor, WorktreeFilesystem, GitCommandResult, WorktreeMetadata } from "../types.js";
import type { AgentInterface } from "@ants/agent-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(stdout: string): GitCommandResult {
  return { stdout, stderr: "", exitCode: 0 };
}

function fail(stderr: string): GitCommandResult {
  return { stdout: "", stderr, exitCode: 1 };
}

function createMockExecutor(responses?: Record<string, GitCommandResult>): CommandExecutor {
  const map = new Map(Object.entries(responses ?? {}));
  return {
    exec: vi.fn(async (command: string, _cwd: string): Promise<GitCommandResult> => {
      for (const [pattern, result] of map.entries()) {
        if (command.includes(pattern)) {
          return result;
        }
      }
      return ok("");
    }),
  };
}

function createMockFilesystem(files: Record<string, string> = {}): WorktreeFilesystem {
  const store = new Map(Object.entries(files));
  return {
    readFile: vi.fn(async (path: string) => {
      const content = store.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      store.set(path, content);
    }),
    exists: vi.fn(async (path: string) => store.has(path)),
    mkdir: vi.fn(async () => {}),
    rm: vi.fn(async () => {}),
    resolve: (...paths: string[]) => paths.join("/"),
    dirname: (p: string) => p.split("/").slice(0, -1).join("/"),
    basename: (p: string) => p.split("/").pop() || "",
    join: (...paths: string[]) => paths.join("/"),
  };
}

function createMockAgent(workingDirectory = "/repo"): AgentInterface {
  let cwd = workingDirectory;
  return {
    getWorkingDirectory: () => cwd,
    setWorkingDirectory: (dir: string) => { cwd = dir; },
    getConfig: () => ({ provider: "test", model: "test" }) as any,
    getExtension: () => undefined,
    setExtension: vi.fn(),
    emit: vi.fn(),
    on: vi.fn(),
  } as unknown as AgentInterface;
}

/** Create a metadata JSON with two worktrees */
function twoWorktreeMetadata(): WorktreeMetadata {
  return {
    version: 1,
    worktrees: [
      {
        id: "wt-main-id",
        path: "/repo/.worktrees/wt-main-id",
        branchName: "ants/session-main",
        baseBranch: "main",
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      {
        id: "wt-feature-id",
        path: "/repo/.worktrees/wt-feature-id",
        branchName: "ants/session-feature",
        baseBranch: "main",
        sessionId: "session-123",
        createdAt: "2025-01-02T00:00:00.000Z",
        updatedAt: "2025-01-02T00:00:00.000Z",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests — WorktreeManager (agent-aware wrapper)
// ---------------------------------------------------------------------------

describe("WorktreeManager", () => {
  let agent: AgentInterface;
  let fs: WorktreeFilesystem;
  let executor: CommandExecutor;
  let manager: WorktreeManager;

  beforeEach(() => {
    agent = createMockAgent("/repo");
    fs = createMockFilesystem({
      "/repo/.worktrees/metadata.json": JSON.stringify(twoWorktreeMetadata()),
      "/repo/.worktrees/wt-main-id": "dir",
      "/repo/.worktrees/wt-feature-id": "dir",
    });
    executor = createMockExecutor({
      "rev-parse --show-toplevel": ok("/repo\n"),
      "rev-parse --git-dir": ok(".git\n"),
      "rev-parse HEAD": ok("abc12345\n"),
    });
    manager = new WorktreeManager(() => agent, () => undefined, fs, executor);
  });

  // -----------------------------------------------------------------------
  // getRepoRoot
  // -----------------------------------------------------------------------

  describe("getRepoRoot", () => {
    it("should return the trimmed repo root", async () => {
      const root = await manager.getRepoRoot();
      expect(root).toBe("/repo");
    });

    it("should throw if not a git repo", async () => {
      executor = createMockExecutor({
        "rev-parse --show-toplevel": fail("fatal: not a git repository"),
      });
      manager = new WorktreeManager(() => agent, () => undefined, fs, executor);

      await expect(manager.getRepoRoot()).rejects.toThrow("failed");
    });
  });

  // -----------------------------------------------------------------------
  // getRepoName
  // -----------------------------------------------------------------------

  describe("getRepoName", () => {
    it("should return the basename of the repo root", async () => {
      const name = await manager.getRepoName();
      expect(name).toBe("repo");
    });
  });

  // -----------------------------------------------------------------------
  // isInWorktree
  // -----------------------------------------------------------------------

  describe("isInWorktree", () => {
    it("should return false when in main repo (.git)", async () => {
      executor = createMockExecutor({
        "rev-parse --show-toplevel": ok("/repo\n"),
        "rev-parse --git-common-dir": ok(".git\n"),
      });
      manager = new WorktreeManager(() => agent, () => undefined, fs, executor);

      expect(await manager.isInWorktree()).toBe(false);
    });

    it("should return true when in a worktree", async () => {
      executor = createMockExecutor({
        "rev-parse --show-toplevel": ok("/repo\n"),
        "rev-parse --git-common-dir": ok("/repo/.git/worktrees/feature\n"),
      });
      manager = new WorktreeManager(() => agent, () => undefined, fs, executor);

      expect(await manager.isInWorktree()).toBe(true);
    });

    it("should return false on git error", async () => {
      executor = createMockExecutor({
        "rev-parse --git-common-dir": fail("fatal: error"),
      });
      manager = new WorktreeManager(() => agent, () => undefined, fs, executor);

      expect(await manager.isInWorktree()).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // ensureGitignore
  // -----------------------------------------------------------------------

  describe("ensureGitignore", () => {
    it("should create .gitignore if it doesn't exist", async () => {
      const result = await manager.ensureGitignore();
      expect(result.added).toBe(true);
      expect(result.message).toContain("Created .gitignore");
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it("should add .worktrees/ to existing .gitignore", async () => {
      fs = createMockFilesystem({
        "/repo/.gitignore": "node_modules/\ndist/\n",
        "/repo/.worktrees/metadata.json": JSON.stringify(twoWorktreeMetadata()),
        "/repo/.worktrees/wt-main-id": "dir",
        "/repo/.worktrees/wt-feature-id": "dir",
      });
      manager = new WorktreeManager(() => agent, () => undefined, fs, executor);

      const result = await manager.ensureGitignore();
      expect(result.added).toBe(true);
      expect(result.message).toContain("Added .worktrees/");
    });

    it("should skip if .worktrees already in .gitignore", async () => {
      fs = createMockFilesystem({
        "/repo/.gitignore": "node_modules/\n.worktrees/\n",
        "/repo/.worktrees/metadata.json": JSON.stringify(twoWorktreeMetadata()),
        "/repo/.worktrees/wt-main-id": "dir",
        "/repo/.worktrees/wt-feature-id": "dir",
      });
      manager = new WorktreeManager(() => agent, () => undefined, fs, executor);

      const result = await manager.ensureGitignore();
      expect(result.added).toBe(false);
      expect(result.message).toContain("already in .gitignore");
    });

    it("should detect .worktrees without trailing slash", async () => {
      fs = createMockFilesystem({
        "/repo/.gitignore": ".worktrees\n",
        "/repo/.worktrees/metadata.json": JSON.stringify(twoWorktreeMetadata()),
        "/repo/.worktrees/wt-main-id": "dir",
        "/repo/.worktrees/wt-feature-id": "dir",
      });
      manager = new WorktreeManager(() => agent, () => undefined, fs, executor);

      const result = await manager.ensureGitignore();
      expect(result.added).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // list (now metadata-based)
  // -----------------------------------------------------------------------

  describe("list", () => {
    it("should list worktrees from metadata", async () => {
      const worktrees = await manager.list();
      expect(worktrees).toHaveLength(2);
      expect(worktrees[0]!.id).toBe("wt-main-id");
      expect(worktrees[0]!.branch).toBe("ants/session-main");
      expect(worktrees[1]!.id).toBe("wt-feature-id");
      expect(worktrees[1]!.sessionId).toBe("session-123");
    });

    it("should return empty array when no metadata exists", async () => {
      fs = createMockFilesystem();
      manager = new WorktreeManager(() => agent, () => undefined, fs, executor);

      const worktrees = await manager.list();
      expect(worktrees).toHaveLength(0);
    });

    it("should clean up stale entries", async () => {
      // Only one of two worktree paths exists
      fs = createMockFilesystem({
        "/repo/.worktrees/metadata.json": JSON.stringify(twoWorktreeMetadata()),
        "/repo/.worktrees/wt-feature-id": "dir",
        // wt-main-id does NOT exist
      });
      manager = new WorktreeManager(() => agent, () => undefined, fs, executor);

      const worktrees = await manager.list();
      expect(worktrees).toHaveLength(1);
      expect(worktrees[0]!.id).toBe("wt-feature-id");
      // Metadata should have been rewritten
      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------

  describe("create", () => {
    it("should create a worktree with auto-generated branch", async () => {
      executor = createMockExecutor({
        "rev-parse --show-toplevel": ok("/repo\n"),
        "rev-parse --git-dir": ok(".git\n"),
        "rev-parse HEAD": ok("deadbeef\n"),
        "symbolic-ref": fail("not found"),
        "show-ref --verify --quiet refs/heads/main": ok(""),
        "show-ref --verify --quiet refs/heads/ants/session-": fail("not found"),
        "worktree add": ok(""),
      });
      fs = createMockFilesystem();
      manager = new WorktreeManager(() => agent, () => undefined, fs, executor);

      const result = await manager.create({ branch: "my-feature" });
      expect(result.branch).toBe("my-feature");
      expect(result.isMain).toBe(false);
      expect(result.id).toBeDefined();
    });

    it("should use custom path if provided", async () => {
      executor = createMockExecutor({
        "rev-parse --show-toplevel": ok("/repo\n"),
        "rev-parse --git-dir": ok(".git\n"),
        "rev-parse HEAD": ok("deadbeef\n"),
        "symbolic-ref": fail("not found"),
        "show-ref --verify --quiet refs/heads/main": ok(""),
        "show-ref --verify --quiet refs/heads/custom": fail("not found"),
        "worktree add": ok(""),
      });
      fs = createMockFilesystem();
      manager = new WorktreeManager(() => agent, () => undefined, fs, executor);

      const result = await manager.create({
        branch: "custom",
        path: "/custom/path",
      });
      expect(result.path).toBe("/custom/path");
    });

    it("should throw on git worktree add failure", async () => {
      executor = createMockExecutor({
        "rev-parse --show-toplevel": ok("/repo\n"),
        "rev-parse --git-dir": ok(".git\n"),
        "symbolic-ref": fail("not found"),
        "show-ref --verify --quiet refs/heads/main": ok(""),
        "show-ref --verify --quiet refs/heads/fail": fail("not found"),
        "worktree add": fail("fatal: could not create worktree"),
      });
      fs = createMockFilesystem();
      manager = new WorktreeManager(() => agent, () => undefined, fs, executor);

      await expect(manager.create({ branch: "fail" })).rejects.toThrow(
        "could not create worktree"
      );
    });

    it("should use baseBranch when provided", async () => {
      const execSpy = vi.fn(async (cmd: string, _cwd: string): Promise<GitCommandResult> => {
        if (cmd.includes("rev-parse --show-toplevel")) return ok("/repo\n");
        if (cmd.includes("rev-parse --git-dir")) return ok(".git\n");
        if (cmd.includes("symbolic-ref")) return fail("not found");
        if (cmd.includes("show-ref --verify --quiet refs/heads/main")) return ok("");
        if (cmd.includes("show-ref --verify --quiet refs/heads/feat")) return fail("not found");
        if (cmd.includes("worktree add")) {
          expect(cmd).toContain('"develop"');
          return ok("");
        }
        if (cmd.includes("rev-parse HEAD")) return ok("aaa111\n");
        return ok("");
      });
      executor = { exec: execSpy };
      fs = createMockFilesystem();
      manager = new WorktreeManager(() => agent, () => undefined, fs, executor);

      await manager.create({ branch: "feat", baseBranch: "develop" });
    });
  });

  // -----------------------------------------------------------------------
  // switch
  // -----------------------------------------------------------------------

  describe("switch", () => {
    it("should switch agent working directory to the worktree", async () => {
      const result = await manager.switch(
        "/repo/.worktrees/wt-feature-id"
      );
      expect(result.branch).toBe("ants/session-feature");
      expect(agent.getWorkingDirectory()).toBe(
        "/repo/.worktrees/wt-feature-id"
      );
    });

    it("should throw if path is not a valid worktree", async () => {
      await expect(manager.switch("/nonexistent")).rejects.toThrow(
        "Not a valid worktree"
      );
    });

    it("should update session working directory if session manager available", async () => {
      const updateSession = vi.fn();
      const sessionManager = { updateSession } as any;
      const agentWithSession = {
        ...createMockAgent("/repo"),
        getSessionContext: () => ({ sessionId: "session-1" }),
      } as unknown as AgentInterface;

      manager = new WorktreeManager(
        () => agentWithSession,
        () => sessionManager,
        fs,
        executor
      );

      await manager.switch("/repo/.worktrees/wt-feature-id");

      expect(updateSession).toHaveBeenCalledWith("session-1", {
        workingDirectory: "/repo/.worktrees/wt-feature-id",
      });
    });
  });

  // -----------------------------------------------------------------------
  // remove
  // -----------------------------------------------------------------------

  describe("remove", () => {
    it("should remove a worktree", async () => {
      await manager.remove("/repo/.worktrees/wt-feature-id");
      expect(executor.exec).toHaveBeenCalledWith(
        expect.stringContaining("worktree remove"),
        "/repo"
      );
    });

    it("should throw if trying to remove current worktree", async () => {
      agent = createMockAgent("/repo/.worktrees/wt-feature-id");
      manager = new WorktreeManager(() => agent, () => undefined, fs, executor);

      await expect(
        manager.remove("/repo/.worktrees/wt-feature-id")
      ).rejects.toThrow("Cannot remove the worktree you are currently in");
    });

    it("should throw for non-existent worktree", async () => {
      await expect(manager.remove("/nonexistent")).rejects.toThrow(
        "Not a valid worktree"
      );
    });
  });

  // -----------------------------------------------------------------------
  // current
  // -----------------------------------------------------------------------

  describe("current", () => {
    it("should return the worktree matching the current directory", async () => {
      agent = createMockAgent("/repo/.worktrees/wt-feature-id");
      manager = new WorktreeManager(() => agent, () => undefined, fs, executor);

      const result = await manager.current();
      expect(result).not.toBeNull();
      expect(result!.path).toBe("/repo/.worktrees/wt-feature-id");
      expect(result!.branch).toBe("ants/session-feature");
    });

    it("should return worktree when in a subdirectory", async () => {
      agent = createMockAgent("/repo/.worktrees/wt-feature-id/src");
      manager = new WorktreeManager(() => agent, () => undefined, fs, executor);

      const result = await manager.current();
      expect(result).not.toBeNull();
      expect(result!.path).toBe("/repo/.worktrees/wt-feature-id");
    });

    it("should return null if not in any worktree", async () => {
      agent = createMockAgent("/completely/different/path");
      manager = new WorktreeManager(() => agent, () => undefined, fs, executor);

      const result = await manager.current();
      expect(result).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Tests — ProjectWorktreeManager (standalone)
// ---------------------------------------------------------------------------

describe("ProjectWorktreeManager", () => {
  let fs: WorktreeFilesystem;
  let executor: CommandExecutor;
  let manager: ProjectWorktreeManager;

  beforeEach(() => {
    fs = createMockFilesystem({
      "/repo/.worktrees/metadata.json": JSON.stringify(twoWorktreeMetadata()),
      "/repo/.worktrees/wt-main-id": "dir",
      "/repo/.worktrees/wt-feature-id": "dir",
    });
    executor = createMockExecutor({
      "rev-parse --show-toplevel": ok("/repo\n"),
      "rev-parse --git-dir": ok(".git\n"),
      "rev-parse --abbrev-ref HEAD": ok("main\n"),
      "rev-parse HEAD": ok("abc12345\n"),
    });
    manager = new ProjectWorktreeManager(executor, fs);
  });

  describe("getDefaultBranch", () => {
    it("should detect main branch", async () => {
      executor = createMockExecutor({
        "symbolic-ref": fail("not found"),
        "show-ref --verify --quiet refs/heads/main": ok(""),
      });
      manager = new ProjectWorktreeManager(executor, fs);

      const branch = await manager.getDefaultBranch("/repo");
      expect(branch).toBe("main");
    });

    it("should fall back to master", async () => {
      executor = createMockExecutor({
        "symbolic-ref": fail("not found"),
        "show-ref --verify --quiet refs/heads/main": fail("not found"),
        "show-ref --verify --quiet refs/heads/master": ok(""),
      });
      manager = new ProjectWorktreeManager(executor, fs);

      const branch = await manager.getDefaultBranch("/repo");
      expect(branch).toBe("master");
    });
  });

  describe("getWorktreeBySession", () => {
    it("should find worktree by session ID", async () => {
      const wt = await manager.getWorktreeBySession("/repo", "session-123");
      expect(wt).not.toBeNull();
      expect(wt!.id).toBe("wt-feature-id");
    });

    it("should return null for unknown session", async () => {
      const wt = await manager.getWorktreeBySession("/repo", "unknown");
      expect(wt).toBeNull();
    });
  });

  describe("associateSession", () => {
    it("should associate a session with a worktree", async () => {
      await manager.associateSession("/repo", "wt-main-id", "new-session");
      const wt = await manager.getWorktreeBySession("/repo", "new-session");
      expect(wt).not.toBeNull();
      expect(wt!.id).toBe("wt-main-id");
    });

    it("should throw for unknown worktree", async () => {
      await expect(
        manager.associateSession("/repo", "unknown-id", "session")
      ).rejects.toThrow("Worktree not found");
    });
  });

  describe("renameWorktreeBranch", () => {
    it("should rename a worktree branch", async () => {
      executor = createMockExecutor({
        "rev-parse --show-toplevel": ok("/repo\n"),
        "rev-parse --git-dir": ok(".git\n"),
        "rev-parse HEAD": ok("abc12345\n"),
        "show-ref --verify --quiet refs/heads/ants/my-feature": fail("not found"),
        "branch -m": ok(""),
      });
      manager = new ProjectWorktreeManager(executor, fs);

      const result = await manager.renameWorktreeBranch("/repo", "wt-feature-id", "my-feature");
      expect(result.branch).toBe("ants/my-feature");
    });
  });

  describe("getSystemPrompt", () => {
    it("should generate a system prompt", async () => {
      const wt = await manager.getWorktree("/repo", "wt-feature-id");
      expect(wt).not.toBeNull();
      const prompt = manager.getSystemPrompt(wt!);
      expect(prompt).toContain("Git Worktree Mode");
      expect(prompt).toContain("ants/session-feature");
      expect(prompt).toContain("main");
    });
  });

  describe("sanitizeBranchName", () => {
    it("should lowercase and replace special chars", () => {
      expect(manager.sanitizeBranchName("My Feature!")).toBe("my-feature");
    });

    it("should collapse multiple hyphens", () => {
      expect(manager.sanitizeBranchName("a--b--c")).toBe("a-b-c");
    });

    it("should truncate long names", () => {
      const long = "a".repeat(100);
      expect(manager.sanitizeBranchName(long).length).toBeLessThanOrEqual(50);
    });
  });

  describe("lifecycle hooks", () => {
    it("should call onWorktreeCreated after creating a worktree", async () => {
      const onCreated = vi.fn();
      const hookFs = createMockFilesystem({
        "/repo/.gitignore": ".worktrees/\n",
      });
      const hookExecutor = createMockExecutor({
        "rev-parse --git-dir": ok(".git\n"),
        "rev-parse --show-toplevel": ok("/repo\n"),
        "rev-parse --abbrev-ref HEAD": ok("main\n"),
        "rev-parse HEAD": ok("abc12345\n"),
        "symbolic-ref": fail("not found"),
        "show-ref --verify --quiet refs/heads/main": ok(""),
      });
      const hookManager = new ProjectWorktreeManager(hookExecutor, hookFs, undefined, {
        onWorktreeCreated: onCreated,
      });

      const wt = await hookManager.createWorktree("/repo");

      expect(onCreated).toHaveBeenCalledOnce();
      expect(onCreated).toHaveBeenCalledWith("/repo", expect.objectContaining({
        id: wt.id,
        branch: wt.branch,
        path: wt.path,
      }));
    });

    it("should call onWorktreeRemoving and onWorktreeRemoved when removing", async () => {
      const onRemoving = vi.fn();
      const onRemoved = vi.fn();
      const hookManager = new ProjectWorktreeManager(executor, fs, undefined, {
        onWorktreeRemoving: onRemoving,
        onWorktreeRemoved: onRemoved,
      });

      await hookManager.removeWorktree("/repo", "wt-feature-id");

      expect(onRemoving).toHaveBeenCalledOnce();
      expect(onRemoving).toHaveBeenCalledWith("/repo", expect.objectContaining({
        id: "wt-feature-id",
      }));
      expect(onRemoved).toHaveBeenCalledOnce();
      expect(onRemoved).toHaveBeenCalledWith("/repo", "wt-feature-id");
    });

    it("should not fail worktree creation if onWorktreeCreated hook throws", async () => {
      const onCreated = vi.fn().mockRejectedValue(new Error("Docker failed"));
      const hookFs = createMockFilesystem({
        "/repo/.gitignore": ".worktrees/\n",
      });
      const hookExecutor = createMockExecutor({
        "rev-parse --git-dir": ok(".git\n"),
        "rev-parse --show-toplevel": ok("/repo\n"),
        "rev-parse --abbrev-ref HEAD": ok("main\n"),
        "rev-parse HEAD": ok("abc12345\n"),
        "symbolic-ref": fail("not found"),
        "show-ref --verify --quiet refs/heads/main": ok(""),
      });
      const hookManager = new ProjectWorktreeManager(hookExecutor, hookFs, undefined, {
        onWorktreeCreated: onCreated,
      });

      // Should NOT throw even though the hook fails
      const wt = await hookManager.createWorktree("/repo");
      expect(wt).toBeDefined();
      expect(wt.id).toBeTruthy();
      expect(onCreated).toHaveBeenCalledOnce();
    });

    it("should not fail worktree removal if onWorktreeRemoving hook throws", async () => {
      const onRemoving = vi.fn().mockRejectedValue(new Error("Docker stop failed"));
      const hookManager = new ProjectWorktreeManager(executor, fs, undefined, {
        onWorktreeRemoving: onRemoving,
      });

      // Should NOT throw even though the hook fails
      await hookManager.removeWorktree("/repo", "wt-feature-id");
      expect(onRemoving).toHaveBeenCalledOnce();
    });

    it("should allow setting hooks after construction via setHooks", async () => {
      const onCreated = vi.fn();
      const hookFs = createMockFilesystem({
        "/repo/.gitignore": ".worktrees/\n",
      });
      const hookExecutor = createMockExecutor({
        "rev-parse --git-dir": ok(".git\n"),
        "rev-parse --show-toplevel": ok("/repo\n"),
        "rev-parse --abbrev-ref HEAD": ok("main\n"),
        "rev-parse HEAD": ok("abc12345\n"),
        "symbolic-ref": fail("not found"),
        "show-ref --verify --quiet refs/heads/main": ok(""),
      });
      const hookManager = new ProjectWorktreeManager(hookExecutor, hookFs);

      // No hooks initially
      const wt1 = await hookManager.createWorktree("/repo");
      expect(onCreated).not.toHaveBeenCalled();

      // Set hooks
      hookManager.setHooks({ onWorktreeCreated: onCreated });

      const wt2 = await hookManager.createWorktree("/repo");
      expect(onCreated).toHaveBeenCalledOnce();
    });
  });
});
