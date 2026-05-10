import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";

export type VerifierResult = {
  name: string;
  score: number; // 0.0–1.0
  passed: boolean;
  detail: string;
};

export type Verifier = (workspacePath: string) => Promise<VerifierResult>;

// ---------------------------------------------------------------------------
// Primitive verifiers
// ---------------------------------------------------------------------------

export function fileExists(relativePath: string): Verifier {
  return async (workspacePath) => {
    const passed = existsSync(join(workspacePath, relativePath));
    return {
      name: `fileExists(${relativePath})`,
      score: passed ? 1 : 0,
      passed,
      detail: passed ? `${relativePath} exists` : `${relativePath} not found`,
    };
  };
}

export function fileContains(
  relativePath: string,
  pattern: string | RegExp
): Verifier {
  return async (workspacePath) => {
    const fullPath = join(workspacePath, relativePath);
    if (!existsSync(fullPath)) {
      return {
        name: `fileContains(${relativePath})`,
        score: 0,
        passed: false,
        detail: `${relativePath} not found`,
      };
    }
    const content = readFileSync(fullPath, "utf-8");
    const passed =
      typeof pattern === "string"
        ? content.includes(pattern)
        : pattern.test(content);
    return {
      name: `fileContains(${relativePath})`,
      score: passed ? 1 : 0,
      passed,
      detail: passed ? "pattern found" : `pattern not found: ${pattern}`,
    };
  };
}

// Runs a plain Node.js script and checks stdout matches expectedOutput.
// Tasks should use .js files (no compile step needed in the workspace).
export function scriptOutputs(
  relativePath: string,
  expectedOutput: string
): Verifier {
  return async (workspacePath) => {
    const fullPath = join(workspacePath, relativePath);
    if (!existsSync(fullPath)) {
      return {
        name: `scriptOutputs(${relativePath})`,
        score: 0,
        passed: false,
        detail: `${relativePath} not found`,
      };
    }
    try {
      const { stdout } = await execa("node", [fullPath], {
        cwd: workspacePath,
      });
      const passed = stdout.trim() === expectedOutput.trim();
      return {
        name: `scriptOutputs(${relativePath})`,
        score: passed ? 1 : 0,
        passed,
        detail: passed
          ? "output matches"
          : `expected ${JSON.stringify(expectedOutput.trim())}, got ${JSON.stringify(stdout.trim())}`,
      };
    } catch (err) {
      return {
        name: `scriptOutputs(${relativePath})`,
        score: 0,
        passed: false,
        detail: `runtime error: ${(err as Error).message.slice(0, 200)}`,
      };
    }
  };
}

// Runs `tsc --noEmit` on a single file. Requires tsc on PATH or npx.
export function typescriptCompiles(relativePath: string): Verifier {
  return async (workspacePath) => {
    const fullPath = join(workspacePath, relativePath);
    if (!existsSync(fullPath)) {
      return {
        name: `typescriptCompiles(${relativePath})`,
        score: 0,
        passed: false,
        detail: `${relativePath} not found`,
      };
    }
    try {
      await execa(
        "npx",
        [
          "tsc",
          "--noEmit",
          "--strict",
          "--target",
          "ES2022",
          "--moduleResolution",
          "bundler",
          "--allowImportingTsExtensions",
          fullPath,
        ],
        { cwd: workspacePath }
      );
      return {
        name: `typescriptCompiles(${relativePath})`,
        score: 1,
        passed: true,
        detail: "no type errors",
      };
    } catch (err) {
      const detail =
        ((err as { stderr?: string }).stderr ?? String(err)).slice(0, 300);
      return {
        name: `typescriptCompiles(${relativePath})`,
        score: 0,
        passed: false,
        detail,
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Combinators
// ---------------------------------------------------------------------------

// All verifiers must pass. Score is the mean across all.
export function allPass(verifiers: Verifier[]): Verifier {
  return async (workspacePath) => {
    const results = await Promise.all(verifiers.map((v) => v(workspacePath)));
    const score =
      results.reduce((sum, r) => sum + r.score, 0) / results.length;
    const passed = results.every((r) => r.passed);
    return {
      name: "allPass",
      score,
      passed,
      detail: results.map((r) => `${r.name}: ${r.passed ? "✓" : "✗"}`).join(", "),
    };
  };
}

// At least one verifier must pass.
export function anyPass(verifiers: Verifier[]): Verifier {
  return async (workspacePath) => {
    const results = await Promise.all(verifiers.map((v) => v(workspacePath)));
    const score = Math.max(...results.map((r) => r.score));
    const passed = results.some((r) => r.passed);
    return {
      name: "anyPass",
      score,
      passed,
      detail: results.map((r) => `${r.name}: ${r.passed ? "✓" : "✗"}`).join(", "),
    };
  };
}
