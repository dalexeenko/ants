import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  fileExists,
  fileContains,
  scriptOutputs,
  allPass,
  anyPass,
} from "../index.js";

let workspace: string;

beforeEach(() => {
  workspace = join(tmpdir(), `verifiers-test-${Date.now()}`);
  mkdirSync(workspace, { recursive: true });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("fileExists", () => {
  it("passes when file is present", async () => {
    writeFileSync(join(workspace, "hello.txt"), "hi");
    const result = await fileExists("hello.txt")(workspace);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it("fails when file is absent", async () => {
    const result = await fileExists("missing.txt")(workspace);
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
  });
});

describe("fileContains", () => {
  it("passes when string is present", async () => {
    writeFileSync(join(workspace, "code.js"), "function add(a, b) { return a + b; }");
    const result = await fileContains("code.js", "a + b")(workspace);
    expect(result.passed).toBe(true);
  });

  it("passes when regex matches", async () => {
    writeFileSync(join(workspace, "code.js"), "export function add(a, b) { return a + b; }");
    const result = await fileContains("code.js", /export function \w+/)(workspace);
    expect(result.passed).toBe(true);
  });

  it("fails when pattern is absent", async () => {
    writeFileSync(join(workspace, "code.js"), "function add(a, b) { return a - b; }");
    const result = await fileContains("code.js", "a + b")(workspace);
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
  });

  it("fails gracefully when file is missing", async () => {
    const result = await fileContains("missing.js", "anything")(workspace);
    expect(result.passed).toBe(false);
  });
});

describe("scriptOutputs", () => {
  it("passes when script output matches", async () => {
    writeFileSync(join(workspace, "run.js"), "console.log('hello')");
    const result = await scriptOutputs("run.js", "hello")(workspace);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it("fails when output does not match", async () => {
    writeFileSync(join(workspace, "run.js"), "console.log('wrong')");
    const result = await scriptOutputs("run.js", "hello")(workspace);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("wrong");
  });

  it("fails gracefully on runtime error", async () => {
    writeFileSync(join(workspace, "run.js"), "throw new Error('boom')");
    const result = await scriptOutputs("run.js", "anything")(workspace);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("runtime error");
  });

  it("fails gracefully when file is missing", async () => {
    const result = await scriptOutputs("missing.js", "hello")(workspace);
    expect(result.passed).toBe(false);
  });
});

describe("allPass", () => {
  it("passes when all verifiers pass", async () => {
    writeFileSync(join(workspace, "a.txt"), "x");
    writeFileSync(join(workspace, "b.txt"), "y");
    const result = await allPass([fileExists("a.txt"), fileExists("b.txt")])(workspace);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it("fails when any verifier fails", async () => {
    writeFileSync(join(workspace, "a.txt"), "x");
    const result = await allPass([fileExists("a.txt"), fileExists("missing.txt")])(workspace);
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.5);
  });
});

describe("anyPass", () => {
  it("passes when at least one verifier passes", async () => {
    writeFileSync(join(workspace, "a.txt"), "x");
    const result = await anyPass([fileExists("a.txt"), fileExists("missing.txt")])(workspace);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it("fails when all verifiers fail", async () => {
    const result = await anyPass([fileExists("a.txt"), fileExists("b.txt")])(workspace);
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
  });
});
