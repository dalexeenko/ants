/**
 * Server harness for server-ui E2E tests.
 *
 * Re-exports the shared ServerHarness from app-integration-tests with
 * additional helpers specific to UI testing (setup admin, get auth cookies).
 */

import { spawn, type ChildProcess } from 'child_process';
import { join, dirname } from 'path';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { randomBytes } from 'crypto';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ServerConfig {
  port?: number;
  host?: string;
  mockAgent?: boolean;
  mockResponses?: Array<{
    content: string;
    toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
    toolResults?: Array<{ name: string; content: string }>;
    delay?: number;
  }>;
  startupTimeout?: number;
  multiUser?: boolean;
}

export interface ServerInfo {
  url: string;
  secret: string;
  port: number;
  host: string;
  dataDir: string;
  workspacesDir: string;
}

/**
 * Manages a server instance for UI E2E testing.
 */
export class UITestServer {
  private process: ChildProcess | null = null;
  private serverInfo: ServerInfo | null = null;
  private dataDir: string;
  private workspacesDir: string;
  private encryptionKey: string;
  private secret: string;
  private sessionCookie: string | null = null;
  private config: Required<ServerConfig>;

  constructor(config: ServerConfig = {}) {
    const testId = randomBytes(8).toString('hex');
    const tempBase = join(tmpdir(), 'ants-ui-e2e', testId);

    this.dataDir = join(tempBase, 'data');
    this.workspacesDir = join(tempBase, 'workspaces');
    this.encryptionKey = randomBytes(32).toString('base64');
    this.secret = randomBytes(32).toString('base64url');

    this.config = {
      port: config.port ?? 0,
      host: config.host ?? '127.0.0.1',
      mockAgent: config.mockAgent ?? true,
      mockResponses: config.mockResponses ?? [],
      startupTimeout: config.startupTimeout ?? 20000,
      multiUser: config.multiUser ?? true,
    };
  }

  async start(): Promise<ServerInfo> {
    if (this.process) {
      throw new Error('Server is already running');
    }

    mkdirSync(this.dataDir, { recursive: true });
    mkdirSync(this.workspacesDir, { recursive: true });

    const serverPath = join(__dirname, '../../../apps/server');
    const builtEntryPoint = join(serverPath, 'dist/index.js');
    const serverEntryPoint = join(serverPath, 'src/index.ts');

    let command: string;
    let args: string[];

    if (existsSync(builtEntryPoint)) {
      command = 'node';
      args = [builtEntryPoint];
    } else if (existsSync(serverEntryPoint)) {
      command = 'npx';
      args = ['tsx', serverEntryPoint];
    } else {
      throw new Error(`No server entry point found at ${builtEntryPoint} or ${serverEntryPoint}`);
    }

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ANTS_PORT: String(this.config.port),
      ANTS_HOST: this.config.host,
      ANTS_DATA_DIR: this.dataDir,
      ANTS_WORKSPACES_DIR: this.workspacesDir,
      ANTS_ENCRYPTION_KEY: this.encryptionKey,
      ANTS_MOCK_AGENT: this.config.mockAgent ? 'true' : 'false',
    };

    // Multi-user mode uses per-user credentials; ANTS_SECRET is not
    // allowed.  In single-user mode we set the secret for bearer auth.
    if (this.config.multiUser) {
      env.ANTS_MULTI_USER = 'true';
    } else {
      env.ANTS_SECRET = this.secret;
    }

    // Pass mock responses if configured
    if (this.config.mockResponses.length > 0) {
      env.ANTS_MOCK_RESPONSES = JSON.stringify(this.config.mockResponses);
    }

