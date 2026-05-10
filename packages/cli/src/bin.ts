#!/usr/bin/env node
/**
 * OpenMgr Agent CLI Entry Point
 */

import { Command } from "commander";
import { registerAllCommands } from "./commands/index.js";

const program = new Command();

program
  .name("openmgr-agent")
  .description("OpenMgr Agent - AI coding assistant")
  .version("0.1.0");

// Register all commands
registerAllCommands(program);

// Default action (when no command is provided)
program.action(() => {
  // If no command, show help
  program.help();
});

program.parseAsync();
