import type { Verifier, VerifierResult } from "@ants/agent-verifiers";

// A function that takes a prompt and a workspace directory path and modifies
// files in that directory. Can be a real agent or a deterministic stub.
export type AgentRunner = (
  prompt: string,
  workspacePath: string
) => Promise<void>;

// A self-contained coding task. setup() creates the initial broken state;
// verifiers[] check whether the agent produced a correct outcome.
export type Task = {
  id: string;
  description: string;
  prompt: string;
  setup: (workspacePath: string) => Promise<void>;
  verifiers: Verifier[];
};

export type EpisodeResult = {
  taskId: string;
  reward: number; // mean score across all verifiers, 0.0–1.0
  passed: boolean; // true when every verifier passed
  verifierResults: VerifierResult[];
  durationMs: number;
};