    return new Promise<ServerInfo>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.stop();
        reject(new Error(`Server failed to start within ${this.config.startupTimeout}ms`));
      }, this.config.startupTimeout);

      this.process = spawn(command, args, {
        cwd: serverPath,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let output = '';
      let detected = false;

      this.process.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        output += text;

        if (detected) return;

        const serverUrlMatch = output.match(/Server:\s+http:\/\/[\w.]+:(\d+)/);
        const boundPortMatch = output.match(/\(bound to port (\d+)\)/);

        if (serverUrlMatch || boundPortMatch) {
          detected = true;
          const actualPort = parseInt(boundPortMatch?.[1] ?? serverUrlMatch![1], 10);

          setTimeout(async () => {
            clearTimeout(timeout);

            this.serverInfo = {
              url: `http://${this.config.host}:${actualPort}`,
              secret: this.secret,
              port: actualPort,
              host: this.config.host,
              dataDir: this.dataDir,
              workspacesDir: this.workspacesDir,
            };

            try {
              await this.waitForHealth();
              resolve(this.serverInfo);
            } catch (e) {
              this.stop();
              reject(e);
            }
          }, 500);
        }
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        output += text;
      });

      this.process.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to start server: ${error.message}`));
      });

      this.process.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          clearTimeout(timeout);
          reject(new Error(`Server exited with code ${code}. Output:\n${output}`));
        }
      });
    });
  }

  private async waitForHealth(maxAttempts = 30, delay = 250): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(`${this.serverInfo!.url}/health`);
        if (response.ok) return;
      } catch {
        // Server not ready yet
      }
      await new Promise((r) => setTimeout(r, delay));
    }
    throw new Error('Server health check failed after multiple attempts');
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.process?.kill('SIGKILL');
          resolve();
        }, 5000);
        this.process!.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      this.process = null;
      await new Promise((r) => setTimeout(r, 500));
    }
    this.serverInfo = null;
  }

  async cleanup(): Promise<void> {
    await this.stop();
    const tempBase = join(this.dataDir, '..');
    if (existsSync(tempBase) && tempBase.includes('ants-ui-e2e')) {
      rmSync(tempBase, { recursive: true, force: true });
    }
  }

  getServerInfo(): ServerInfo {
    if (!this.serverInfo) throw new Error('Server is not running');
    return this.serverInfo;
  }

  /**
   * Make an authenticated API request.
   * In multi-user mode, uses the session cookie obtained from login().
   * In single-user mode, uses the Bearer secret.
   */
  async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    const info = this.getServerInfo();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.config.multiUser && this.sessionCookie) {
      headers['Cookie'] = this.sessionCookie;
    } else if (!this.config.multiUser) {
      headers['Authorization'] = `Bearer ${info.secret}`;
    }
    // If multi-user and no cookie yet, send without auth (for setup endpoint)

    return fetch(`${info.url}${path}`, {
      ...options,
      headers,
    });
  }

  /**
   * Login as a user and store the session cookie for subsequent requests.
   * Only needed in multi-user mode.
   */
  async login(username = 'admin', password = 'testpassword123'): Promise<void> {
    const info = this.getServerInfo();
    const res = await fetch(`${info.url}/api/beta/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      redirect: 'manual',
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Login failed: ${res.status} ${text}`);
    }
    // Extract session cookie from Set-Cookie header
    const setCookie = res.headers.getSetCookie?.() ?? [];
    const sessionCookie = setCookie.find((c: string) => c.startsWith('ants_session='));
    if (sessionCookie) {
      // Store just the cookie value part (before the first ;)
      this.sessionCookie = sessionCookie.split(';')[0];
    } else {
      // Fallback: try the raw set-cookie header
      const rawCookie = res.headers.get('set-cookie') ?? '';
      const match = rawCookie.match(/ants_session=[^;]+/);
      if (match) {
        this.sessionCookie = match[0];
      } else {
        throw new Error('Login succeeded but no session cookie returned');
      }
    }
  }

  /**
   * Run initial server setup (create admin account).
   */
  async setupAdmin(username = 'admin', password = 'testpassword123'): Promise<void> {
    const res = await this.fetch('/api/beta/setup', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Setup failed: ${res.status} ${text}`);
    }
  }

  /**
   * Create a project for testing.
   */
  async createProject(name: string): Promise<{ id: string; name: string; workingDirectory: string }> {
    const dir = join(this.workspacesDir, name);
    mkdirSync(dir, { recursive: true });
    const res = await this.fetch('/api/beta/projects', {
      method: 'POST',
      body: JSON.stringify({ name, workingDirectory: dir }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Create project failed: ${res.status} ${text}`);
    }
    return res.json();
  }
}
