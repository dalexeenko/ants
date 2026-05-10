import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import type { ServerConfig } from '../config.js';
import type { AgentConfig } from '../models/project.js';
import { AGENT_PORT_RANGE_START } from '../constants.js';

// ---------------------------------------------------------------------------
// Mocks – must be declared before importing the module under test
// ---------------------------------------------------------------------------

// child_process.spawn and execFile
const mockSpawn = vi.fn();
const mockExecFile = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

// fs/promises helpers used by the manager
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockAccess = vi.fn();
vi.mock('fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  access: (...args: unknown[]) => mockAccess(...args),
}));

// Also mock utils/fs which provides pathExists
vi.mock('../utils/fs.js', () => ({
  pathExists: vi.fn().mockResolvedValue(false),
  ensureDirectory: vi.fn(),
  ensureDirectoryAsync: vi.fn().mockResolvedValue(undefined),
  readJsonFile: vi.fn().mockReturnValue({}),
  readJsonFileAsync: vi.fn().mockResolvedValue({}),
}));

// AgentAuthService – lightweight stub
vi.mock('./agent-auth.js', () => ({
  AgentAuthService: vi.fn().mockImplementation(() => ({
    getProvider: vi.fn().mockResolvedValue(undefined),
  })),
}));

// AntsAgentClient – we replace the real HTTP client with a controllable stub
const mockIsHealthy = vi.fn();
vi.mock('./ants-agent-client.js', () => ({
  AntsAgentClient: vi.fn().mockImplementation(() => ({
    isHealthy: mockIsHealthy,
  })),
}));

// MockAgentClient – use the real implementation (it's in-memory, no I/O)
vi.mock('./mock-agent-client.js', async () => {
  // We need a lightweight in-memory mock that satisfies IAgentClient
  class InlineMockAgentClient {
    async isHealthy() { return true; }
    async listSessions() { return []; }
    async createSession() { return { id: 'mock' }; }
    async getSession() { return {}; }
    async sendPromptAsync() { return { status: 'completed' }; }
    async getMessages() { return { messages: [] }; }
    async getProviders() { return { providers: [] }; }
    async abortSession() { return { success: true }; }
    async deleteSession() { return { success: true }; }
    async searchSessions() { return { results: [], pagination: { limit: 50, offset: 0, count: 0 } }; }
    async searchMessages() { return { results: [], pagination: { limit: 100, offset: 0, count: 0 } }; }
    async getTools() { return []; }
    async getBranches() { return []; }
    async createBranch() { return {}; }
    async switchBranch() { return {}; }
    async deleteBranch() { return {}; }
    async rollback() { return {}; }
    async respondToPermission() { return {}; }
    async respondToQuestion() { return {}; }
    async getPlugins() { return { installed: [], registered: [] }; }
    async installPlugin() { return {}; }
    async uninstallPlugin() { return {}; }
  }
  return { MockAgentClient: InlineMockAgentClient };
});

// Now import after mocks are in place
import { AntsAgentManager, type IAgentClient } from './ants-agent-manager.js';
import { pathExists as _pathExists } from '../utils/fs.js';
const mockPathExists = vi.mocked(_pathExists);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal ServerConfig for tests */
function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    secret: 'test-secret',
    encryptionKey: Buffer.from('a'.repeat(32)).toString('base64'),
    port: 6647,
    host: '127.0.0.1',
    dataDir: '/tmp/ants-test',
    workspacesDir: '/tmp/ants-workspaces',
    autoInstallAgent: false,
    mockAgent: false,
    corsOrigins: [],
    multiUser: false,
    cfAccessSetIdentity: true,
    webApp: false,
    allowedHosts: [],
    ...overrides,
  };
}

