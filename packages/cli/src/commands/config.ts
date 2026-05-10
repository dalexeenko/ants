import type { Command } from "commander";
import chalk from "chalk";
import {
  loadConfig,
  saveGlobalConfig,
  saveLocalConfig,
  getGlobalConfigPath,
  getLocalConfigPath,
} from "@openmgr/agent-config-xdg";
import { isLoggedIn } from "@openmgr/agent-auth-anthropic";
import { FileTokenStore } from "@openmgr/agent-node";

// Shared token store instance
const tokenStore = new FileTokenStore();

export function registerConfigCommands(program: Command): void {
  const configCmd = program
    .command("config")
    .description("Manage configuration");

  configCmd
    .command("show")
    .description("Show current configuration")
    .option("-d, --directory <dir>", "Working directory", process.cwd())
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const config = await loadConfig(options.directory);
      const loggedIn = await isLoggedIn(tokenStore);

      if (options.json) {
        console.log(JSON.stringify({
          ...config,
          auth: {
            ...config.auth,
            oauthLoggedIn: loggedIn,
          },
        }, null, 2));
        return;
      }

      console.log(chalk.cyan("Current configuration:\n"));
      console.log(`  Provider:  ${chalk.white(config.provider)}`);
      console.log(`  Model:     ${chalk.white(config.model)}`);
      console.log(`  Auth type: ${chalk.white(config.auth.type)}`);
      if (config.auth.type === "oauth") {
        console.log(`  OAuth:     ${loggedIn ? chalk.green("logged in") : chalk.red("not logged in")}`);
      } else {
        console.log(`  API Key:   ${config.auth.apiKey ? chalk.green("configured") : chalk.red("not set")}`);
      }
      if (config.systemPrompt) {
        const truncated = config.systemPrompt.length > 50
          ? config.systemPrompt.slice(0, 50) + "..."
          : config.systemPrompt;
        console.log(`  System:    ${chalk.gray(truncated)}`);
      }
      if (config.maxTokens) {
        console.log(`  Max tokens: ${chalk.white(config.maxTokens)}`);
      }
      if (config.temperature !== undefined) {
        console.log(`  Temperature: ${chalk.white(config.temperature)}`);
      }
    });

  configCmd
    .command("set")
    .description("Set a configuration value")
    .argument("<key>", "Config key (provider, model, maxTokens, temperature)")
    .argument("<value>", "Config value")
    .option("--global", "Save to global config (default)")
    .option("--local", "Save to local project config")
    .option("-d, --directory <dir>", "Working directory", process.cwd())
    .action(async (key, value, options) => {
      const validKeys = ["provider", "model", "maxTokens", "temperature"];
      
      if (!validKeys.includes(key)) {
        console.error(chalk.red(`Invalid config key: ${key}`));
        console.log(chalk.gray(`Valid keys: ${validKeys.join(", ")}`));
        process.exit(1);
      }

      // Parse value based on key type
      let parsedValue: string | number = value;
      if (key === "maxTokens") {
        parsedValue = parseInt(value, 10);
        if (isNaN(parsedValue) || parsedValue <= 0) {
          console.error(chalk.red("maxTokens must be a positive integer"));
          process.exit(1);
        }
      } else if (key === "temperature") {
        parsedValue = parseFloat(value);
        if (isNaN(parsedValue) || parsedValue < 0 || parsedValue > 2) {
          console.error(chalk.red("temperature must be between 0 and 2"));
          process.exit(1);
        }
      }

      const configUpdate = { [key]: parsedValue };

      if (options.local) {
        await saveLocalConfig(options.directory, configUpdate);
        console.log(chalk.green(`Set ${key}=${value} in local config`));
        console.log(chalk.gray(`Config file: ${getLocalConfigPath(options.directory)}`));
      } else {
        await saveGlobalConfig(configUpdate);
        console.log(chalk.green(`Set ${key}=${value} in global config`));
        console.log(chalk.gray(`Config file: ${getGlobalConfigPath()}`));
      }
    });

  configCmd
    .command("get")
    .description("Get a configuration value")
    .argument("<key>", "Config key")
    .option("-d, --directory <dir>", "Working directory", process.cwd())
    .action(async (key, options) => {
      const config = await loadConfig(options.directory);
      
      const value = (config as unknown as Record<string, unknown>)[key];
      if (value === undefined) {
        console.log(chalk.gray("(not set)"));
      } else if (typeof value === "object") {
        console.log(JSON.stringify(value, null, 2));
      } else {
        console.log(value);
      }
    });

  configCmd
    .command("path")
    .description("Show config file paths")
    .option("-d, --directory <dir>", "Working directory", process.cwd())
    .action(async (options) => {
      console.log(chalk.cyan("Config file paths:\n"));
      console.log(`  Global: ${chalk.white(getGlobalConfigPath())}`);
      console.log(`  Local:  ${chalk.white(getLocalConfigPath(options.directory))}`);
    });

  configCmd
    .command("edit")
    .description("Open config file in editor")
    .option("--global", "Edit global config (default)")
    .option("--local", "Edit local project config")
    .option("-d, --directory <dir>", "Working directory", process.cwd())
    .action(async (options) => {
      const configPath = options.local 
        ? getLocalConfigPath(options.directory)
        : getGlobalConfigPath();

      const editor = process.env.EDITOR || process.env.VISUAL || "nano";
      
      console.log(chalk.cyan(`Opening ${configPath} with ${editor}...`));
      
      const { spawn } = await import("child_process");
      const child = spawn(editor, [configPath], {
        stdio: "inherit",
      });

      await new Promise<void>((resolve, reject) => {
        child.on("close", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Editor exited with code ${code}`));
          }
        });
        child.on("error", reject);
      });
    });

  configCmd
    .command("reset")
    .description("Reset configuration to defaults")
    .option("--global", "Reset global config")
    .option("--local", "Reset local project config")
    .option("-d, --directory <dir>", "Working directory", process.cwd())
    .option("-f, --force", "Skip confirmation")
    .action(async (options) => {
      if (!options.global && !options.local) {
        console.error(chalk.red("Specify --global or --local"));
        process.exit(1);
      }

      if (!options.force) {
        const readline = await import("readline");
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const target = options.local ? "local" : "global";
        const answer = await new Promise<string>((resolve) => {
          rl.question(chalk.yellow(`Reset ${target} config to defaults? (y/N) `), resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== "y") {
          console.log(chalk.gray("Cancelled."));
          return;
        }
      }

      const defaultConfig = {};

      if (options.local) {
        await saveLocalConfig(options.directory, defaultConfig);
        console.log(chalk.green("Local config reset to defaults."));
      } else {
        await saveGlobalConfig(defaultConfig);
        console.log(chalk.green("Global config reset to defaults."));
      }
    });
}
