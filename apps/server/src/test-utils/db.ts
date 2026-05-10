/**
 * Shared test helper for creating in-memory SQLite databases with the
 * full drizzle schema applied via drizzle-kit migrations.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as schema from '../db/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolved path to the migration SQL files in the source tree. */
const MIGRATIONS_FOLDER = join(__dirname, '..', 'db', 'migrations');

export type TestDB = ReturnType<typeof drizzle<typeof schema>>;

export interface TestDatabase {
  sqlite: Database.Database;
  db: TestDB;
}

/**
 * Create an in-memory SQLite database with the full schema applied via
 * drizzle-kit migrations.  Returns both the raw `better-sqlite3` handle
 * (for cleanup in `afterEach`) and the drizzle wrapper.
 */
export function createTestDatabase(): TestDatabase {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { sqlite, db };
}
