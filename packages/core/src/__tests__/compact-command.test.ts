/**
 * Tests for the /compact slash command.
 */
import { describe, it, expect, vi } from "vitest";
import { compactCommand } from "../commands/builtin.js";
import type { CommandContext } from "../plugin.js";

function createMockAgent(overrides?: {
  runCompaction?: () => Promise<{
    messagesPruned: number;
    compressionRatio: number;
  }>;
}): CommandContext {
  return {
    agent: {
      ...(overrides ?? {}),
    } as unknown as CommandContext["agent"],
    sessionId: "test-session",
  };
}

describe("/compact command", () => {
  it("should return 'not available' when agent lacks compaction methods", async () => {
    const ctx = createMockAgent();
    const result = await compactCommand.execute("", ctx);
    expect(result.output).toBe("Compaction not available.");
  });

  it("should run compaction and report results", async () => {
    const ctx = createMockAgent({
      runCompaction: vi.fn().mockResolvedValue({
        messagesPruned: 15,
        compressionRatio: 0.12,
      }),
    });
    const result = await compactCommand.execute("", ctx);
    expect(result.output).toContain("Compacted 15 messages");
    expect(result.output).toContain("12.0%");
  });

  it("should handle compaction errors gracefully", async () => {
    const ctx = createMockAgent({
      runCompaction: vi.fn().mockRejectedValue(new Error("Provider timeout")),
    });
    const result = await compactCommand.execute("", ctx);
    expect(result.output).toContain("Compaction failed");
    expect(result.output).toContain("Provider timeout");
  });

  it("should report correct compression ratio formatting", async () => {
    const ctx = createMockAgent({
      runCompaction: vi.fn().mockResolvedValue({
        messagesPruned: 5,
        compressionRatio: 0.056,
      }),
    });
    const result = await compactCommand.execute("", ctx);
    expect(result.output).toContain("5.6%");
  });
});
