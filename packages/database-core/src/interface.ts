/**
 * Database interface definitions.
 * These abstractions allow different SQLite implementations (better-sqlite3, expo-sqlite, etc.)
 * to be used interchangeably.
 */

// =============================================================================
// Database Types
// =============================================================================

/**
 * Configuration for creating a database connection
 */
export interface DatabaseConfig {
  /** 
   * Path to the SQLite database file. 
   * For in-memory databases, use ":memory:" or leave undefined.
   */
  path?: string;
  
  /** Enable verbose/debug logging */
  verbose?: boolean;
}

/**
 * Result of a database connection.
 * The db property is typed as `unknown` to allow platform-specific types.
 * Platform implementations should re-export with proper types.
 */
export interface DatabaseConnection<TDatabase = unknown> {
  /** The Drizzle ORM database instance */
  db: TDatabase;
  
  /** Close the database connection */
  close: () => void | Promise<void>;
}

// =============================================================================
// Database Adapter Interface
// =============================================================================

/**
 * Interface that platform-specific database implementations must implement.
 * This allows the storage layer to work with any SQLite implementation.
 * 
 * TDatabase is the platform-specific Drizzle database type.
 */
export interface DatabaseAdapter<TDatabase = unknown> {
  /**
   * Create a new database connection.
   * @param config - Database configuration
   * @returns Database connection with close method
   */
  createDatabase(config: DatabaseConfig): DatabaseConnection<TDatabase> | Promise<DatabaseConnection<TDatabase>>;
  
  /**
   * Create an in-memory database for testing.
   * The schema tables should be automatically created.
   * @returns Database connection with close method
   */
  createInMemoryDatabase(): DatabaseConnection<TDatabase> | Promise<DatabaseConnection<TDatabase>>;
  
  /**
   * Get the default database path for this platform.
   * @returns Default path string
   */
  getDefaultPath(): string;
  
  /**
   * Ensure the directory for the database file exists.
   * @param path - Path to the database file
   */
  ensureDirectory?(path: string): void | Promise<void>;
  
  /**
   * Run database migrations.
   * @param db - Database connection
   * @returns Migration result
   */
  runMigrations?(db: TDatabase): Promise<MigrationResult>;
}

/**
 * Result of running database migrations
 */
export interface MigrationResult {
  success: boolean;
  migrationsRun: number;
  message: string;
}

// =============================================================================
// SQL for Schema Creation
// =============================================================================

/**
 * SQL statements to create the database schema.
 * Used for in-memory databases and initial setup.
 */
export const CREATE_SCHEMA_SQL = `
-- Remote servers table (must be created before projects due to FK)
CREATE TABLE IF NOT EXISTS remote_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  api_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  provider_type TEXT NOT NULL CHECK (provider_type IN ('local', 'remote')),
  remote_server_id TEXT REFERENCES remote_servers(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_path_idx ON projects(path);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  user_id TEXT,
  working_directory TEXT NOT NULL,
  title TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  system_prompt TEXT,
  compaction_enabled INTEGER DEFAULT 1,
  compaction_model TEXT,
  compaction_token_threshold INTEGER,
  token_estimate INTEGER DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  cache_creation_input_tokens INTEGER DEFAULT 0,
  cache_read_input_tokens INTEGER DEFAULT 0,
  estimated_cost REAL DEFAULT 0,
  request_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_parent_idx ON sessions(parent_id);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  tool_calls TEXT,
  tool_results TEXT,
  is_compaction_summary INTEGER DEFAULT 0,
  token_count INTEGER,
  sequence INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_session_idx ON messages(session_id);
CREATE INDEX IF NOT EXISTS messages_sequence_idx ON messages(session_id, sequence);

-- Compaction history table
CREATE TABLE IF NOT EXISTS compaction_history (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  original_tokens INTEGER NOT NULL,
  compacted_tokens INTEGER NOT NULL,
  messages_pruned INTEGER NOT NULL,
  from_sequence INTEGER NOT NULL,
  to_sequence INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS compaction_session_idx ON compaction_history(session_id);

-- MCP OAuth tokens table
CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
  server_name TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_type TEXT DEFAULT 'Bearer',
  expires_at INTEGER,
  scopes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Memory entries table
CREATE TABLE IF NOT EXISTS memory_entries (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  embedding BLOB,
  type TEXT NOT NULL CHECK (type IN ('conversation', 'fact', 'note', 'code')),
  metadata TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS memory_session_idx ON memory_entries(session_id);
CREATE INDEX IF NOT EXISTS memory_type_idx ON memory_entries(type);

-- Anthropic tokens table
CREATE TABLE IF NOT EXISTS anthropic_tokens (
  id TEXT PRIMARY KEY DEFAULT 'default',
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

/**
 * Split schema SQL into individual statements for execution.
 * Some SQLite drivers don't support multiple statements in one exec call.
 */
export function getSchemaStatements(): string[] {
  return CREATE_SCHEMA_SQL
    .split(";")
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(s => s + ";");
}
