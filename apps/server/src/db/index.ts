import { createHash } from 'crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { existsSync, readFileSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as schema from './schema.js';
import { backfillCreatedBy } from './backfill.js';
import { ensureDirectory } from '../utils/fs.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('database');

export type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>;

export interface DatabaseConfig {
  dataDir: string;
  /** Override path to migration files (used in tests). */
  migrationsFolder?: string;
  /** SQLite journal mode. Defaults to 'wal'. Use 'delete' on network
   *  filesystems (e.g. EFS) where WAL's mmap shared memory is unreliable. */
  sqliteJournalMode?: 'wal' | 'delete';
}

export class DatabaseService {
  private sqlite: Database.Database;
  private _db: DrizzleDB;

  constructor(config: DatabaseConfig) {
    const dbPath = join(config.dataDir, 'openmgr.db');
    
    ensureDirectory(dirname(dbPath));

    this.sqlite = new Database(dbPath);

    // Wait up to 10 seconds for locks to clear (e.g. during rolling deploys
    // where two processes briefly share the same DB file on EFS).
    this.sqlite.pragma('busy_timeout = 10000');

    const journalMode = config.sqliteJournalMode ?? 'wal';
    this.sqlite.pragma(`journal_mode = ${journalMode}`);
    log.info(`SQLite journal mode: ${journalMode}`);
    this._db = drizzle(this.sqlite, { schema });
    
    this.runMigrations(config.migrationsFolder);
    backfillCreatedBy(this._db);
    this.migrateFromJson(config.dataDir);
  }

  get db(): DrizzleDB {
    return this._db;
  }

  /**
   * Detect a database that was created by the old hand-rolled DDL (before
   * drizzle-kit migrations were introduced) and seed the drizzle journal so
   * the initial migration is not re-applied on an existing database.
   *
   * Detection: the `projects` table exists but `__drizzle_migrations` does not.
   */
  private stampLegacyDatabase(migrationsFolder: string): void {
    const hasProjects = this.sqlite
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type='table' AND name='projects'`
      )
      .get();

    const hasDrizzleJournal = this.sqlite
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`
      )
      .get();

    if (!hasProjects || hasDrizzleJournal) {
      // Either a fresh database (nothing to stamp) or already using drizzle
      // migrations — nothing to do.
      return;
    }

    // Read the drizzle-kit journal to discover which migrations exist.
    const journalPath = join(migrationsFolder, 'meta', '_journal.json');
    if (!existsSync(journalPath)) {
      return;
    }

    const journal = JSON.parse(readFileSync(journalPath, 'utf-8')) as {
      entries: Array<{ tag: string; when: number }>;
    };

    // Create the journal table that drizzle-orm expects.
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash TEXT NOT NULL,
        created_at NUMERIC
      )
    `);

    // Only stamp the initial migration (0000) which represents the
    // pre-drizzle hand-rolled schema that already exists in the database.
    // Subsequent migrations (0001, 0002, ...) must NOT be stamped — they
    // contain new schema changes that need to be applied by migrate().
    const initialEntry = journal.entries[0];
    if (!initialEntry) return;

    const sqlPath = join(migrationsFolder, `${initialEntry.tag}.sql`);
    if (!existsSync(sqlPath)) return;

    const insert = this.sqlite.prepare(
      `INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`
    );

    const sqlContent = readFileSync(sqlPath, 'utf-8');
    const hash = createHash('sha256').update(sqlContent).digest('hex');
    insert.run(hash, initialEntry.when);

    log.info(
      'Stamped legacy database with drizzle migration journal ' +
      '(initial migration marked as applied, subsequent migrations will run normally)'
    );
  }

  private runMigrations(overrideFolder?: string): void {
    // Resolve the migrations folder.  In production this lives alongside
    // the compiled JS at dist/db/migrations (or src/db/migrations during
    // development).  Tests can supply an explicit path.
    const migrationsFolder =
      overrideFolder ??
      join(dirname(fileURLToPath(import.meta.url)), 'migrations');

    this.stampLegacyDatabase(migrationsFolder);
    migrate(this._db, { migrationsFolder });
  }

  private migrateFromJson(dataDir: string): void {
    const projectsJsonPath = join(dataDir, 'projects.json');
    
    if (existsSync(projectsJsonPath)) {
      try {
        const data = JSON.parse(readFileSync(projectsJsonPath, 'utf-8'));
        const existingProjects = this._db.select().from(schema.projects).all();
        
        if (existingProjects.length === 0 && Array.isArray(data.projects)) {
          for (const project of data.projects) {
            this._db.insert(schema.projects).values({
              id: project.id,
              name: project.name,
              workingDirectory: project.workingDirectory,
              autoStart: project.autoStart ?? true,
              createdAt: new Date(project.createdAt),
              updatedAt: new Date(project.updatedAt),
            }).run();
          }
          log.info(`Migrated ${data.projects.length} projects from JSON to database`);
        }
        
        renameSync(projectsJsonPath, `${projectsJsonPath}.backup`);
        log.info(`Backed up ${projectsJsonPath} to ${projectsJsonPath}.backup`);
      } catch (error) {
        log.error('Failed to migrate projects from JSON:', error);
      }
    }

    const tasksJsonPath = join(dataDir, 'tasks.json');
    
    if (existsSync(tasksJsonPath)) {
      try {
        const data = JSON.parse(readFileSync(tasksJsonPath, 'utf-8'));
        const existingTasks = this._db.select().from(schema.tasks).all();
        
        if (existingTasks.length === 0 && Array.isArray(data.tasks)) {
          for (const task of data.tasks) {
            this._db.insert(schema.tasks).values({
              id: task.id,
              projectId: task.projectId,
              name: task.name,
              prompt: task.prompt,
              schedule: task.schedule,
              webhookUrl: task.webhookUrl,
              enabled: task.enabled ?? true,
              lastRunAt: task.lastRunAt ? new Date(task.lastRunAt) : null,
              createdAt: new Date(task.createdAt),
              updatedAt: new Date(task.updatedAt),
            }).run();
          }
          log.info(`Migrated ${data.tasks.length} tasks from JSON to database`);
        }
        
        renameSync(tasksJsonPath, `${tasksJsonPath}.backup`);
        log.info(`Backed up ${tasksJsonPath} to ${tasksJsonPath}.backup`);
      } catch (error) {
        log.error('Failed to migrate tasks from JSON:', error);
      }
    }
  }

  close(): void {
    this.sqlite.close();
  }
}
