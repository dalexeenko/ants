import { describe, it, expect, afterEach, vi } from "vitest";
import { storagePlugin } from "../plugin.js";
import type { AgentInterface } from "@openmgr/agent-core";
import type { ToolCall, ToolResult, ToolContext } from "@openmgr/agent-core";
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function createMockAgent(): AgentInterface {
  const extensions = new Map<string, unknown>();
  const mockUsageTracker = {
    record: vi.fn(),
    setOnRecordCallback: vi.fn(),
    hydrate: vi.fn(),
    getSummary: () => ({ total: { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCost: 0, requestCount: 0 }, sessions: [] }),
  };
  return {
    emit: vi.fn(() => true),
    getConfig: () => ({ provider: "anthropic", model: "claude-3-opus" }),
    getProvider: () => null,
    setExtension: (key: string, value: unknown) => extensions.set(key, value),
    getExtension: <T>(key: string): T | undefined => extensions.get(key) as T | undefined,
    setWorkingDirectory: vi.fn(),
    getWorkingDirectory: () => "/test",
    getMessages: () => [],
    getSessionContext: () => null,
    getUsageTracker: () => mockUsageTracker as any,
  };
}

// 1x1 red PNG as base64
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

describe("storagePlugin onAfterToolExecute (screenshots)", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("writes screenshot to disk and replaces dataUrl with path", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "openmgr-test-"));
    const dbPath = join(tmpDir, "agent.db");

    const plugin = storagePlugin({ path: dbPath, inMemory: false });
    const agent = createMockAgent();
    await plugin.onRegister!(agent);

    const toolCall: ToolCall = { id: "tc-1", name: "browser_screenshot", arguments: {} };
    const result: ToolResult = {
      id: "tc-1",
      name: "browser_screenshot",
      result: "Screenshot taken",
      metadata: {
        image: {
          dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}`,
          width: 1,
          height: 1,
        },
      },
    };
    const ctx = {} as ToolContext;

    await plugin.onAfterToolExecute!(toolCall, result, ctx);

    // dataUrl should be removed, path should be set
    const image = result.metadata!.image as { dataUrl?: string; path?: string };
    expect(image.dataUrl).toBeUndefined();
    expect(image.path).toMatch(/^screenshots\/[a-f0-9\-]+\.png$/);

    // File should exist on disk
    const screenshotsDir = join(tmpDir, "screenshots");
    expect(existsSync(screenshotsDir)).toBe(true);
    const files = readdirSync(screenshotsDir);
    expect(files).toHaveLength(1);

    // File content should be valid PNG bytes
    const content = readFileSync(join(screenshotsDir, files[0]!));
    expect(content[0]).toBe(0x89); // PNG magic byte
  });

  it("skips writing for in-memory databases", async () => {
    const plugin = storagePlugin({ inMemory: true });
    const agent = createMockAgent();
    await plugin.onRegister!(agent);

    const result: ToolResult = {
      id: "tc-1",
      name: "browser_screenshot",
      result: "Screenshot taken",
      metadata: {
        image: {
          dataUrl: `data:image/png;base64,${TINY_PNG_BASE64}`,
          width: 1,
          height: 1,
        },
      },
    };

    await plugin.onAfterToolExecute!({ id: "tc-1", name: "browser_screenshot", arguments: {} }, result, {} as ToolContext);

    // dataUrl should be preserved (no disk path for in-memory)
    const image = result.metadata!.image as { dataUrl?: string; path?: string };
    expect(image.dataUrl).toBeDefined();
    expect(image.path).toBeUndefined();
  });

  it("ignores results without image metadata", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "openmgr-test-"));
    const dbPath = join(tmpDir, "agent.db");

    const plugin = storagePlugin({ path: dbPath, inMemory: false });
    const agent = createMockAgent();
    await plugin.onRegister!(agent);

    const result: ToolResult = {
      id: "tc-1",
      name: "bash",
      result: "done",
    };

    // Should not throw
    await plugin.onAfterToolExecute!({ id: "tc-1", name: "bash", arguments: {} }, result, {} as ToolContext);

    // No screenshots dir should be created
    expect(existsSync(join(tmpDir, "screenshots"))).toBe(false);
  });
});
