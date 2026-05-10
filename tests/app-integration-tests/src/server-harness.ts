import { spawn, type ChildProcess } from 'child_process';
import { join, dirname } from 'path';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { randomBytes } from 'crypto';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ServerHarnessConfig {
  /** Port for the server to listen on */
  port?: number;
  /** Host for the server to bind to */
  host?: string;
  /** Directory for server data (temp by default) */
  dataDir?: string;
  /** Directory for workspaces (temp by default) */
  workspacesDir?: string;
  /** Enable mock agent mode (default: true for testing) */
  mockAgent?: boolean;
  /** Mock responses to configure */
  mockResponses?: Array<{
    content: string;
    toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
    delay?: number;
  }>;
  /** Timeout for server startup in ms (default: 15000) */
  startupTimeout?: number;
  /** Path to server directory */
  serverPath?: string;
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
 * Test harness for booting and managing @openmgr/server for integration tests.
 * 
 * The harness:
 * - Starts the server in mock mode for testing
 * - Configures temporary directories for data
 * - Provides the connection info for clients
 * - Cleans up after tests
 */
export class ServerHarness {
  private config: Required<ServerHarnessConfig>;
  private process: ChildProcess | null = null;
  private serverInfo: ServerInfo | null = null;
  private encryptionKey: string;
  private secret: string;

  constructor(config: ServerHarnessConfig = {}) {
    // Use port 0 by default to let the OS assign a free port, avoiding
    // EADDRINUSE when test files run sequentially and the previous server
    // hasn't fully released its port yet.
    const defaultPort = 0;
    
    // Create temp directories for test isolation
    const testId = randomBytes(8).toString('hex');
    const tempBase = join(tmpdir(), 'openmgr-integration-test', testId);

    this.config = {
      port: config.port ?? defaultPort,
      host: config.host ?? '127.0.0.1',
      dataDir: config.dataDir ?? join(tempBase, 'data'),
      workspacesDir: config.workspacesDir ?? join(tempBase, 'workspaces'),
      mockAgent: config.mockAgent ?? true,
      mockResponses: config.mockResponses ?? [],
      startupTimeout: config.startupTimeout ?? 15000,
      serverPath: config.serverPath ?? join(__dirname, '../../../apps/server'),
    };

    // Generate encryption key (32 bytes base64)
    this.encryptionKey = randomBytes(32).toString('base64');
    // Generate a test secret
    this.secret = randomBytes(32).toString('base64url');
  }

  /**
   * Start the server and wait for it to be healthy.
   */
  async start(): Promise<ServerInfo> {
    if (this.process) {
      throw new Error('Server is already running');
    }

    // Ensure directories exist
    mkdirSync(this.config.dataDir, { recursive: true });
    mkdirSync(this.config.workspacesDir, { recursive: true });

    const serverPath = this.config.serverPath;

    // Check if server exists
    if (!existsSync(serverPath)) {
      throw new Error(`Server not found at ${serverPath}. Make sure to build the server first.`);
    }

    // Environment variables for the server.
    // Explicitly set OPENMGR_MULTI_USER=false so the secret-based Bearer
    // auth used by tests works, regardless of what the local .env says.
    const env = {
      ...process.env,
      OPENMGR_PORT: String(this.config.port),
      OPENMGR_HOST: this.config.host,
      OPENMGR_DATA_DIR: this.config.dataDir,
      OPENMGR_WORKSPACES_DIR: this.config.workspacesDir,
      OPENMGR_ENCRYPTION_KEY: this.encryptionKey,
      OPENMGR_SECRET: this.secret,
      OPENMGR_MULTI_USER: 'false',
      OPENMGR_MOCK_AGENT: this.config.mockAgent ? 'true' : 'false',
      ...(this.config.mockResponses && this.config.mockResponses.length > 0
        ? { OPENMGR_MOCK_RESPONSES: JSON.stringify(this.config.mockResponses) }
        : {}),
    };

    // Start the server. Prefer the built entry point (dist/index.js) over
    // tsx for two reasons: (1) faster startup, (2) SIGTERM is delivered
    // directly to the node process so the shutdown handler can call
    // server.close() and release the port (npx/tsx wrappers may not
    // forward signals, causing EADDRINUSE on the next test file).
    const builtEntryPoint = join(serverPath, 'dist/index.js');
    const serverEntryPoint = join(serverPath, 'src/index.ts');
    
    let command: string;
    let args: string[];
    
    if (existsSync(builtEntryPoint)) {
      command = 'node';
      args = [builtEntryPoint];
    } else if (existsSync(serverEntryPoint)) {
      // Fallback: Use tsx for TypeScript source (dev without build)
      command = 'npx';
      args = ['tsx', serverEntryPoint];
    } else {
      throw new Error(`No server entry point found at ${builtEntryPoint} or ${serverEntryPoint}`);
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

        // Parse the actual bound port from server output.
        // The server prints "Server:     http://HOST:PORT" in its banner.
        // When using port 0, the OS assigns a free port and the server
        // may also print "(bound to port XXXXX)".
        const serverUrlMatch = output.match(/Server:\s+http:\/\/[\w.]+:(\d+)/);
        const boundPortMatch = output.match(/\(bound to port (\d+)\)/);
        
        if (serverUrlMatch || boundPortMatch) {
          detected = true;
          const actualPort = parseInt(boundPortMatch?.[1] ?? serverUrlMatch![1], 10);
          
          // Give it a moment to fully initialize
          setTimeout(async () => {
            clearTimeout(timeout);
            
            this.serverInfo = {
              url: `http://${this.config.host}:${actualPort}`,
              secret: this.secret,
              port: actualPort,
              host: this.config.host,
              dataDir: this.config.dataDir,
              workspacesDir: this.config.workspacesDir,
            };

            // Verify the server is actually responding
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
        console.error('[Server stderr]', text);
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

  /**
   * Wait for the server to respond to health checks.
   */
  private async waitForHealth(maxAttempts = 20, delay = 250): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(`${this.serverInfo!.url}/api/beta/health`);
        if (response.ok) {
          return;
        }
      } catch {
        // Server not ready yet
      }
      await new Promise((r) => setTimeout(r, delay));
    }
    throw new Error('Server health check failed after multiple attempts');
  }

  /**
   * Stop the server and clean up.
   */
  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM');
      
      // Wait for graceful shutdown
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

      // Brief delay to let the OS fully release the port (avoid EADDRINUSE
      // when the next test file starts a new server immediately after).
      await new Promise((r) => setTimeout(r, 500));
    }

    this.serverInfo = null;
  }

  /**
   * Stop the server and clean up temp directories.
   */
  async cleanup(): Promise<void> {
    await this.stop();

    // Clean up temp directories
    const tempBase = join(this.config.dataDir, '..');
    if (existsSync(tempBase) && tempBase.includes('openmgr-integration-test')) {
      rmSync(tempBase, { recursive: true, force: true });
    }
  }

  /**
   * Get server connection info. Throws if server is not running.
   */
  getServerInfo(): ServerInfo {
    if (!this.serverInfo) {
      throw new Error('Server is not running');
    }
    return this.serverInfo;
  }

  /**
   * Make an authenticated request to the server.
   */
  async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    const info = this.getServerInfo();
    const url = `${info.url}/api/beta${path}`;
    
    return fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${info.secret}`,
        ...options.headers,
      },
    });
  }

  /**
   * Create a project on the server.
   */
  async createProject(name: string, workingDirectory?: string): Promise<{ id: string; name: string; workingDirectory: string }> {
    const dir = workingDirectory ?? join(this.config.workspacesDir, name);
    mkdirSync(dir, { recursive: true });

    const response = await this.fetch('/projects', {
      method: 'POST',
      body: JSON.stringify({ name, workingDirectory: dir }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create project: ${error}`);
    }

    return response.json();
  }
}

/**
 * Create and start a server harness for testing.
 * Returns the harness and server info.
 */
export async function createTestServer(config?: ServerHarnessConfig): Promise<{
  harness: ServerHarness;
  server: ServerInfo;
}> {
  const harness = new ServerHarness(config);
  const server = await harness.start();
  return { harness, server };
}
