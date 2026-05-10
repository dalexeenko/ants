/**
 * @openmgr/agent-database
 * 
 * SQLite database layer with Drizzle ORM for OpenMgr Agent.
 * This is the Node.js implementation using better-sqlite3.
 * 
 * For React Native, use @openmgr/agent-database-expo instead.
 */

// Re-export everything from core (schema, types, interfaces)
export * from "@openmgr/agent-database-core";

// Database connection (Node.js specific)
export {
  getDb,
  closeDb,
  getDbPath,
  getDefaultDbPath,
  createDatabase,
  createInMemoryDatabase,
  nodeDatabaseAdapter,
  type AgentDatabase,
  type NodeDatabaseConnection,
  type BetterSQLite3Database,
} from "./database.js";

// Migrations (Node.js specific)
export {
  runMigrations,
  initializeDatabase,
} from "./migrate.js";
