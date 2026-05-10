/**
 * Tests for MobileBridge SSE streaming functionality
 * 
 * These tests verify the SSE handler behavior for React Native.
 */

// Mock react-native-sse before importing anything
const mockEventListeners = new Map<string, ((event: { data?: string; message?: string }) => void)[]>();
const mockEventSource = {
  addEventListener: jest.fn((type: string, handler: (event: { data?: string; message?: string }) => void) => {
    if (!mockEventListeners.has(type)) {
      mockEventListeners.set(type, []);
    }
    mockEventListeners.get(type)!.push(handler);
  }),
  close: jest.fn(),
  open: jest.fn(),
};

jest.mock('react-native-sse', () => {
  return jest.fn().mockImplementation(() => {
    mockEventListeners.clear();
    return mockEventSource;
  });
});

// Mock database
jest.mock('./database', () => ({
  getDatabase: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        orderBy: jest.fn().mockReturnValue([]),
        where: jest.fn().mockReturnValue([]),
      }),
    }),
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        onConflictDoUpdate: jest.fn().mockReturnValue({
          run: jest.fn(),
        }),
      }),
    }),
    delete: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        run: jest.fn(),
      }),
    }),
  }),
}));

// Store the captured SSE handler and onEvent callback
let capturedSseHandler: {
  connect: (
    url: string,
    options: { method: 'POST'; headers: Record<string, string>; body: string },
    onEvent: (event: { type: string; data: string }) => void,
    onError: (error: Error) => void,
    onComplete: () => void
  ) => () => void;
} | null = null;

let capturedOnEvent: ((projectId: string, event: { type: string; [key: string]: unknown }) => void) | null = null;

