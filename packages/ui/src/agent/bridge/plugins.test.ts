import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPluginMethods } from './plugins';
import type { BridgeDeps } from './types';
import type { PlatformAgent } from '../BridgeCore';

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

/**
 * Create a minimal mock PlatformAgent with optional agent type methods.
 */
function createMockAgent(overrides: Partial<PlatformAgent> = {}): PlatformAgent {
  return {
    id: 'mock-agent',
    prompt: vi.fn(),
    stream: vi.fn() as unknown as PlatformAgent['stream'],
    cancel: vi.fn(),
    setSessionContext: vi.fn(),
    setMessages: vi.fn(),
    on: vi.fn(),
    setPermissionRequestCallback: vi.fn(),
    allowToolForSession: vi.fn(),
    clearToolPermissions: vi.fn(),
    getPermissionConfig: vi.fn().mockReturnValue({
      defaultMode: 'ask',
      alwaysAllow: [],
      alwaysDeny: [],
      allowAll: false,
    }),
    updatePermissionConfig: vi.fn(),
    getDisabledTools: vi.fn().mockReturnValue([]),
    setDisabledTools: vi.fn(),
    disableTool: vi.fn(),
    enableTool: vi.fn(),
    getToolsInfo: vi.fn().mockReturnValue([]),
    getModel: vi.fn().mockReturnValue({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' }),
    setModel: vi.fn(),
    getMessages: vi.fn().mockReturnValue([]),
    shutdown: vi.fn(),
    ...overrides,
  };
}

function createMockDeps(overrides: {
  localAgent?: { agent: PlatformAgent } | null;
  project?: { providerType: 'local' | 'remote'; remoteServerId?: string } | null;
  remoteServer?: { url: string; id: string; name: string } | null;
  remoteFetchResponse?: unknown;
} = {}): BridgeDeps {
  const projects = new Map();
  const localAgents = new Map();
  const remoteServers = new Map();

  if (overrides.project) {
    projects.set('proj-1', { id: 'proj-1', ...overrides.project });
  }

  if (overrides.localAgent) {
    localAgents.set('proj-1', overrides.localAgent);
  }

  if (overrides.remoteServer) {
    remoteServers.set(overrides.remoteServer.id, overrides.remoteServer);
  }

  return {
    config: {},
    state: {
      projects,
      localAgents,
      remoteServers,
    },
    helpers: {
      remoteFetch: overrides.remoteFetchResponse
        ? vi.fn().mockResolvedValue(overrides.remoteFetchResponse)
        : vi.fn(),
    },
  } as unknown as BridgeDeps;
}

describe('createPluginMethods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAgentTypes', () => {
    it('should return empty array when no project exists', async () => {
      const deps = createMockDeps();
      const methods = createPluginMethods(deps);
      const types = await methods.getAgentTypes('proj-1');
      expect(types).toEqual([]);
    });

    it('should return agent types from local agent when getAgentTypes is implemented', async () => {
      const mockTypes = [
        {
          name: 'explore-code',
          description: 'Read-only codebase explorer',
          enabled: true,
          source: 'plugin' as const,
          tags: ['subagent', 'code'],
        },
        {
          name: 'general-code',
          description: 'Full-access coding agent',
          enabled: true,
          source: 'plugin' as const,
          tags: ['root', 'subagent', 'code'],
        },
      ];

      const agent = createMockAgent({
        getAgentTypes: vi.fn().mockReturnValue(mockTypes),
      });

      const deps = createMockDeps({
        project: { providerType: 'local' },
        localAgent: { agent },
      });

      const methods = createPluginMethods(deps);
      const types = await methods.getAgentTypes('proj-1');

      expect(types).toEqual(mockTypes);
      expect(agent.getAgentTypes).toHaveBeenCalledTimes(1);
    });

    it('should return empty array for local project when getAgentTypes is not implemented', async () => {
      const agent = createMockAgent();
      // Explicitly remove getAgentTypes
      delete (agent as Partial<PlatformAgent>).getAgentTypes;

      const deps = createMockDeps({
        project: { providerType: 'local' },
        localAgent: { agent },
      });

      const methods = createPluginMethods(deps);
      const types = await methods.getAgentTypes('proj-1');

      expect(types).toEqual([]);
    });

    it('should return empty array for local project when no managed agent exists', async () => {
      const deps = createMockDeps({
        project: { providerType: 'local' },
        // No localAgent
      });

      const methods = createPluginMethods(deps);
      const types = await methods.getAgentTypes('proj-1');

      expect(types).toEqual([]);
    });

    it('should fetch agent types from remote server for remote projects', async () => {
      const remoteTypes = [
        { name: 'remote-agent', description: 'A remote agent type', enabled: true, source: 'builtin' },
      ];

      const deps = createMockDeps({
        project: { providerType: 'remote', remoteServerId: 'server-1' },
        remoteServer: { id: 'server-1', name: 'Test Server', url: 'https://example.com' },
        remoteFetchResponse: {
          ok: true,
          json: vi.fn().mockResolvedValue({ agentTypes: remoteTypes }),
        },
      });

      const methods = createPluginMethods(deps);
      const types = await methods.getAgentTypes('proj-1');

      expect(types).toEqual(remoteTypes);
    });

    it('should return empty array when remote fetch fails', async () => {
      const deps = createMockDeps({
        project: { providerType: 'remote', remoteServerId: 'server-1' },
        remoteServer: { id: 'server-1', name: 'Test Server', url: 'https://example.com' },
        remoteFetchResponse: { ok: false, status: 500 },
      });

      const methods = createPluginMethods(deps);
      const types = await methods.getAgentTypes('proj-1');

      expect(types).toEqual([]);
    });

    it('should handle errors from local getAgentTypes gracefully', async () => {
      const agent = createMockAgent({
        getAgentTypes: vi.fn().mockImplementation(() => {
          throw new Error('Registry error');
        }),
      });

      const deps = createMockDeps({
        project: { providerType: 'local' },
        localAgent: { agent },
      });

      const methods = createPluginMethods(deps);
      const types = await methods.getAgentTypes('proj-1');

      expect(types).toEqual([]);
    });
  });

  describe('getAgentTypeConflicts', () => {
    it('should return conflicts from local agent when getAgentTypeConflicts is implemented', async () => {
      const mockConflicts = [
        {
          name: 'general-code',
          keptSource: 'config' as const,
          replacedSource: 'plugin' as const,
        },
      ];

      const agent = createMockAgent({
        getAgentTypeConflicts: vi.fn().mockReturnValue(mockConflicts),
      });

      const deps = createMockDeps({
        project: { providerType: 'local' },
        localAgent: { agent },
      });

      const methods = createPluginMethods(deps);
      const conflicts = await methods.getAgentTypeConflicts('proj-1');

      expect(conflicts).toEqual(mockConflicts);
      expect(agent.getAgentTypeConflicts).toHaveBeenCalledTimes(1);
    });

    it('should return empty array for local project when getAgentTypeConflicts is not implemented', async () => {
      const agent = createMockAgent();

      const deps = createMockDeps({
        project: { providerType: 'local' },
        localAgent: { agent },
      });

      const methods = createPluginMethods(deps);
      const conflicts = await methods.getAgentTypeConflicts('proj-1');

      expect(conflicts).toEqual([]);
    });

    it('should fetch conflicts from remote server for remote projects', async () => {
      const remoteConflicts = [
        { name: 'test', keptSource: 'config', replacedSource: 'builtin' },
      ];

      const deps = createMockDeps({
        project: { providerType: 'remote', remoteServerId: 'server-1' },
        remoteServer: { id: 'server-1', name: 'Test Server', url: 'https://example.com' },
        remoteFetchResponse: {
          ok: true,
          json: vi.fn().mockResolvedValue({ conflicts: remoteConflicts }),
        },
      });

      const methods = createPluginMethods(deps);
      const conflicts = await methods.getAgentTypeConflicts('proj-1');

      expect(conflicts).toEqual(remoteConflicts);
    });
  });

  describe('setAgentTypeEnabled', () => {
    it('should delegate to local agent setAgentTypeEnabled', async () => {
      const agent = createMockAgent({
        setAgentTypeEnabled: vi.fn(),
      });

      const deps = createMockDeps({
        project: { providerType: 'local' },
        localAgent: { agent },
      });

      const methods = createPluginMethods(deps);
      await methods.setAgentTypeEnabled('proj-1', 'explore-code', false);

      expect(agent.setAgentTypeEnabled).toHaveBeenCalledWith('explore-code', false);
    });

    it('should call remote server for remote projects', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });

      const deps = createMockDeps({
        project: { providerType: 'remote', remoteServerId: 'server-1' },
        remoteServer: { id: 'server-1', name: 'Test Server', url: 'https://example.com' },
        remoteFetchResponse: { ok: true },
      });

      const methods = createPluginMethods(deps);
      await methods.setAgentTypeEnabled('proj-1', 'explore-code', false);

      const remoteFetch = deps.helpers.remoteFetch as ReturnType<typeof vi.fn>;
      expect(remoteFetch).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'server-1' }),
        '/projects/proj-1/agent-types/explore-code/enabled',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ enabled: false }),
        }),
      );
    });

    it('should not throw when local agent does not implement setAgentTypeEnabled', async () => {
      const agent = createMockAgent();

      const deps = createMockDeps({
        project: { providerType: 'local' },
        localAgent: { agent },
      });

      const methods = createPluginMethods(deps);
      // Should not throw
      await methods.setAgentTypeEnabled('proj-1', 'explore-code', false);
    });
  });
});
