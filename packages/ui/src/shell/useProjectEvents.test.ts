import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProjectEvents } from './useProjectEvents';
import { useSessionStore } from '../store/sessionStore';
import { useUIStore } from '../store/uiStore';
import { useProjectStore } from '../store/projectStore';

// Mock the logger
vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

let originalAgentBridge: any;

describe('useProjectEvents', () => {
  let eventHandler: ((event: any) => void) | null;
  let mockUnsubscribe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    eventHandler = null;
    mockUnsubscribe = vi.fn();

    originalAgentBridge = window.agentBridge;
    window.agentBridge = {
      subscribeToProject: vi.fn((_projectId: string, handler: (event: any) => void) => {
        eventHandler = handler;
        return mockUnsubscribe;
      }),
      listSessions: vi.fn().mockResolvedValue([]),
      syncRemoteSessions: vi.fn().mockResolvedValue(undefined),
    } as any;

    // Reset stores
    useSessionStore.setState({
      sessionsByProject: {},
      currentSessionId: null,
      messagesBySession: {},
      processingBySession: {},
      pendingPermissionsBySession: {},
      pendingQuestionsBySession: {},
      errorBySession: {},
      doneBySession: {},
      subagentsBySession: {},
    });
    useUIStore.setState({
      toasts: [],
      middleTabs: [],
    });
    useProjectStore.setState({
      projects: [{ id: 'project-1', name: 'Test', path: '/test', providerType: 'local' } as any],
      currentProjectId: 'project-1',
    });
  });

  afterEach(() => {
    window.agentBridge = originalAgentBridge;
  });

  it('does nothing when projectId is null', () => {
    renderHook(() => useProjectEvents(null));
    expect(window.agentBridge!.subscribeToProject).not.toHaveBeenCalled();
  });

  it('does nothing when agentBridge is not available', () => {
    window.agentBridge = undefined;
    renderHook(() => useProjectEvents('project-1'));
    // Should not throw
  });

  it('subscribes to project events', () => {
    renderHook(() => useProjectEvents('project-1'));
    expect(window.agentBridge!.subscribeToProject).toHaveBeenCalledWith('project-1', expect.any(Function));
  });

  it('unsubscribes when unmounted', () => {
    const { unmount } = renderHook(() => useProjectEvents('project-1'));
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('resubscribes when projectId changes', () => {
    const { rerender } = renderHook(
      ({ projectId }) => useProjectEvents(projectId),
      { initialProps: { projectId: 'project-1' } },
    );

    expect(window.agentBridge!.subscribeToProject).toHaveBeenCalledTimes(1);

    rerender({ projectId: 'project-2' });

    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(window.agentBridge!.subscribeToProject).toHaveBeenCalledTimes(2);
  });

  it('loads sessions for the project on mount', async () => {
    const sessions = [{ id: 's1', title: 'Session 1', createdAt: Date.now() }];
    (window.agentBridge as any).listSessions.mockResolvedValue(sessions);

    renderHook(() => useProjectEvents('project-1'));

    await vi.waitFor(() => {
      expect(window.agentBridge!.listSessions).toHaveBeenCalledWith('project-1');
    });

    await vi.waitFor(() => {
      expect(useSessionStore.getState().sessionsByProject['project-1']).toEqual(sessions);
    });
  });

  describe('event handling', () => {
    it('handles message.start event', () => {
      renderHook(() => useProjectEvents('project-1'));

      act(() => {
        eventHandler!({
          type: 'message.start',
          sessionId: 'session-1',
          messageId: 'msg-1',
        });
      });

      expect(useSessionStore.getState().processingBySession['session-1']).toBe(true);
      const messages = useSessionStore.getState().messagesBySession['session-1'];
      expect(messages).toBeDefined();
      expect(messages![0]!.id).toBe('msg-1');
      expect(messages![0]!.role).toBe('assistant');
    });

    it('handles message.delta event', () => {
      // Set up initial message
      useSessionStore.setState({
        messagesBySession: {
          'session-1': [{
            id: 'msg-1',
            role: 'assistant',
            content: 'Hello',
            contentBlocks: [{ type: 'text', text: 'Hello' }],
            createdAt: Date.now(),
          }],
        },
      });

      renderHook(() => useProjectEvents('project-1'));

      act(() => {
        eventHandler!({
          type: 'message.delta',
          sessionId: 'session-1',
          messageId: 'msg-1',
          delta: ' World',
        });
      });

      const messages = useSessionStore.getState().messagesBySession['session-1'];
      expect(messages![0]!.content).toBe('Hello World');
    });

    it('handles tool.start event', () => {
      useSessionStore.setState({
        messagesBySession: {
          'session-1': [{
            id: 'msg-1',
            role: 'assistant',
            content: '',
            contentBlocks: [],
            createdAt: Date.now(),
          }],
        },
      });

      renderHook(() => useProjectEvents('project-1'));

      act(() => {
        eventHandler!({
          type: 'tool.start',
          sessionId: 'session-1',
          messageId: 'msg-1',
          toolCall: { id: 'tc-1', name: 'readFile', arguments: { path: '/test' } },
        });
      });

      const messages = useSessionStore.getState().messagesBySession['session-1'];
      expect(messages![0]!.toolCalls).toHaveLength(1);
      expect(messages![0]!.toolCalls![0]!.name).toBe('readFile');
      expect(messages![0]!.toolCalls![0]!.status).toBe('running');
    });

    it('handles tool.complete event', () => {
      useSessionStore.setState({
        messagesBySession: {
          'session-1': [{
            id: 'msg-1',
            role: 'assistant',
            content: '',
            contentBlocks: [{ type: 'tool_call', toolCall: { id: 'tc-1', name: 'readFile', arguments: {}, status: 'running' } }],
            toolCalls: [{ id: 'tc-1', name: 'readFile', arguments: {}, status: 'running' as const }],
            createdAt: Date.now(),
          }],
        },
      });

      renderHook(() => useProjectEvents('project-1'));

      act(() => {
        eventHandler!({
          type: 'tool.complete',
          sessionId: 'session-1',
          messageId: 'msg-1',
          toolResult: { id: 'tc-1', result: 'file contents' },
        });
      });

      const messages = useSessionStore.getState().messagesBySession['session-1'];
      expect(messages![0]!.toolCalls![0]!.status).toBe('complete');
      expect(messages![0]!.toolCalls![0]!.result).toBe('file contents');
    });

    it('handles tool.permission.request event', () => {
      renderHook(() => useProjectEvents('project-1'));

      const toolCall = { id: 'tc-1', name: 'writeFile', arguments: { path: '/test' } };
      act(() => {
        eventHandler!({
          type: 'tool.permission.request',
          sessionId: 'session-1',
          toolCall,
        });
      });

      expect(useSessionStore.getState().pendingPermissionsBySession['session-1']).toEqual(toolCall);
    });

    it('handles tool.permission.granted event', () => {
      useSessionStore.setState({
        pendingPermissionsBySession: {
          'session-1': { id: 'tc-1', name: 'writeFile', arguments: {} } as any,
        },
      });

      renderHook(() => useProjectEvents('project-1'));

      act(() => {
        eventHandler!({
          type: 'tool.permission.granted',
          sessionId: 'session-1',
        });
      });

      expect(useSessionStore.getState().pendingPermissionsBySession['session-1']).toBeNull();
    });

    it('handles question.request event', () => {
      renderHook(() => useProjectEvents('project-1'));

      act(() => {
        eventHandler!({
          type: 'question.request',
          sessionId: 'session-1',
          questionId: 'q-1',
          question: 'Which option?',
          options: ['a', 'b'],
          multiple: false,
          allowFreeform: true,
        });
      });

      const pending = useSessionStore.getState().pendingQuestionsBySession['session-1'];
      expect(pending).toBeDefined();
      expect(pending!.questionId).toBe('q-1');
      expect(pending!.question).toBe('Which option?');
    });

    it('handles session.title.updated event', () => {
      useSessionStore.setState({
        sessionsByProject: {
          'project-1': [{ id: 'session-1', title: 'Old Title', createdAt: Date.now() } as any],
        },
      });

      renderHook(() => useProjectEvents('project-1'));

      act(() => {
        eventHandler!({
          type: 'session.title.updated',
          sessionId: 'session-1',
          title: 'New Title',
        });
      });

      const sessions = useSessionStore.getState().sessionsByProject['project-1'];
      expect(sessions![0]!.title).toBe('New Title');
    });

    it('handles done event', () => {
      useSessionStore.setState({
        processingBySession: { 'session-1': true },
        currentSessionId: 'other-session',
      });

      renderHook(() => useProjectEvents('project-1'));

      act(() => {
        eventHandler!({
          type: 'done',
          sessionId: 'session-1',
        });
      });

      expect(useSessionStore.getState().processingBySession['session-1']).toBe(false);
      expect(useSessionStore.getState().doneBySession['session-1']).toBe(true);
    });

    it('does not set done indicator when done event is for current session', () => {
      useSessionStore.setState({
        processingBySession: { 'session-1': true },
        currentSessionId: 'session-1',
      });

      renderHook(() => useProjectEvents('project-1'));

      act(() => {
        eventHandler!({
          type: 'done',
          sessionId: 'session-1',
        });
      });

      expect(useSessionStore.getState().processingBySession['session-1']).toBe(false);
      expect(useSessionStore.getState().doneBySession['session-1']).toBeFalsy();
    });

    it('handles error event', () => {
      useSessionStore.setState({
        processingBySession: { 'session-1': true },
      });

      renderHook(() => useProjectEvents('project-1'));

      act(() => {
        eventHandler!({
          type: 'error',
          sessionId: 'session-1',
          error: 'Something went wrong',
        });
      });

      expect(useSessionStore.getState().processingBySession['session-1']).toBe(false);
      expect(useSessionStore.getState().errorBySession['session-1']).toBe('Something went wrong');
    });

    it('handles setup.start event with toast', () => {
      renderHook(() => useProjectEvents('project-1'));

      act(() => {
        eventHandler!({
          type: 'setup.start',
          component: 'mcp',
          message: 'Setting up MCP...',
        });
      });

      const toasts = useUIStore.getState().toasts;
      expect(toasts.some(t => t.message === 'Setting up MCP...')).toBe(true);
    });

    it('handles setup.complete event', () => {
      // Add setup toast first
      useUIStore.setState({
        toasts: [{ id: 'setup-mcp', message: 'Setting up...', type: 'info' as any, loading: true }],
      });

      renderHook(() => useProjectEvents('project-1'));

      act(() => {
        eventHandler!({
          type: 'setup.complete',
          component: 'mcp',
          message: 'MCP ready',
        });
      });

      const toasts = useUIStore.getState().toasts;
      // The setup toast should be removed, and a success toast added
      expect(toasts.some(t => t.message === 'MCP ready' && t.type === 'success')).toBe(true);
    });

    it('handles subagent.start event', () => {
      renderHook(() => useProjectEvents('project-1'));

      act(() => {
        eventHandler!({
          type: 'subagent.start',
          sessionId: 'sub-1',
          parentSessionId: 'session-1',
          description: 'Analyzing code',
          async: false,
        });
      });

      const subagents = useSessionStore.getState().subagentsBySession['session-1'];
      expect(subagents).toBeDefined();
      expect(subagents![0]!.sessionId).toBe('sub-1');
      expect(subagents![0]!.status).toBe('running');
    });

    it('handles subagent.complete event', () => {
      useSessionStore.setState({
        subagentsBySession: {
          'session-1': [{ sessionId: 'sub-1', parentSessionId: 'session-1', status: 'running', description: 'Test' } as any],
        },
      });

      renderHook(() => useProjectEvents('project-1'));

      act(() => {
        eventHandler!({
          type: 'subagent.complete',
          sessionId: 'sub-1',
          parentSessionId: 'session-1',
          result: 'Done',
        });
      });

      const subagents = useSessionStore.getState().subagentsBySession['session-1'];
      expect(subagents![0]!.status).toBe('completed');
    });

    it('handles todos.updated event', () => {
      renderHook(() => useProjectEvents('project-1'));

      const todos = [{ id: 't1', title: 'Fix bug', status: 'pending' }];
      act(() => {
        eventHandler!({
          type: 'todos.updated',
          sessionId: 'session-1',
          todos,
        });
      });

      expect(useSessionStore.getState().todosBySession?.['session-1']).toEqual(todos);
    });

    it('handles browser.created event', () => {
      renderHook(() => useProjectEvents('project-1'));

      act(() => {
        eventHandler!({
          type: 'browser.created',
          sessionId: 'session-1',
          browserId: 'b-1',
          url: 'http://localhost:3000',
        });
      });

      const tabs = useUIStore.getState().middleTabs;
      expect(tabs.some(t => t.id === 'browser:b-1')).toBe(true);
    });
  });
});
