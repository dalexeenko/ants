import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  DIRECTOR_CONTEXT_KEY,
  DIRECTOR_SYSTEM_PROMPT,
  getDirectorContext,
  directorTools,
  directorToolsPlugin,
  directorAgentType,
} from "../index.js";

// ---------------------------------------------------------------------------
// 1. DIRECTOR_CONTEXT_KEY
// ---------------------------------------------------------------------------

describe("DIRECTOR_CONTEXT_KEY", () => {
  it('equals "director.context"', () => {
    expect(DIRECTOR_CONTEXT_KEY).toBe("director.context");
  });
});

// ---------------------------------------------------------------------------
// 2. DIRECTOR_SYSTEM_PROMPT
// ---------------------------------------------------------------------------

describe("DIRECTOR_SYSTEM_PROMPT", () => {
  it("is a non-empty string", () => {
    expect(typeof DIRECTOR_SYSTEM_PROMPT).toBe("string");
    expect(DIRECTOR_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it('contains the word "Director"', () => {
    expect(DIRECTOR_SYSTEM_PROMPT).toContain("Director");
  });

  it('contains the word "assistant"', () => {
    expect(DIRECTOR_SYSTEM_PROMPT).toContain("assistant");
  });

  it("mentions key capabilities", () => {
    expect(DIRECTOR_SYSTEM_PROMPT).toContain("Projects");
    expect(DIRECTOR_SYSTEM_PROMPT).toContain("Sessions");
    expect(DIRECTOR_SYSTEM_PROMPT).toContain("Docker");
    expect(DIRECTOR_SYSTEM_PROMPT).toContain("Settings");
  });
});

// ---------------------------------------------------------------------------
// 3. getDirectorContext
// ---------------------------------------------------------------------------

describe("getDirectorContext", () => {
  it("returns the context when present in extensions", () => {
    const fakeContext = { listProjects: () => Promise.resolve([]) };
    const extensions: Record<string, unknown> = {
      [DIRECTOR_CONTEXT_KEY]: fakeContext,
    };
    expect(getDirectorContext(extensions)).toBe(fakeContext);
  });

  it("returns undefined when the key is not present", () => {
    expect(getDirectorContext({})).toBeUndefined();
  });

  it("returns undefined when extensions has other keys but not the director key", () => {
    const extensions: Record<string, unknown> = {
      "some.other.key": { foo: "bar" },
    };
    expect(getDirectorContext(extensions)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. directorTools — array shape
// ---------------------------------------------------------------------------

describe("directorTools", () => {
  it("is an array with at least 16 tools", () => {
    expect(Array.isArray(directorTools)).toBe(true);
    expect(directorTools.length).toBeGreaterThanOrEqual(16);
  });

  it("each tool has name, description, parameters (Zod schema), and execute", () => {
    for (const tool of directorTools) {
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);

      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);

      // parameters should be a Zod schema (ZodType instance)
      expect(tool.parameters).toBeDefined();
      expect(tool.parameters instanceof z.ZodType).toBe(true);

      expect(typeof tool.execute).toBe("function");
    }
  });

  it("has no duplicate tool names", () => {
    const names = directorTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ---------------------------------------------------------------------------
// 5. Every tool name starts with "director_"
// ---------------------------------------------------------------------------

describe("tool naming convention", () => {
  it('every tool name starts with "director_"', () => {
    for (const tool of directorTools) {
      expect(tool.name).toMatch(/^director_/);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. directorToolsPlugin
// ---------------------------------------------------------------------------

describe("directorToolsPlugin", () => {
  it("has a name property", () => {
    expect(typeof directorToolsPlugin.name).toBe("string");
    expect(directorToolsPlugin.name).toBe("@ants/agent-tools-director");
  });

  it("has a version property", () => {
    expect(typeof directorToolsPlugin.version).toBe("string");
    expect(directorToolsPlugin.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("has a tools array matching directorTools", () => {
    expect(Array.isArray(directorToolsPlugin.tools)).toBe(true);
    expect(directorToolsPlugin.tools).toHaveLength(directorTools.length);
  });
});

// ---------------------------------------------------------------------------
// 7. directorAgentType
// ---------------------------------------------------------------------------

describe("directorAgentType", () => {
  it('has name "director"', () => {
    expect(directorAgentType.name).toBe("director");
  });

  it("has a version string", () => {
    expect(typeof directorAgentType.version).toBe("string");
  });

  it("has a non-empty description", () => {
    expect(typeof directorAgentType.description).toBe("string");
    expect(directorAgentType.description.length).toBeGreaterThan(0);
  });

  it("has a systemPrompt equal to DIRECTOR_SYSTEM_PROMPT", () => {
    expect(directorAgentType.systemPrompt).toBe(DIRECTOR_SYSTEM_PROMPT);
  });

  it("has allowedTools matching directorTools names", () => {
    const expected = directorTools.map((t) => t.name);
    expect(directorAgentType.allowedTools).toEqual(expected);
  });

  it("has deniedTools as an empty array", () => {
    expect(directorAgentType.deniedTools).toEqual([]);
  });

  it('has tags including "builtin"', () => {
    expect(directorAgentType.tags).toContain("builtin");
  });

  it('has source "builtin"', () => {
    expect(directorAgentType.source).toBe("builtin");
  });
});

// ---------------------------------------------------------------------------
// 8. Tool "no context" path — execute with empty extensions
// ---------------------------------------------------------------------------

describe("tool execute with no DirectorContext", () => {
  const emptyCtx = {
    workingDirectory: "/tmp",
    extensions: {} as Record<string, unknown>,
  };

  it('returns "Director context not available." for a no-param tool', async () => {
    // director_list_projects takes no params — call it directly
    const tool = directorTools.find((t) => t.name === "director_list_projects");
    expect(tool).toBeDefined();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (tool as any).execute({}, emptyCtx);

    expect(result).toEqual({ output: "Director context not available." });
  });

  it('returns the same message for a tool that requires params', async () => {
    // director_list_sessions requires { projectId }
    const tool = directorTools.find((t) => t.name === "director_list_sessions");
    expect(tool).toBeDefined();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (tool as any).execute({ projectId: "fake-id" }, emptyCtx);

    expect(result).toEqual({ output: "Director context not available." });
  });
});
