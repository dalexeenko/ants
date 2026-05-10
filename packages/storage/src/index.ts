// Re-export database layer
export {
  // Database connection
  getDb,
  closeDb,
  getDbPath,
  getDefaultDbPath,
  createDatabase,
  createInMemoryDatabase,
  schema,
  type AgentDatabase,
  type DatabaseConfig,
  type BetterSQLite3Database,
  type NodeDatabaseConnection,
  
  // Schema and types
  sessions,
  messages,
  compactionHistory,
  mcpOAuthTokens,
  memoryEntries,
  anthropicTokens,
  type ToolCallData,
  type ToolResultData,
  type SessionRow,
  type SessionInsert,
  type MessageRow,
  type MessageInsert,
  type CompactionHistoryRow,
  type CompactionHistoryInsert,
  type McpOAuthTokenRow,
  type McpOAuthTokenInsert,
  type MemoryEntryRow,
  type MemoryEntryInsert,
  type AnthropicTokenRow,
  type AnthropicTokenInsert,
  
  // Migrations
  runMigrations,
  initializeDatabase,
  type MigrationResult,
} from "@openmgr/agent-database";

// Storage-specific exports
export {
  SessionManager,
  type SessionManagerOptions,
  type GenericAgentDatabase,
  type CreateSessionOptions,
  type CreateMessageOptions,
  type UpdateSessionOptions,
  type SearchSessionsOptions,
  type SearchMessagesOptions,
  type SearchSessionResult,
  type SearchMessageResult,
} from "./sessions.js";

// Plugin
export {
  storagePlugin,
  type StoragePluginOptions,
} from "./plugin.js";

