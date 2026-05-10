/**
 * @ants/agent-database-react-native
 *
 * React Native SQLite database implementation for Ants Agent using expo-sqlite.
 *
 * This package provides a React Native compatible database layer that implements
 * the same interface as @ants/agent-database for Node.js.
 *
 * @example
 * ```typescript
 * import { createReactNativeDatabase } from "@ants/agent-database-react-native";
 * import * as SQLite from "expo-sqlite";
 *
 * // Create a database connection
 * const { db, close } = createReactNativeDatabase(SQLite, {
 *   path: "agent.db",
 * });
 *
 * // Use with SessionManager
 * import { SessionManager } from "@ants/agent-storage";
 * const sessionManager = new SessionManager(db);
 * ```
 */

import { drizzle, type ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite";
import type { SQLiteDatabase } from "expo-sqlite";
import {
  schema,
  type Schema,
  type DatabaseConfig,
  type DatabaseConnection,
  type DatabaseAdapter,
  type MigrationResult,
  getSchemaStatements,
} from "@ants/agent-database-core";

// Re-export everything from core
export * from "@ants/agent-database-core";

/**
 * The typed database instance for React Native using expo-sqlite.
 */
export type AgentDatabase = ExpoSQLiteDatabase<Schema>;

/**
 * Expo SQLite module interface - the minimal interface we need from expo-sqlite.
 * This allows the package to work with the expo-sqlite module passed in at runtime.
 */
export interface ExpoSQLiteModule {
  openDatabaseSync(name: string): SQLiteDatabase;
}

/**
 * React Native database connection that includes the raw SQLite instance.
 */
export interface ReactNativeDatabaseConnection
  extends DatabaseConnection<AgentDatabase> {
  /** The raw expo-sqlite database instance */
  sqlite: SQLiteDatabase;
}

/**
 * Default database name for React Native.
 * On React Native, databases are stored in the app's document directory.
 */
export const DEFAULT_DB_NAME = "ants-agent.db";

/**
 * Create a React Native database connection using expo-sqlite.
 *
 * @param SQLite - The expo-sqlite module (import * as SQLite from "expo-sqlite")
 * @param config - Database configuration
 * @returns Database connection with Drizzle ORM and close method
 *
 * @example
 * ```typescript
 * import * as SQLite from "expo-sqlite";
 * import { createReactNativeDatabase } from "@ants/agent-database-react-native";
 *
 * const { db, close } = createReactNativeDatabase(SQLite, {
 *   path: "my-app.db",
 * });
 * ```
 */
/**
 * Run column-level migrations for existing databases.
 * CREATE TABLE IF NOT EXISTS won't add new columns, so we check for
 * missing columns and add them via ALTER TABLE.
 */
function runColumnMigrations(sqlite: SQLiteDatabase, verbose?: boolean): void {
  // Migration: add user_id to sessions table
  try {
    const columns = sqlite.getAllSync<{ name: string }>(
      "PRAGMA table_info(sessions)"
    );
    const hasUserId = columns.some((col) => col.name === "user_id");
    if (!hasUserId) {
      sqlite.execSync("ALTER TABLE sessions ADD COLUMN user_id TEXT;");
      if (verbose) {
        console.log("Added user_id column to sessions table");
      }
    }
  } catch (error) {
    if (verbose) {
      console.log("Column migration error:", error);
    }
  }
}

export function createReactNativeDatabase(
  SQLite: ExpoSQLiteModule,
  config: DatabaseConfig = {}
): ReactNativeDatabaseConnection {
  const dbName = config.path ?? DEFAULT_DB_NAME;

  // Open the database synchronously
  const sqlite = SQLite.openDatabaseSync(dbName);

  // Create schema tables if needed
  const statements = getSchemaStatements();
  for (const sql of statements) {
    try {
      sqlite.execSync(sql);
    } catch (error) {
      // Ignore errors for CREATE TABLE IF NOT EXISTS
      if (config.verbose) {
        console.log(`SQL statement result:`, error);
      }
    }
  }

  // Run column migrations for existing databases
  // CREATE TABLE IF NOT EXISTS won't add new columns to existing tables
  runColumnMigrations(sqlite, config.verbose);

  // Create Drizzle instance
  const db = drizzle(sqlite, { schema });

  return {
    db,
    sqlite,
    close: () => {
      sqlite.closeSync();
    },
  };
}

/**
 * Create an in-memory database for testing in React Native.
 * Note: expo-sqlite may not support true in-memory databases on all platforms.
 * This creates a temporary database with a unique name.
 *
 * @param SQLite - The expo-sqlite module
 * @returns Database connection with close method
 */
export function createInMemoryReactNativeDatabase(
  SQLite: ExpoSQLiteModule
): ReactNativeDatabaseConnection {
  // Use a unique name for the "in-memory" database
  // Note: expo-sqlite doesn't support true :memory: databases
  const tempName = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;

  return createReactNativeDatabase(SQLite, { path: tempName });
}

/**
 * React Native database adapter factory.
 * Creates an adapter instance bound to a specific expo-sqlite module.
 *
 * @param SQLite - The expo-sqlite module
 * @returns Database adapter implementation
 *
 * @example
 * ```typescript
 * import * as SQLite from "expo-sqlite";
 * import { createReactNativeDatabaseAdapter } from "@ants/agent-database-react-native";
 *
 * const adapter = createReactNativeDatabaseAdapter(SQLite);
 * const { db, close } = adapter.createDatabase({ path: "app.db" });
 * ```
 */
export function createReactNativeDatabaseAdapter(
  SQLite: ExpoSQLiteModule
): DatabaseAdapter<AgentDatabase> {
  return {
    createDatabase(config: DatabaseConfig): ReactNativeDatabaseConnection {
      return createReactNativeDatabase(SQLite, config);
    },

    createInMemoryDatabase(): ReactNativeDatabaseConnection {
      return createInMemoryReactNativeDatabase(SQLite);
    },

    getDefaultPath(): string {
      return DEFAULT_DB_NAME;
    },

    // Note: ensureDirectory is not needed on React Native as expo-sqlite
    // handles directory creation automatically
  };
}

/**
 * Run schema creation as a simple migration.
 * This ensures all tables exist.
 *
 * @param sqlite - The raw expo-sqlite database instance
 * @returns Migration result
 */
export async function runReactNativeMigrations(
  sqlite: SQLiteDatabase
): Promise<MigrationResult> {
  try {
    const statements = getSchemaStatements();
    for (const sql of statements) {
      sqlite.execSync(sql);
    }

    // Run column-level migrations for existing tables
    runColumnMigrations(sqlite);

    return {
      success: true,
      migrationsRun: statements.length,
      message: "Schema tables created/verified successfully.",
    };
  } catch (error) {
    return {
      success: false,
      migrationsRun: 0,
      message: `Migration failed: ${(error as Error).message}`,
    };
  }
}
