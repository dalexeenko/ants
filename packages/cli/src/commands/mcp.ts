import type { Command } from "commander";
import chalk from "chalk";
import { McpManager, type McpServerConfig } from "@openmgr/agent-core";
import { loadConfig } from "@openmgr/agent-config-xdg";

export function registerMcpCommands(program: Command): void {
  const mcpCmd = program
    .command("mcp")
    .description("MCP server management");

  mcpCmd
    .command("list")
    .description("List configured MCP servers")
    .option("-d, --directory <dir>", "Working directory", process.cwd())
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const config = await loadConfig(options.directory);

      if (!config.mcp || Object.keys(config.mcp).length === 0) {
        if (options.json) {
          console.log(JSON.stringify({ servers: [] }, null, 2));
        } else {
          console.log(chalk.gray("No MCP servers configured."));
        }
        return;
      }

      if (options.json) {
        console.log(JSON.stringify({ servers: Object.entries(config.mcp).map(([name, cfg]) => ({ name, ...(cfg as McpServerConfig) })) }, null, 2));
        return;
      }

      console.log(chalk.cyan(`Configured MCP servers:\n`));
      for (const [name, serverConfigRaw] of Object.entries(config.mcp)) {
        const serverConfig = serverConfigRaw as McpServerConfig;
        const transport = serverConfig.transport ?? "stdio";
        console.log(`  ${chalk.white(name)}`);
        console.log(`    Transport: ${chalk.gray(transport)}`);
        if (transport === "stdio" && "command" in serverConfig) {
          console.log(`    Command:   ${chalk.gray(serverConfig.command)}`);
          if ("args" in serverConfig && serverConfig.args?.length) {
            console.log(`    Args:      ${chalk.gray(serverConfig.args.join(" "))}`);
          }
        } else if (transport === "sse" && "url" in serverConfig) {
          console.log(`    URL:       ${chalk.gray(serverConfig.url)}`);
        }
        console.log();
      }
    });

  mcpCmd
    .command("status")
    .description("Show status of MCP servers (connect and list tools)")
    .option("-d, --directory <dir>", "Working directory", process.cwd())
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const config = await loadConfig(options.directory);

      if (!config.mcp || Object.keys(config.mcp).length === 0) {
        if (options.json) {
          console.log(JSON.stringify({ servers: [] }, null, 2));
        } else {
          console.log(chalk.gray("No MCP servers configured."));
        }
        return;
      }

      const manager = new McpManager();

      console.log(chalk.cyan("Connecting to MCP servers...\n"));

      for (const [name, serverConfigRaw] of Object.entries(config.mcp)) {
        try {
          process.stdout.write(`  ${name}: `);
          await manager.addServer(name, serverConfigRaw as McpServerConfig);
          console.log(chalk.green("connected"));
        } catch (err) {
          console.log(chalk.red(`failed - ${(err as Error).message}`));
        }
      }

      const servers = manager.getServers();

      if (options.json) {
        console.log(JSON.stringify({ servers }, null, 2));
        await manager.shutdown();
        return;
      }

      console.log(chalk.cyan("\nServer Status:\n"));

      for (const server of servers) {
        const status = server.connected ? chalk.green("connected") : chalk.red("disconnected");
        console.log(`  ${chalk.white(server.name)}: ${status}`);
        console.log(`    Transport: ${chalk.gray(server.transport)}`);
        console.log(`    Tools:     ${chalk.gray(server.toolCount)}`);
        console.log();
      }

      await manager.shutdown();
    });

  mcpCmd
    .command("tools")
    .description("List all tools from configured MCP servers")
    .option("-d, --directory <dir>", "Working directory", process.cwd())
    .option("-s, --server <name>", "Filter by server name")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const config = await loadConfig(options.directory);

      if (!config.mcp || Object.keys(config.mcp).length === 0) {
        if (options.json) {
          console.log(JSON.stringify({ tools: [] }, null, 2));
        } else {
          console.log(chalk.gray("No MCP servers configured."));
        }
        return;
      }

      const manager = new McpManager();
      await manager.loadFromConfig(config.mcp);

      let tools = manager.getTools();
      if (options.server) {
        tools = tools.filter((t) => t.serverName === options.server);
      }

      if (options.json) {
        console.log(JSON.stringify({ tools }, null, 2));
        await manager.shutdown();
        return;
      }

      if (tools.length === 0) {
        console.log(chalk.gray("No tools available."));
        await manager.shutdown();
        return;
      }

      console.log(chalk.cyan(`Available MCP tools (${tools.length}):\n`));

      const byServer = new Map<string, typeof tools>();
      for (const tool of tools) {
        const existing = byServer.get(tool.serverName) ?? [];
        existing.push(tool);
        byServer.set(tool.serverName, existing);
      }

      for (const [serverName, serverTools] of byServer) {
        console.log(`  ${chalk.white(serverName)}:`);
        for (const tool of serverTools) {
          console.log(`    ${chalk.green(tool.name)}`);
          if (tool.description) {
            const desc = tool.description.length > 60
              ? tool.description.slice(0, 60) + "..."
              : tool.description;
            console.log(`      ${chalk.gray(desc)}`);
          }
        }
        console.log();
      }

      await manager.shutdown();
    });

  mcpCmd
    .command("test")
    .description("Test connection to an MCP server")
    .argument("<name>", "Server name from config")
    .option("-d, --directory <dir>", "Working directory", process.cwd())
    .action(async (name, options) => {
      const config = await loadConfig(options.directory);

      if (!config.mcp || !config.mcp[name]) {
        console.error(chalk.red(`MCP server not found in config: ${name}`));
        process.exit(1);
      }

      const manager = new McpManager();
      console.log(chalk.cyan(`Testing connection to ${name}...`));

      try {
        await manager.addServer(name, config.mcp[name]);
        const servers = manager.getServers();
        const server = servers.find((s) => s.name === name);

        if (server?.connected) {
          console.log(chalk.green(`\nSuccess! Connected to ${name}`));
          console.log(`  Transport: ${chalk.gray(server.transport)}`);
          console.log(`  Tools:     ${chalk.gray(server.toolCount)}`);

          const tools = manager.getTools().filter((t) => t.serverName === name);
          if (tools.length > 0) {
            console.log(`\n  Available tools:`);
            for (const tool of tools.slice(0, 10)) {
              console.log(`    - ${chalk.green(tool.name)}`);
            }
            if (tools.length > 10) {
              console.log(`    ... and ${tools.length - 10} more`);
            }
          }
        } else {
          console.log(chalk.red(`Failed to connect to ${name}`));
        }
      } catch (err) {
        console.error(chalk.red(`Connection failed: ${(err as Error).message}`));
        process.exit(1);
      } finally {
        await manager.shutdown();
      }
    });
}
