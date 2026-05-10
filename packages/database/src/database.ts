/**
 * Node.js database implementation using better-sqlite3.
 */

import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync, existsSync } from "fs";
import {
  schema,
  type Schema,
  type DatabaseConfig,
  type DatabaseConnection,
  type DatabaseAdapter,
  getSchemaStatements,
} from "@openmgr/agent-database-core";

/**
 * The typed database instance for Node.js using better-sqlite3.
 */
export type AgentDatabase = BetterSQLite3Database<Schema>;

const DEFAULT_CONFIG_DIR = join(homedir(), ".config", "openmgr");
const DEFAULT_DB_PATH = join(DEFAULT_CONFIG_DIR, "agent.db");

let defaultDb: AgentDatabase | null = null;
let defaultSqlite: Database.Database | null = null;
let currentDbPath: string = DEFAULT_DB_PATH;

function ensureDirectoryExists(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Get or create the default database connection.
 * Uses ~/.config/openmgr/agent.db by default.
 */
export function getDb(config?: DatabaseConfig): AgentDatabase {
  const dbPath = config?.path ?? DEFAULT_DB_PATH;
  
  // If requesting a different path than the current connection, close the current one
  if (defaultDb && dbPath !== currentDbPath) {
    closeDb();
  }
  
  if (!defaultDb) {
    const dir = join(dbPath, "..");
    ensureDirectoryExists(dir);
    
    defaultSqlite = new Database(dbPath, {
      verbose: config?.verbose ? console.log : undefined,
    });
    // Enable WAL mode for concurrent read access — prevents exclusive
    // locking that causes hangs when multiple agent processes share the
    // same database file.
    defaultSqlite.pragma('journal_mode = WAL');
    defaultDb = drizzle(defaultSqlite, { schema });
    currentDbPath = dbPath;
  }
  
  return defaultDb;
}

/**
 * Close the default database connection.
 */
export function closeDb(): void {
  if (defaultSqlite) {
    defaultSqlite.close();
    defaultSqlite = null;
    defaultDb = null;
  }
}

/**
 * Get the path to the current database file.
 */
export function getDbPath(): string {
  return currentDbPath;
}

/**
 * Get the default database path.
 */
export function getDefaultDbPath(): string {
  return DEFAULT_DB_PATH;
}

/**
 * Extended database connection that includes the raw SQLite instance.
 */
export interface NodeDatabaseConnection extends DatabaseConnection<AgentDatabase> {
  /** The raw better-sqlite3 database instance */
  sqlite: Database.Database;
}

/**
 * Create a new database connection with custom configuration.
 * This does not affect the default connection.
 */
export function createDatabase(config: DatabaseConfig): NodeDatabaseConnection {
  const dbPath = config.path ?? DEFAULT_DB_PATH;
  const dir = join(dbPath, "..");
  ensureDirectoryExists(dir);
  
  const sqlite = new Database(dbPath, {
    verbose: config.verbose ? console.log : undefined,
  });
  // Enable WAL mode for concurrent read access
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite, { schema });
  
  return {
    db,
    sqlite,
    close: () => { sqlite.close(); },
  };
}

/**
 * Create an in-memory database for testing.
 * The schema tables are automatically created.
 */
export function createInMemoryDatabase(): NodeDatabaseConnection {
  const sqlite = new Database(":memory:");
  
  // Create schema tables
  const statements = getSchemaStatements();
  for (const sql of statements) {
    sqlite.exec(sql);
  }
  
  const db = drizzle(sqlite, { schema });
  
  return {
    db,
    sqlite,
    close: () => { sqlite.close(); },
  };
}

/**
 * Node.js database adapter implementation.
 */
export const nodeDatabaseAdapter: DatabaseAdapter<AgentDatabase> = {
  createDatabase(config: DatabaseConfig): NodeDatabaseConnection {
    return createDatabase(config);
  },
  
  createInMemoryDatabase(): NodeDatabaseConnection {
    return createInMemoryDatabase();
  },
  
  getDefaultPath(): string {
    return DEFAULT_DB_PATH;
  },
  
  ensureDirectory(path: string): void {
    const dir = join(path, "..");
    ensureDirectoryExists(dir);
  },
};

export { schema };
export type { BetterSQLite3Database };
