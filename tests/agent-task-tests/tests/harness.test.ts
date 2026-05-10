import { describe, it, expect } from "vitest";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runEpisode } from "../src/harness.js";
import type { AgentRunner } from "../src/types.js";
import { fixBugTask } from "../tasks/fix-bug.js";
import { addFunctionTask } from "../tasks/add-function.js";

// A mock agent that applies a known correct solution to the workspace.
// In production this would be replaced by a real AgentRunner that calls an LLM.
function perfectAgent(filePatch: Record<string, string>): AgentRunner {
  return async (_prompt, workspacePath) => {
    for (const [relativePath, content] of Object.entries(filePatch)) {
      writeFileSync(join(workspacePath, relativePath), content);
    }
  };
}

// An agent that does nothing — simulates a failed/no-op run.
const noOpAgent: AgentRunner = async () => {};

// An agent that makes things worse — replaces the correct fix with a new bug.
function brokenAgent(filePatch: Record<string, string>): AgentRunner {
  return perfectAgent(filePatch);
}

// ---------------------------------------------------------------------------
// fix-bug task
// ---------------------------------------------------------------------------

describe("fix-bug task", () => {
  it("reward=1 when agent correctly fixes the bug", async () => {
    const result = await runEpisode(
      fixBugTask,
      perfectAgent({
        "calculator.js": "export function add(a, b) {\n  return a + b;\n}\n",
      })
    );
    expect(result.reward).toBe(1);
    expect(result.passed).toBe(true);
    expect(result.verifierResults).toHaveLength(2);
    expect(result.verifierResults.every((r) => r.passed)).toBe(true);
  });

  it("reward=0 when agent does nothing", async () => {
    const result = await runEpisode(fixBugTask, noOpAgent);
    expect(result.reward).toBe(0);
    expect(result.passed).toBe(false);
  });

  it("reward=0.5 when script output is correct but source pattern is missing", async () => {
    // Produces correct output but stores result differently — no `return a + b` literal.
    // scriptOutputs passes, fileContains("return a + b") fails → mean = 0.5
    const result = await runEpisode(
      fixBugTask,
      perfectAgent({
        "calculator.js":
          "export function add(a, b) {\n  const sum = a + b; return sum;\n}\n",
      })
    );
    // `const sum = a + b; return sum;` contains "a + b" but not "return a + b"
    // scriptOutputs → passes, fileContains("return a + b") → fails
    expect(result.reward).toBe(0.5);
    expect(result.passed).toBe(false);
  });

  it("returns taskId and durationMs", async () => {
    const result = await runEpisode(fixBugTask, noOpAgent);
    expect(result.taskId).toBe("fix-bug");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// add-function task
// ---------------------------------------------------------------------------

describe("add-function task", () => {
  it("reward=1 when agent adds the correct multiply function", async () => {
    const result = await runEpisode(
      addFunctionTask,
      perfectAgent({
        "utils.js": `export function add(a, b) { return a + b; }
export function subtract(a, b) { return a - b; }
export function multiply(a, b) { return a * b; }
`,
      })
    );
    expect(result.reward).toBe(1);
    expect(result.passed).toBe(true);
  });

  it("reward=0 when agent does nothing", async () => {
    const result = await runEpisode(addFunctionTask, noOpAgent);
    expect(result.reward).toBe(0);
    expect(result.passed).toBe(false);
  });

  it("reward=0.5 when agent adds multiply but returns wrong value", async () => {
    // fileContains passes, scriptOutputs fails
    const result = await runEpisode(
      addFunctionTask,
      perfectAgent({
        "utils.js": `export function add(a, b) { return a + b; }
export function subtract(a, b) { return a - b; }
export function multiply(a, b) { return a + b; } // wrong: adds instead of multiplies
`,
      })
    );
    expect(result.reward).toBe(0.5);
    expect(result.passed).toBe(false);
    const byName = Object.fromEntries(
      result.verifierResults.map((r) => [r.name, r])
    );
    expect(byName["fileContains(utils.js)"]?.passed).toBe(true);
    expect(byName["scriptOutputs(verify.js)"]?.passed).toBe(false);
  });
});
