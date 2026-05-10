import { spawn, ChildProcess, execFile } from 'child_process';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import type { ServerConfig } from '../config.js';
import type { AgentConfig } from '../models/project.js';
import type { ApiKeyManager } from './api-key-manager.js';
import type { PluginRegistry } from './plugin-registry.js';
import { AGENT_PORT_RANGE_START, AGENT_PORT_RANGE_END, AGENT_STARTUP_TIMEOUT_MS } from '../constants.js';
import { MockAgentClient } from './mock-agent-client.js';
import { AntsAgentClient } from './ants-agent-client.js';
import { DockerManager, type DockerConfig } from './docker-manager.js';
import { pathExists } from '../utils/fs.js';
import { createLogger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

const log = createLogger('AgentManager');

/**
 * Interface for agent client operations.
 * Both real and mock clients implement this interface.
 */
export interface ToolInfo {
  name: string;
  description: string;
  available: boolean;
}

export interface SearchSessionsParams {
  query?: string;
  provider?: string;
  model?: string;
  workingDirectory?: string;
  includeMessages?: boolean;
  rootOnly?: boolean;
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'updatedAt' | 'messageCount' | 'tokenEstimate';
  orderDirection?: 'asc' | 'desc';
}

export interface SearchMessagesParams {
  query: string;
  sessionId?: string;
  role?: 'user' | 'assistant';
  limit?: number;
  offset?: number;
}

export interface SearchResult<T> {
  results: T[];
  pagination: { limit: number; offset: number; count: number };
}

export interface IAgentClient {
  isHealthy(): Promise<boolean>;
  listSessions(limit?: number): Promise<unknown[]>;
  createSession(options?: { id?: string; workingDirectory?: string; title?: string; parentId?: string; mode?: string; userId?: string }): Promise<unknown>;
  getSession(sessionId: string): Promise<unknown>;
  sendPromptAsync(sessionId: string, prompt: string): Promise<unknown>;
  getMessages(sessionId: string): Promise<unknown>;
  getMessagesPaginated(sessionId: string, limit: number, beforeSequence?: number): Promise<{ messages: unknown[]; hasMore: boolean }>;
  getProviders(): Promise<unknown>;
  abortSession(sessionId: string): Promise<unknown>;
  deleteSession(sessionId: string): Promise<unknown>;
  deleteAllSessions(): Promise<{ deletedCount: number }>;
  searchSessions(params: SearchSessionsParams): Promise<SearchResult<unknown>>;
  searchMessages(params: SearchMessagesParams): Promise<SearchResult<unknown>>;
  getTools(): Promise<ToolInfo[]>;
  getBranches(sessionId: string): Promise<unknown>;
  createBranch(sessionId: string, name: string, messageId?: string): Promise<unknown>;
  switchBranch(sessionId: string, branchId: string): Promise<unknown>;
  deleteBranch(sessionId: string, branchId: string): Promise<unknown>;
  rollback(sessionId: string, count: number): Promise<unknown>;
  respondToPermission(sessionId: string, toolCallId: string, response: string): Promise<unknown>;
  respondToQuestion(sessionId: string, questionId: string, response: { selected?: string[]; freeformText?: string }): Promise<unknown>;

  // Plugin management
  getPlugins(): Promise<{ installed: unknown[]; registered: string[] }>;
  installPlugin(packageSpec: string): Promise<unknown>;
  uninstallPlugin(packageName: string): Promise<unknown>;

  // Agent mode
  getSessionMode(sessionId: string): Promise<{ mode: string }>;
  setSessionMode(sessionId: string, mode: string): Promise<{ mode: string }>;

  // Agent types (subagent presets)
  getAgentTypes(): Promise<{ agentTypes: unknown[] }>;
  getAgentTypeConflicts(): Promise<{ conflicts: unknown[] }>;
  setAgentTypeEnabled(name: string, enabled: boolean): Promise<unknown>;

  // Permission config
  getPermissionConfig(): Promise<{ defaultMode?: string; alwaysAllow?: string[]; alwaysDeny?: string[]; allowAll?: boolean }>;
  updatePermissionConfig(config: { defaultMode?: string; alwaysAllow?: string[]; alwaysDeny?: string[]; allowAll?: boolean }): Promise<unknown>;

  // Disabled tools
  getDisabledTools(): Promise<{ disabledTools: string[] }>;
  setDisabledTools(tools: string[]): Promise<{ disabledTools: string[] }>;
  disableTool(name: string): Promise<unknown>;
  enableTool(name: string): Promise<unknown>;

  // Token usage
  getUsage(): Promise<unknown>;

  // MCP management
  getMcpServers(): Promise<{ servers: unknown[] }>;
  addMcpServer(name: string, config: Record<string, unknown>): Promise<unknown>;
  removeMcpServer(name: string): Promise<unknown>;
  getMcpTools(): Promise<{ tools: unknown[] }>;

  // File watching
  watchFile(path: string): Promise<unknown>;
  unwatchFile(path: string): Promise<unknown>;
}

interface AgentServerInfo {
  port: number;
  process: ChildProcess | null;  // null for mock clients and Docker containers
  client: IAgentClient;
  isMock: boolean;
  /** Whether this agent is running in a Docker container */
  isDocker: boolean;
}

export class AntsAgentManager {
  private config: ServerConfig;
  private apiKeyManager?: ApiKeyManager;
  private pluginRegistry?: PluginRegistry;
  private servers: Map<string, AgentServerInfo> = new Map();
  private nextPort = AGENT_PORT_RANGE_START;
  private dockerManager: DockerManager;
  
  constructor(config: ServerConfig, apiKeyManager?: ApiKeyManager) {
    this.config = config;
    this.apiKeyManager = apiKeyManager;
    this.dockerManager = new DockerManager(createLogger('DockerManager'));
  }

  /** Set the plugin registry (called after construction to avoid circular deps). */
  setPluginRegistry(pluginRegistry: PluginRegistry): void {
    this.pluginRegistry = pluginRegistry;
  }

  /**
   * Kill any orphaned agent server processes from a previous server instance.
   * When the server restarts, in-memory state is lost but previously spawned
   * agent processes may still be running. These orphans hold the SQLite
   * database file open, which can block new agent processes from starting.
   */
  async cleanupOrphanedProcesses(): Promise<void> {
    let killed = 0;

    for (let port = AGENT_PORT_RANGE_START; port < AGENT_PORT_RANGE_END; port++) {
      try {
        const probe = new AntsAgentClient(`http://127.0.0.1:${port}`);
        if (await probe.isHealthy()) {
          log.info(`Found orphaned agent server on port ${port}, shutting it down`);
          try {
            // Try a graceful shutdown via the API first
            const response = await fetch(`http://127.0.0.1:${port}/shutdown`, { method: 'POST' });
            if (response.ok) {
              killed++;
              continue;
            }
          } catch {
            // Graceful shutdown failed, try to find and kill the process
          }
          // Fall back to killing via lsof
          try {
            const { stdout } = await execFileAsync('lsof', ['-ti', `:${port}`]);
            const output = stdout.trim();
            if (output) {
              for (const pid of output.split('\n')) {
                try {
                  process.kill(parseInt(pid, 10), 'SIGTERM');
                  killed++;
                } catch {
                  // Process may have already exited
                }
              }
            }
          } catch {
            // lsof may fail if no process is listening
          }
        }
      } catch {
        // Port not in use or not an agent server — skip
      }
    }

    if (killed > 0) {
      log.info(`Cleaned up ${killed} orphaned agent process(es)`);
      // Wait briefly for processes to exit and release file locks
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  /**
   * Get the Docker manager instance for external access (routes, etc.).
   */
  getDockerManager(): DockerManager {
    return this.dockerManager;
  }
  
  async getAgentPath(): Promise<string> {
    // Check if we have a configured path
    if (this.config.agentPath) {
      return this.config.agentPath;
    }
    
    // Check if we have a local development version (monorepo structure).
    // Try multiple candidate roots: cwd might be the monorepo root (Docker)
    // or apps/server/ (local dev).
    const candidateRoots = [
      process.cwd(),                          // cwd is monorepo root (Docker)
      join(process.cwd(), '..', '..'),        // cwd is apps/server/ (local dev)
    ];
    for (const root of candidateRoots) {
      const cliPath = join(root, 'packages', 'cli', 'dist', 'bin.js');
      if (await pathExists(cliPath)) {
        return `node ${cliPath}`;
      }
      const agentPath = join(root, 'packages', 'agent', 'dist', 'bin.js');
      if (await pathExists(agentPath)) {
        return `node ${agentPath}`;
      }
    }
    
    // Check for global installation
    try {
      const { stdout } = await execFileAsync('which', ['ants-agent']);
      return stdout.trim();
    } catch {
      // Check for npm global installation
      try {
        const { stdout } = await execFileAsync('npm', ['root', '-g']);
        const npmPath = stdout.trim();
        const globalAgentPath = join(npmPath, '@ants', 'agent', 'dist', 'cli.js');
        if (await pathExists(globalAgentPath)) {
          return `node ${globalAgentPath}`;
        }
      } catch {
        // Ignore
      }
      
      throw new Error('Ants Agent not found. Build the monorepo with: pnpm build');
    }
  }
  
  async isInstalled(): Promise<boolean> {
    try {
      await this.getAgentPath();
      return true;
    } catch {
      return false;
    }
  }
  
  async getVersion(): Promise<string> {
    try {
      const agentPath = await this.getAgentPath();
      // agentPath may be "node /path/to/bin.js" or a plain binary path
      const parts = agentPath.split(' ');
      const { stdout } = await execFileAsync(parts[0], [...parts.slice(1), '--version']);
      return stdout.trim();
    } catch {
      return 'unknown';
    }
  }
  
  async install(): Promise<void> {
    // In monorepo development, build the CLI package instead of installing from npm
    const monorepoRoot = join(process.cwd(), '..', '..');
    const pnpmWorkspace = join(monorepoRoot, 'pnpm-workspace.yaml');
    if (await pathExists(pnpmWorkspace)) {
      log.info('Detected monorepo environment, building CLI package...');
      return new Promise((resolve, reject) => {
        const proc = spawn('pnpm', ['turbo', 'build', '--filter=@ants/agent-cli'], {
          cwd: monorepoRoot,
          stdio: 'inherit',
        });
        proc.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Build failed with code ${code}. Run 'pnpm build' from the monorepo root.`));
          }
        });
        proc.on('error', reject);
      });
    }

    // Outside monorepo: install from npm
    return new Promise((resolve, reject) => {
      const proc = spawn('npm', ['install', '-g', '@ants/agent'], {
        stdio: 'inherit',
      });
      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Installation failed with code ${code}`));
        }
      });
      proc.on('error', reject);
    });
  }
  
  private getAvailablePort(): number {
    const port = this.nextPort;
    this.nextPort++;
    return port;
  }
  
  async writeAgentConfig(workingDirectory: string, agentConfig: AgentConfig): Promise<void> {
    const configPath = join(workingDirectory, '.ants.json');
    const config: Record<string, unknown> = {};
    
    if (agentConfig.provider) {
      config.provider = agentConfig.provider;
    }
    
    if (agentConfig.model) {
      config.model = agentConfig.model;
    }
    
    if (agentConfig.systemPrompt) {
      config.systemPrompt = agentConfig.systemPrompt;
    }
    
    if (agentConfig.mcp && Object.keys(agentConfig.mcp).length > 0) {
      config.mcp = agentConfig.mcp;
    }
    
    // Copy any other config properties
    Object.keys(agentConfig).forEach(key => {
      if (!['provider', 'model', 'systemPrompt', 'mcp'].includes(key)) {
        config[key] = agentConfig[key];
      }
    });
    
    if (Object.keys(config).length > 0) {
      await writeFile(configPath, JSON.stringify(config, null, 2));
    }
  }
  
  async readAgentConfig(workingDirectory: string): Promise<AgentConfig | undefined> {
    const configPath = join(workingDirectory, '.ants.json');
    if (!await pathExists(configPath)) {
      return undefined;
    }
    try {
      const content = await readFile(configPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return undefined;
    }
  }
  
  /**
   * Collect API key and OAuth environment variables for the agent process.
   */
  private async getAgentEnvVars(): Promise<Record<string, string>> {
    const apiKeyEnv = await this.apiKeyManager?.getAllEnvVars() || {};

    // Check for Anthropic OAuth credentials and pass them as JSON env var
    const anthropicOAuthEnv: Record<string, string> = {};
    const anthropicCreds = await this.apiKeyManager?.getOAuthCredentials('anthropic');
    log.debug(`Anthropic credentials type: ${anthropicCreds?.type || 'none'}`);
    if (anthropicCreds?.type === 'oauth') {
      log.debug(`Found OAuth tokens, expires: ${new Date(anthropicCreds.expires).toISOString()}`);
      anthropicOAuthEnv.ANTHROPIC_OAUTH_TOKENS = JSON.stringify({
        accessToken: anthropicCreds.access,
        refreshToken: anthropicCreds.refresh,
        expiresAt: anthropicCreds.expires,
      });
    } else if (anthropicCreds?.type === 'api') {
      log.debug(`Found API key credentials`);
    }

    return { ...apiKeyEnv, ...anthropicOAuthEnv };
  }

  async startServer(workingDirectory: string, agentConfig?: AgentConfig): Promise<{ port: number; pid: number }> {
    if (this.servers.has(workingDirectory)) {
      const existing = this.servers.get(workingDirectory)!;
      if (await existing.client.isHealthy()) {
        return { port: existing.port, pid: existing.process?.pid ?? 0 };
      }
      this.servers.delete(workingDirectory);
    }
    
    if (agentConfig) {
      await this.writeAgentConfig(workingDirectory, agentConfig);
    }

    // Check if Docker mode is enabled for this project
    const dockerConfig = agentConfig?.docker as DockerConfig | undefined;
    if (dockerConfig?.enabled && this.dockerManager.isAvailable()) {
      return this.startServerInDocker(workingDirectory, dockerConfig);
    }
    
    const port = this.getAvailablePort();
    const agentPath = await this.getAgentPath();
    
    log.info(`Starting agent server on port ${port}`);
    log.info(`Agent path: ${agentPath}`);
    log.info(`Working directory: ${workingDirectory}`);
    
    // Get env vars from the encrypted API key store
    const envVars = await this.getAgentEnvVars();
    
    const proc = spawn('bash', ['-c', `${agentPath} serve --port ${port}`], {
      cwd: workingDirectory,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...envVars,
      },
    });
    
    const clientUrl = `http://127.0.0.1:${port}`;
    log.debug(`Creating client for: ${clientUrl}`);
    const client = new AntsAgentClient(clientUrl);
    
    this.servers.set(workingDirectory, { port, process: proc, client, isMock: false, isDocker: false });
    
    const agentLog = log.child(`agent:${port}`);
    
    proc.on('exit', (code, signal) => {
      if (signal) {
        agentLog.warn(`Agent server process exited via signal ${signal}`);
      } else if (code !== 0) {
        agentLog.error(`Agent server process exited with code ${code}`);
      } else {
        agentLog.info(`Agent server process exited cleanly`);
      }
      this.servers.delete(workingDirectory);
    });
    
    let startupOutput = '';
    let started = false;
    
    const forwardLine = (stream: 'stdout' | 'stderr', line: string) => {
      if (stream === 'stderr') {
        agentLog.error(line);
      } else {
        agentLog.info(line);
      }
    };
    
    // Buffer partial lines per stream since data events can split across line boundaries
    let stdoutBuffer = '';
    let stderrBuffer = '';
    
    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      startupOutput += text;
      if (started) {
        stdoutBuffer += text;
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim()) forwardLine('stdout', line);
        }
      }
    });
    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      startupOutput += text;
      if (started) {
        stderrBuffer += text;
        const lines = stderrBuffer.split('\n');
        stderrBuffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim()) forwardLine('stderr', line);
        }
      }
    });
    
    const maxWait = AGENT_STARTUP_TIMEOUT_MS;
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      // Fail fast if the child process has already exited
      if (proc.exitCode !== null) {
        log.error(`Agent server process exited with code ${proc.exitCode} before becoming healthy. Output: ${startupOutput}`);
        this.servers.delete(workingDirectory);
        throw new Error(`Agent server process exited with code ${proc.exitCode}: ${startupOutput}`);
      }
      if (await client.isHealthy()) {
        started = true;
        log.info(`Agent server healthy on port ${port} (pid: ${proc.pid})`);
        return { port, pid: proc.pid! };
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    log.error(`Agent server failed to start within ${maxWait}ms. Output: ${startupOutput}`);
    
    proc.kill();
    this.servers.delete(workingDirectory);
    throw new Error(`Failed to start Ants Agent server: ${startupOutput}`);
  }

  /**
   * Start the agent server inside a Docker container.
   */
  private async startServerInDocker(
    workingDirectory: string,
    dockerConfig: DockerConfig,
  ): Promise<{ port: number; pid: number }> {
    const port = this.getAvailablePort();

    log.info(`Starting agent server in Docker on port ${port}`);
    log.info(`Working directory: ${workingDirectory}`);

    // Verify the agent image is available
    const { image } = dockerConfig.image
      ? { image: dockerConfig.image }
      : await this.dockerManager.resolveAgentImage();
    const imageAvailable = await this.dockerManager.imageExists(image);
    if (!imageAvailable) {
      throw new Error(
        `Agent Docker image '${image}' not found locally. ` +
        `Pull it with: docker pull ${image}`,
      );
    }

    const envVars = await this.getAgentEnvVars();

    const containerInfo = await this.dockerManager.startContainer(
      workingDirectory,
      port,
      dockerConfig,
      envVars,
    );

    const clientUrl = `http://127.0.0.1:${port}`;
    log.debug(`Creating client for Docker container: ${clientUrl}`);
    const client = new AntsAgentClient(clientUrl);

    this.servers.set(workingDirectory, {
      port,
      process: null,  // No local process — it's in Docker
      client,
      isMock: false,
      isDocker: true,
    });

    // Wait for the container's agent server to become healthy
    const maxWait = AGENT_STARTUP_TIMEOUT_MS * 2;  // Docker startup may be slower
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      if (await client.isHealthy()) {
        log.info(`Docker agent server healthy on port ${port} (container: ${containerInfo.containerId})`);
        return { port, pid: 0 };  // pid=0 since it's in Docker
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Cleanup on failure
    await this.dockerManager.stopContainer(workingDirectory);
    this.servers.delete(workingDirectory);
    throw new Error('Docker agent server failed to become healthy within timeout');
  }
  
  async stopServer(workingDirectory: string): Promise<void> {
    const server = this.servers.get(workingDirectory);
    if (!server) {
      return;
    }
    
    // Stop Docker container if applicable
    if (server.isDocker) {
      await this.dockerManager.stopContainer(workingDirectory);
    } else if (server.process) {
      // Only kill the process if it's a real server (not mock)
      server.process.kill();
    }
    this.servers.delete(workingDirectory);
  }
  
  async restartServer(workingDirectory: string, agentConfig?: AgentConfig): Promise<{ port: number; pid: number }> {
    await this.stopServer(workingDirectory);
    return this.startServer(workingDirectory, agentConfig);
  }
  
  isServerRunning(workingDirectory: string): boolean {
    return this.servers.has(workingDirectory);
  }
  
  getClient(workingDirectory: string): IAgentClient | undefined {
    return this.servers.get(workingDirectory)?.client;
  }
  
  getServerPort(workingDirectory: string): number | undefined {
    return this.servers.get(workingDirectory)?.port;
  }
  
  async ensureServerRunning(workingDirectory: string, agentConfig?: AgentConfig): Promise<IAgentClient> {
    const existing = this.servers.get(workingDirectory);
    if (existing && await existing.client.isHealthy()) {
      return existing.client;
    }
    
    // In mock mode, create a mock client instead of starting a real agent
    if (this.config.mockAgent) {
      const mockClient = new MockAgentClient();
      this.servers.set(workingDirectory, {
        port: 0,
        process: null,
        client: mockClient,
        isMock: true,
        isDocker: false,
      });
      return mockClient;
    }
    
    await this.startServer(workingDirectory, agentConfig);
    return this.servers.get(workingDirectory)!.client;
  }
  
  async shutdown(): Promise<void> {
    const stopPromises = Array.from(this.servers.keys()).map(dir => this.stopServer(dir));
    await Promise.all(stopPromises);
    // Also ensure all Docker containers are cleaned up
    await this.dockerManager.shutdown();
  }

  /**
   * Check if a server is running in Docker.
   */
  isDockerServer(workingDirectory: string): boolean {
    return this.servers.get(workingDirectory)?.isDocker ?? false;
  }
  
  getRunningServers(): string[] {
    return Array.from(this.servers.keys());
  }
  
  async restartAllServers(): Promise<{ restarted: string[]; failed: string[] }> {
    const workingDirectories = this.getRunningServers();
    const restarted: string[] = [];
    const failed: string[] = [];
    
    for (const workingDirectory of workingDirectories) {
      try {
        const existingConfig = await this.readAgentConfig(workingDirectory);
        await this.restartServer(workingDirectory, existingConfig);
        restarted.push(workingDirectory);
      } catch {
        failed.push(workingDirectory);
      }
    }
    
    return { restarted, failed };
  }
}

export { AntsAgentClient } from './ants-agent-client.js';
export { MockAgentClient } from './mock-agent-client.js';