import type { Command } from "commander";
import chalk from "chalk";
import * as readline from "readline";
import { login, isLoggedIn } from "@ants/agent-auth-anthropic";
import { FileTokenStore } from "@ants/agent-node";

// Shared token store instance for the CLI
const tokenStore = new FileTokenStore();

export function registerAuthCommands(program: Command): void {
  // Login commands
  const loginCmd = program
    .command("login")
    .description("Login with a provider");

  loginCmd
    .command("anthropic")
    .description("Login with Anthropic OAuth (for Claude Pro/Max subscriptions)")
    .option("-f, --force", "Replace existing login without prompting")
    .action(async (options) => {
      const loggedIn = await isLoggedIn(tokenStore);
      if (loggedIn && !options.force) {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question(chalk.yellow("Already logged in. Replace existing login? (y/N) "), resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== "y") {
          console.log(chalk.gray("Cancelled."));
          return;
        }
      }

      console.log(chalk.cyan("Opening browser for Anthropic login..."));

      try {
        const openBrowser = async (url: string) => {
          const { exec } = await import("child_process");
          const command = process.platform === "darwin"
            ? `open "${url}"`
            : process.platform === "win32"
            ? `start "${url}"`
            : `xdg-open "${url}"`;
          exec(command);
        };

        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const getCode = (): Promise<string> => {
          return new Promise((resolve) => {
            console.log(chalk.gray("\nAfter authorizing, you'll see an authorization code."));
            rl.question(chalk.cyan("Paste the authorization code here: "), (answer) => {
              rl.close();
              resolve(answer);
            });
          });
        };

        await login(tokenStore, openBrowser, getCode);

        console.log(chalk.green("\nSuccessfully logged in!"));
        console.log(chalk.gray("Your OAuth tokens are stored securely."));
      } catch (err) {
        console.error(chalk.red(`Login failed: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Logout commands
  const logoutCmd = program
    .command("logout")
    .description("Logout from a provider");

  logoutCmd
    .command("anthropic")
    .description("Clear stored Anthropic OAuth tokens")
    .action(async () => {
      await tokenStore.clearTokens();
      console.log(chalk.green("Logged out from Anthropic successfully."));
    });

  // Whoami command
  program
    .command("whoami")
    .description("Check current authentication status")
    .action(async () => {
      const loggedIn = await isLoggedIn(tokenStore);
      console.log(chalk.cyan("Authentication status:\n"));
      console.log(`  Anthropic OAuth: ${loggedIn ? chalk.green("logged in") : chalk.red("not logged in")}`);
    });
}
