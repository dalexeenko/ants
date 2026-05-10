import type { Command } from "commander";
import chalk from "chalk";
import * as readline from "readline";
import * as path from "path";
import { SessionManager, getDb, closeDb } from "@openmgr/agent-storage";
import type { SessionRow } from "@openmgr/agent-storage";

export function registerSessionCommands(program: Command): void {
  const sessionCmd = program
    .command("session")
    .description("Manage sessions");

  sessionCmd
    .command("list")
    .description("List stored sessions")
    .option("-l, --limit <limit>", "Maximum number of sessions", "20")
    .option("-a, --all", "Show sessions from all directories")
    .option("-d, --directory <dir>", "Show sessions from specific directory")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      try {
        const db = getDb();
        const manager = new SessionManager(db);
        let sessions = await manager.getRootSessions(parseInt(options.limit, 10));

        if (!options.all) {
          const targetDir = options.directory ? path.resolve(options.directory) : process.cwd();
          sessions = sessions.filter((session: SessionRow) => session.workingDirectory === targetDir);
        }

        if (options.json) {
          console.log(JSON.stringify(sessions, null, 2));
          closeDb();
          return;
        }

        if (sessions.length === 0) {
          if (options.all) {
            console.log(chalk.gray("No sessions found."));
          } else {
            const currentDir = options.directory ? path.resolve(options.directory) : process.cwd();
            console.log(chalk.gray(`No sessions found for directory: ${currentDir}`));
            console.log(chalk.gray("Use --all to see sessions from all directories."));
          }
          closeDb();
          return;
        }

        console.log(chalk.cyan(`Found ${sessions.length} session(s):\n`));

        for (const session of sessions) {
          const title = session.title ?? "(untitled)";
          const date = session.updatedAt.toLocaleDateString();
          const time = session.updatedAt.toLocaleTimeString();
          console.log(`  ${chalk.white(session.id.slice(0, 8))}  ${chalk.green(title)}`);
          console.log(`    ${chalk.gray(`${session.provider}/${session.model} | ${session.messageCount} messages | ${date} ${time}`)}`);
          console.log(`    ${chalk.gray(session.workingDirectory)}\n`);
        }

        closeDb();
      } catch (error) {
        // Handle case where DB has no tables yet (fresh install)
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("no such table")) {
          console.log(chalk.gray("No sessions found. Database has not been initialized yet."));
        } else {
          console.error(chalk.red(`Error listing sessions: ${message}`));
          process.exit(1);
        }
        closeDb();
      }
    });

  sessionCmd
    .command("show")
    .description("Show details of a session")
    .argument("<id>", "Session ID (can be partial)")
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

      if (options.json) {
        const messages = await manager.getSessionMessages(session.id);
        console.log(JSON.stringify({ session, messages }, null, 2));
        closeDb();
        return;
      }

      console.log(chalk.cyan("Session Details:\n"));
      console.log(`  ID:         ${chalk.white(session.id)}`);
      console.log(`  Title:      ${chalk.green(session.title ?? "(untitled)")}`);
      console.log(`  Provider:   ${chalk.white(session.provider)}`);
      console.log(`  Model:      ${chalk.white(session.model)}`);
      console.log(`  Messages:   ${chalk.white(session.messageCount)}`);
      console.log(`  Tokens:     ${chalk.white(session.tokenEstimate)}`);
      console.log(`  Directory:  ${chalk.gray(session.workingDirectory)}`);
      console.log(`  Created:    ${chalk.gray(session.createdAt.toLocaleString())}`);
      console.log(`  Updated:    ${chalk.gray(session.updatedAt.toLocaleString())}`);

      closeDb();
    });

  sessionCmd
    .command("delete")
    .description("Delete a session")
    .argument("<id>", "Session ID (can be partial)")
    .option("-f, --force", "Skip confirmation")
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

      if (!options.force) {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question(
            chalk.yellow(`Delete session "${session.title ?? session.id}"? (y/N) `),
            resolve
          );
        });
        rl.close();

        if (answer.toLowerCase() !== "y") {
          console.log(chalk.gray("Cancelled."));
          closeDb();
          return;
        }
      }

      await manager.deleteSession(session.id);
      console.log(chalk.green(`Deleted session: ${session.id}`));
      closeDb();
    });

  sessionCmd
    .command("messages")
    .description("Show messages in a session")
    .argument("<id>", "Session ID (can be partial)")
    .option("-l, --limit <limit>", "Maximum number of messages")
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

      const messages = await manager.getSessionMessages(session.id);
      const displayMessages = options.limit
        ? messages.slice(-parseInt(options.limit, 10))
        : messages;

      if (options.json) {
        console.log(JSON.stringify(displayMessages, null, 2));
        closeDb();
        return;
      }

      console.log(chalk.cyan(`Messages in session ${session.id.slice(0, 8)}:\n`));

      for (const msg of displayMessages) {
        const roleColor = msg.role === "user" ? chalk.green : chalk.blue;
        const roleLabel = msg.role === "user" ? "You" : "Assistant";
        const timestamp = new Date(msg.createdAt).toLocaleTimeString();

        console.log(`${roleColor(roleLabel)} ${chalk.gray(`(${timestamp})`)}`);

        if (msg.content) {
          const content = msg.content.length > 500
            ? msg.content.slice(0, 500) + "..."
            : msg.content;
          console.log(content);
        }

        console.log();
      }

      closeDb();
    });
}
