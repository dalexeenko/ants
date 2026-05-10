/**
 * Jest setup for React Native tests
 */

// Set up React act environment
(global as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
(global as Record<string, unknown>).IS_REACT_NATIVE_TEST_ENVIRONMENT = true;

// Define __DEV__
Object.defineProperty(global, '__DEV__', {
  configurable: true,
  enumerable: true,
  value: true,
  writable: true,
});

// Mock expo-secure-store
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}), { virtual: true });

// Mock expo-crypto
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn().mockResolvedValue(new Uint8Array(32)),
  digestStringAsync: jest.fn().mockResolvedValue('mock-hash'),
  CryptoDigestAlgorithm: {
    SHA256: 'SHA-256',
  },
}), { virtual: true });

// Mock expo-file-system
jest.mock('expo-file-system', () => ({
  documentDirectory: '/mock/documents/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: false }),
  readDirectoryAsync: jest.fn().mockResolvedValue([]),
  readAsStringAsync: jest.fn().mockResolvedValue(''),
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
}), { virtual: true });

// Mock expo-linking
jest.mock('expo-linking', () => ({
  createURL: jest.fn((path: string) => `exp://localhost:8081/${path}`),
  openURL: jest.fn().mockResolvedValue(undefined),
}), { virtual: true });

// Mock expo-sqlite
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn().mockResolvedValue({
    execAsync: jest.fn().mockResolvedValue(undefined),
    runAsync: jest.fn().mockResolvedValue({ lastInsertRowId: 1, changes: 1 }),
    getFirstAsync: jest.fn().mockResolvedValue(null),
    getAllAsync: jest.fn().mockResolvedValue([]),
    closeAsync: jest.fn().mockResolvedValue(undefined),
  }),
}), { virtual: true });

// Mock @ants/agent-auth-react-native
jest.mock('@ants/agent-auth-react-native', () => ({
  createManualOAuthHandler: jest.fn(() => ({
    generateAuthUrl: jest.fn().mockResolvedValue({
      url: 'https://mock-oauth-url.com',
      verifier: 'mock-verifier',
    }),
    completeLogin: jest.fn().mockResolvedValue(undefined),
    logout: jest.fn().mockResolvedValue(undefined),
    isLoggedIn: jest.fn().mockResolvedValue(false),
    getValidAccessToken: jest.fn().mockResolvedValue(null),
    tokenStore: {
      loadTokens: jest.fn().mockResolvedValue(null),
      saveTokens: jest.fn().mockResolvedValue(undefined),
    },
  })),
}), { virtual: true });

