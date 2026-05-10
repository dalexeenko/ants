/**
 * Test utilities for React Native components
 */

/// <reference types="jest" />
import React, { ReactNode } from 'react';
import { render, RenderOptions } from '@testing-library/react-native';
import { ThemeContext, resolveTheme } from '@ants/ui';

/**
 * Custom render function that wraps components with theme context
 */
function customRender(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  const theme = resolveTheme('light');

  const Wrapper: React.FC<{ children: ReactNode }> = ({ children }) => (
    <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
  );

  return render(ui, { wrapper: Wrapper, ...options });
}

// Re-export everything from testing-library
export * from '@testing-library/react-native';

// Override render with our custom version
export { customRender as render };

/**
 * Create a mock AgentBridge for testing
 */
export function createMockBridge() {
  return {
    // Project management
    createProject: jest.fn().mockResolvedValue({
      id: 'test-project-id',
      name: 'Test Project',
      path: '/test/path',
      createdAt: Date.now(),
      providerType: 'local',
    }),
    listProjects: jest.fn().mockResolvedValue([]),
    removeProject: jest.fn().mockResolvedValue(undefined),
    discoverProjects: jest.fn().mockResolvedValue([]),

    // Remote server management
    listRemoteServers: jest.fn().mockResolvedValue([]),
    addRemoteServer: jest.fn().mockResolvedValue({
      id: 'test-server-id',
      name: 'Test Server',
      url: 'https://test-server.com',
      createdAt: Date.now(),
    }),
    updateRemoteServer: jest.fn().mockResolvedValue(undefined),
    removeRemoteServer: jest.fn().mockResolvedValue(undefined),
    testRemoteServer: jest.fn().mockResolvedValue({ success: true }),

    // Session management
    listSessions: jest.fn().mockResolvedValue([]),
    createSession: jest.fn().mockResolvedValue({
      id: 'test-session-id',
      title: 'Test Session',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
    deleteSession: jest.fn().mockResolvedValue(undefined),
    getSession: jest.fn().mockResolvedValue({
      id: 'test-session-id',
      title: 'Test Session',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),

    // Messaging
    getMessages: jest.fn().mockResolvedValue([]),
    sendMessage: jest.fn().mockResolvedValue(undefined),
    cancelMessage: jest.fn().mockResolvedValue(undefined),

    // Events
    subscribeToProject: jest.fn().mockReturnValue(() => {}),

    // Permissions
    respondToPermission: jest.fn().mockResolvedValue(undefined),
    getPermissionConfig: jest.fn().mockResolvedValue({
      defaultMode: 'ask',
      alwaysAllow: [],
      alwaysDeny: [],
      allowAll: false,
    }),
    updatePermissionConfig: jest.fn().mockResolvedValue(undefined),

    // Authentication
    getAuthStatus: jest.fn().mockResolvedValue({
      anthropic: { authenticated: false, method: null },
      openai: { hasApiKey: false },
      google: { hasApiKey: false },
      openrouter: { hasApiKey: false },
      groq: { hasApiKey: false },
      xai: { hasApiKey: false },
    }),
    initiateOAuth: jest.fn().mockResolvedValue({
      url: 'https://oauth-url.com',
      verifier: 'test-verifier',
    }),
    completeOAuth: jest.fn().mockResolvedValue(undefined),
    disconnectOAuth: jest.fn().mockResolvedValue(undefined),

    // API Keys
    getApiKeys: jest.fn().mockResolvedValue([]),
    setApiKey: jest.fn().mockResolvedValue(undefined),
    deleteApiKey: jest.fn().mockResolvedValue(undefined),

    // MCP
    listMcpServers: jest.fn().mockResolvedValue([]),
    addMcpServer: jest.fn().mockResolvedValue(undefined),
    removeMcpServer: jest.fn().mockResolvedValue(undefined),
    getMcpTools: jest.fn().mockResolvedValue([]),
    getMcpStatus: jest.fn().mockResolvedValue({}),

    // Models
    getModels: jest.fn().mockResolvedValue([
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic' },
    ]),

    // Commands
    getCommands: jest.fn().mockResolvedValue([
      { name: 'help', description: 'Show available commands' },
    ]),

    // Filesystem
    readDirectory: jest.fn().mockResolvedValue([]),
    readFile: jest.fn().mockResolvedValue(''),

    // Settings
    getProjectsDirectory: jest.fn().mockResolvedValue(null),
    setProjectsDirectory: jest.fn().mockResolvedValue(undefined),

    // Tools
    getToolsInfo: jest.fn().mockResolvedValue([]),
    getDisabledTools: jest.fn().mockResolvedValue([]),
    setDisabledTools: jest.fn().mockResolvedValue(undefined),
    disableTool: jest.fn().mockResolvedValue(undefined),
    enableTool: jest.fn().mockResolvedValue(undefined),

    // Search
    searchSessions: jest.fn().mockResolvedValue([]),

    // Project updates
    updateProject: jest.fn().mockResolvedValue(undefined),
    deleteAllSessions: jest.fn().mockResolvedValue({ deletedCount: 0 }),

    // Director
    directorListSessions: jest.fn().mockResolvedValue([]),
    directorCreateSession: jest.fn().mockResolvedValue({
      id: 'director-session-id',
      title: 'Director Session',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
    directorDeleteSession: jest.fn().mockResolvedValue(undefined),
    directorGetMessages: jest.fn().mockResolvedValue([]),
    directorSendMessage: jest.fn().mockResolvedValue(undefined),
    directorCancelMessage: jest.fn().mockResolvedValue(undefined),
    directorRespondToPermission: jest.fn().mockResolvedValue(undefined),
    directorSubscribeToEvents: jest.fn().mockReturnValue(() => {}),

    // Worktree
    getWorktreeDiff: jest.fn().mockResolvedValue({ files: [], stats: { additions: 0, deletions: 0, changed: 0 } }),
    mergeWorktree: jest.fn().mockResolvedValue(undefined),
    discardWorktree: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * Create a mock project for testing
 */
export function createMockProject(overrides = {}) {
  return {
    id: 'test-project-id',
    name: 'Test Project',
    path: '/test/path',
    createdAt: Date.now(),
    providerType: 'local' as const,
    ...overrides,
  };
}

/**
 * Create a mock session for testing
 */
export function createMockSession(overrides = {}) {
  return {
    id: 'test-session-id',
    title: 'Test Session',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

/**
 * Create a mock message for testing
 */
export function createMockMessage(overrides = {}) {
  return {
    id: 'test-message-id',
    role: 'user' as const,
    content: 'Test message content',
    createdAt: Date.now(),
    ...overrides,
  };
}
