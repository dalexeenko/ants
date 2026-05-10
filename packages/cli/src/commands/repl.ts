import type { Command } from "commander";
import chalk from "chalk";
import * as readline from "readline";
import type { AgentEvent } from "@openmgr/agent-core";
import { createReadOnlyConfig } from "@openmgr/agent-core";
import { createNodeAgent } from "@openmgr/agent-node";
import { Spinner, debug } from "../utils.js";
import { createPermissionCallback, handleQuestionEvent } from "../interaction.js";

export function registerReplCommand(program: Command): void {
  program
    .command("repl")
    .description("Start an interactive REPL session")
    .option("-d, --directory <dir>", "Working directory", process.cwd())
    .option("--provider <provider>", "LLM provider (anthropic|openai)")
    .option("--model <model>", "Model name")
    .option("--debug", "Enable debug logging")
    .action(async (options) => {
      debug.setEnabled(!!options.debug);
      debug.log("init", "Starting REPL", { options });

      const agent = await createNodeAgent({
        workingDirectory: options.directory,
        provider: options.provider,
        model: options.model,
        permissions: createReadOnlyConfig(),
      });

      const config = agent.getConfig();
      debug.log("config", "Agent configuration", config);

      console.log(chalk.cyan("OpenMgr Agent REPL"));
      console.log(chalk.gray(`Working directory: ${config.workingDirectory}`));
      console.log(chalk.gray(`Provider: ${config.provider} (${config.model})`));
      console.log(chalk.gray(`Auth: ${config.auth?.type ?? "default"}`));
      if (options.debug) {
        console.log(chalk.magenta(`Debug mode enabled`));
      }
      console.log(chalk.gray('Type /help for commands, /exit to quit\n'));

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      // Wire up interactive permission approval
      agent.setPermissionRequestCallback(createPermissionCallback(rl));

      const handleSlashCommand = async (input: string): Promise<boolean> => {
        const parts = input.slice(1).split(/\s+/);
        const command = (parts[0] ?? "").toLowerCase();

        if (command === "exit" || command === "quit") {
          console.log(chalk.gray("Goodbye!"));
          rl.close();
          process.exit(0);
        }

        if (command === "clear") {
          agent.clearMessages();
          console.log(chalk.gray("Conversation cleared.\n"));
          return true;
        }

        if (command === "help") {
          console.log(chalk.cyan("\nAvailable commands:\n"));
          console.log(chalk.white("  /clear") + chalk.gray("  - Clear conversation history"));
          console.log(chalk.white("  /exit") + chalk.gray("   - Exit the REPL"));
          console.log(chalk.white("  /help") + chalk.gray("   - Show this help message"));
          console.log();
          return true;
        }

        console.log(chalk.red(`\nUnknown command: /${command}`));
        console.log(chalk.gray("Type /help for available commands.\n"));
        return true;
      };

      const promptUser = () => {
        rl.question(chalk.green("You: "), async (input) => {
          const trimmed = input.trim();

          if (!trimmed) {
            promptUser();
            return;
          }

          if (trimmed.startsWith("/")) {
            await handleSlashCommand(trimmed);
            promptUser();
            return;
          }

          if (trimmed.toLowerCase() === "exit") {
            console.log(chalk.gray("Goodbye!"));
            rl.close();
            process.exit(0);
          }

          debug.log("prompt", "Sending prompt", trimmed);

          const spinner = new Spinner("Thinking");
          spinner.start();
          let streamStarted = false;

          const onEvent = (event: AgentEvent) => {
            debug.log("event", event.type, event);

            switch (event.type) {
              case "message.start":
                if (!streamStarted) {
                  spinner.stop();
                  streamStarted = true;
                  process.stdout.write(chalk.blue("Assistant: "));
                }
                break;
              case "message.delta":
                if (!streamStarted) {
                  spinner.stop();
                  streamStarted = true;
                  process.stdout.write(chalk.blue("Assistant: "));
                }
                process.stdout.write(event.delta);
                break;
              case "tool.start":
                spinner.stop();
                streamStarted = false;
                process.stdout.write(
                  chalk.yellow(`\n[Calling ${event.toolCall.name}...]\n`)
                );
                debug.log("tool", `Tool arguments for ${event.toolCall.name}`, event.toolCall.arguments);
                spinner.update(`Running ${event.toolCall.name}`);
                spinner.start();
                break;
              case "tool.complete": {
                spinner.stop();
                const preview = String(event.toolResult.result).slice(0, 200);
                const truncated =
                  String(event.toolResult.result).length > 200 ? "..." : "";
                process.stdout.write(
                  chalk.gray(`[${event.toolResult.name} result: ${preview}${truncated}]\n`)
                );
                spinner.update("Thinking");
                spinner.start();
                break;
              }
              case "question.request":
                spinner.stop();
                streamStarted = false;
                handleQuestionEvent(rl, agent, event);
                break;
              case "error":
                debug.log("error", "Agent error", event.error);
                break;
            }
          };

          agent.on("event", onEvent);

          try {
            const startTime = Date.now();
            await agent.prompt(trimmed);
            spinner.stop();
            debug.log("prompt", `Completed in ${Date.now() - startTime}ms`);
            console.log("\n");
          } catch (err) {
            spinner.stop();
            debug.log("error", "Prompt error", (err as Error).message);
            console.log(chalk.red(`\nError: ${(err as Error).message}\n`));
          }

          agent.off("event", onEvent);
          promptUser();
        });
      };

      promptUser();
    });
}
