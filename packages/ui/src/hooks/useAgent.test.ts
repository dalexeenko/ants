import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAgent } from './useAgent';
import { useSessionStore } from '../store/sessionStore';
import { useUIStore } from '../store/uiStore';
import type { Session, Message, ToolCall, PermissionResponse } from '../agent/types';

// Mock the window.agentBridge
const mockBridge = {
  subscribeToProject: vi.fn((_projectId: string, _callback: (event: unknown) => void) => vi.fn()),
  listSessions: vi.fn((): Promise<Session[]> => Promise.resolve([])),
  createSession: vi.fn((): Promise<Session> =>
    Promise.resolve({
      id: 'session-1',
      title: 'New Session',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  ),
  getMessages: vi.fn((): Promise<Message[]> => Promise.resolve([])),
  sendMessage: vi.fn((): Promise<void> => Promise.resolve()),
  respondToPermission: vi.fn((_projectId: string, _sessionId: string, _toolCallId: string, _response: PermissionResponse): Promise<void> => Promise.resolve()),
  cancelMessage: vi.fn((): Promise<void> => Promise.resolve()),
};

// Setup window.agentBridge - using Object.defineProperty for proper typing
const originalWindow = globalThis.window;

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: { agentBridge: mockBridge },
    writable: true,
  });

  // Reset mocks
  vi.clearAllMocks();

  // Reset stores
  useSessionStore.setState({
    sessionsByProject: {},
    currentSessionId: null,
    messagesBySession: {},
    processingBySession: {},
    pendingPermissionsBySession: {},
    pendingQuestionsBySession: {},
  });

  useUIStore.setState({
    toasts: [],
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: originalWindow,
    writable: true,
  });
});

