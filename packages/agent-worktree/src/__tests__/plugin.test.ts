import { describe, it, expect, vi } from "vitest";
import { worktreePlugin } from "../plugin.js";
import type { AgentInterface } from "@openmgr/agent-core";
import type { CommandExecutor, WorktreeFilesystem } from "../types.js";
import { WorktreeManager } from "../manager.js";

function createMockAgent(): AgentInterface {
  const extensions = new Map<string, unknown>();
  return {
    getWorkingDirectory: () => "/repo",
    setWorkingDirectory: vi.fn(),
    getConfig: () => ({ provider: "test", model: "test" }) as any,
    getExtension: (key: string) => extensions.get(key),
    setExtension: (key: string, value: unknown) => extensions.set(key, value),
    emit: vi.fn(),
    on: vi.fn(),
  } as unknown as AgentInterface;
}

function createMockExecutor(): CommandExecutor {
  return {
    exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
  };
}

function createMockFilesystem(): WorktreeFilesystem {
  return {
    readFile: vi.fn(async () => ""),
    writeFile: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    resolve: (...paths: string[]) => paths.join("/"),
    dirname: (p: string) => p.split("/").slice(0, -1).join("/"),
    basename: (p: string) => p.split("/").pop() || "",
    join: (...paths: string[]) => paths.join("/"),
  };
}

describe("worktreePlugin", () => {
  it("should create a plugin with correct name and version", () => {
    const plugin = worktreePlugin();
    expect(plugin.name).toBe("@openmgr/agent-worktree");
    expect(plugin.version).toBe("0.1.0");
  });

  it("should register 4 tools", () => {
    const plugin = worktreePlugin();
    expect(plugin.tools).toHaveLength(4);
    const toolNames = plugin.tools!.map((t: any) => t.name);
    expect(toolNames).toContain("worktree_create");
    expect(toolNames).toContain("worktree_list");
    expect(toolNames).toContain("worktree_switch");
    expect(toolNames).toContain("worktree_remove");
  });

  it("should register WorktreeManager as extension on agent", () => {
    const plugin = worktreePlugin({
      executor: createMockExecutor(),
      filesystem: createMockFilesystem(),
    });
    const agent = createMockAgent();

    plugin.onRegister!(agent);

    const manager = agent.getExtension("worktree.manager");
    expect(manager).toBeDefined();
    expect(manager).toBeInstanceOf(WorktreeManager);
  });

  it("should accept custom executor and filesystem", () => {
    const executor = createMockExecutor();
    const filesystem = createMockFilesystem();
    const plugin = worktreePlugin({ executor, filesystem });
    const agent = createMockAgent();

    plugin.onRegister!(agent);

    const manager = agent.getExtension("worktree.manager") as WorktreeManager;
    expect(manager).toBeDefined();
  });

  it("should have an onShutdown hook", async () => {
    const plugin = worktreePlugin();
    expect(plugin.onShutdown).toBeDefined();
    // Should not throw
    await plugin.onShutdown!({} as any);
  });

  it("should use default executor and filesystem when none provided", () => {
    const plugin = worktreePlugin();
    // Just verifying it doesn't throw during creation
    expect(plugin).toBeDefined();
  });
});
