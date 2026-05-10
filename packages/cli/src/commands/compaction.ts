import type { Command } from "commander";
import chalk from "chalk";
import { SessionManager, getDb, closeDb } from "@ants/agent-storage";
import type { SessionRow } from "@ants/agent-storage";

export function registerCompactionCommands(program: Command): void {
  const compactionCmd = program
    .command("compaction")
    .description("Context compaction management");

  compactionCmd
    .command("show")
    .description("Show compaction config for a session")
    .argument("<session-id>", "Session ID (can be partial)")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      const db = getDb();
      const manager = new SessionManager(db);
      const sessions = await manager.getRootSessions(100);
      const session = sessions.find((s: SessionRow) => s.id.startsWith(id));

      if (!session) {
        console.error(chalk.red(`Session not found: ${id}`));
        closeDb();
        process.exit(1);
      }

      const compactionConfig = {
        enabled: session.compactionEnabled,
        model: session.compactionModel,
        tokenThreshold: session.compactionTokenThreshold,
      };

      if (options.json) {
        console.log(JSON.stringify({ config: compactionConfig }, null, 2));
        closeDb();
        return;
      }

      console.log(chalk.cyan("Compaction Config:\n"));
      console.log(`  Enabled:     ${compactionConfig.enabled ? chalk.green("yes") : chalk.gray("no")}`);
      if (compactionConfig.model) {
        console.log(`  Model:       ${chalk.white(compactionConfig.model)}`);
      }
      if (compactionConfig.tokenThreshold) {
        console.log(`  Threshold:   ${chalk.white(compactionConfig.tokenThreshold)}`);
      }

      closeDb();
    });

  compactionCmd
    .command("set")
    .description("Update compaction config for a session")
    .argument("<session-id>", "Session ID (can be partial)")
    .option("--enabled <bool>", "Enable/disable compaction")
    .option("--threshold <number>", "Token threshold (0-1)")
    .option("--model <model>", "Model to use for summarization")
    .action(async (id, options) => {
      const db = getDb();
      const manager = new SessionManager(db);
      const sessions = await manager.getRootSessions(100);
      const session = sessions.find((s: SessionRow) => s.id.startsWith(id));

      if (!session) {
        console.error(chalk.red(`Session not found: ${id}`));
        closeDb();
        process.exit(1);
      }

      const updates: Record<string, unknown> = {};
      if (options.enabled !== undefined) {
        updates.compactionEnabled = options.enabled === "true";
      }
      if (options.threshold !== undefined) {
        updates.compactionTokenThreshold = parseFloat(options.threshold);
      }
      if (options.model !== undefined) {
        updates.compactionModel = options.model;
      }

      if (Object.keys(updates).length === 0) {
        console.error(chalk.red("No updates specified."));
        closeDb();
        process.exit(1);
      }

      await manager.updateSession(session.id, updates);
      console.log(chalk.green("Compaction config updated."));

      closeDb();
    });
}
