import type { Command } from "commander";
import chalk from "chalk";
import { getDbPath, closeDb, runMigrations } from "@openmgr/agent-storage";

export function registerDbCommands(program: Command): void {
  const dbCmd = program
    .command("db")
    .description("Database management commands");

  dbCmd
    .command("path")
    .description("Show database file path")
    .action(() => {
      console.log(getDbPath());
    });

  dbCmd
    .command("migrate")
    .description("Run database migrations")
    .action(async () => {
      const result = await runMigrations();
      closeDb();
      if (result.success) {
        console.log(chalk.green("Migrations complete."));
        if (result.migrationsRun > 0) {
          console.log(chalk.gray(`Applied ${result.migrationsRun} migration(s).`));
        }
        console.log(chalk.gray(result.message));
      } else {
        console.error(chalk.red(`Migration failed: ${result.message}`));
        process.exit(1);
      }
    });
}
