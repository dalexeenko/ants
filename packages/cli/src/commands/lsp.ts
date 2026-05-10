import type { Command } from "commander";
import chalk from "chalk";
import { existsSync } from "fs";
import { resolve } from "path";
import { loadConfig } from "@openmgr/agent-config-xdg";
import type { LspServerConfig } from "@openmgr/agent-core";
import {
  LspManager,
  DEFAULT_LANGUAGE_SERVERS,
  getLanguageId,
  LANGUAGE_IDS,
} from "@openmgr/agent-lsp";

export function registerLspCommands(program: Command): void {
  const lspCmd = program
    .command("lsp")
    .description("Language Server Protocol management");

  lspCmd
    .command("servers")
    .description("List available language servers")
    .option("-d, --directory <dir>", "Working directory", process.cwd())
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const config = await loadConfig(options.directory);

      // Merge default servers with config overrides
      const servers: Record<string, { command: string; args?: string[]; disabled?: boolean; source: string }> = {};

      // Add defaults
      for (const [lang, serverConfig] of Object.entries(DEFAULT_LANGUAGE_SERVERS)) {
        servers[lang] = {
          command: serverConfig.command,
          args: serverConfig.args,
          disabled: false,
          source: "default",
        };
      }

      // Apply config overrides
      if (config.lsp) {
        for (const [lang, serverConfigRaw] of Object.entries(config.lsp)) {
          const serverConfig = serverConfigRaw as LspServerConfig;
          if (servers[lang]) {
            // Override existing
            servers[lang] = {
              command: serverConfig.command ?? servers[lang].command,
              args: serverConfig.args ?? servers[lang].args,
              disabled: serverConfig.disabled ?? false,
              source: "config",
            };
          } else {
            // Add new
            servers[lang] = {
              command: serverConfig.command ?? "",
              args: serverConfig.args,
              disabled: serverConfig.disabled ?? false,
              source: "config",
            };
          }
        }
      }

      if (options.json) {
        console.log(JSON.stringify({ servers }, null, 2));
        return;
      }

      console.log(chalk.cyan("Available Language Servers:\n"));

      for (const [lang, server] of Object.entries(servers).sort((a, b) => a[0].localeCompare(b[0]))) {
        const status = server.disabled ? chalk.red("disabled") : chalk.green("enabled");
        const sourceTag = server.source === "config" ? chalk.yellow(" [config]") : chalk.gray(" [default]");
        console.log(`  ${chalk.white(lang)}: ${status}${sourceTag}`);
        console.log(`    Command: ${chalk.gray(server.command)}${server.args?.length ? " " + server.args.join(" ") : ""}`);
        console.log();
      }
    });

  lspCmd
    .command("check")
    .description("Get diagnostics for a file")
    .argument("<file>", "File path to check")
    .option("-d, --directory <dir>", "Working directory", process.cwd())
    .option("--json", "Output as JSON")
    .option("--timeout <ms>", "Timeout in milliseconds", "10000")
    .action(async (file, options) => {
      const config = await loadConfig(options.directory);

      const filePath = resolve(options.directory, file);

      if (!existsSync(filePath)) {
        console.error(chalk.red(`File not found: ${filePath}`));
        process.exit(1);
      }

      const languageId = getLanguageId(filePath);
      if (!languageId) {
        console.error(chalk.red(`Cannot determine language for: ${filePath}`));
        process.exit(1);
      }

      console.log(chalk.cyan(`Checking ${file} (${languageId})...\n`));

      const manager = new LspManager({
        workingDirectory: options.directory,
        config: config.lsp,
      });

      try {
        const diagnostics = await manager.getDiagnostics(filePath);

        if (options.json) {
          console.log(JSON.stringify({ file: filePath, languageId, diagnostics }, null, 2));
          return;
        }

        if (diagnostics.length === 0) {
          console.log(chalk.green("No diagnostics found."));
          return;
        }

        const errors = diagnostics.filter(d => d.severity === "error");
        const warnings = diagnostics.filter(d => d.severity === "warning");
        const info = diagnostics.filter(d => d.severity === "info");
        const hints = diagnostics.filter(d => d.severity === "hint");

        console.log(chalk.white(`Found ${diagnostics.length} diagnostic(s):`));
        console.log(`  ${chalk.red(`${errors.length} errors`)}, ${chalk.yellow(`${warnings.length} warnings`)}, ${chalk.blue(`${info.length} info`)}, ${chalk.gray(`${hints.length} hints`)}\n`);

        for (const diag of diagnostics) {
          const loc = `${file}:${diag.line}:${diag.column}`;

          let severityText: string;
          switch (diag.severity) {
            case "error":
              severityText = chalk.red("error");
              break;
            case "warning":
              severityText = chalk.yellow("warning");
              break;
            case "info":
              severityText = chalk.blue("info");
              break;
            case "hint":
              severityText = chalk.gray("hint");
              break;
            default:
              severityText = chalk.gray("unknown");
          }

          const source = diag.source ? chalk.gray(`[${diag.source}]`) : "";
          console.log(`${chalk.cyan(loc)} ${severityText} ${source}`);
          console.log(`  ${diag.message}`);
          console.log();
        }
      } catch (err) {
        if ((err as Error).message.includes("not installed")) {
          console.error(chalk.yellow(`Language server for ${languageId} is not installed.`));
          console.error(chalk.gray(`Install it or configure a custom server in your config.`));
        } else {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
        }
        process.exit(1);
      } finally {
        await manager.shutdown();
      }
    });

  lspCmd
    .command("languages")
    .description("List supported language IDs and file extensions")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      // Group by language ID
      const byLanguage = new Map<string, string[]>();
      for (const [ext, langId] of Object.entries(LANGUAGE_IDS)) {
        const existing = byLanguage.get(langId) ?? [];
        existing.push(ext);
        byLanguage.set(langId, existing);
      }

      const languages = Array.from(byLanguage.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([langId, exts]) => ({ languageId: langId, extensions: exts.sort() }));

      if (options.json) {
        console.log(JSON.stringify({ languages }, null, 2));
        return;
      }

      console.log(chalk.cyan("Supported Languages:\n"));

      for (const { languageId, extensions } of languages) {
        const hasServer = languageId in DEFAULT_LANGUAGE_SERVERS;
        const serverStatus = hasServer ? chalk.green(" [server available]") : "";
        console.log(`  ${chalk.white(languageId)}${serverStatus}`);
        console.log(`    Extensions: ${chalk.gray(extensions.join(", "))}`);
      }
    });
}
