/**
 * App-level database for storing projects, remote servers, and other app-wide data.
 * This is separate from the per-project agent databases.
 * 
 * Uses raw SQL via better-sqlite3 to avoid drizzle-orm version conflicts between
 * the app and agent repos.
 */
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import Database from 'better-sqlite3';

// =============================================================================
// Types
// =============================================================================

export interface ProjectRow {
  id: string;
  name: string;
  path: string;
  providerType: 'local' | 'remote';
  remoteServerId: string | null;
  worktreeEnabled: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectInsert {
  id: string;
  name: string;
  path: string;
  providerType: 'local' | 'remote';
  remoteServerId?: string | null;
  worktreeEnabled?: boolean | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface RemoteServerRow {
  id: string;
  name: string;
  url: string;
  apiKey: string | null;
  authType: string | null;
  authConfig: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RemoteServerInsert {
  id: string;
  name: string;
  url: string;
  apiKey?: string | null;
  authType?: string | null;
  authConfig?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface AnthropicTokenRow {
  id: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// Database Class
// =============================================================================

export class AppDatabase {
  private sqlite: Database.Database;
  private static instance: AppDatabase | null = null;

  private constructor() {
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'app.db');
    
    // Ensure directory exists
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    
    this.sqlite = new Database(dbPath);
    
    // Run migrations
    this.runMigrations();
  }

  static getInstance(): AppDatabase {
    if (!AppDatabase.instance) {
      AppDatabase.instance = new AppDatabase();
    }
    return AppDatabase.instance;
  }

  private runMigrations() {
    // Create tables if they don't exist
    this.sqlite.exec(`
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
      
      CREATE TABLE IF NOT EXISTS remote_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        api_key TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS anthropic_tokens (
        id TEXT PRIMARY KEY DEFAULT 'default',
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // Migration: Add auth_type and auth_config columns to remote_servers
    try {
      this.sqlite.exec(`ALTER TABLE remote_servers ADD COLUMN auth_type TEXT`);
    } catch {
      // Column already exists
    }
    try {
      this.sqlite.exec(`ALTER TABLE remote_servers ADD COLUMN auth_config TEXT`);
    } catch {
      // Column already exists
    }

    // Migration: Add worktree_enabled column to projects
    try {
      this.sqlite.exec(`ALTER TABLE projects ADD COLUMN worktree_enabled INTEGER`);
    } catch {
      // Column already exists
    }
  }

  // =============================================================================
  // Helper Methods
  // =============================================================================

  private toDate(timestamp: number): Date {
    return new Date(timestamp);
  }

  private toTimestamp(date: Date): number {
    return date.getTime();
  }

  private mapProjectRow(row: Record<string, unknown>): ProjectRow {
    return {
      id: row.id as string,
      name: row.name as string,
      path: row.path as string,
      providerType: row.provider_type as 'local' | 'remote',
      remoteServerId: row.remote_server_id as string | null,
      worktreeEnabled: row.worktree_enabled != null ? Boolean(row.worktree_enabled) : null,
      createdAt: this.toDate(row.created_at as number),
      updatedAt: this.toDate(row.updated_at as number),
    };
  }

  private mapRemoteServerRow(row: Record<string, unknown>): RemoteServerRow {
    return {
      id: row.id as string,
      name: row.name as string,
      url: row.url as string,
      apiKey: row.api_key as string | null,
      authType: row.auth_type as string | null,
      authConfig: row.auth_config as string | null,
      createdAt: this.toDate(row.created_at as number),
      updatedAt: this.toDate(row.updated_at as number),
    };
  }

  private mapAnthropicTokenRow(row: Record<string, unknown>): AnthropicTokenRow {
    return {
      id: row.id as string,
      accessToken: row.access_token as string,
      refreshToken: row.refresh_token as string,
      expiresAt: this.toDate(row.expires_at as number),
      createdAt: this.toDate(row.created_at as number),
      updatedAt: this.toDate(row.updated_at as number),
    };
  }

  // =============================================================================
  // Projects
  // =============================================================================

  async getAllProjects(): Promise<ProjectRow[]> {
    const rows = this.sqlite.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
    return rows.map(row => this.mapProjectRow(row as Record<string, unknown>));
  }

  async getProject(id: string): Promise<ProjectRow | undefined> {
    const row = this.sqlite.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    return row ? this.mapProjectRow(row as Record<string, unknown>) : undefined;
  }

  async getProjectByPath(projectPath: string): Promise<ProjectRow | undefined> {
    const row = this.sqlite.prepare('SELECT * FROM projects WHERE path = ?').get(projectPath);
    return row ? this.mapProjectRow(row as Record<string, unknown>) : undefined;
  }

  async createProject(project: ProjectInsert): Promise<ProjectRow> {
    const now = new Date();
    const createdAt = project.createdAt ?? now;
    const updatedAt = project.updatedAt ?? now;
    
    this.sqlite.prepare(`
      INSERT INTO projects (id, name, path, provider_type, remote_server_id, worktree_enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      project.id,
      project.name,
      project.path,
      project.providerType,
      project.remoteServerId ?? null,
      project.worktreeEnabled != null ? (project.worktreeEnabled ? 1 : 0) : null,
      this.toTimestamp(createdAt),
      this.toTimestamp(updatedAt)
    );
    
    return (await this.getProject(project.id))!;
  }

  async updateProject(id: string, updates: Partial<Omit<ProjectInsert, 'id'>>): Promise<ProjectRow | undefined> {
    const existing = await this.getProject(id);
    if (!existing) return undefined;
    
    const setClauses: string[] = [];
    const values: unknown[] = [];
    
    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      values.push(updates.name);
    }
    if (updates.path !== undefined) {
      setClauses.push('path = ?');
      values.push(updates.path);
    }
    if (updates.providerType !== undefined) {
      setClauses.push('provider_type = ?');
      values.push(updates.providerType);
    }
    if (updates.remoteServerId !== undefined) {
      setClauses.push('remote_server_id = ?');
      values.push(updates.remoteServerId);
    }
    if (updates.worktreeEnabled !== undefined) {
      setClauses.push('worktree_enabled = ?');
      values.push(updates.worktreeEnabled != null ? (updates.worktreeEnabled ? 1 : 0) : null);
    }
    
    // Always update updatedAt
    setClauses.push('updated_at = ?');
    values.push(this.toTimestamp(new Date()));
    
    values.push(id);
    
    this.sqlite.prepare(`
      UPDATE projects SET ${setClauses.join(', ')} WHERE id = ?
    `).run(...values);
    
    return this.getProject(id);
  }

  async deleteProject(id: string): Promise<void> {
    this.sqlite.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  // =============================================================================
  // Remote Servers
  // =============================================================================

  async getAllRemoteServers(): Promise<RemoteServerRow[]> {
    const rows = this.sqlite.prepare('SELECT * FROM remote_servers ORDER BY updated_at DESC').all();
    return rows.map(row => this.mapRemoteServerRow(row as Record<string, unknown>));
  }

  async getRemoteServer(id: string): Promise<RemoteServerRow | undefined> {
    const row = this.sqlite.prepare('SELECT * FROM remote_servers WHERE id = ?').get(id);
    return row ? this.mapRemoteServerRow(row as Record<string, unknown>) : undefined;
  }

  async createRemoteServer(server: RemoteServerInsert): Promise<RemoteServerRow> {
    const now = new Date();
    const createdAt = server.createdAt ?? now;
    const updatedAt = server.updatedAt ?? now;
    
    this.sqlite.prepare(`
      INSERT INTO remote_servers (id, name, url, api_key, auth_type, auth_config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      server.id,
      server.name,
      server.url,
      server.apiKey ?? null,
      server.authType ?? null,
      server.authConfig ?? null,
      this.toTimestamp(createdAt),
      this.toTimestamp(updatedAt)
    );
    
    return (await this.getRemoteServer(server.id))!;
  }

  async updateRemoteServer(id: string, updates: Partial<Omit<RemoteServerInsert, 'id'>>): Promise<RemoteServerRow | undefined> {
    const existing = await this.getRemoteServer(id);
    if (!existing) return undefined;
    
    const setClauses: string[] = [];
    const values: unknown[] = [];
    
    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      values.push(updates.name);
    }
    if (updates.url !== undefined) {
      setClauses.push('url = ?');
      values.push(updates.url);
    }
    if (updates.apiKey !== undefined) {
      setClauses.push('api_key = ?');
      values.push(updates.apiKey);
    }
    if (updates.authType !== undefined) {
      setClauses.push('auth_type = ?');
      values.push(updates.authType);
    }
    if (updates.authConfig !== undefined) {
      setClauses.push('auth_config = ?');
      values.push(updates.authConfig);
    }
    
    // Always update updatedAt
    setClauses.push('updated_at = ?');
    values.push(this.toTimestamp(new Date()));
    
    values.push(id);
    
    this.sqlite.prepare(`
      UPDATE remote_servers SET ${setClauses.join(', ')} WHERE id = ?
    `).run(...values);
    
    return this.getRemoteServer(id);
  }

  async deleteRemoteServer(id: string): Promise<void> {
    this.sqlite.prepare('DELETE FROM remote_servers WHERE id = ?').run(id);
  }

  // =============================================================================
  // Anthropic Tokens
  // =============================================================================

  async getAnthropicTokens(): Promise<AnthropicTokenRow | undefined> {
    const row = this.sqlite.prepare("SELECT * FROM anthropic_tokens WHERE id = 'default'").get();
    return row ? this.mapAnthropicTokenRow(row as Record<string, unknown>) : undefined;
  }

  async saveAnthropicTokens(accessToken: string, refreshToken: string, expiresAt: Date): Promise<void> {
    const now = new Date();
    const existing = await this.getAnthropicTokens();
    
    if (existing) {
      this.sqlite.prepare(`
        UPDATE anthropic_tokens 
        SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = ?
        WHERE id = 'default'
      `).run(
        accessToken,
        refreshToken,
        this.toTimestamp(expiresAt),
        this.toTimestamp(now)
      );
    } else {
      this.sqlite.prepare(`
        INSERT INTO anthropic_tokens (id, access_token, refresh_token, expires_at, created_at, updated_at)
        VALUES ('default', ?, ?, ?, ?, ?)
      `).run(
        accessToken,
        refreshToken,
        this.toTimestamp(expiresAt),
        this.toTimestamp(now),
        this.toTimestamp(now)
      );
    }
  }

  async clearAnthropicTokens(): Promise<void> {
    this.sqlite.prepare("DELETE FROM anthropic_tokens WHERE id = 'default'").run();
  }

  // =============================================================================
  // Cleanup
  // =============================================================================

  close(): void {
    this.sqlite.close();
    AppDatabase.instance = null;
  }
}

// Export singleton getter
export function getAppDatabase(): AppDatabase {
  return AppDatabase.getInstance();
}