describe('useAgent', () => {
  describe('initialization', () => {
    it('should return empty sessions when no projectId is provided', () => {
      const { result } = renderHook(() => useAgent(undefined));

      expect(result.current.sessions).toEqual([]);
      expect(result.current.currentSession).toBeUndefined();
      expect(result.current.messages).toEqual([]);
      expect(result.current.isProcessing).toBe(false);
      expect(result.current.pendingPermission).toBeNull();
    });

    it('should subscribe to project events on mount', () => {
      renderHook(() => useAgent('project-1'));

      expect(mockBridge.subscribeToProject).toHaveBeenCalledWith(
        'project-1',
        expect.any(Function)
      );
    });

    it('should load sessions on mount', async () => {
      const testSession: Session = {
        id: 'session-1',
        title: 'Test Session',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      mockBridge.listSessions.mockResolvedValue([testSession]);

      renderHook(() => useAgent('project-1'));

      // Wait for the async call
      await vi.waitFor(() => {
        expect(mockBridge.listSessions).toHaveBeenCalledWith('project-1');
      });
    });

    it('should unsubscribe when unmounted', () => {
      const unsubscribe = vi.fn();
      mockBridge.subscribeToProject.mockReturnValue(unsubscribe);

      const { unmount } = renderHook(() => useAgent('project-1'));
      unmount();

      expect(unsubscribe).toHaveBeenCalled();
    });

    it('should not subscribe when projectId is undefined', () => {
      renderHook(() => useAgent(undefined));

      expect(mockBridge.subscribeToProject).not.toHaveBeenCalled();
    });
  });

  describe('createSession', () => {
    it('should create a new session via bridge', async () => {
      const { result } = renderHook(() => useAgent('project-1'));

      await act(async () => {
        await result.current.createSession({ title: 'New Session' });
      });

      expect(mockBridge.createSession).toHaveBeenCalledWith('project-1', {
        title: 'New Session',
      });
    });

    it('should add the created session to the store', async () => {
      // listSessions returns empty, so only our created session should be there
      mockBridge.listSessions.mockResolvedValue([]);

      const { result } = renderHook(() => useAgent('project-1'));

      // Wait for mount effects to complete
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      await act(async () => {
        await result.current.createSession();
      });

      expect(result.current.sessions).toHaveLength(1);
      expect(result.current.sessions[0].id).toBe('session-1');
    });

    it('should set the created session as current', async () => {
      const { result } = renderHook(() => useAgent('project-1'));

      await act(async () => {
        await result.current.createSession();
      });

      expect(result.current.currentSession?.id).toBe('session-1');
    });

    it('should show error toast when creation fails', async () => {
      mockBridge.createSession.mockRejectedValue(new Error('Failed'));

      const { result } = renderHook(() => useAgent('project-1'));

      await act(async () => {
        await result.current.createSession();
      });

      const toasts = useUIStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].type).toBe('error');
    });

    it('should not create session without projectId', async () => {
      const { result } = renderHook(() => useAgent(undefined));

      await act(async () => {
        await result.current.createSession();
      });

      expect(mockBridge.createSession).not.toHaveBeenCalled();
    });
  });

  describe('sendMessage', () => {
    const setupSessionState = () => {
      const session: Session = {
        id: 'session-1',
        title: 'Test',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      // Mock listSessions to return our session
      mockBridge.listSessions.mockResolvedValue([session]);
      useSessionStore.setState({
        sessionsByProject: {
          'project-1': [session],
        },
        currentSessionId: 'session-1',
        messagesBySession: { 'session-1': [] },
        processingBySession: {},
        pendingPermissionsBySession: {},
      });
    };

    it('should add user message optimistically', async () => {
      setupSessionState();

      const { result } = renderHook(() => useAgent('project-1'));

      await act(async () => {
        await result.current.sendMessage('Hello');
      });

      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].role).toBe('user');
      expect(result.current.messages[0].content).toBe('Hello');
    });

    it('should call bridge sendMessage', async () => {
      setupSessionState();

      const { result } = renderHook(() => useAgent('project-1'));

      await act(async () => {
        await result.current.sendMessage('Hello', { attachments: [] });
      });

      expect(mockBridge.sendMessage).toHaveBeenCalledWith(
        'project-1',
        'session-1',
        'Hello',
        { attachments: [] }
      );
    });

    it('should not send message without current session', async () => {
      const { result } = renderHook(() => useAgent('project-1'));

      await act(async () => {
        await result.current.sendMessage('Hello');
      });

      expect(mockBridge.sendMessage).not.toHaveBeenCalled();
    });

    it('should show error toast when send fails', async () => {
      setupSessionState();
      mockBridge.sendMessage.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useAgent('project-1'));

      await act(async () => {
        await result.current.sendMessage('Hello');
      });

      const toasts = useUIStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].type).toBe('error');
    });
  });

  describe('selectSession', () => {
    it('should set current session', async () => {
      const sessions: Session[] = [
        {
          id: 'session-1',
          title: 'Test',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: 'session-2',
          title: 'Test 2',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];
      // Prevent listSessions from overwriting our state
      mockBridge.listSessions.mockResolvedValue(sessions);

      useSessionStore.setState({
        sessionsByProject: { 'project-1': sessions },
        currentSessionId: 'session-1',
        messagesBySession: { 'session-1': [], 'session-2': [] },
        processingBySession: {},
        pendingPermissionsBySession: {},
      });

      const { result } = renderHook(() => useAgent('project-1'));

      await act(async () => {
        await result.current.selectSession('session-2');
      });

      expect(result.current.currentSession?.id).toBe('session-2');
    });

    it('should load messages for session if not cached', async () => {
      const session: Session = {
        id: 'session-1',
        title: 'Test',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      useSessionStore.setState({
        sessionsByProject: { 'project-1': [session] },
        currentSessionId: null,
        messagesBySession: {},
        processingBySession: {},
        pendingPermissionsBySession: {},
      });

      const testMessage: Message = {
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        createdAt: Date.now(),
      };
      mockBridge.getMessages.mockResolvedValue([testMessage]);

      const { result } = renderHook(() => useAgent('project-1'));

      await act(async () => {
        await result.current.selectSession('session-1');
      });

      expect(mockBridge.getMessages).toHaveBeenCalledWith('project-1', 'session-1');
    });

    it('should not load messages if already cached', async () => {
      const session: Session = {
        id: 'session-1',
        title: 'Test',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const message: Message = {
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        createdAt: Date.now(),
      };
      useSessionStore.setState({
        sessionsByProject: { 'project-1': [session] },
        currentSessionId: null,
        messagesBySession: { 'session-1': [message] },
        processingBySession: {},
        pendingPermissionsBySession: {},
      });

      const { result } = renderHook(() => useAgent('project-1'));

      await act(async () => {
        await result.current.selectSession('session-1');
      });

      expect(mockBridge.getMessages).not.toHaveBeenCalled();
    });
  });

  describe('respondToPermission', () => {
    const pendingToolCall: ToolCall = {
      id: 'tool-1',
      name: 'readFile',
      arguments: { path: '/test' },
      status: 'pending',
    };

    it('should call bridge respondToPermission', async () => {
      useSessionStore.setState({
        sessionsByProject: { 'project-1': [] },
        currentSessionId: 'session-1',
        messagesBySession: {},
        processingBySession: {},
        pendingPermissionsBySession: { 'session-1': pendingToolCall },
      });

      const { result } = renderHook(() => useAgent('project-1'));
      const response: PermissionResponse = 'allow_once';

      await act(async () => {
        await result.current.respondToPermission(response);
      });

      expect(mockBridge.respondToPermission).toHaveBeenCalledWith(
        'project-1',
        'session-1',
        'tool-1',
        'allow_once'
      );
    });

    it('should clear pending permission after response', async () => {
      useSessionStore.setState({
        sessionsByProject: { 'project-1': [] },
        currentSessionId: 'session-1',
        messagesBySession: {},
        processingBySession: {},
        pendingPermissionsBySession: { 'session-1': pendingToolCall },
      });

      const { result } = renderHook(() => useAgent('project-1'));
      const response: PermissionResponse = 'allow_once';

      await act(async () => {
        await result.current.respondToPermission(response);
      });

      expect(mockBridge.respondToPermission).toHaveBeenCalledWith(
        'project-1',
        'session-1',
        'tool-1',
        'allow_once'
      );
    });

    it('should clear pending permission after response', async () => {
      useSessionStore.setState({
        sessionsByProject: { 'project-1': [] },
        currentSessionId: 'session-1',
        messagesBySession: {},
        processingBySession: { 'session-1': true },
        pendingPermissionsBySession: {},
      });

      const { result } = renderHook(() => useAgent('project-1'));
      expect(result.current.isProcessing).toBe(true);

      await act(async () => {
        await result.current.cancelMessage();
      });

      expect(result.current.isProcessing).toBe(false);
    });
  });

  describe('agent event handling', () => {
    it('should handle message.start event', async () => {
      let eventHandler: (event: unknown) => void = () => {};
      mockBridge.subscribeToProject.mockImplementation(
        (_projectId: string, handler: (event: unknown) => void) => {
          eventHandler = handler;
          return vi.fn();
        }
      );

      const session: Session = {
        id: 'session-1',
        title: 'Test',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      useSessionStore.setState({
        sessionsByProject: { 'project-1': [session] },
        currentSessionId: 'session-1',
        messagesBySession: {},
        processingBySession: {},
        pendingPermissionsBySession: {},
      });

      const { result } = renderHook(() => useAgent('project-1'));

      act(() => {
        eventHandler({
          type: 'message.start',
          sessionId: 'session-1',
          messageId: 'msg-1',
        });
      });

      expect(result.current.isProcessing).toBe(true);
    });

    it('should handle message.complete event', async () => {
      let eventHandler: (event: unknown) => void = () => {};
      mockBridge.subscribeToProject.mockImplementation(
        (_projectId: string, handler: (event: unknown) => void) => {
          eventHandler = handler;
          return vi.fn();
        }
      );

      const session: Session = {
        id: 'session-1',
        title: 'Test',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const message: Message = {
        id: 'msg-1',
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
      };
      useSessionStore.setState({
        sessionsByProject: { 'project-1': [session] },
        currentSessionId: 'session-1',
        messagesBySession: { 'session-1': [message] },
        processingBySession: { 'session-1': true },
        pendingPermissionsBySession: {},
      });

      const { result } = renderHook(() => useAgent('project-1'));

      act(() => {
        eventHandler({
          type: 'message.complete',
          sessionId: 'session-1',
          messageId: 'msg-1',
          content: 'Hello, I am an assistant',
        });
      });

      // message.complete no longer clears processing — only 'done' does
      expect(result.current.isProcessing).toBe(true);
      expect(result.current.messages[0].content).toBe('Hello, I am an assistant');
    });

    it('should handle done event and clear processing', async () => {
      let eventHandler: (event: unknown) => void = () => {};
      mockBridge.subscribeToProject.mockImplementation(
        (_projectId: string, handler: (event: unknown) => void) => {
          eventHandler = handler;
          return vi.fn();
        }
      );

      useSessionStore.setState({
        sessionsByProject: { 'project-1': [] },
        currentSessionId: 'session-1',
        messagesBySession: {},
        processingBySession: { 'session-1': true },
        pendingPermissionsBySession: {},
      });

      const { result } = renderHook(() => useAgent('project-1'));

      act(() => {
        eventHandler({
          type: 'done',
          sessionId: 'session-1',
        });
      });

      expect(result.current.isProcessing).toBe(false);
      // doneBySession is NOT set to true for the current session — it's only set
      // for background sessions so the UI can show a "done" badge indicator
      expect(useSessionStore.getState().doneBySession['session-1']).toBeFalsy();
    });

    it('should set doneBySession for background session done events', async () => {
      let eventHandler: (event: unknown) => void = () => {};
      mockBridge.subscribeToProject.mockImplementation(
        (_projectId: string, handler: (event: unknown) => void) => {
          eventHandler = handler;
          return vi.fn();
        }
      );

      useSessionStore.setState({
        sessionsByProject: { 'project-1': [] },
        currentSessionId: 'session-1',
        messagesBySession: {},
        processingBySession: { 'session-2': true },
        pendingPermissionsBySession: {},
      });

      renderHook(() => useAgent('project-1'));

      act(() => {
        eventHandler({
          type: 'done',
          sessionId: 'session-2',
        });
      });

      // Background session gets doneBySession set so the sidebar can show a badge
      expect(useSessionStore.getState().doneBySession['session-2']).toBe(true);
    });

    it('should handle error event and show toast', async () => {
      let eventHandler: (event: unknown) => void = () => {};
      mockBridge.subscribeToProject.mockImplementation(
        (_projectId: string, handler: (event: unknown) => void) => {
          eventHandler = handler;
          return vi.fn();
        }
      );

      useSessionStore.setState({
        sessionsByProject: { 'project-1': [] },
        currentSessionId: 'session-1',
        messagesBySession: {},
        processingBySession: { 'session-1': true },
        pendingPermissionsBySession: {},
      });

      renderHook(() => useAgent('project-1'));

      act(() => {
        eventHandler({
          type: 'error',
          sessionId: 'session-1',
          error: 'Something went wrong',
        });
      });

      const toasts = useUIStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].message).toBe('Something went wrong');
      expect(toasts[0].type).toBe('error');
    });

    it('should handle compaction.start event', async () => {
      let eventHandler: (event: unknown) => void = () => {};
      mockBridge.subscribeToProject.mockImplementation(
        (_projectId: string, handler: (event: unknown) => void) => {
          eventHandler = handler;
          return vi.fn();
        }
      );

      const session: Session = {
        id: 'session-1',
        title: 'Test',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      useSessionStore.setState({
        sessionsByProject: { 'project-1': [session] },
        currentSessionId: 'session-1',
        messagesBySession: { 'session-1': [] },
        processingBySession: {},
        pendingPermissionsBySession: {},
      });

      renderHook(() => useAgent('project-1'));

      act(() => {
        eventHandler({
          type: 'compaction.start',
          sessionId: 'session-1',
          stats: { currentTokens: 8000, threshold: 5000, messagesToCompact: 15 },
        });
      });

      const state = useSessionStore.getState();
      expect(state.compactingBySession['session-1']).toBe(true);
      expect(state.compactionMessageIdBySession['session-1']).toBeTruthy();
      // A placeholder compaction message should have been added
      const messages = state.messagesBySession['session-1'];
      expect(messages).toHaveLength(1);
      expect(messages[0].isCompactionSummary).toBe(true);
      expect(messages[0].content).toBe('');
    });

    it('should handle compaction.delta event by appending to compaction message', async () => {
      let eventHandler: (event: unknown) => void = () => {};
      mockBridge.subscribeToProject.mockImplementation(
        (_projectId: string, handler: (event: unknown) => void) => {
          eventHandler = handler;
          return vi.fn();
        }
      );

      const session: Session = {
        id: 'session-1',
        title: 'Test',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      useSessionStore.setState({
        sessionsByProject: { 'project-1': [session] },
        currentSessionId: 'session-1',
        messagesBySession: { 'session-1': [] },
        processingBySession: {},
        pendingPermissionsBySession: {},
      });

      renderHook(() => useAgent('project-1'));

      // First, trigger compaction.start to create the placeholder message
      act(() => {
        eventHandler({
          type: 'compaction.start',
          sessionId: 'session-1',
          stats: { currentTokens: 8000, threshold: 5000, messagesToCompact: 15 },
        });
      });

      const compactionMsgId = useSessionStore.getState().compactionMessageIdBySession['session-1'];

      // Now send deltas
      act(() => {
        eventHandler({
          type: 'compaction.delta',
          sessionId: 'session-1',
          delta: 'Part 1. ',
        });
      });

      act(() => {
        eventHandler({
          type: 'compaction.delta',
          sessionId: 'session-1',
          delta: 'Part 2.',
        });
      });

      const messages = useSessionStore.getState().messagesBySession['session-1'];
      const compactionMsg = messages.find((m: Message) => m.id === compactionMsgId);
      expect(compactionMsg).toBeDefined();
      expect(compactionMsg!.content).toBe('Part 1. Part 2.');
    });

    it('should handle compaction.complete event', async () => {
      let eventHandler: (event: unknown) => void = () => {};
      mockBridge.subscribeToProject.mockImplementation(
        (_projectId: string, handler: (event: unknown) => void) => {
          eventHandler = handler;
          return vi.fn();
        }
      );

      const session: Session = {
        id: 'session-1',
        title: 'Test',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      useSessionStore.setState({
        sessionsByProject: { 'project-1': [session] },
        currentSessionId: 'session-1',
        messagesBySession: { 'session-1': [] },
        processingBySession: {},
        pendingPermissionsBySession: {},
      });

      renderHook(() => useAgent('project-1'));

      // Start compaction
      act(() => {
        eventHandler({
          type: 'compaction.start',
          sessionId: 'session-1',
          stats: { currentTokens: 8000, threshold: 5000, messagesToCompact: 15 },
        });
      });

      expect(useSessionStore.getState().compactingBySession['session-1']).toBe(true);

      // Complete compaction with context usage
      act(() => {
        eventHandler({
          type: 'compaction.complete',
          sessionId: 'session-1',
          compactionId: 'cmp-1',
          stats: { originalTokens: 8000, compactedTokens: 800, messagesPruned: 15, compressionRatio: 0.1 },
          contextUsage: { currentTokens: 2000, maxTokens: 200000 },
        });
      });

      const state = useSessionStore.getState();
      expect(state.compactingBySession['session-1']).toBe(false);
      expect(state.compactionMessageIdBySession['session-1']).toBeNull();
      expect(state.contextUsageBySession['session-1']).toEqual({
        currentTokens: 2000,
        maxTokens: 200000,
      });
    });

    it('should handle compaction.error event and show toast', async () => {
      let eventHandler: (event: unknown) => void = () => {};
      mockBridge.subscribeToProject.mockImplementation(
        (_projectId: string, handler: (event: unknown) => void) => {
          eventHandler = handler;
          return vi.fn();
        }
      );

      const session: Session = {
        id: 'session-1',
        title: 'Test',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      useSessionStore.setState({
        sessionsByProject: { 'project-1': [session] },
        currentSessionId: 'session-1',
        messagesBySession: { 'session-1': [] },
        processingBySession: {},
        pendingPermissionsBySession: {},
      });

      renderHook(() => useAgent('project-1'));

      // Start compaction
      act(() => {
        eventHandler({
          type: 'compaction.start',
          sessionId: 'session-1',
          stats: { currentTokens: 8000, threshold: 5000, messagesToCompact: 15 },
        });
      });

      // Error during compaction
      act(() => {
        eventHandler({
          type: 'compaction.error',
          sessionId: 'session-1',
          error: 'Provider error',
        });
      });

      const state = useSessionStore.getState();
      expect(state.compactingBySession['session-1']).toBe(false);
      expect(state.compactionMessageIdBySession['session-1']).toBeNull();

      // Should show error toast
      const toasts = useUIStore.getState().toasts;
      expect(toasts.length).toBeGreaterThanOrEqual(1);
      const errorToast = toasts.find((t: { message: string }) => t.message.includes('Summarization failed'));
      expect(errorToast).toBeDefined();
      expect(errorToast!.type).toBe('error');
    });

    it('should update context usage from message.complete event', async () => {
      let eventHandler: (event: unknown) => void = () => {};
      mockBridge.subscribeToProject.mockImplementation(
        (_projectId: string, handler: (event: unknown) => void) => {
          eventHandler = handler;
          return vi.fn();
        }
      );

      const session: Session = {
        id: 'session-1',
        title: 'Test',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const message: Message = {
        id: 'msg-1',
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
      };
      useSessionStore.setState({
        sessionsByProject: { 'project-1': [session] },
        currentSessionId: 'session-1',
        messagesBySession: { 'session-1': [message] },
        processingBySession: { 'session-1': true },
        pendingPermissionsBySession: {},
      });

      renderHook(() => useAgent('project-1'));

      act(() => {
        eventHandler({
          type: 'message.complete',
          sessionId: 'session-1',
          messageId: 'msg-1',
          content: 'Hello!',
          contextUsage: { currentTokens: 3000, maxTokens: 200000 },
        });
      });

      const contextUsage = useSessionStore.getState().contextUsageBySession['session-1'];
      expect(contextUsage).toEqual({ currentTokens: 3000, maxTokens: 200000 });
    });

    it('should handle tool.permission.request event', async () => {
      let eventHandler: (event: unknown) => void = () => {};
      mockBridge.subscribeToProject.mockImplementation(
        (_projectId: string, handler: (event: unknown) => void) => {
          eventHandler = handler;
          return vi.fn();
        }
      );

      useSessionStore.setState({
        sessionsByProject: { 'project-1': [] },
        currentSessionId: 'session-1',
        messagesBySession: {},
        processingBySession: {},
        pendingPermissionsBySession: {},
      });

      const { result } = renderHook(() => useAgent('project-1'));

      const toolCall: ToolCall = {
        id: 'tool-1',
        name: 'writeFile',
        arguments: { path: '/test.txt', content: 'hello' },
        status: 'pending',
      };

      act(() => {
        eventHandler({
          type: 'tool.permission.request',
          sessionId: 'session-1',
          toolCall,
        });
      });

      expect(result.current.pendingPermission).toEqual(toolCall);
    });
  });
});
