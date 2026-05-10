import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { useDirectorEvents } from './useDirectorEvents';
import { useDirectorStore } from '../store/directorStore';
import { useUIStore } from '../store/uiStore';
import { PlatformProvider, type PlatformAdapter } from '../platform/PlatformContext';

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

describe('useDirectorEvents', () => {
  let directorEventHandler: ((event: any) => void) | null;
  let mockUnsubscribe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    directorEventHandler = null;
    mockUnsubscribe = vi.fn();

    originalAgentBridge = window.agentBridge;
    window.agentBridge = {
      directorSubscribeToEvents: vi.fn((handler: (event: any) => void) => {
        directorEventHandler = handler;
        return mockUnsubscribe;
      }),
    } as any;

    // Reset stores
    useDirectorStore.setState({
      sessions: [],
      currentSessionId: null,
      messagesBySession: {},
      processingBySession: {},
      pendingPermissionsBySession: {},
      pendingQuestionsBySession: {},
      errorBySession: {},
      doneBySession: {},
    });
    useUIStore.setState({
      activeScreen: 'project',
      themeMode: 'system',
      toasts: [],
    });
  });

  afterEach(() => {
    window.agentBridge = originalAgentBridge;
  });

  it('subscribes to director events on mount', () => {
    renderHook(() => useDirectorEvents());
    expect(window.agentBridge!.directorSubscribeToEvents).toHaveBeenCalledWith(expect.any(Function));
  });

  it('does nothing when agentBridge is not available', () => {
    window.agentBridge = undefined;
    renderHook(() => useDirectorEvents());
    // Should not throw
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useDirectorEvents());
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  describe('director event handling', () => {
    it('handles message.start event', () => {
      renderHook(() => useDirectorEvents());

      act(() => {
        directorEventHandler!({
          type: 'message.start',
          sessionId: 'dir-session-1',
          messageId: 'msg-1',
        });
      });

      expect(useDirectorStore.getState().processingBySession['dir-session-1']).toBe(true);
      const messages = useDirectorStore.getState().messagesBySession['dir-session-1'];
      expect(messages).toBeDefined();
      expect(messages![0]!.id).toBe('msg-1');
      expect(messages![0]!.role).toBe('assistant');
    });

    it('handles message.delta event', () => {
      useDirectorStore.setState({
        messagesBySession: {
          'dir-session-1': [{
            id: 'msg-1',
            role: 'assistant',
            content: 'Hello',
            contentBlocks: [{ type: 'text', text: 'Hello' }],
            createdAt: Date.now(),
          }],
        },
      });

      renderHook(() => useDirectorEvents());

      act(() => {
        directorEventHandler!({
          type: 'message.delta',
          sessionId: 'dir-session-1',
          messageId: 'msg-1',
          delta: ' World',
        });
      });

      const messages = useDirectorStore.getState().messagesBySession['dir-session-1'];
      expect(messages![0]!.content).toBe('Hello World');
    });

    it('handles tool.start event', () => {
      useDirectorStore.setState({
        messagesBySession: {
          'dir-session-1': [{
            id: 'msg-1',
            role: 'assistant',
            content: '',
            contentBlocks: [],
            createdAt: Date.now(),
          }],
        },
      });

      renderHook(() => useDirectorEvents());

      act(() => {
        directorEventHandler!({
          type: 'tool.start',
          sessionId: 'dir-session-1',
          messageId: 'msg-1',
          toolCall: { id: 'tc-1', name: 'navigate', arguments: { target: 'settings' } },
        });
      });

      const messages = useDirectorStore.getState().messagesBySession['dir-session-1'];
      expect(messages![0]!.toolCalls).toHaveLength(1);
      expect(messages![0]!.toolCalls![0]!.name).toBe('navigate');
    });

    it('handles done event', () => {
      useDirectorStore.setState({
        processingBySession: { 'dir-session-1': true },
        currentSessionId: 'other-session',
      });

      renderHook(() => useDirectorEvents());

      act(() => {
        directorEventHandler!({
          type: 'done',
          sessionId: 'dir-session-1',
        });
      });

      expect(useDirectorStore.getState().processingBySession['dir-session-1']).toBe(false);
      expect(useDirectorStore.getState().doneBySession['dir-session-1']).toBe(true);
    });

    it('handles error event with toast', () => {
      renderHook(() => useDirectorEvents());

      act(() => {
        directorEventHandler!({
          type: 'error',
          sessionId: 'dir-session-1',
          error: 'Director error occurred',
        });
      });

      expect(useDirectorStore.getState().processingBySession['dir-session-1']).toBe(false);
      expect(useDirectorStore.getState().errorBySession['dir-session-1']).toBe('Director error occurred');
      expect(useUIStore.getState().toasts.some(t => t.message === 'Director error occurred')).toBe(true);
    });

    it('handles session.title.updated event', () => {
      useDirectorStore.setState({
        sessions: [{ id: 'dir-session-1', title: 'Old Title', createdAt: Date.now() } as any],
      });

      renderHook(() => useDirectorEvents());

      act(() => {
        directorEventHandler!({
          type: 'session.title.updated',
          sessionId: 'dir-session-1',
          title: 'New Title',
        });
      });

      const sessions = useDirectorStore.getState().sessions;
      expect(sessions[0]!.title).toBe('New Title');
    });

    it('handles tool.permission.request event', () => {
      renderHook(() => useDirectorEvents());

      const toolCall = { id: 'tc-1', name: 'writeFile', arguments: {} };
      act(() => {
        directorEventHandler!({
          type: 'tool.permission.request',
          sessionId: 'dir-session-1',
          toolCall,
        });
      });

      expect(useDirectorStore.getState().pendingPermissionsBySession['dir-session-1']).toEqual(toolCall);
    });

    it('handles tool.permission.denied event', () => {
      useDirectorStore.setState({
        pendingPermissionsBySession: {
          'dir-session-1': { id: 'tc-1', name: 'writeFile', arguments: {} } as any,
        },
      });

      renderHook(() => useDirectorEvents());

      act(() => {
        directorEventHandler!({
          type: 'tool.permission.denied',
          sessionId: 'dir-session-1',
        });
      });

      expect(useDirectorStore.getState().pendingPermissionsBySession['dir-session-1']).toBeNull();
    });
  });

  describe('director navigation', () => {
    it('handles director:navigate to projects', () => {
      let navigateHandler: ((target: string) => void) | null = null;
      const adapter: PlatformAdapter = {
        platform: 'desktop',
        onDirectorNavigate: (callback: (target: string) => void) => {
          navigateHandler = callback;
          return () => { navigateHandler = null; };
        },
      };

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(PlatformProvider, { adapter, children });

      renderHook(() => useDirectorEvents(), { wrapper });

      act(() => {
        navigateHandler!('projects');
      });

      expect(useUIStore.getState().activeScreen).toBe('project');
    });

    it('handles director:navigate to settings', () => {
      let navigateHandler: ((target: string) => void) | null = null;
      const adapter: PlatformAdapter = {
        platform: 'desktop',
        onDirectorNavigate: (callback: (target: string) => void) => {
          navigateHandler = callback;
          return () => { navigateHandler = null; };
        },
      };

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(PlatformProvider, { adapter, children });

      renderHook(() => useDirectorEvents(), { wrapper });

      act(() => {
        navigateHandler!('settings');
      });

      expect(useUIStore.getState().activeScreen).toBe('settings');
    });

    it('handles director:navigate to agents', () => {
      let navigateHandler: ((target: string) => void) | null = null;
      const adapter: PlatformAdapter = {
        platform: 'desktop',
        onDirectorNavigate: (callback: (target: string) => void) => {
          navigateHandler = callback;
          return () => { navigateHandler = null; };
        },
      };

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(PlatformProvider, { adapter, children });

      renderHook(() => useDirectorEvents(), { wrapper });

      act(() => {
        navigateHandler!('agents');
      });

      expect(useUIStore.getState().activeScreen).toBe('agents');
    });
  });

  describe('director theme changes', () => {
    it('handles director:set-theme to dark', () => {
      let themeHandler: ((mode: string) => void) | null = null;
      const adapter: PlatformAdapter = {
        platform: 'desktop',
        onDirectorSetTheme: (callback: (mode: string) => void) => {
          themeHandler = callback;
          return () => { themeHandler = null; };
        },
      };

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(PlatformProvider, { adapter, children });

      renderHook(() => useDirectorEvents(), { wrapper });

      act(() => {
        themeHandler!('dark');
      });

      expect(useUIStore.getState().themeMode).toBe('dark');
    });

    it('handles director:set-theme to light', () => {
      let themeHandler: ((mode: string) => void) | null = null;
      const adapter: PlatformAdapter = {
        platform: 'desktop',
        onDirectorSetTheme: (callback: (mode: string) => void) => {
          themeHandler = callback;
          return () => { themeHandler = null; };
        },
      };

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(PlatformProvider, { adapter, children });

      renderHook(() => useDirectorEvents(), { wrapper });

      act(() => {
        themeHandler!('light');
      });

      expect(useUIStore.getState().themeMode).toBe('light');
    });

    it('ignores invalid theme modes', () => {
      const originalThemeMode = useUIStore.getState().themeMode;
      let themeHandler: ((mode: string) => void) | null = null;
      const adapter: PlatformAdapter = {
        platform: 'desktop',
        onDirectorSetTheme: (callback: (mode: string) => void) => {
          themeHandler = callback;
          return () => { themeHandler = null; };
        },
      };

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(PlatformProvider, { adapter, children });

      renderHook(() => useDirectorEvents(), { wrapper });

      act(() => {
        themeHandler!('invalid-theme');
      });

      expect(useUIStore.getState().themeMode).toBe(originalThemeMode);
    });
  });
});
