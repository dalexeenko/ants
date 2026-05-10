import Database from "better-sqlite3";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";

const MEMORY_DIR = ".openmgr";
const MEMORY_DB_FILE = "memories.db";

const projectDatabases = new Map<string, Database.Database>();

/**
 * Get the path to the memory database for a project.
 */
export function getMemoryDbPath(projectRoot: string): string {
  return join(projectRoot, MEMORY_DIR, MEMORY_DB_FILE);
}

function ensureMemoryDir(projectRoot: string): void {
  const memoryDir = join(projectRoot, MEMORY_DIR);
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }
}

function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT '/',
      tags TEXT NOT NULL DEFAULT '[]',
      author TEXT,
      embedding BLOB,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS memories_scope_idx ON memories(scope);
    CREATE INDEX IF NOT EXISTS memories_created_at_idx ON memories(created_at);
    CREATE INDEX IF NOT EXISTS memories_updated_at_idx ON memories(updated_at);
  `);

  // FTS5 for full-text search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      id,
      content,
      tags,
      content='memories',
      content_rowid='rowid'
    );
  `);

  // Triggers to keep FTS in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, id, content, tags) 
      VALUES (NEW.rowid, NEW.id, NEW.content, NEW.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, id, content, tags) 
      VALUES ('delete', OLD.rowid, OLD.id, OLD.content, OLD.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, id, content, tags) 
      VALUES ('delete', OLD.rowid, OLD.id, OLD.content, OLD.tags);
      INSERT INTO memories_fts(rowid, id, content, tags) 
      VALUES (NEW.rowid, NEW.id, NEW.content, NEW.tags);
    END;
  `);
}

/**
 * Get or create a database connection for a project.
 */
export function getMemoryDb(projectRoot: string): Database.Database {
  const existing = projectDatabases.get(projectRoot);
  if (existing) {
    return existing;
  }

  ensureMemoryDir(projectRoot);
  const dbPath = getMemoryDbPath(projectRoot);
  const db = new Database(dbPath);
  
  initializeSchema(db);
  
  projectDatabases.set(projectRoot, db);
  return db;
}

/**
 * Close the database connection for a project.
 */
export function closeMemoryDb(projectRoot: string): void {
  const db = projectDatabases.get(projectRoot);
  if (db) {
    db.close();
    projectDatabases.delete(projectRoot);
  }
}

/**
 * Close all open database connections.
 */
export function closeAllMemoryDbs(): void {
  for (const [projectRoot, db] of projectDatabases) {
    db.close();
    projectDatabases.delete(projectRoot);
  }
}

/**
 * Check if a memory database exists for a project.
 */
export function memoryDbExists(projectRoot: string): boolean {
  return existsSync(getMemoryDbPath(projectRoot));
}

/**
 * Create an in-memory database for testing.
 */
export function createInMemoryDb(): Database.Database {
  const db = new Database(":memory:");
  initializeSchema(db);
  return db;
}
