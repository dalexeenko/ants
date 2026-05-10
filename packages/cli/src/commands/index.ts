import type { Command } from "commander";
import { registerAuthCommands } from "./auth.js";
import { registerServeCommand } from "./serve.js";
import { registerConfigCommands } from "./config.js";
import { registerDbCommands } from "./db.js";
import { registerModelsCommands } from "./models.js";
import { registerSessionCommands } from "./session.js";
import { registerMcpCommands } from "./mcp.js";
import { registerLspCommands } from "./lsp.js";
import { registerCompactionCommands } from "./compaction.js";
import { registerSkillCommands } from "./skill.js";
import { registerToolsCommands } from "./tools.js";
import { registerReplCommand } from "./repl.js";
import { registerPromptCommand } from "./prompt.js";

/**
 * Register all CLI commands to the program
 */
export function registerAllCommands(program: Command): void {
  registerAuthCommands(program);
  registerServeCommand(program);
  registerConfigCommands(program);
  registerDbCommands(program);
  registerModelsCommands(program);
  registerSessionCommands(program);
  registerMcpCommands(program);
  registerLspCommands(program);
  registerCompactionCommands(program);
  registerSkillCommands(program);
  registerToolsCommands(program);
  registerReplCommand(program);
  registerPromptCommand(program);
}

export { registerAuthCommands } from "./auth.js";
export { registerServeCommand } from "./serve.js";
export { registerConfigCommands } from "./config.js";
export { registerDbCommands } from "./db.js";
export { registerModelsCommands } from "./models.js";
export { registerSessionCommands } from "./session.js";
export { registerMcpCommands } from "./mcp.js";
export { registerLspCommands } from "./lsp.js";
export { registerCompactionCommands } from "./compaction.js";
export { registerSkillCommands } from "./skill.js";
export { registerToolsCommands } from "./tools.js";
export { registerReplCommand } from "./repl.js";
export { registerPromptCommand } from "./prompt.js";
