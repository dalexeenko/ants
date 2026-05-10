/**
 * Database migrations for Node.js using better-sqlite3.
 */

import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDatabase, getDefaultDbPath } from "./database.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import type { MigrationResult } from "@openmgr/agent-database-core";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Migrations folder is at package root, one level up from dist
const MIGRATIONS_PATH = join(__dirname, "../drizzle");

/**
 * Run database migrations from the drizzle migrations folder.
 * 
 * Opens a temporary, isolated database connection for the migration
 * and closes it when done, so it does not interfere with any other
 * open connections in the process.
 */
export async function runMigrations(dbPath?: string): Promise<MigrationResult> {
  if (!existsSync(MIGRATIONS_PATH)) {
    return {
      success: true,
      migrationsRun: 0,
      message: `Migrations directory not found at ${MIGRATIONS_PATH}. Skipping migrations.`,
    };
  }

  // Use an isolated connection for migrations so we don't disturb
  // any existing connections held by other projects / plugins.
  const connection = createDatabase({ path: dbPath });
  
  try {
    migrate(connection.db, { migrationsFolder: MIGRATIONS_PATH });
    return {
      success: true,
      migrationsRun: -1, // Unknown count
      message: "Database migrations completed successfully.",
    };
  } catch (error) {
    const err = error as Error;
    if (err.message.includes("no migration files found")) {
      return {
        success: true,
        migrationsRun: 0,
        message: "No migrations to run.",
      };
    }
    return {
      success: false,
      migrationsRun: 0,
      message: `Migration failed: ${err.message}`,
    };
  } finally {
    connection.close();
  }
}

/**
 * Initialize the database by running migrations.
 */
export async function initializeDatabase(dbPath?: string): Promise<MigrationResult> {
  const path = dbPath ?? getDefaultDbPath();
  console.log(`Initializing database at ${path}`);
  return runMigrations(dbPath);
}

// CLI entry point — only run when this file is executed directly via `node migrate.js`.
// IMPORTANT: When bundled (e.g., by electron-vite/rollup), import.meta.url gets
// rewritten to __filename which can falsely match process.argv[1] in the bundle,
// causing process.exit() to kill the host app. Guard against this by also checking
// that we are NOT running inside Electron.
if (
  typeof process !== "undefined" &&
  !(process.versions && 'electron' in process.versions) &&
  import.meta.url === `file://${process.argv[1]}`
) {
  initializeDatabase()
    .then((result) => {
      console.log(result.message);
      process.exit(result.success ? 0 : 1);
    })
    .catch((err) => {
      console.error("Database initialization failed:", err);
      process.exit(1);
    });
}
