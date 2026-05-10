import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { scriptOutputs, fileContains } from "@ants/agent-verifiers";
import type { Task } from "../src/types.js";

// Task: the add() function subtracts instead of adds.
// Agent must change `a - b` to `a + b`.
// Reward: verify.js prints the correct sum AND the fix is in the source.
export const fixBugTask: Task = {
  id: "fix-bug",
  description: "Fix a buggy add() function that subtracts instead of adding",
  prompt:
    "The add() function in calculator.js is broken — it subtracts instead of adding. Fix it so add(2, 3) returns 5.",

  setup: async (dir) => {
    writeFileSync(
      join(dir, "calculator.js"),
      `export function add(a, b) {
  return a - b; // wrong operator
}
`
    );
    writeFileSync(
      join(dir, "verify.js"),
      `import { add } from './calculator.js';
const result = add(2, 3);
console.log(String(result));
`
    );
  },

  verifiers: [
    scriptOutputs("verify.js", "5"),
    fileContains("calculator.js", "return a + b"),
  ],
};