/** Build a fake ChildProcess-like EventEmitter */
function makeFakeProcess(pid = 12345): ChildProcess {
  const proc = new EventEmitter() as unknown as ChildProcess;
  (proc as any).pid = pid;
  (proc as any).exitCode = null;
  (proc as any).kill = vi.fn();
  (proc as any).stdin = null;

  // stdout / stderr as simple EventEmitters
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  (proc as any).stdout = stdout;
  (proc as any).stderr = stderr;

  return proc;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AntsAgentManager', () => {
  let manager: AntsAgentManager;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Reset mocks to clear return value queues from prior tests
    mockSpawn.mockReset();
    mockExecFile.mockReset();
    mockReadFile.mockReset();
    mockWriteFile.mockReset().mockResolvedValue(undefined);
    mockAccess.mockReset();
    mockIsHealthy.mockReset();
    mockIsHealthy.mockResolvedValue(false);

    // Reset the pathExists mock
    mockPathExists.mockReset().mockResolvedValue(false);

    manager = new AntsAgentManager(makeConfig());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // 1. Construction and configuration
  // =========================================================================
  describe('construction and configuration', () => {
    it('should construct with only a config', () => {
      const m = new AntsAgentManager(makeConfig());
      expect(m).toBeInstanceOf(AntsAgentManager);
    });

    it('should accept optional apiKeyManager', () => {
      const apiKeyMgr = { getAllEnvVars: vi.fn().mockResolvedValue({}) } as any;
      const m = new AntsAgentManager(makeConfig(), apiKeyMgr);
      expect(m).toBeInstanceOf(AntsAgentManager);
    });

    it('should start with no running servers', () => {
      expect(manager.getRunningServers()).toEqual([]);
    });
  });

  // =========================================================================
  // 2. getAgentPath
  // =========================================================================
  describe('getAgentPath', () => {
    it('should return configured agentPath when set', async () => {
      const m = new AntsAgentManager(makeConfig({ agentPath: '/usr/local/bin/ants-agent' }));
      expect(await m.getAgentPath()).toBe('/usr/local/bin/ants-agent');
    });

    it('should fall back to local development path if it exists', async () => {
      mockPathExists.mockResolvedValue(true);
      const m = new AntsAgentManager(makeConfig());
      const path = await m.getAgentPath();
      expect(path).toContain('node');
      expect(path).toContain('bin.js');
    });

    it('should fall back to global which ants-agent', async () => {
      mockPathExists.mockResolvedValue(false);
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
        cb(null, { stdout: '/usr/local/bin/ants-agent\n', stderr: '' });
      });
      const m = new AntsAgentManager(makeConfig());
      expect(await m.getAgentPath()).toBe('/usr/local/bin/ants-agent');
    });

    it('should try npm global root as last resort', async () => {
      let pathExistsCalls = 0;
      mockPathExists.mockImplementation(async () => {
        pathExistsCalls++;
        // Calls 1-4 are monorepo paths (2 candidate roots × 2 paths each),
        // call 5 is the npm global path check
        return pathExistsCalls === 5;
      });
      let execFileCalls = 0;
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
        execFileCalls++;
        if (execFileCalls === 1) {
          cb(new Error('not found'), { stdout: '', stderr: '' }); // which fails
        } else {
          cb(null, { stdout: '/usr/lib/node_modules\n', stderr: '' }); // npm root -g
        }
      });
      const m = new AntsAgentManager(makeConfig());
      const path = await m.getAgentPath();
      expect(path).toContain('node');
      expect(path).toContain('@ants');
    });

    it('should throw when agent is not found anywhere', async () => {
      mockPathExists.mockResolvedValue(false);
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
        cb(new Error('not found'), { stdout: '', stderr: '' });
      });
      const m = new AntsAgentManager(makeConfig());
      await expect(m.getAgentPath()).rejects.toThrow('Ants Agent not found');
    });

    it('should check both monorepo paths before falling back to global', async () => {
      let pathExistsCalls = 0;
      mockPathExists.mockImplementation(async () => {
        pathExistsCalls++;
        return pathExistsCalls === 2; // packages/agent/dist/bin.js
      });
      const m = new AntsAgentManager(makeConfig());
      const path = await m.getAgentPath();
      expect(path).toContain('node');
      expect(path).toContain('bin.js');
      expect(pathExistsCalls).toBe(2);
    });
  });

  // =========================================================================
  // 3. isInstalled / getVersion
  // =========================================================================
  describe('isInstalled', () => {
    it('should return true when agent path resolves', async () => {
      const m = new AntsAgentManager(makeConfig({ agentPath: '/some/path' }));
      expect(await m.isInstalled()).toBe(true);
    });

    it('should return false when agent is not found', async () => {
      mockPathExists.mockResolvedValue(false);
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
        cb(new Error('nope'), { stdout: '', stderr: '' });
      });
      const m = new AntsAgentManager(makeConfig());
      expect(await m.isInstalled()).toBe(false);
    });
  });

  describe('getVersion', () => {
    it('should return version string', async () => {
      const m = new AntsAgentManager(makeConfig({ agentPath: '/agent' }));
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
        cb(null, { stdout: '1.2.3\n', stderr: '' });
      });
      expect(await m.getVersion()).toBe('1.2.3');
    });

    it('should return unknown on error', async () => {
      mockPathExists.mockResolvedValue(false);
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
        cb(new Error('fail'), { stdout: '', stderr: '' });
      });
      const m = new AntsAgentManager(makeConfig());
      expect(await m.getVersion()).toBe('unknown');
    });
  });

  // =========================================================================
  // 4. Port allocation
  // =========================================================================
  describe('port allocation', () => {
    it('should allocate ports starting from AGENT_PORT_RANGE_START', async () => {
      const m = new AntsAgentManager(makeConfig({ agentPath: '/agent' }));
      // We access getAvailablePort indirectly via startServer.
      // Instead, test the observable outcome: two sequential startServer
      // calls produce different ports.

      // Set up two successful startServer flows
      let callCount = 0;
      mockIsHealthy.mockImplementation(async () => {
        callCount++;
        // Become healthy on 2nd poll each time
        return callCount % 2 === 0;
      });

      const proc1 = makeFakeProcess(111);
      const proc2 = makeFakeProcess(222);
      mockSpawn.mockReturnValueOnce(proc1).mockReturnValueOnce(proc2);

      const r1 = await m.startServer('/project/a');
      const r2 = await m.startServer('/project/b');

      expect(r1.port).toBe(AGENT_PORT_RANGE_START);
      expect(r2.port).toBe(AGENT_PORT_RANGE_START + 1);
    });
  });

  // =========================================================================
  // 5. startServer (agent health checking / spawning)
  // =========================================================================
  describe('startServer', () => {
    let proc: ChildProcess;

    beforeEach(() => {
      proc = makeFakeProcess(9999);
      mockSpawn.mockReturnValue(proc);
      manager = new AntsAgentManager(makeConfig({ agentPath: '/agent' }));
    });

    it('should spawn a child process and wait until healthy', async () => {
      let pollCount = 0;
      mockIsHealthy.mockImplementation(async () => {
        pollCount++;
        return pollCount >= 2; // healthy on 2nd poll
      });

      const result = await manager.startServer('/workspace/foo');

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(result.port).toBe(AGENT_PORT_RANGE_START);
      expect(result.pid).toBe(9999);
      expect(manager.isServerRunning('/workspace/foo')).toBe(true);
    });

    it('should return existing server when it is still healthy', async () => {
      // First start
      mockIsHealthy.mockResolvedValueOnce(true);
      await manager.startServer('/workspace/foo');

      // Second call – existing server is healthy
      mockIsHealthy.mockResolvedValueOnce(true);
      const result = await manager.startServer('/workspace/foo');

      // spawn should only have been called once
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(result.port).toBe(AGENT_PORT_RANGE_START);
    });

    it('should replace server when existing is unhealthy', async () => {
      // First start succeeds
      mockIsHealthy.mockResolvedValueOnce(true);
      await manager.startServer('/workspace/foo');

      // Second call – existing server is unhealthy, then new one becomes healthy
      mockIsHealthy
        .mockResolvedValueOnce(false)   // existing check
        .mockResolvedValueOnce(true);   // new server health check

      const proc2 = makeFakeProcess(8888);
      mockSpawn.mockReturnValue(proc2);
      const result = await manager.startServer('/workspace/foo');

      expect(mockSpawn).toHaveBeenCalledTimes(2);
      expect(result.pid).toBe(8888);
    });

    it('should throw after timeout if agent never becomes healthy', async () => {
      mockIsHealthy.mockResolvedValue(false);

      // Start server and advance timers; catch the rejection inline
      const promise = manager.startServer('/workspace/bar').catch(e => e);

      // Advance time past the startup timeout (30s) in one step
      await vi.advanceTimersByTimeAsync(31_000);

      const error = await promise;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('Failed to start Ants Agent server');
      expect((proc as any).kill).toHaveBeenCalled();
      expect(manager.isServerRunning('/workspace/bar')).toBe(false);
    });

    it('should fail fast if process exits before becoming healthy', async () => {
      mockIsHealthy.mockResolvedValue(false);

      // Set exitCode on the proc to simulate immediate crash
      (proc as any).exitCode = 1;

      const promise = manager.startServer('/workspace/crash');

      // Should reject quickly without needing to advance timers to 30s
      await expect(promise).rejects.toThrow('Agent server process exited with code 1');
      expect(manager.isServerRunning('/workspace/crash')).toBe(false);
      // Process already exited, so kill should NOT have been called
      expect((proc as any).kill).not.toHaveBeenCalled();
    });

    it('should fail fast if process exits mid-poll', async () => {
      let pollCount = 0;
      mockIsHealthy.mockImplementation(async () => {
        pollCount++;
        // After a couple polls, simulate the process crashing
        if (pollCount >= 2) {
          (proc as any).exitCode = 127;
        }
        return false;
      });

      await expect(manager.startServer('/workspace/midcrash')).rejects.toThrow('Agent server process exited with code 127');
      expect(manager.isServerRunning('/workspace/midcrash')).toBe(false);
    });

    it('should write agent config before starting', async () => {
      mockIsHealthy.mockResolvedValueOnce(true);

      const agentCfg: AgentConfig = {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'Be helpful',
      };

      await manager.startServer('/workspace/cfg', agentCfg);

      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      const [filePath, content] = mockWriteFile.mock.calls[0];
      expect(filePath).toContain('.ants.json');
      const parsed = JSON.parse(content);
      expect(parsed.provider).toBe('anthropic');
      expect(parsed.model).toBe('claude-sonnet-4-20250514');
      expect(parsed.systemPrompt).toBe('Be helpful');
    });

    it('should pass api key env vars to spawned process', async () => {
      const apiKeyMgr = {
        getAllEnvVars: vi.fn().mockResolvedValue({
          ANTHROPIC_API_KEY: 'sk-ant-xxx',
          OPENAI_API_KEY: 'sk-oai-yyy',
        }),
        getOAuthCredentials: vi.fn().mockResolvedValue(undefined),
      } as any;

      const m = new AntsAgentManager(makeConfig({ agentPath: '/agent' }), apiKeyMgr);
      mockIsHealthy.mockResolvedValueOnce(true);
      mockSpawn.mockReturnValue(makeFakeProcess());

      await m.startServer('/workspace/env');

      const spawnCall = mockSpawn.mock.calls[0];
      const spawnOpts = spawnCall[2] as { env: Record<string, string> };
      expect(spawnOpts.env.ANTHROPIC_API_KEY).toBe('sk-ant-xxx');
      expect(spawnOpts.env.OPENAI_API_KEY).toBe('sk-oai-yyy');
    });

    it('should clean up server entry when process exits', async () => {
      mockIsHealthy.mockResolvedValueOnce(true);
      await manager.startServer('/workspace/exit');
      expect(manager.isServerRunning('/workspace/exit')).toBe(true);

      // Simulate process exit
      proc.emit('exit');
      expect(manager.isServerRunning('/workspace/exit')).toBe(false);
    });
  });

  // =========================================================================
  // 6. stopServer
  // =========================================================================
  describe('stopServer', () => {
    it('should kill process and remove server entry', async () => {
      const proc = makeFakeProcess();
      mockSpawn.mockReturnValue(proc);
      manager = new AntsAgentManager(makeConfig({ agentPath: '/agent' }));
      mockIsHealthy.mockResolvedValueOnce(true);

      await manager.startServer('/workspace/stop');
      expect(manager.isServerRunning('/workspace/stop')).toBe(true);

      await manager.stopServer('/workspace/stop');
      expect((proc as any).kill).toHaveBeenCalled();
      expect(manager.isServerRunning('/workspace/stop')).toBe(false);
    });

    it('should be a no-op for unknown working directory', async () => {
      await expect(manager.stopServer('/unknown')).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // 7. restartServer
  // =========================================================================
  describe('restartServer', () => {
    it('should stop then start a new server', async () => {
      const proc1 = makeFakeProcess(111);
      const proc2 = makeFakeProcess(222);
      mockSpawn.mockReturnValueOnce(proc1).mockReturnValueOnce(proc2);
      manager = new AntsAgentManager(makeConfig({ agentPath: '/agent' }));

      mockIsHealthy
        .mockResolvedValueOnce(true)   // first start
        .mockResolvedValueOnce(true);  // restart

      await manager.startServer('/workspace/restart');
      const result = await manager.restartServer('/workspace/restart');

      expect((proc1 as any).kill).toHaveBeenCalled();
      expect(result.pid).toBe(222);
    });
  });

  // =========================================================================
  // 8. ensureServerRunning
  // =========================================================================
  describe('ensureServerRunning', () => {
    it('should return existing healthy client', async () => {
      const proc = makeFakeProcess();
      mockSpawn.mockReturnValue(proc);
      manager = new AntsAgentManager(makeConfig({ agentPath: '/agent' }));
      mockIsHealthy
        .mockResolvedValueOnce(true)   // startServer health
        .mockResolvedValueOnce(true);  // ensureServerRunning health

      await manager.startServer('/workspace/ensure');
      const client = await manager.ensureServerRunning('/workspace/ensure');
      expect(client).toBeDefined();
    });

    it('should start a new server when none exists', async () => {
      const proc = makeFakeProcess();
      mockSpawn.mockReturnValue(proc);
      manager = new AntsAgentManager(makeConfig({ agentPath: '/agent' }));
      mockIsHealthy.mockResolvedValueOnce(true); // startup health check

      const client = await manager.ensureServerRunning('/workspace/new');
      expect(client).toBeDefined();
      expect(manager.isServerRunning('/workspace/new')).toBe(true);
    });

    it('should use MockAgentClient when mockAgent is true', async () => {
      const m = new AntsAgentManager(makeConfig({ mockAgent: true }));
      const client = await m.ensureServerRunning('/workspace/mock');
      expect(await client.isHealthy()).toBe(true);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should restart server when existing client is unhealthy', async () => {
      const proc1 = makeFakeProcess(111);
      const proc2 = makeFakeProcess(222);
      mockSpawn.mockReturnValueOnce(proc1).mockReturnValueOnce(proc2);
      manager = new AntsAgentManager(makeConfig({ agentPath: '/agent' }));

      // First start
      mockIsHealthy.mockResolvedValueOnce(true);
      await manager.startServer('/workspace/sick');

      // ensureServerRunning: existing is unhealthy, new start becomes healthy
      mockIsHealthy
        .mockResolvedValueOnce(false)  // existing client check in ensureServerRunning
        .mockResolvedValueOnce(true);  // new startServer health check

      const client = await manager.ensureServerRunning('/workspace/sick');
      expect(client).toBeDefined();
    });
  });

  // =========================================================================
  // 9. shutdown
  // =========================================================================
  describe('shutdown', () => {
    it('should stop all running servers', async () => {
      const procs: ChildProcess[] = [];
      mockSpawn.mockImplementation(() => {
        const p = makeFakeProcess(1000 + procs.length);
        procs.push(p);
        return p;
      });
      manager = new AntsAgentManager(makeConfig({ agentPath: '/agent' }));

      mockIsHealthy
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);

      await manager.startServer('/workspace/a');
      await manager.startServer('/workspace/b');

      expect(manager.getRunningServers()).toHaveLength(2);
      expect(procs).toHaveLength(2);

      await manager.shutdown();

      expect(manager.getRunningServers()).toHaveLength(0);
      for (const p of procs) {
        expect((p as any).kill).toHaveBeenCalled();
      }
    });
  });

  // =========================================================================
  // 10. restartAllServers
  // =========================================================================
  describe('restartAllServers', () => {
    it('should restart all servers and report results', async () => {
      // Use mockImplementation so we can control procs dynamically
      let spawnCount = 0;
      mockSpawn.mockImplementation(() => {
        spawnCount++;
        return makeFakeProcess(spawnCount * 100);
      });
      manager = new AntsAgentManager(makeConfig({ agentPath: '/agent' }));

      // pathExists returns false = no .ants.json files (readAgentConfig)
      mockPathExists.mockResolvedValue(false);

      mockIsHealthy
        .mockResolvedValueOnce(true)   // initial start r1
        .mockResolvedValueOnce(true);  // initial start r2

      await manager.startServer('/workspace/r1');
      await manager.startServer('/workspace/r2');
      expect(manager.getRunningServers()).toHaveLength(2);

      // For restartAll: both succeed
      mockIsHealthy
        .mockResolvedValueOnce(true)   // restart r1 health
        .mockResolvedValueOnce(true);  // restart r2 health

      const result = await manager.restartAllServers();

      expect(result.restarted).toHaveLength(2);
      expect(result.restarted).toContain('/workspace/r1');
      expect(result.restarted).toContain('/workspace/r2');
      expect(result.failed).toHaveLength(0);
    });

    it('should report failed restarts', async () => {
      mockSpawn.mockImplementation(() => makeFakeProcess());
      manager = new AntsAgentManager(makeConfig({ agentPath: '/agent' }));

      mockPathExists.mockResolvedValue(false);
      mockIsHealthy.mockResolvedValueOnce(true);

      await manager.startServer('/workspace/fail');
      expect(manager.getRunningServers()).toHaveLength(1);

      // Now make spawn throw to simulate failed restart
      mockSpawn.mockImplementation(() => { throw new Error('spawn failed'); });

      const result = await manager.restartAllServers();

      expect(result.restarted).toHaveLength(0);
      expect(result.failed).toContain('/workspace/fail');
    });
  });

  // =========================================================================
  // 11. writeAgentConfig / readAgentConfig
  // =========================================================================
  describe('writeAgentConfig', () => {
    it('should write config with all fields', async () => {
      const agentCfg: AgentConfig = {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'Hello',
        mcp: {
          myServer: { name: 'myServer', type: 'local', command: ['node', 'server.js'] },
        },
        customField: 'value',
      };

      await manager.writeAgentConfig('/workspace/cfg', agentCfg);

      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      const [filePath, content] = mockWriteFile.mock.calls[0];
      expect(filePath).toContain('.ants.json');
      const parsed = JSON.parse(content);
      expect(parsed.provider).toBe('anthropic');
      expect(parsed.model).toBe('claude-sonnet-4-20250514');
      expect(parsed.systemPrompt).toBe('Hello');
      expect(parsed.mcp.myServer).toBeDefined();
      expect(parsed.customField).toBe('value');
    });

    it('should not write file if config is empty', async () => {
      await manager.writeAgentConfig('/workspace/empty', {});
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('should skip empty mcp object', async () => {
      await manager.writeAgentConfig('/workspace/nomcp', { mcp: {} });
      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  });

  describe('readAgentConfig', () => {
    it('should return undefined when file does not exist', async () => {
      mockPathExists.mockResolvedValue(false);
      expect(await manager.readAgentConfig('/workspace/none')).toBeUndefined();
    });

    it('should return parsed config when file exists', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue('{"provider":"openai","model":"gpt-4"}');
      const cfg = await manager.readAgentConfig('/workspace/exists');
      expect(cfg).toEqual({ provider: 'openai', model: 'gpt-4' });
    });

    it('should return undefined on parse error', async () => {
      mockPathExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue('not json');
      expect(await manager.readAgentConfig('/workspace/bad')).toBeUndefined();
    });
  });

  // =========================================================================
  // 12. getClient / getServerPort
  // =========================================================================
  describe('getClient', () => {
    it('should return undefined for unknown directory', () => {
      expect(manager.getClient('/unknown')).toBeUndefined();
    });

    it('should return the client for a running server', async () => {
      const proc = makeFakeProcess();
      mockSpawn.mockReturnValue(proc);
      manager = new AntsAgentManager(makeConfig({ agentPath: '/agent' }));
      mockIsHealthy.mockResolvedValueOnce(true);
      await manager.startServer('/workspace/client');
      expect(manager.getClient('/workspace/client')).toBeDefined();
    });
  });

  describe('getServerPort', () => {
    it('should return undefined for unknown directory', () => {
      expect(manager.getServerPort('/unknown')).toBeUndefined();
    });

    it('should return port for a running server', async () => {
      const proc = makeFakeProcess();
      mockSpawn.mockReturnValue(proc);
      manager = new AntsAgentManager(makeConfig({ agentPath: '/agent' }));
      mockIsHealthy.mockResolvedValueOnce(true);
      await manager.startServer('/workspace/port');
      expect(manager.getServerPort('/workspace/port')).toBe(AGENT_PORT_RANGE_START);
    });
  });

  // =========================================================================
  // 13. install
  // =========================================================================
  describe('install', () => {
    it('should resolve when npm install succeeds', async () => {
      const proc = makeFakeProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = manager.install();
      // Allow the async pathExists check to resolve before emitting
      await vi.advanceTimersByTimeAsync(0);
      proc.emit('close', 0);
      await expect(promise).resolves.toBeUndefined();
    });

    it('should reject when npm install fails', async () => {
      const proc = makeFakeProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = manager.install();
      await vi.advanceTimersByTimeAsync(0);
      proc.emit('close', 1);
      await expect(promise).rejects.toThrow('Installation failed with code 1');
    });

    it('should reject on spawn error', async () => {
      const proc = makeFakeProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = manager.install();
      await vi.advanceTimersByTimeAsync(0);
      proc.emit('error', new Error('spawn ENOENT'));
      await expect(promise).rejects.toThrow('spawn ENOENT');
    });
  });

  // =========================================================================
  // 14. IAgentClient interface contract (mock mode)
  // =========================================================================
  describe('IAgentClient interface contract (mock mode)', () => {
    let client: IAgentClient;

    beforeEach(async () => {
      const m = new AntsAgentManager(makeConfig({ mockAgent: true }));
      client = await m.ensureServerRunning('/workspace/iface');
    });

    it('isHealthy should return a boolean', async () => {
      expect(typeof await client.isHealthy()).toBe('boolean');
    });

    it('listSessions should return an array', async () => {
      const sessions = await client.listSessions();
      expect(Array.isArray(sessions)).toBe(true);
    });

    it('createSession should return an object', async () => {
      const session = await client.createSession();
      expect(session).toBeDefined();
    });

    it('getProviders should return an object', async () => {
      const providers = await client.getProviders();
      expect(providers).toBeDefined();
    });

    it('searchSessions should return result with pagination', async () => {
      const result = await client.searchSessions({});
      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('pagination');
    });

    it('searchMessages should return result with pagination', async () => {
      const result = await client.searchMessages({ query: 'test' });
      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('pagination');
    });

    it('getTools should return an array', async () => {
      const tools = await client.getTools();
      expect(Array.isArray(tools)).toBe(true);
    });

    it('getPlugins should return installed and registered', async () => {
      const result = await client.getPlugins();
      expect(result).toHaveProperty('installed');
      expect(result).toHaveProperty('registered');
    });
  });

  // =========================================================================
  // 15. Mock client not killed on stop (no process)
  // =========================================================================
  describe('mock mode stop behavior', () => {
    it('should not throw when stopping a mock server', async () => {
      const m = new AntsAgentManager(makeConfig({ mockAgent: true }));
      await m.ensureServerRunning('/workspace/mockstop');
      await expect(m.stopServer('/workspace/mockstop')).resolves.toBeUndefined();
      expect(m.isServerRunning('/workspace/mockstop')).toBe(false);
    });

    it('mock server port should be 0', async () => {
      const m = new AntsAgentManager(makeConfig({ mockAgent: true }));
      await m.ensureServerRunning('/workspace/mockport');
      expect(m.getServerPort('/workspace/mockport')).toBe(0);
    });
  });
});
