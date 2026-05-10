import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBridgeCore, type PlatformAgent, type PlatformSessionManager, type PlatformStorage, type PlatformFilesystem, type PlatformAgentFactory } from '../BridgeCore';
// AgentEvent type used indirectly via onEvent callback
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { AgentEvent as _AgentEvent } from '../types';

// Mock implementations
function createMockAgent(): PlatformAgent {
  return {
    id: 'mock-agent-id',
    prompt: vi.fn().mockResolvedValue({ content: 'Mock response', toolCalls: [] }),
    stream: vi.fn(),
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
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockSessionManager(): PlatformSessionManager {
  return {
    createSession: vi.fn().mockResolvedValue({
      id: 'session-1',
      title: 'Test Session',
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    getRootSessions: vi.fn().mockResolvedValue([]),
    getSession: vi.fn().mockResolvedValue({
      id: 'session-1',
      title: 'Test Session',
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    deleteAllSessions: vi.fn().mockResolvedValue(0),
    getSessionMessages: vi.fn().mockResolvedValue([]),
    getSessionMessagesPaginated: vi.fn().mockResolvedValue({ messages: [], hasMore: false }),
    addMessage: vi.fn().mockResolvedValue(undefined),
    getNextSequence: vi.fn().mockResolvedValue(1),
    searchSessions: vi.fn().mockResolvedValue([]),
  };
}

function createMockStorage(): PlatformStorage {
  return {
    getAuthStatus: vi.fn().mockResolvedValue({
      anthropic: { authenticated: true, method: 'apikey' },
      openai: { hasApiKey: false },
      google: { hasApiKey: false },
      openrouter: { hasApiKey: false },
      groq: { hasApiKey: false },
      xai: { hasApiKey: false },
    }),
    initiateOAuth: vi.fn().mockResolvedValue({ url: 'https://oauth.test', verifier: 'test-verifier' }),
    completeOAuth: vi.fn().mockResolvedValue(undefined),
    disconnectOAuth: vi.fn().mockResolvedValue(undefined),
    listApiKeys: vi.fn().mockResolvedValue([{ provider: 'anthropic', hasKey: true }]),
    getApiKey: vi.fn().mockResolvedValue('sk-test-key'),
    setApiKey: vi.fn().mockResolvedValue(undefined),
    deleteApiKey: vi.fn().mockResolvedValue(undefined),
    hasApiKey: vi.fn().mockResolvedValue(true),
    getProjectsDirectory: vi.fn().mockResolvedValue('/projects'),
    setProjectsDirectory: vi.fn().mockResolvedValue(undefined),
    getOAuthTokens: vi.fn().mockResolvedValue(null),
    saveOAuthTokens: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockFilesystem(): PlatformFilesystem {
  return {
    readDirectory: vi.fn().mockResolvedValue([
      { name: 'file.txt', path: '/test/file.txt', isDirectory: false },
    ]),
    readFile: vi.fn().mockResolvedValue('file content'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    pathExists: vi.fn().mockResolvedValue(true),
    getDataDirectory: vi.fn().mockReturnValue('/data'),
    watchFile: vi.fn(),
    unwatchFile: vi.fn(),
  };
}

function createMockAgentFactory(agent: PlatformAgent, sessionManager: PlatformSessionManager): PlatformAgentFactory {
  return {
    createAgent: vi.fn().mockResolvedValue({ agent, sessionManager }),
  };
}

describe('BridgeCore', () => {
  let mockAgent: PlatformAgent;
  let mockSessionManager: PlatformSessionManager;
  let mockStorage: PlatformStorage;
  let mockFilesystem: PlatformFilesystem;
  let mockAgentFactory: PlatformAgentFactory;
  let onEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockAgent = createMockAgent();
    mockSessionManager = createMockSessionManager();
    mockStorage = createMockStorage();
    mockFilesystem = createMockFilesystem();
    mockAgentFactory = createMockAgentFactory(mockAgent, mockSessionManager);
    onEvent = vi.fn();
  });

  function createBridge() {
    return createBridgeCore({
      agentFactory: mockAgentFactory,
      storage: mockStorage,
      filesystem: mockFilesystem,
      onEvent,
    });
  }

  describe('project management', () => {
    it('should create a local project', async () => {
      const bridge = createBridge();
      
      const project = await bridge.createProject('/test/path', 'local');
      
      expect(project).toMatchObject({
        name: 'path',
        path: '/test/path',
        providerType: 'local',
      });
      expect(project.id).toBeDefined();
      expect(mockAgentFactory.createAgent).toHaveBeenCalled();
    });

    it('should list projects', async () => {
      const bridge = createBridge();
      await bridge.createProject('/test/path', 'local');
      
      const projects = await bridge.listProjects();
      
      expect(projects).toHaveLength(1);
      expect(projects[0].path).toBe('/test/path');
    });

    it('should remove a project', async () => {
      const bridge = createBridge();
      const project = await bridge.createProject('/test/path', 'local');
      
      await bridge.removeProject(project.id);
      
      const projects = await bridge.listProjects();
      expect(projects).toHaveLength(0);
      expect(mockAgent.shutdown).toHaveBeenCalled();
    });
  });

  describe('remote server management', () => {
    it('should add a remote server', async () => {
      const bridge = createBridge();
      
      const server = await bridge.addRemoteServer({
        name: 'Test Server',
        url: 'https://test-server.com',
        token: 'test-token',
      });
      
      expect(server).toMatchObject({
        name: 'Test Server',
        url: 'https://test-server.com',
      });
      expect(server.id).toBeDefined();
    });

    it('should list remote servers', async () => {
      const bridge = createBridge();
      await bridge.addRemoteServer({
        name: 'Server 1',
        url: 'https://server1.com',
      });
      await bridge.addRemoteServer({
        name: 'Server 2',
        url: 'https://server2.com',
      });
      
      const servers = await bridge.listRemoteServers();
      
      expect(servers).toHaveLength(2);
    });

    it('should update a remote server', async () => {
      const bridge = createBridge();
      const server = await bridge.addRemoteServer({
        name: 'Server',
        url: 'https://server.com',
      });
      
      await bridge.updateRemoteServer(server.id, { name: 'Updated Server' });
      
      const servers = await bridge.listRemoteServers();
      expect(servers[0].name).toBe('Updated Server');
    });

    it('should remove a remote server', async () => {
      const bridge = createBridge();
      const server = await bridge.addRemoteServer({
        name: 'Server',
        url: 'https://server.com',
      });
      
      await bridge.removeRemoteServer(server.id);
      
      const servers = await bridge.listRemoteServers();
      expect(servers).toHaveLength(0);
    });

    it('should test remote server connection with token using /api/beta/health/auth', async () => {
      const bridge = createBridge();
      
      // Mock fetch for the test
      global.fetch = vi.fn().mockResolvedValue({ ok: true });
      
      const result = await bridge.testRemoteServer({
        url: 'https://test-server.com',
        token: 'token',
      });
      
      expect(result.success).toBe(true);
      // Should use the authenticated endpoint when a token is provided
      expect(global.fetch).toHaveBeenCalledWith(
        'https://test-server.com/api/beta/health/auth',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token',
          }),
        }),
      );
    });

    it('should test remote server connection without token still using /api/beta/health/auth', async () => {
      const bridge = createBridge();
      
      // Mock fetch for the test
      global.fetch = vi.fn().mockResolvedValue({ ok: true });
      
      const result = await bridge.testRemoteServer({
        url: 'https://test-server.com',
      });
      
      expect(result.success).toBe(true);
      // Should always use the authenticated endpoint, even without a token
      expect(global.fetch).toHaveBeenCalledWith(
        'https://test-server.com/api/beta/health/auth',
        expect.objectContaining({
          headers: {},
        }),
      );
    });

    it('should return descriptive error for 401 responses', async () => {
      const bridge = createBridge();
      
      global.fetch = vi.fn().mockResolvedValue({ 
        ok: false, 
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve(''),
      });
      
      const result = await bridge.testRemoteServer({
        url: 'https://test-server.com',
        token: 'bad-token',
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Authentication failed');
    });

    it('should return descriptive error for network failures', async () => {
      const bridge = createBridge();
      
      global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
      
      const result = await bridge.testRemoteServer({
        url: 'https://nonexistent.example.com',
        token: 'token',
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Could not connect');
    });
  });

  describe('session management', () => {
    it('should create a session', async () => {
      const bridge = createBridge();
      const project = await bridge.createProject('/test/path', 'local');
      
      const session = await bridge.createSession(project.id);
      
      expect(session).toMatchObject({
        id: 'session-1',
        title: 'Test Session',
      });
      expect(mockSessionManager.createSession).toHaveBeenCalled();
    });

    it('should list sessions for a project', async () => {
      (mockSessionManager.getRootSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 's1', title: 'Session 1', createdAt: new Date(), updatedAt: new Date() },
        { id: 's2', title: 'Session 2', createdAt: new Date(), updatedAt: new Date() },
      ]);
      
      const bridge = createBridge();
      const project = await bridge.createProject('/test/path', 'local');
      
      const sessions = await bridge.listSessions(project.id);
      
      expect(sessions).toHaveLength(2);
    });

    it('should delete a session', async () => {
      const bridge = createBridge();
      const project = await bridge.createProject('/test/path', 'local');
      
      await bridge.deleteSession(project.id, 'session-1');
      
      expect(mockSessionManager.deleteSession).toHaveBeenCalledWith('session-1');
    });

    it('should delete all sessions', async () => {
      (mockSessionManager.deleteAllSessions as ReturnType<typeof vi.fn>).mockResolvedValue(3);
      const bridge = createBridge();
      const project = await bridge.createProject('/test/path', 'local');

      const result = await bridge.deleteAllSessions(project.id);

      expect(mockSessionManager.deleteAllSessions).toHaveBeenCalled();
      expect(result.deletedCount).toBe(3);
    });

    it('should return zero when deleting all sessions for unknown project', async () => {
      const bridge = createBridge();

      const result = await bridge.deleteAllSessions('unknown');

      expect(result.deletedCount).toBe(0);
    });

    it('should get a session by ID', async () => {
      const bridge = createBridge();
      const project = await bridge.createProject('/test/path', 'local');
      
      const session = await bridge.getSession(project.id, 'session-1');
      
      expect(session.id).toBe('session-1');
    });

    it('should throw when getting session for unknown project', async () => {
      const bridge = createBridge();
      
      await expect(bridge.getSession('unknown', 'session-1')).rejects.toThrow();
    });
  });

  describe('messaging', () => {
    it('should get messages for a session', async () => {
      (mockSessionManager.getSessionMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'm1', role: 'user', content: 'Hello', createdAt: new Date() },
        { id: 'm2', role: 'assistant', content: 'Hi!', createdAt: new Date() },
      ]);
      
      const bridge = createBridge();
      const project = await bridge.createProject('/test/path', 'local');
      
      const messages = await bridge.getMessages(project.id, 'session-1');
      
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
    });

    it('should send a message', async () => {
      const bridge = createBridge();
      const project = await bridge.createProject('/test/path', 'local');
      
      await bridge.sendMessage(project.id, 'session-1', 'Hello!');
      
      expect(mockAgent.setSessionContext).toHaveBeenCalledWith({ sessionId: 'session-1' });
      expect(mockAgent.setMessages).toHaveBeenCalled();
      expect(mockAgent.prompt).toHaveBeenCalledWith('Hello!');
    });

    it('should cancel a message', async () => {
      const bridge = createBridge();
      const project = await bridge.createProject('/test/path', 'local');
      
      await bridge.cancelMessage(project.id);
      
      expect(mockAgent.cancel).toHaveBeenCalled();
    });

    it('should get paginated messages for a session', async () => {
      (mockSessionManager.getSessionMessagesPaginated as ReturnType<typeof vi.fn>).mockResolvedValue({
        messages: [
          { id: 'm1', role: 'user', content: 'Hello', sequence: 0, createdAt: new Date() },
          { id: 'm2', role: 'assistant', content: 'Hi!', sequence: 1, createdAt: new Date() },
        ],
        hasMore: true,
      });

      const bridge = createBridge();
      const project = await bridge.createProject('/test/path', 'local');

      const result = await bridge.getMessagesPaginated(project.id, 'session-1', 2);

      expect(result.messages).toHaveLength(2);
      expect(result.hasMore).toBe(true);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].sequence).toBe(0);
      expect(result.messages[1].role).toBe('assistant');
      expect(result.messages[1].sequence).toBe(1);
    });

    it('should pass beforeSequence cursor to paginated query', async () => {
      (mockSessionManager.getSessionMessagesPaginated as ReturnType<typeof vi.fn>).mockResolvedValue({
        messages: [
          { id: 'm0', role: 'user', content: 'First', sequence: 0, createdAt: new Date() },
        ],
        hasMore: false,
      });

      const bridge = createBridge();
      const project = await bridge.createProject('/test/path', 'local');

      const result = await bridge.getMessagesPaginated(project.id, 'session-1', 10, 1);

      expect(result.messages).toHaveLength(1);
      expect(result.hasMore).toBe(false);
      expect(mockSessionManager.getSessionMessagesPaginated).toHaveBeenCalledWith('session-1', 10, 1);
    });

    it('should return empty result for unknown project', async () => {
      const bridge = createBridge();

      const result = await bridge.getMessagesPaginated('unknown', 'session-1', 10);

      expect(result.messages).toHaveLength(0);
      expect(result.hasMore).toBe(false);
    });

    it('should filter out tool-result messages from paginated results', async () => {
      (mockSessionManager.getSessionMessagesPaginated as ReturnType<typeof vi.fn>).mockResolvedValue({
        messages: [
          { id: 'm1', role: 'user', content: 'Hello', sequence: 0, createdAt: new Date() },
          {
            id: 'm2',
            role: 'assistant',
            content: 'Let me check.',
            toolCalls: [{ id: 'tc-1', name: 'read_file', arguments: { path: '/test' } }],
            sequence: 1,
            createdAt: new Date(),
          },
          {
            id: 'm3',
            role: 'user',
            content: '',
            toolResults: [{ toolCallId: 'tc-1', content: 'file contents', isError: false }],
            sequence: 2,
            createdAt: new Date(),
          },
        ],
        hasMore: false,
      });

      const bridge = createBridge();
      const project = await bridge.createProject('/test/path', 'local');

      const result = await bridge.getMessagesPaginated(project.id, 'session-1', 10);

      // Tool-result message should be filtered out
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[1].role).toBe('assistant');
      // Tool call should have result attached
      expect(result.messages[1].toolCalls![0].result).toBe('file contents');
      expect(result.messages[1].toolCalls![0].status).toBe('complete');
    });

    it('should preserve sequence numbers in paginated messages', async () => {
      (mockSessionManager.getSessionMessagesPaginated as ReturnType<typeof vi.fn>).mockResolvedValue({
        messages: [
          { id: 'm5', role: 'user', content: 'Page 2 msg 1', sequence: 5, createdAt: new Date() },
          { id: 'm6', role: 'assistant', content: 'Page 2 msg 2', sequence: 6, createdAt: new Date() },
        ],
        hasMore: true,
      });

      const bridge = createBridge();
      const project = await bridge.createProject('/test/path', 'local');

      const result = await bridge.getMessagesPaginated(project.id, 'session-1', 2, 7);

      expect(result.messages[0].sequence).toBe(5);
      expect(result.messages[1].sequence).toBe(6);
    });
  });

  describe('permissions', () => {
    it('should get permission config', async () => {
      const bridge = createBridge();
      const project = await bridge.createProject('/test/path', 'local');
      
      const config = await bridge.getPermissionConfig(project.id);
      
      expect(config).toMatchObject({
        defaultMode: 'ask',
        alwaysAllow: [],
        alwaysDeny: [],
      });
    });

    it('should update permission config', async () => {
      const bridge = createBridge();
      const project = await bridge.createProject('/test/path', 'local');
      
      await bridge.updatePermissionConfig(project.id, { allowAll: true });
      
      expect(mockAgent.updatePermissionConfig).toHaveBeenCalledWith({ allowAll: true });
    });
  });

  describe('tools', () => {
    it('should get tools info', async () => {
      (mockAgent.getToolsInfo as ReturnType<typeof vi.fn>).mockReturnValue([
        { name: 'tool1', description: 'Tool 1', tags: [], requires: [], available: true, disabled: false },
      ]);
      
      const bridge = createBridge();
      const project = await bridge.createProject('/test/path', 'local');
      
      const tools = await bridge.getToolsInfo(project.id);
      
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('tool1');
    });

    it('should get disabled tools', async () => {
      (mockAgent.getDisabledTools as ReturnType<typeof vi.fn>).mockReturnValue(['tool1', 'tool2']);
      
      const bridge = createBridge();
      const project = await bridge.createProject('/test/path', 'local');
      
      const disabled = await bridge.getDisabledTools(project.id);
      
      expect(disabled).toEqual(['tool1', 'tool2']);
    });

    it('should set disabled tools', async () => {
      const bridge = createBridge();
      const project = await bridge.createProject('/test/path', 'local');
      
      await bridge.setDisabledTools(project.id, ['tool1']);
      
      expect(mockAgent.setDisabledTools).toHaveBeenCalledWith(['tool1']);
    });

    it('should disable a tool', async () => {
      const bridge = createBridge();
      const project = await bridge.createProject('/test/path', 'local');
      
      await bridge.disableTool(project.id, 'tool1');
      
      expect(mockAgent.disableTool).toHaveBeenCalledWith('tool1');
    });

    it('should enable a tool', async () => {
      const bridge = createBridge();
      const project = await bridge.createProject('/test/path', 'local');
      
      await bridge.enableTool(project.id, 'tool1');
      
      expect(mockAgent.enableTool).toHaveBeenCalledWith('tool1');
    });
  });

  describe('authentication', () => {
    it('should get auth status', async () => {
      const bridge = createBridge();
      
      const status = await bridge.getAuthStatus();
      
      expect(status.anthropic.authenticated).toBe(true);
      expect(mockStorage.getAuthStatus).toHaveBeenCalled();
    });

    it('should initiate OAuth', async () => {
      const bridge = createBridge();
      
      const result = await bridge.initiateOAuth('anthropic');
      
      expect(result.url).toBe('https://oauth.test');
      expect(result.verifier).toBe('test-verifier');
    });

    it('should complete OAuth', async () => {
      const bridge = createBridge();
      
      await bridge.completeOAuth('anthropic', 'code', 'verifier');
      
      expect(mockStorage.completeOAuth).toHaveBeenCalledWith('anthropic', 'code', 'verifier');
    });

    it('should disconnect OAuth', async () => {
      const bridge = createBridge();
      
      await bridge.disconnectOAuth('anthropic');
      
      expect(mockStorage.disconnectOAuth).toHaveBeenCalledWith('anthropic');
    });
  });

  describe('API keys', () => {
    it('should get API keys', async () => {
      const bridge = createBridge();
      
      const keys = await bridge.getApiKeys();
      
      expect(keys).toHaveLength(1);
      expect(keys[0].provider).toBe('anthropic');
    });

    it('should set API key', async () => {
      const bridge = createBridge();
      
      await bridge.setApiKey('openai', 'sk-openai-key');
      
      expect(mockStorage.setApiKey).toHaveBeenCalledWith('openai', 'sk-openai-key');
    });

    it('should delete API key', async () => {
      const bridge = createBridge();
      
      await bridge.deleteApiKey('openai');
      
      expect(mockStorage.deleteApiKey).toHaveBeenCalledWith('openai');
    });
  });

  describe('models', () => {
    it('should get models when anthropic key exists', async () => {
      const bridge = createBridge();
      
      const models = await bridge.getModels('any-project');
      
      expect(models.length).toBeGreaterThan(0);
      expect(models.some(m => m.provider === 'anthropic')).toBe(true);
    });
  });

  describe('commands', () => {
    it('should get available commands', async () => {
      const bridge = createBridge();
      
      const commands = await bridge.getCommands('any-project');
      
      expect(commands).toContainEqual({ name: 'help', description: 'Show available commands' });
      expect(commands).toContainEqual({ name: 'clear', description: 'Clear the conversation' });
    });
  });

  describe('filesystem', () => {
    it('should read directory', async () => {
      const bridge = createBridge();
      
      const entries = await bridge.readDirectory('any-project', '/test');
      
      expect(entries).toHaveLength(1);
      expect(mockFilesystem.readDirectory).toHaveBeenCalledWith('/test');
    });

    it('should read file', async () => {
      const bridge = createBridge();
      
      const content = await bridge.readFile('any-project', '/test/file.txt');
      
      expect(content).toBe('file content');
      expect(mockFilesystem.readFile).toHaveBeenCalledWith('/test/file.txt');
    });
  });

  describe('settings', () => {
    it('should get projects directory', async () => {
      const bridge = createBridge();
      
      const dir = await bridge.getProjectsDirectory();
      
      expect(dir).toBe('/projects');
    });

    it('should set projects directory', async () => {
      const bridge = createBridge();
      
      await bridge.setProjectsDirectory('/new/path');
      
      expect(mockStorage.setProjectsDirectory).toHaveBeenCalledWith('/new/path');
    });
  });

  describe('search', () => {
    it('should search sessions across projects', async () => {
      (mockSessionManager.searchSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          session: {
            id: 's1',
            title: 'Test Session',
            workingDirectory: '/test',
            createdAt: new Date(),
            updatedAt: new Date(),
            messageCount: 5,
          },
          matchingMessages: [
            { id: 'm1', role: 'user', content: 'search term', createdAt: new Date() },
          ],
        },
      ]);
      
      const bridge = createBridge();
      await bridge.createProject('/test/path', 'local');
      
      const results = await bridge.searchSessions({ query: 'search term' });
      
      expect(results.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('event subscription', () => {
    it('should subscribe to project events', async () => {
      const bridge = createBridge();
      const project = await bridge.createProject('/test/path', 'local');
      
      const callback = vi.fn();
      const unsubscribe = bridge.subscribeToProject(project.id, callback);
      
      expect(typeof unsubscribe).toBe('function');
    });
  });

  describe('remote filesystem browsing', () => {
    beforeEach(() => {
      // Mock fetch for remote server calls
      global.fetch = vi.fn();
    });

    it('should get remote filesystem home paths', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          home: '/home/user',
          workspaces: '/home/user/workspaces',
          common: [
            { name: 'Home', path: '/home/user' },
            { name: 'Documents', path: '/home/user/Documents' },
          ],
        }),
      });
      
      const bridge = createBridge();
      const server = await bridge.addRemoteServer({
        name: 'Test Server',
        url: 'https://test-server.com',
        token: 'test-token',
      });
      
      const homePaths = await bridge.getRemoteFilesystemHome(server.id);
      
      expect(homePaths.home).toBe('/home/user');
      expect(homePaths.workspaces).toBe('/home/user/workspaces');
      expect(homePaths.common).toHaveLength(2);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://test-server.com/api/beta/filesystem/home',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
          }),
        })
      );
    });

    it('should list remote filesystem directory', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          path: '/home/user',
          name: 'user',
          parent: '/home',
          isRoot: false,
          entries: [
            { name: 'Documents', path: '/home/user/Documents', isDirectory: true, isFile: false },
            { name: 'file.txt', path: '/home/user/file.txt', isDirectory: false, isFile: true },
          ],
          count: { total: 2, directories: 1, files: 1 },
        }),
      });
      
      const bridge = createBridge();
      const server = await bridge.addRemoteServer({
        name: 'Test Server',
        url: 'https://test-server.com',
        token: 'test-token',
      });
      
      const result = await bridge.listRemoteFilesystem(server.id, '/home/user');
      
      expect(result.path).toBe('/home/user');
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].name).toBe('Documents');
      expect(result.entries[0].isDirectory).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://test-server.com/api/beta/filesystem/list'),
        expect.anything()
      );
    });

    it('should list remote filesystem with showHidden option', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          path: '/home/user',
          name: 'user',
          parent: '/home',
          isRoot: false,
          entries: [
            { name: '.hidden', path: '/home/user/.hidden', isDirectory: true, isFile: false },
            { name: 'Documents', path: '/home/user/Documents', isDirectory: true, isFile: false },
          ],
          count: { total: 2, directories: 2, files: 0 },
        }),
      });
      
      const bridge = createBridge();
      const server = await bridge.addRemoteServer({
        name: 'Test Server',
        url: 'https://test-server.com',
      });
      
      await bridge.listRemoteFilesystem(server.id, '/home/user', true);
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('showHidden=true'),
        expect.anything()
      );
    });

    it('should create remote directory', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve({
          path: '/home/user/NewFolder',
          name: 'NewFolder',
          isDirectory: true,
          createdAt: new Date().toISOString(),
        }),
      });
      
      const bridge = createBridge();
      const server = await bridge.addRemoteServer({
        name: 'Test Server',
        url: 'https://test-server.com',
        token: 'test-token',
      });
      
      const newPath = await bridge.createRemoteDirectory(server.id, '/home/user', 'NewFolder');
      
      expect(newPath).toBe('/home/user/NewFolder');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://test-server.com/api/beta/filesystem/mkdir',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
          }),
          body: JSON.stringify({ parentPath: '/home/user', name: 'NewFolder' }),
        })
      );
    });

    it('should throw when remote server not found', async () => {
      const bridge = createBridge();
      
      await expect(bridge.getRemoteFilesystemHome('non-existent-server')).rejects.toThrow();
      await expect(bridge.listRemoteFilesystem('non-existent-server', '/path')).rejects.toThrow();
      await expect(bridge.createRemoteDirectory('non-existent-server', '/path', 'name')).rejects.toThrow();
    });

    it('should throw when remote server request fails', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Server error' }),
      });
      
      const bridge = createBridge();
      const server = await bridge.addRemoteServer({
        name: 'Test Server',
        url: 'https://test-server.com',
      });
      
      await expect(bridge.getRemoteFilesystemHome(server.id)).rejects.toThrow();
    });

    it('should update server lastSeen timestamp on successful request', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          home: '/home/user',
          workspaces: '/workspaces',
          common: [],
        }),
      });
      
      const onServersChanged = vi.fn();
      const bridge = createBridgeCore({
        agentFactory: mockAgentFactory,
        storage: mockStorage,
        filesystem: mockFilesystem,
        onEvent,
        onRemoteServersChanged: onServersChanged,
      });
      
      const server = await bridge.addRemoteServer({
        name: 'Test Server',
        url: 'https://test-server.com',
      });
      
      // Make a request
      await bridge.getRemoteFilesystemHome(server.id);
      
      // Check that lastSeen was updated
      const servers = await bridge.listRemoteServers();
      expect(servers[0].lastSeen).toBeDefined();
      expect(servers[0].lastSeen).toBeGreaterThan(0);
    });
  });
});
