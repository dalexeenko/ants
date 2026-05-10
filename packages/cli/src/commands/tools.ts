import type { Command } from "commander";
import chalk from "chalk";
import {
  loadConfig,
  loadGlobalConfig,
  loadLocalConfig,
  saveGlobalConfig,
  saveLocalConfig,
} from "@openmgr/agent-config-xdg";

// ============================================================================
// Built-in tool definitions (for display purposes)
// ============================================================================

interface ToolInfo {
  name: string;
  description: string;
  plugin: string;
}

const BUILTIN_TOOLS: ToolInfo[] = [
  // Platform-agnostic tools (@openmgr/agent-tools)
  { name: "todoread", description: "Read current todo list", plugin: "agent-tools" },
  { name: "todowrite", description: "Write/update todo list", plugin: "agent-tools" },
  { name: "phaseread", description: "Read current phase", plugin: "agent-tools" },
  { name: "phasewrite", description: "Write/update phase", plugin: "agent-tools" },
  { name: "web_fetch", description: "Fetch content from a URL", plugin: "agent-tools" },
  { name: "web_search", description: "Search the web", plugin: "agent-tools" },
  { name: "skill", description: "Load a skill for domain-specific instructions", plugin: "agent-tools" },
  { name: "task", description: "Launch a subagent for complex tasks", plugin: "agent-tools" },
  { name: "task_status", description: "Check subagent task status", plugin: "agent-tools" },
  { name: "task_cancel", description: "Cancel a running subagent task", plugin: "agent-tools" },
  { name: "question", description: "Ask the user a question with options", plugin: "agent-tools" },

  // Terminal/filesystem tools (@openmgr/agent-tools-terminal)
  { name: "bash", description: "Execute shell commands", plugin: "agent-tools-terminal" },
  { name: "read", description: "Read file contents", plugin: "agent-tools-terminal" },
  { name: "write", description: "Write file contents", plugin: "agent-tools-terminal" },
  { name: "edit", description: "Edit file with string replacement", plugin: "agent-tools-terminal" },
  { name: "glob", description: "Find files by pattern", plugin: "agent-tools-terminal" },
  { name: "grep", description: "Search file contents with regex", plugin: "agent-tools-terminal" },
];

// ============================================================================
// Commands
// ============================================================================

export function registerToolsCommands(program: Command): void {
  const toolsCmd = program
    .command("tools")
    .description("List and manage available tools");

  // ── tools list ───────────────────────────────────────────────────────────

  toolsCmd
    .command("list")
    .description("List all tools and their status")
    .option("-d, --directory <dir>", "Working directory", process.cwd())
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const config = await loadConfig(options.directory);
      const disabledSet = new Set(config.disabledTools ?? []);
      const whitelistSet = config.tools ? new Set(config.tools) : null;

      if (options.json) {
        const result = BUILTIN_TOOLS.map((tool) => {
          const whitelisted = whitelistSet ? whitelistSet.has(tool.name) : true;
          const blacklisted = disabledSet.has(tool.name);
          return {
            ...tool,
            enabled: whitelisted && !blacklisted,
            disabled: blacklisted,
            whitelisted: whitelistSet ? whitelisted : undefined,
          };
        });
        console.log(JSON.stringify({ tools: result }, null, 2));
        return;
      }

      console.log(chalk.cyan("\nAvailable Tools:\n"));

      // Group by plugin
      const byPlugin = new Map<string, ToolInfo[]>();
      for (const tool of BUILTIN_TOOLS) {
        const list = byPlugin.get(tool.plugin) ?? [];
        list.push(tool);
        byPlugin.set(tool.plugin, list);
      }

      for (const [plugin, tools] of byPlugin) {
        console.log(chalk.white(`  ${plugin}:`));
        for (const tool of tools) {
          const whitelisted = whitelistSet ? whitelistSet.has(tool.name) : true;
          const blacklisted = disabledSet.has(tool.name);
          const enabled = whitelisted && !blacklisted;

          const status = enabled
            ? chalk.green("enabled")
            : chalk.red("disabled");
          const name = enabled
            ? chalk.white(tool.name)
            : chalk.gray(tool.name);
          const padding = " ".repeat(Math.max(1, 16 - tool.name.length));

          console.log(`    ${name}${padding}${status}  ${chalk.gray(tool.description)}`);
        }
        console.log();
      }

      if (whitelistSet) {
        console.log(chalk.yellow("  Note: tools whitelist is active (only whitelisted tools are enabled)\n"));
      }
    });

  // ── tools disable ────────────────────────────────────────────────────────

  toolsCmd
    .command("disable")
    .description("Disable one or more tools")
    .argument("<tools...>", "Tool names to disable (e.g., bash web_fetch)")
    .option("--local", "Save to local project config")
    .option("-d, --directory <dir>", "Working directory", process.cwd())
    .action(async (toolNames: string[], options) => {
      const knownNames = new Set(BUILTIN_TOOLS.map((t) => t.name));
      const unknown = toolNames.filter((n) => !knownNames.has(n));
      if (unknown.length > 0) {
        console.error(chalk.yellow(`Warning: unknown tool(s): ${unknown.join(", ")}`));
        console.log(chalk.gray(`Known tools: ${BUILTIN_TOOLS.map((t) => t.name).join(", ")}`));
      }

      // Load existing config to merge
      const scope = options.local ? "local" : "global";
      const existing = scope === "local"
        ? (await loadLocalConfig(options.directory)) ?? {}
        : (await loadGlobalConfig()) ?? {};

      const currentDisabled = new Set(existing.disabledTools ?? []);
      for (const name of toolNames) {
        currentDisabled.add(name);
      }

      const update = { disabledTools: Array.from(currentDisabled) };

      if (options.local) {
        await saveLocalConfig(options.directory, update);
      } else {
        await saveGlobalConfig(update);
      }

      console.log(chalk.green(`Disabled: ${toolNames.join(", ")} (${scope} config)`));
    });

  // ── tools enable ─────────────────────────────────────────────────────────

  toolsCmd
    .command("enable")
    .description("Enable one or more previously disabled tools")
    .argument("<tools...>", "Tool names to enable (e.g., bash web_fetch)")
    .option("--local", "Save to local project config")
    .option("-d, --directory <dir>", "Working directory", process.cwd())
    .action(async (toolNames: string[], options) => {
      const scope = options.local ? "local" : "global";
      const existing = scope === "local"
        ? (await loadLocalConfig(options.directory)) ?? {}
        : (await loadGlobalConfig()) ?? {};

      const currentDisabled = new Set(existing.disabledTools ?? []);
      const reEnabled: string[] = [];
      for (const name of toolNames) {
        if (currentDisabled.delete(name)) {
          reEnabled.push(name);
        }
      }

      const update = { disabledTools: currentDisabled.size > 0 ? Array.from(currentDisabled) : undefined };

      if (options.local) {
        await saveLocalConfig(options.directory, update);
      } else {
        await saveGlobalConfig(update);
      }

      if (reEnabled.length > 0) {
        console.log(chalk.green(`Enabled: ${reEnabled.join(", ")} (${scope} config)`));
      }
      const notDisabled = toolNames.filter((n) => !reEnabled.includes(n));
      if (notDisabled.length > 0) {
        console.log(chalk.gray(`Already enabled: ${notDisabled.join(", ")}`));
      }
    });
}
