/**
 * Shared interactive prompt handlers for the CLI.
 *
 * Provides a unified interface for:
 * - Tool permission approval (allow once / allow always / deny)
 * - Question tool responses (pick options or type freeform)
 *
 * Both use readline and share the same visual style.
 */

import * as readline from "readline";
import chalk from "chalk";
import type {
  Agent,
  AgentEvent,
  ToolCall,
  PermissionResponse,
  QuestionResponse,
} from "@openmgr/agent-core";

/**
 * Format a tool call's arguments into a short, readable summary.
 */
function formatToolArgs(toolCall: ToolCall): string {
  const args = toolCall.arguments;
  if (!args || Object.keys(args).length === 0) return "";

  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    const str = typeof value === "string" ? value : JSON.stringify(value);
    const truncated = str.length > 80 ? str.slice(0, 77) + "..." : str;
    parts.push(`${key}: ${truncated}`);
  }
  return parts.join(", ");
}

/**
 * Prompt the user to approve or deny a tool call.
 *
 * Displays the tool name and arguments, then asks:
 *   y = allow once, a = allow always (session), n = deny
 *
 * Returns a PermissionResponse.
 */
export function promptForPermission(
  rl: readline.Interface,
  toolCall: ToolCall,
): Promise<PermissionResponse> {
  return new Promise((resolve) => {
    const args = formatToolArgs(toolCall);
    console.log(chalk.yellow(`\nTool: ${toolCall.name}`));
    if (args) {
      console.log(chalk.gray(`  ${args}`));
    }
    console.log(
      chalk.gray("  Allow? ") +
      chalk.white("y") + chalk.gray("es / ") +
      chalk.white("n") + chalk.gray("o / ") +
      chalk.white("a") + chalk.gray("lways"),
    );

    rl.question(chalk.green("  > "), (answer) => {
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === "a" || trimmed === "always") {
        resolve("allow_always");
      } else if (trimmed === "n" || trimmed === "no") {
        resolve("deny");
      } else {
        // default to allow once (y, yes, enter, anything else)
        resolve("allow_once");
      }
    });
  });
}

/**
 * Create a PermissionRequestCallback wired to a readline interface.
 */
export function createPermissionCallback(
  rl: readline.Interface,
): (toolCall: ToolCall) => Promise<PermissionResponse> {
  return (toolCall) => promptForPermission(rl, toolCall);
}

/**
 * Handle a question.request event by displaying options and reading user input.
 * Resolves the question on the agent once the user responds.
 */
export function handleQuestionEvent(
  rl: readline.Interface,
  agent: Agent,
  event: Extract<AgentEvent, { type: "question.request" }>,
): void {
  console.log(chalk.cyan(`\n${event.question}\n`));

  // Display numbered options
  for (let i = 0; i < event.options.length; i++) {
    const opt = event.options[i]!;
    const num = chalk.white(`  ${i + 1}.`);
    const label = chalk.bold(opt.label);
    const desc = opt.description ? chalk.gray(` - ${opt.description}`) : "";
    console.log(`${num} ${label}${desc}`);
  }

  if (event.multiple) {
    console.log(
      chalk.gray("\nEnter option numbers separated by commas (e.g. 1,3), or type a freeform response:"),
    );
  } else {
    console.log(
      chalk.gray("\nEnter an option number, or type a freeform response:"),
    );
  }

  rl.question(chalk.green("> "), (answer) => {
    const trimmed = answer.trim();
    let response: QuestionResponse;

    if (event.multiple) {
      const parts = trimmed.split(",").map((s) => s.trim());
      const indices = parts.map((s) => parseInt(s, 10));
      const allValid = indices.every(
        (n) => !isNaN(n) && n >= 1 && n <= event.options.length,
      );

      if (allValid && indices.length > 0) {
        response = { selected: indices.map((n) => event.options[n - 1]!.label) };
      } else {
        response = { selected: [], freeformText: trimmed };
      }
    } else {
      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && num >= 1 && num <= event.options.length) {
        response = { selected: [event.options[num - 1]!.label] };
      } else {
        response = { selected: [], freeformText: trimmed };
      }
    }

    agent.respondToQuestion(event.questionId, response);
  });
}