// Mock @ants/agent-react-native
jest.mock('@ants/agent-react-native', () => ({
  Agent: jest.fn().mockImplementation(() => ({
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
    setPermissionRequestCallback: jest.fn(),
    allowToolForSession: jest.fn(),
    clearToolPermissions: jest.fn(),
    respondToPermission: jest.fn(),
    respondToQuestion: jest.fn(),
    useIsolatedToolRegistry: jest.fn(),
    getProviderRegistry: jest.fn().mockReturnValue({
      register: jest.fn(),
    }),
    getPermissionConfig: jest.fn().mockReturnValue({
      defaultMode: 'ask',
      alwaysAllow: [],
      alwaysDeny: [],
      allowAll: false,
    }),
    updatePermissionConfig: jest.fn(),
    getDisabledTools: jest.fn().mockReturnValue([]),
    setDisabledTools: jest.fn(),
    disableTool: jest.fn(),
    enableTool: jest.fn(),
    getToolsInfo: jest.fn().mockReturnValue([]),
    shutdown: jest.fn().mockResolvedValue(undefined),
  })),
  createReactNativeDatabase: jest.fn().mockReturnValue({
    db: {},
    close: jest.fn(),
  }),
  SessionManager: jest.fn().mockImplementation(() => ({
    createSession: jest.fn().mockResolvedValue({
      id: 'mock-session-id',
      title: 'Mock Session',
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    getRootSessions: jest.fn().mockResolvedValue([]),
    getSession: jest.fn().mockResolvedValue(null),
    deleteSession: jest.fn().mockResolvedValue(undefined),
    getSessionMessages: jest.fn().mockResolvedValue([]),
    getSessionMessagesPaginated: jest.fn().mockResolvedValue({ messages: [], hasMore: false }),
    addMessage: jest.fn().mockResolvedValue(undefined),
    getNextSequence: jest.fn().mockResolvedValue(1),
    searchSessions: jest.fn().mockResolvedValue([]),
  })),
  providersPlugin: { name: 'mock-providers-plugin' },
  AnthropicOAuthProvider: jest.fn().mockImplementation(() => ({
    stream: jest.fn(),
  })),
  createReactNativeAgent: jest.fn().mockResolvedValue({
    agent: {
      id: 'mock-agent-id',
      prompt: jest.fn().mockResolvedValue({ content: 'Mock response' }),
      stream: jest.fn(),
      cancel: jest.fn(),
      setSessionContext: jest.fn(),
      setMessages: jest.fn(),
      on: jest.fn(),
      setPermissionRequestCallback: jest.fn(),
      allowToolForSession: jest.fn(),
      clearToolPermissions: jest.fn(),
      getPermissionConfig: jest.fn().mockReturnValue({
        defaultMode: 'ask',
        alwaysAllow: [],
        alwaysDeny: [],
        allowAll: false,
      }),
      updatePermissionConfig: jest.fn(),
      getDisabledTools: jest.fn().mockReturnValue([]),
      setDisabledTools: jest.fn(),
      disableTool: jest.fn(),
      enableTool: jest.fn(),
      getToolsInfo: jest.fn().mockReturnValue([]),
      shutdown: jest.fn().mockResolvedValue(undefined),
    },
    sessionManager: {
      createSession: jest.fn().mockResolvedValue({
        id: 'mock-session-id',
        title: 'Mock Session',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      getRootSessions: jest.fn().mockResolvedValue([]),
      getSession: jest.fn().mockResolvedValue(null),
      deleteSession: jest.fn().mockResolvedValue(undefined),
      getSessionMessages: jest.fn().mockResolvedValue([]),
      addMessage: jest.fn().mockResolvedValue(undefined),
      getNextSequence: jest.fn().mockResolvedValue(1),
      searchSessions: jest.fn().mockResolvedValue([]),
    },
  }),
}), { virtual: true });

// Mock @ants/agent-core (for providerRegistry)
jest.mock('@ants/agent-core', () => ({
  providerRegistry: {
    register: jest.fn(),
    has: jest.fn().mockReturnValue(false),
    get: jest.fn(),
    getNames: jest.fn().mockReturnValue([]),
    create: jest.fn(),
  },
}), { virtual: true });

// Mock @ants/agent-auth-core
jest.mock('@ants/agent-auth-core', () => ({
  DEFAULT_ANTHROPIC_CLIENT_ID: 'mock-client-id',
}), { virtual: true });

// Mock @ants/ui styles
jest.mock('@ants/ui/styles/theme', () => ({
  useTheme: () => ({
    colors: {
      bg: {
        primary: '#FFFFFF',
        secondary: '#F5F7F5',
        tertiary: '#E8ECE8',
        elevated: '#FFFFFF',
      },
      text: {
        primary: '#111816',
        secondary: '#3D4A47',
        muted: '#6B7A76',
        inverse: '#FFFFFF',
      },
      border: {
        light: '#D4DAD4',
        medium: '#B5BDB5',
        heavy: '#6B7A76',
      },
      primary: '#5C6CA8',
      primaryHover: '#4E5E98',
      primaryActive: '#3F4E82',
      success: '#4E9E76',
      warning: '#B8923E',
      error: '#B85C5C',
      info: '#5C6CA8',
    },
    palette: {
      primary: '#5C6CA8', primaryHover: '#4E5E98', primaryActive: '#3F4E82', primaryMuted: '#2E3858',
      success: '#4E9E76', successHover: '#3E8862', successMuted: '#1E4030', successLight: '#D6EBE0',
      warning: '#B8923E', warningHover: '#9C7A2E', warningMuted: '#4E3E1A', warningLight: '#EDE5CE', warningDark: '#7A5E28',
      error: '#B85C5C', errorHover: '#9C4444', errorMuted: '#4E2222', errorLight: '#EADADA',
      info: '#5C6CA8',
      violet: '#8A78B4', indigo: '#727AAE', pink: '#B06888', teal: '#4E9E94', orange: '#B87E58',
      yellow: '#9E9248', green: '#5EAA68', greenDark: '#428A4E',
      black: '#000000', white: '#FFFFFF', link: '#8AB4C8',
    },
    mode: 'system',
    resolvedMode: 'light',
  }),
  ThemeContext: {
    Provider: ({ children }: { children: unknown }) => children,
  },
}), { virtual: true });

// Silence console.warn in tests (optional)
const originalWarn = console.warn;
beforeAll(() => {
  console.warn = (...args: unknown[]) => {
    // Suppress specific warnings if needed
    if (typeof args[0] === 'string' && args[0].includes('componentWillReceiveProps')) {
      return;
    }
    originalWarn.call(console, ...args);
  };
});

afterAll(() => {
  console.warn = originalWarn;
});
