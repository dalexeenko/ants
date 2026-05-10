import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Task, AgentRunner, EpisodeResult } from "./types.js";

// Runs a single task episode:
//   1. Creates an isolated temp workspace
//   2. Calls task.setup() to write the initial (broken) state
//   3. Calls the agent runner with the task prompt
//   4. Evaluates all verifiers on the resulting workspace state
//   5. Cleans up and returns the episode result
export async function runEpisode(
  task: Task,
  runner: AgentRunner
): Promise<EpisodeResult> {
  const workspacePath = join(
    tmpdir(),
    `ants-task-${task.id}-${Date.now()}`
  );
  mkdirSync(workspacePath, { recursive: true });

  const start = Date.now();
  try {
    await task.setup(workspacePath);
    await runner(task.prompt, workspacePath);

    const verifierResults = await Promise.all(
      task.verifiers.map((v) => v(workspacePath))
    );
    const reward =
      verifierResults.reduce((sum, r) => sum + r.score, 0) /
      verifierResults.length;

    return {
      taskId: task.id,
      reward,
      passed: verifierResults.every((r) => r.passed),
      verifierResults,
      durationMs: Date.now() - start,
    };
  } finally {
    rmSync(workspacePath, { recursive: true, force: true });
  }
}
