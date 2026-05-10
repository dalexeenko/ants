import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { scriptOutputs, fileContains } from "@ants/agent-verifiers";
import type { Task } from "../src/types.js";

// Task: utils.js is missing a multiply() function.
// Agent must add it so the verify script prints the correct product.
export const addFunctionTask: Task = {
  id: "add-function",
  description: "Add a missing multiply() function to utils.js",
  prompt:
    "utils.js is missing a multiply(a, b) function. Add it so that multiply(3, 4) returns 12.",

  setup: async (dir) => {
    writeFileSync(
      join(dir, "utils.js"),
      `export function add(a, b) {
  return a + b;
}

export function subtract(a, b) {
  return a - b;
}

// TODO: add a product function
`
    );
    writeFileSync(
      join(dir, "verify.js"),
      `import { multiply } from './utils.js';
const result = multiply(3, 4);
console.log(String(result));
`
    );
  },

  verifiers: [
    scriptOutputs("verify.js", "12"),
    fileContains("utils.js", "function multiply"),
  ],
};
