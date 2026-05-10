/**
 * Tests for ReactNativeAgentFactory
 *
 * Verifies that the AgentAdapter properly delegates permission and state
 * management methods to the underlying core Agent, rather than maintaining
 * separate local state that the core never sees.
 */

// Mock expo modules before imports
jest.mock('expo/fetch', () => ({
  fetch: jest.fn(),
}), { virtual: true });

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn().mockReturnValue('mock-uuid'),
}), { virtual: true });

jest.mock('expo-file-system', () => ({
  documentDirectory: '/mock/documents/',
}), { virtual: true });

// Mock database before imports
jest.mock('./database', () => ({
  getDatabase: jest.fn().mockReturnValue({}),
}));

// Mock the core Agent with all methods needed by the AgentAdapter and factory.
// The global setup.ts mock is missing some exports, so we provide a complete one.
const mockPermissionManagerGetConfig = jest.fn().mockReturnValue({
  defaultMode: 'ask',
  alwaysAllow: [],
  alwaysDeny: [],
  allowAll: false,
});

const mockAgentTypeRegistry = {
  getAllIncludingDisabled: jest.fn().mockReturnValue([]),
  getConflicts: jest.fn().mockReturnValue([]),
  setEnabled: jest.fn(),
};

const mockAgentInstance = {
  use: jest.fn().mockResolvedValue(undefined),
  setProvider: jest.fn(),
  hasProvider: jest.fn().mockReturnValue(true),
  on: jest.fn(),
  prompt: jest.fn().mockResolvedValue({ content: 'Mock response' }),
  stream: jest.fn(),
  cancel: jest.fn(),
  abort: jest.fn(),
  setSessionContext: jest.fn(),
  setMessages: jest.fn(),
  getMessages: jest.fn().mockReturnValue([]),
  getConfig: jest.fn().mockReturnValue({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' }),
  getProvider: jest.fn().mockReturnValue({ name: 'anthropic' }),
  setExtension: jest.fn(),
  setPermissionRequestCallback: jest.fn(),
  allowToolForSession: jest.fn(),
  clearToolPermissions: jest.fn(),
  respondToPermission: jest.fn(),
  respondToQuestion: jest.fn(),
  useIsolatedToolRegistry: jest.fn(),
  getProviderRegistry: jest.fn().mockReturnValue({ register: jest.fn() }),
  getToolRegistry: jest.fn().mockReturnValue({ getAll: jest.fn().mockReturnValue([]), reevaluateDeferred: jest.fn() }),
  getPermissionManager: jest.fn().mockReturnValue({ getConfig: mockPermissionManagerGetConfig }),
  getAgentTypeRegistry: jest.fn().mockReturnValue(mockAgentTypeRegistry),
  updatePermissionConfig: jest.fn(),
  getDisabledTools: jest.fn().mockReturnValue([]),
  setDisabledTools: jest.fn(),
  disableTool: jest.fn(),
  enableTool: jest.fn(),
  getToolsInfo: jest.fn().mockReturnValue([]),
  shutdown: jest.fn().mockResolvedValue(undefined),
};

jest.mock('@openmgr/agent-react-native', () => ({
  Agent: jest.fn().mockImplementation(() => mockAgentInstance),
  providersPlugin: { name: 'mock-providers-plugin' },
  toolsPlugin: { name: 'mock-tools-plugin' },
  fileToolsPlugin: { name: 'mock-file-tools-plugin' },
  createReactNativeFilesystem: jest.fn().mockReturnValue({}),
  AnthropicOAuthProvider: jest.fn(),
  SessionManager: jest.fn().mockImplementation(() => ({
    createSession: jest.fn().mockResolvedValue({ id: 'mock-session', title: null, createdAt: new Date(), updatedAt: new Date() }),
    getRootSessions: jest.fn().mockResolvedValue([]),
    getSession: jest.fn().mockResolvedValue(null),
    deleteSession: jest.fn().mockResolvedValue(undefined),
    getSessionMessages: jest.fn().mockResolvedValue([]),
    getSessionMessagesPaginated: jest.fn().mockResolvedValue({ messages: [], hasMore: false }),
    addMessage: jest.fn().mockResolvedValue(undefined),
    getNextSequence: jest.fn().mockResolvedValue(1),
    searchSessions: jest.fn().mockResolvedValue([]),
    updateSession: jest.fn().mockResolvedValue(undefined),
  })),
  SubagentManager: jest.fn(),
  capabilityRegistry: { getAll: jest.fn().mockReturnValue([]), register: jest.fn() },
  generateTitle: jest.fn().mockResolvedValue('Generated Title'),
  isDefaultTitle: jest.fn((title: string) => !title || title === 'New conversation' || title.toLowerCase() === 'untitled'),
}));

import { ReactNativeAgentFactory } from './ReactNativeAgentFactory';

describe('ReactNativeAgentFactory', () => {
  let factory: ReactNativeAgentFactory;
  let mockOnEvent: jest.Mock;
  let projectCounter = 0;

  beforeEach(() => {
    jest.clearAllMocks();
    factory = new ReactNativeAgentFactory();
    mockOnEvent = jest.fn();
    projectCounter++;
  });

  async function createAdapter() {
    // Use a unique projectId per test to avoid the module-level agent cache
    const { agent } = await factory.createAgent({
      projectId: `test-project-${projectCounter}`,
      workingDirectory: '/mock/dir',
      apiKey: 'test-key',
      onEvent: mockOnEvent,
    });
    // mockAgentInstance is the shared object returned by the Agent mock constructor
    return { adapter: agent, mockAgent: mockAgentInstance };
  }

  describe('setPermissionRequestCallback', () => {
    it('should delegate to the core Agent', async () => {
      const { adapter, mockAgent } = await createAdapter();
      const callback = jest.fn().mockResolvedValue('allow_once');

      adapter.setPermissionRequestCallback(callback);

      expect(mockAgent.setPermissionRequestCallback).toHaveBeenCalledTimes(1);
      expect(mockAgent.setPermissionRequestCallback).toHaveBeenCalledWith(callback);
    });
  });

  describe('allowToolForSession', () => {
    it('should delegate to the core Agent', async () => {
      const { adapter, mockAgent } = await createAdapter();

      adapter.allowToolForSession('read_file');

      expect(mockAgent.allowToolForSession).toHaveBeenCalledTimes(1);
      expect(mockAgent.allowToolForSession).toHaveBeenCalledWith('read_file');
    });
  });

  describe('clearToolPermissions', () => {
    it('should delegate to the core Agent', async () => {
      const { adapter, mockAgent } = await createAdapter();

      adapter.clearToolPermissions();

      expect(mockAgent.clearToolPermissions).toHaveBeenCalledTimes(1);
    });
  });

  describe('getPermissionConfig', () => {
    it('should read from the core Agent permission manager', async () => {
      const { adapter, mockAgent } = await createAdapter();
      const mockConfig = {
        defaultMode: 'ask',
        alwaysAllow: ['read_file'],
        alwaysDeny: ['delete_file'],
        allowAll: false,
      };
      mockAgent.getPermissionManager = jest.fn().mockReturnValue({
        getConfig: jest.fn().mockReturnValue(mockConfig),
      });

      const config = adapter.getPermissionConfig();

      expect(mockAgent.getPermissionManager).toHaveBeenCalled();
      expect(config).toEqual({
        defaultMode: 'ask',
        alwaysAllow: ['read_file'],
        alwaysDeny: ['delete_file'],
        allowAll: false,
      });
    });
  });

  describe('updatePermissionConfig', () => {
    it('should delegate to the core Agent', async () => {
      const { adapter, mockAgent } = await createAdapter();
      const configUpdate = { allowAll: true };

      adapter.updatePermissionConfig(configUpdate);

      expect(mockAgent.updatePermissionConfig).toHaveBeenCalledTimes(1);
      expect(mockAgent.updatePermissionConfig).toHaveBeenCalledWith(configUpdate);
    });
  });

  describe('setMessages', () => {
    it('should delegate to the core Agent', async () => {
      const { adapter, mockAgent } = await createAdapter();
      const messages = [
        { id: 'msg-1', role: 'user' as const, content: 'Hello' },
        { id: 'msg-2', role: 'assistant' as const, content: 'Hi there' },
      ];

      adapter.setMessages(messages);

      expect(mockAgent.setMessages).toHaveBeenCalledTimes(1);
      expect(mockAgent.setMessages).toHaveBeenCalledWith(messages);
    });
  });

  describe('tool.permission.request event handling', () => {
    it('should forward the event to onEvent without directly calling the permission callback', async () => {
      const { adapter, mockAgent } = await createAdapter();

      // Set up a permission callback
      const permissionCallback = jest.fn().mockResolvedValue('allow_once');
      adapter.setPermissionRequestCallback(permissionCallback);

      // Set session context so events have a sessionId
      adapter.setSessionContext({ sessionId: 'test-session' });

      // Simulate the core Agent emitting a tool.permission.request event
      // The Agent mock's `on` captures the callback; we invoke it directly
      const onCall = mockAgent.on.mock.calls.find(
        (call: [string, (...args: unknown[]) => void]) => call[0] === 'event'
      );
      expect(onCall).toBeDefined();
      const eventHandler = onCall![1];

      eventHandler({
        type: 'tool.permission.request',
        messageId: 'msg-1',
        toolCall: {
          id: 'tc-1',
          name: 'write_file',
          arguments: { path: '/test.txt', content: 'hello' },
        },
      });

      // The onEvent callback should have been called with the UI event
      expect(mockOnEvent).toHaveBeenCalledWith({
        type: 'tool.permission.request',
        sessionId: 'test-session',
        messageId: 'msg-1',
        toolCall: {
          id: 'tc-1',
          name: 'write_file',
          arguments: { path: '/test.txt', content: 'hello' },
          status: 'pending',
        },
      });

      // The permission callback should NOT be called directly by the event handler.
      // It will be called by the core Agent's ToolPermissionManager.checkPermission()
      // which is set up via setPermissionRequestCallback delegation.
      expect(permissionCallback).not.toHaveBeenCalled();
    });
  });

  describe('subagent support', () => {
    it('should create SubagentManager and register subagent capability during agent creation', async () => {
      const { SubagentManager, capabilityRegistry } = require('@openmgr/agent-react-native');

      await createAdapter();

      // SubagentManager should be constructed with the agent instance and options
      expect(SubagentManager).toHaveBeenCalledWith(mockAgentInstance, expect.objectContaining({
        agentFactory: expect.any(Function),
      }));

      // subagentManager should be set as an extension
      expect(mockAgentInstance.setExtension).toHaveBeenCalledWith(
        'subagentManager',
        expect.anything(),
      );

      // subagent capability should be registered
      expect(capabilityRegistry.register).toHaveBeenCalledWith('subagent', {
        providedBy: '@openmgr/app-mobile',
        version: '0.1.0',
      });

      // Deferred tools should be re-evaluated so task tools become active
      expect(mockAgentInstance.getToolRegistry().reevaluateDeferred).toHaveBeenCalled();
    });
  });

  describe('getAgentTypes', () => {
    it('should return agent types from the registry', async () => {
      const mockTypes = [
        {
          name: 'explore-code',
          description: 'Read-only codebase explorer',
          enabled: true,
          source: 'plugin',
          tags: ['subagent', 'code'],
        },
        {
          name: 'general-code',
          description: 'Full-access coding agent',
          enabled: false,
          source: 'plugin',
          tags: ['root', 'subagent', 'code'],
        },
      ];
      mockAgentTypeRegistry.getAllIncludingDisabled.mockReturnValue(mockTypes);

      const { adapter } = await createAdapter();
      const types = adapter.getAgentTypes!();

      expect(types).toHaveLength(2);
      expect(types[0].name).toBe('explore-code');
      expect(types[0].enabled).toBe(true);
      expect(types[1].name).toBe('general-code');
      expect(types[1].enabled).toBe(false);
    });

    it('should default enabled to true when not explicitly set', async () => {
      mockAgentTypeRegistry.getAllIncludingDisabled.mockReturnValue([
        { name: 'test-type', description: 'Test', source: 'builtin' },
      ]);

      const { adapter } = await createAdapter();
      const types = adapter.getAgentTypes!();

      expect(types[0].enabled).toBe(true);
    });

    it('should default source to builtin when not set', async () => {
      mockAgentTypeRegistry.getAllIncludingDisabled.mockReturnValue([
        { name: 'test-type', description: 'Test' },
      ]);

      const { adapter } = await createAdapter();
      const types = adapter.getAgentTypes!();

      expect(types[0].source).toBe('builtin');
    });
  });

  describe('getAgentTypeConflicts', () => {
    it('should return conflicts from the registry', async () => {
      mockAgentTypeRegistry.getConflicts.mockReturnValue([
        {
          name: 'general-code',
          kept: { source: 'config', integrity: 'sha256-abc' },
          replaced: { source: 'plugin', integrity: 'sha256-def' },
        },
      ]);

      const { adapter } = await createAdapter();
      const conflicts = adapter.getAgentTypeConflicts!();

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toEqual({
        name: 'general-code',
        keptSource: 'config',
        replacedSource: 'plugin',
        keptIntegrity: 'sha256-abc',
        replacedIntegrity: 'sha256-def',
      });
    });

    it('should default source to builtin when not set in conflict definitions', async () => {
      mockAgentTypeRegistry.getConflicts.mockReturnValue([
        {
          name: 'test',
          kept: { integrity: 'sha256-abc' },
          replaced: {},
        },
      ]);

      const { adapter } = await createAdapter();
      const conflicts = adapter.getAgentTypeConflicts!();

      expect(conflicts[0].keptSource).toBe('builtin');
      expect(conflicts[0].replacedSource).toBe('builtin');
    });
  });

  describe('setAgentTypeEnabled', () => {
    it('should delegate to the agent type registry', async () => {
      const { adapter } = await createAdapter();

      adapter.setAgentTypeEnabled!('explore-code', false);

      expect(mockAgentTypeRegistry.setEnabled).toHaveBeenCalledWith('explore-code', false);
    });

    it('should support enabling a previously disabled type', async () => {
      const { adapter } = await createAdapter();

      adapter.setAgentTypeEnabled!('explore-code', true);

      expect(mockAgentTypeRegistry.setEnabled).toHaveBeenCalledWith('explore-code', true);
    });
  });

  describe('setSessionContext', () => {
    it('should forward session context to the core Agent', async () => {
      const { adapter, mockAgent } = await createAdapter();

      adapter.setSessionContext({ sessionId: 'session-123' });

      expect(mockAgent.setSessionContext).toHaveBeenCalledWith({
        sessionId: 'session-123',
        sessionManager: null,
      });
    });

    it('should update currentSessionId for event emissions', async () => {
      const { adapter, mockAgent } = await createAdapter();
      adapter.setSessionContext({ sessionId: 'session-456' });

      // Simulate a core event to verify currentSessionId is used
      const onCall = mockAgent.on.mock.calls.find(
        (call: [string, (...args: unknown[]) => void]) => call[0] === 'event'
      );
      const eventHandler = onCall![1];

      eventHandler({
        type: 'message.start',
        messageId: 'msg-1',
      });

      expect(mockOnEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'message.start',
          sessionId: 'session-456',
        }),
      );
    });
  });

  describe('session.title.updated event forwarding', () => {
    it('should forward session.title.updated events from core to UI', async () => {
      const { adapter, mockAgent } = await createAdapter();
      adapter.setSessionContext({ sessionId: 'session-789' });

      const onCall = mockAgent.on.mock.calls.find(
        (call: [string, (...args: unknown[]) => void]) => call[0] === 'event'
      );
      const eventHandler = onCall![1];

      eventHandler({
        type: 'session.title.updated',
        sessionId: 'session-789',
        title: 'My New Title',
      });

      expect(mockOnEvent).toHaveBeenCalledWith({
        type: 'session.title.updated',
        sessionId: 'session-789',
        title: 'My New Title',
      });
    });

    it('should use currentSessionId as fallback when event has no sessionId', async () => {
      const { adapter, mockAgent } = await createAdapter();
      adapter.setSessionContext({ sessionId: 'fallback-session' });

      const onCall = mockAgent.on.mock.calls.find(
        (call: [string, (...args: unknown[]) => void]) => call[0] === 'event'
      );
      const eventHandler = onCall![1];

      eventHandler({
        type: 'session.title.updated',
        title: 'Fallback Title',
      });

      expect(mockOnEvent).toHaveBeenCalledWith({
        type: 'session.title.updated',
        sessionId: 'fallback-session',
        title: 'Fallback Title',
      });
    });
  });

  describe('generateSessionTitle', () => {
    // Access the mocked generateTitle via require so we can inspect/configure it
    function getMockGenerateTitle(): jest.Mock {
      const mod = require('@openmgr/agent-react-native');
      return mod.generateTitle;
    }

    it('should generate a title using the core generateTitle function', async () => {
      const mockProvider = { name: 'anthropic' };
      mockAgentInstance.getProvider = jest.fn().mockReturnValue(mockProvider);
      mockAgentInstance.getConfig = jest.fn().mockReturnValue({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      });

      const { adapter } = await createAdapter();

      const messages = [
        { role: 'user', content: 'How do I sort an array?' },
        { role: 'assistant', content: 'You can use Array.sort()...' },
      ];

      const title = await adapter.generateSessionTitle!(messages);

      expect(title).toBe('Generated Title');
      expect(getMockGenerateTitle()).toHaveBeenCalledWith(
        [
          { role: 'user', content: 'How do I sort an array?' },
          { role: 'assistant', content: 'You can use Array.sort()...' },
        ],
        { provider: mockProvider, model: 'claude-sonnet-4-20250514' },
      );
    });

    it('should return null when no provider is available', async () => {
      mockAgentInstance.getProvider = jest.fn().mockReturnValue(null);

      const { adapter } = await createAdapter();
      const title = await adapter.generateSessionTitle!([
        { role: 'user', content: 'Hello' },
      ]);

      expect(title).toBeNull();
    });

    it('should return null when generateTitle throws', async () => {
      mockAgentInstance.getProvider = jest.fn().mockReturnValue({ name: 'anthropic' });
      mockAgentInstance.getConfig = jest.fn().mockReturnValue({ model: 'test' });
      getMockGenerateTitle().mockRejectedValueOnce(new Error('API error'));

      const { adapter } = await createAdapter();
      const title = await adapter.generateSessionTitle!([
        { role: 'user', content: 'Hello' },
      ]);

      expect(title).toBeNull();
    });
  });
});