// Mock createBridgeCore
jest.mock('@openmgr/ui', () => ({
  createBridgeCore: jest.fn().mockImplementation((config) => {
    // Store the SSE handler and onEvent for tests
    capturedSseHandler = config.sseHandler;
    capturedOnEvent = config.onEvent;
    
    // Return a mock bridge
    return {
      listProjects: jest.fn().mockResolvedValue([]),
      listRemoteServers: jest.fn().mockResolvedValue([]),
      createProject: jest.fn(),
      addRemoteServer: jest.fn(),
      subscribeToProject: jest.fn().mockReturnValue(() => {}),
    };
  }),
  createLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// Mock ReactNativeAgentFactory
jest.mock('./ReactNativeAgentFactory', () => ({
  createReactNativeAgentFactory: jest.fn().mockReturnValue({}),
}));

// Mock ReactNativeStorage
jest.mock('./ReactNativeStorage', () => ({
  createReactNativeStorage: jest.fn().mockReturnValue({}),
}));

// Mock ReactNativeFilesystem
jest.mock('./ReactNativeFilesystem', () => ({
  createReactNativeFilesystem: jest.fn().mockReturnValue({}),
}));

// Mock @openmgr/agent-react-native
jest.mock('@openmgr/agent-react-native', () => ({
  projects: {},
  remoteServers: {},
  eq: jest.fn(),
  desc: jest.fn(),
  toolsPlugin: {
    name: '@openmgr/agent-tools',
    agentTypes: [
      { name: 'general-code', description: 'General coding agent', tags: ['root'] },
      { name: 'explore-code', description: 'Code exploration agent', tags: ['root'] },
    ],
  },
  agentTypeRegistry: {
    register: jest.fn(),
    getAllIncludingDisabled: jest.fn().mockReturnValue([]),
    getConflicts: jest.fn().mockReturnValue([]),
    setEnabled: jest.fn(),
  },
}));

// Mock @openmgr/agent-tools-director (avoids ESM resolution issues with agent-core in Jest)
jest.mock('@openmgr/agent-tools-director', () => ({
  directorToolsPlugin: { name: 'director-tools', tools: [] },
  DIRECTOR_CONTEXT_KEY: 'director',
}));

// Mock expo modules (ESM packages that Jest can't transform via pnpm's nested node_modules)
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn().mockReturnValue('mock-uuid'),
  digestStringAsync: jest.fn().mockResolvedValue('mock-hash'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

jest.mock('expo/fetch', () => ({
  fetch: jest.fn().mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue({}) }),
}));

// Import after mocks are set up
import { createMobileBridge } from './MobileBridge';

describe('MobileBridge SSE Handler', () => {
  // Helper to emit events
  const emitEvent = (type: string, data?: { data?: string; message?: string }) => {
    const handlers = mockEventListeners.get(type) || [];
    for (const handler of handlers) {
      handler(data || {});
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockEventListeners.clear();
    capturedSseHandler = null;
    capturedOnEvent = null;
  });

  describe('SSE Connection', () => {
    it('should create EventSource with correct configuration', () => {
      // Create the bridge to trigger createBridgeCore
      createMobileBridge();
      
      expect(capturedSseHandler).toBeDefined();
      expect(capturedSseHandler!.connect).toBeDefined();
      
      // Test the connect function
      const onEvent = jest.fn();
      const onError = jest.fn();
      const onComplete = jest.fn();
      
      capturedSseHandler!.connect(
        'https://test.example.com/sse',
        {
          method: 'POST',
          headers: { 'Authorization': 'Bearer test-token' },
          body: JSON.stringify({ prompt: 'test' }),
        },
        onEvent,
        onError,
        onComplete
      );
      
      // Verify EventSource was created (via mock)
      const EventSourceMock = require('react-native-sse');
      expect(EventSourceMock).toHaveBeenCalledWith(
        'https://test.example.com/sse',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Authorization': 'Bearer test-token' },
          body: JSON.stringify({ prompt: 'test' }),
          timeoutBeforeConnection: 0,
          pollingInterval: 0,
        })
      );
    });

    it('should handle message.delta events', () => {
      createMobileBridge();
      
      const onEvent = jest.fn();
      const onError = jest.fn();
      const onComplete = jest.fn();
      
      capturedSseHandler!.connect(
        'https://test.example.com/sse',
        { method: 'POST', headers: {}, body: '{}' },
        onEvent,
        onError,
        onComplete
      );
      
      // Simulate message.delta event
      emitEvent('message.delta', { data: JSON.stringify({ content: 'Hello' }) });
      
      expect(onEvent).toHaveBeenCalledWith({
        type: 'message.delta',
        data: JSON.stringify({ content: 'Hello' }),
      });
    });

    it('should handle message.complete events', () => {
      createMobileBridge();
      
      const onEvent = jest.fn();
      const onError = jest.fn();
      const onComplete = jest.fn();
      
      capturedSseHandler!.connect(
        'https://test.example.com/sse',
        { method: 'POST', headers: {}, body: '{}' },
        onEvent,
        onError,
        onComplete
      );
      
      // Simulate message.complete event
      emitEvent('message.complete', { data: JSON.stringify({ content: 'Full message' }) });
      
      expect(onEvent).toHaveBeenCalledWith({
        type: 'message.complete',
        data: JSON.stringify({ content: 'Full message' }),
      });
    });

    it('should handle tool.start events', () => {
      createMobileBridge();
      
      const onEvent = jest.fn();
      const onError = jest.fn();
      const onComplete = jest.fn();
      
      capturedSseHandler!.connect(
        'https://test.example.com/sse',
        { method: 'POST', headers: {}, body: '{}' },
        onEvent,
        onError,
        onComplete
      );
      
      // Simulate tool.start event
      emitEvent('tool.start', { data: JSON.stringify({ tool: 'read_file', args: { path: '/test' } }) });
      
      expect(onEvent).toHaveBeenCalledWith({
        type: 'tool.start',
        data: JSON.stringify({ tool: 'read_file', args: { path: '/test' } }),
      });
    });

    it('should handle tool.complete events', () => {
      createMobileBridge();
      
      const onEvent = jest.fn();
      const onError = jest.fn();
      const onComplete = jest.fn();
      
      capturedSseHandler!.connect(
        'https://test.example.com/sse',
        { method: 'POST', headers: {}, body: '{}' },
        onEvent,
        onError,
        onComplete
      );
      
      // Simulate tool.complete event
      emitEvent('tool.complete', { data: JSON.stringify({ result: 'file content' }) });
      
      expect(onEvent).toHaveBeenCalledWith({
        type: 'tool.complete',
        data: JSON.stringify({ result: 'file content' }),
      });
    });

    it('should handle done event and complete the connection', () => {
      createMobileBridge();
      
      const onEvent = jest.fn();
      const onError = jest.fn();
      const onComplete = jest.fn();
      
      capturedSseHandler!.connect(
        'https://test.example.com/sse',
        { method: 'POST', headers: {}, body: '{}' },
        onEvent,
        onError,
        onComplete
      );
      
      // Simulate done event
      emitEvent('done', { data: '{}' });
      
      expect(onEvent).toHaveBeenCalledWith({
        type: 'done',
        data: '{}',
      });
      expect(mockEventSource.close).toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalled();
    });

    it('should handle error events', () => {
      createMobileBridge();
      
      const onEvent = jest.fn();
      const onError = jest.fn();
      const onComplete = jest.fn();
      
      capturedSseHandler!.connect(
        'https://test.example.com/sse',
        { method: 'POST', headers: {}, body: '{}' },
        onEvent,
        onError,
        onComplete
      );
      
      // Simulate error event
      emitEvent('error', { message: 'Connection failed' });
      
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(onError.mock.calls[0][0].message).toBe('Connection failed');
    });

    it('should handle JSON error responses from server', () => {
      createMobileBridge();
      
      const onEvent = jest.fn();
      const onError = jest.fn();
      const onComplete = jest.fn();
      
      capturedSseHandler!.connect(
        'https://test.example.com/sse',
        { method: 'POST', headers: {}, body: '{}' },
        onEvent,
        onError,
        onComplete
      );
      
      // Simulate error with JSON message
      emitEvent('error', { message: JSON.stringify({ error: 'API rate limit exceeded' }) });
      
      expect(onError).toHaveBeenCalled();
      expect(onError.mock.calls[0][0].message).toBe('API rate limit exceeded');
    });

    it('should handle SSE error events with data field (agent server errors)', () => {
      createMobileBridge();
      
      const onEvent = jest.fn();
      const onError = jest.fn();
      const onComplete = jest.fn();
      
      capturedSseHandler!.connect(
        'https://test.example.com/sse',
        { method: 'POST', headers: {}, body: '{}' },
        onEvent,
        onError,
        onComplete
      );
      
      // Simulate error event from agent server (has data field with error JSON)
      emitEvent('error', { data: JSON.stringify({ error: 'No provider available. Register a provider plugin or call setProvider().' }) });
      
      expect(onError).toHaveBeenCalled();
      expect(onError.mock.calls[0][0].message).toBe('No provider available. Register a provider plugin or call setProvider().');
    });

    it('should handle "session busy" error silently', () => {
      createMobileBridge();
      
      const onEvent = jest.fn();
      const onError = jest.fn();
      const onComplete = jest.fn();
      
      capturedSseHandler!.connect(
        'https://test.example.com/sse',
        { method: 'POST', headers: {}, body: '{}' },
        onEvent,
        onError,
        onComplete
      );
      
      // Simulate "session busy" error
      emitEvent('error', { message: 'Session is already processing a request' });
      
      // Should not call onError for session busy
      expect(onError).not.toHaveBeenCalled();
      // Should still complete
      expect(onComplete).toHaveBeenCalled();
    });

    it('should handle abort callback', () => {
      createMobileBridge();
      
      const onEvent = jest.fn();
      const onError = jest.fn();
      const onComplete = jest.fn();
      
      const abort = capturedSseHandler!.connect(
        'https://test.example.com/sse',
        { method: 'POST', headers: {}, body: '{}' },
        onEvent,
        onError,
        onComplete
      );
      
      expect(abort).toBeInstanceOf(Function);
      
      // Call abort
      abort();
      
      expect(mockEventSource.close).toHaveBeenCalled();
    });

    it('should handle close event without calling onComplete twice', () => {
      createMobileBridge();
      
      const onEvent = jest.fn();
      const onError = jest.fn();
      const onComplete = jest.fn();
      
      capturedSseHandler!.connect(
        'https://test.example.com/sse',
        { method: 'POST', headers: {}, body: '{}' },
        onEvent,
        onError,
        onComplete
      );
      
      // Simulate receiving an event first (so receivedEvents = true)
      emitEvent('message.delta', { data: '{}' });
      
      // Simulate done event (which calls onComplete)
      emitEvent('done', { data: '{}' });
      
      // Simulate close event (should not call onComplete again)
      emitEvent('close');
      
      // onComplete should only be called once
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('should handle close event when no events received', () => {
      createMobileBridge();
      
      const onEvent = jest.fn();
      const onError = jest.fn();
      const onComplete = jest.fn();
      
      capturedSseHandler!.connect(
        'https://test.example.com/sse',
        { method: 'POST', headers: {}, body: '{}' },
        onEvent,
        onError,
        onComplete
      );
      
      // Simulate close event without receiving any events
      emitEvent('close');
      
      // onComplete is still called to resolve the Promise (so it doesn't hang)
      // The BridgeCore will handle whether to emit UI events based on content
      expect(onComplete).toHaveBeenCalled();
    });

    it('should handle generic message events as fallback', () => {
      createMobileBridge();
      
      const onEvent = jest.fn();
      const onError = jest.fn();
      const onComplete = jest.fn();
      
      capturedSseHandler!.connect(
        'https://test.example.com/sse',
        { method: 'POST', headers: {}, body: '{}' },
        onEvent,
        onError,
        onComplete
      );
      
      // Simulate generic message event
      emitEvent('message', { data: JSON.stringify({ type: 'unknown', payload: 'data' }) });
      
      expect(onEvent).toHaveBeenCalledWith({
        type: 'message',
        data: JSON.stringify({ type: 'unknown', payload: 'data' }),
      });
    });
  });

  describe('Event Subscriptions', () => {
    it('should capture onEvent callback from createBridgeCore', () => {
      createMobileBridge();
      
      // The onEvent callback should be captured
      expect(capturedOnEvent).toBeDefined();
      expect(typeof capturedOnEvent).toBe('function');
    });

    it('should call onEvent callback when set', () => {
      createMobileBridge();
      
      // Simulate calling the onEvent callback
      // Note: This tests that the bridge correctly passes the callback to createBridgeCore
      expect(() => {
        capturedOnEvent!('test-project-id', { type: 'message.delta', content: 'test' });
      }).not.toThrow();
    });
  });
});
