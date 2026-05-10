/**
 * @ants/agent-database-core
 * 
 * Core database schema, types, and interfaces for Ants Agent.
 * This package is React Native compatible and contains no Node.js-specific code.
 * 
 * Platform-specific implementations:
 * - Node.js: @ants/agent-database (better-sqlite3)
 * - React Native: @ants/agent-database-expo (expo-sqlite)
 */

// Schema and table definitions
export {
  // Tables
  projects,
  remoteServers,
  sessions,
  messages,
  compactionHistory,
  mcpOAuthTokens,
  memoryEntries,
  anthropicTokens,
  
  // Schema object
  schema,
  
  // Interfaces
  type ToolCallData,
  type ToolResultData,
  
  // Row types (SELECT results)
  type ProjectRow,
  type ProjectInsert,
  type RemoteServerRow,
  type RemoteServerInsert,
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
  
  type Schema,
} from "./schema.js";

// Database interface and types
export {
  type DatabaseConfig,
  type DatabaseConnection,
  type DatabaseAdapter,
  type MigrationResult,
  CREATE_SCHEMA_SQL,
  getSchemaStatements,
} from "./interface.js";
