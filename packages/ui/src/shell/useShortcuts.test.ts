import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { useShortcuts } from './useShortcuts';
import { useUIStore } from '../store/uiStore';
import { useProjectStore } from '../store/projectStore';
import { useSessionStore } from '../store/sessionStore';
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

// Store the original window.agentBridge
let originalAgentBridge: any;

function createMockBridge() {
  return {
    createProject: vi.fn(),
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    cancelMessage: vi.fn(),
    listRemoteServers: vi.fn().mockResolvedValue([]),
    updateRemoteServer: vi.fn(),
    addRemoteServer: vi.fn(),
  };
}

describe('useShortcuts', () => {
  beforeEach(() => {
    originalAgentBridge = window.agentBridge;
    window.agentBridge = createMockBridge() as any;

    // Reset stores
    useUIStore.setState({
      view: 'home',
      activeScreen: 'project',
      toasts: [],
      leftSidebarCollapsed: false,
    });
    useProjectStore.setState({
      projects: [],
      currentProjectId: null,
    });
    useSessionStore.setState({
      sessionsByProject: {},
      currentSessionId: null,
      messagesBySession: {},
      processingBySession: {},
      pendingPermissionsBySession: {},
      pendingQuestionsBySession: {},
      errorBySession: {},
      doneBySession: {},
    });
  });

  afterEach(() => {
    window.agentBridge = originalAgentBridge;
  });

  describe('return value', () => {
    it('returns showKeyboardShortcuts state and setter', () => {
      const { result } = renderHook(() => useShortcuts());

      expect(result.current.showKeyboardShortcuts).toBe(false);
      expect(typeof result.current.setShowKeyboardShortcuts).toBe('function');
    });

    it('allows toggling showKeyboardShortcuts', () => {
      const { result } = renderHook(() => useShortcuts());

      act(() => {
        result.current.setShowKeyboardShortcuts(true);
      });

      expect(result.current.showKeyboardShortcuts).toBe(true);
    });
  });

  describe('platform.onShortcut path', () => {
    it('registers shortcut handlers when platform provides onShortcut', () => {
      const shortcutHandlers = new Map<string, (...args: unknown[]) => void>();
      const adapter: PlatformAdapter = {
        platform: 'desktop',
        onShortcut: (shortcut: string, callback: (...args: unknown[]) => void) => {
          shortcutHandlers.set(shortcut, callback);
          return () => { shortcutHandlers.delete(shortcut); };
        },
      };

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(PlatformProvider, { adapter, children });

      renderHook(() => useShortcuts(), { wrapper });

      // All expected shortcuts should be registered
      expect(shortcutHandlers.has('settings')).toBe(true);
      expect(shortcutHandlers.has('openProject')).toBe(true);
      expect(shortcutHandlers.has('newSession')).toBe(true);
      expect(shortcutHandlers.has('closeSession')).toBe(true);
      expect(shortcutHandlers.has('toggleSidebar')).toBe(true);
      expect(shortcutHandlers.has('prevSession')).toBe(true);
      expect(shortcutHandlers.has('nextSession')).toBe(true);
      expect(shortcutHandlers.has('stop')).toBe(true);
      expect(shortcutHandlers.has('showKeyboardShortcuts')).toBe(true);
    });

    it('settings shortcut sets view to settings', () => {
      const shortcutHandlers = new Map<string, (...args: unknown[]) => void>();
      const adapter: PlatformAdapter = {
        platform: 'desktop',
        onShortcut: (shortcut: string, callback: (...args: unknown[]) => void) => {
          shortcutHandlers.set(shortcut, callback);
          return () => { shortcutHandlers.delete(shortcut); };
        },
      };

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(PlatformProvider, { adapter, children });

      renderHook(() => useShortcuts(), { wrapper });

      act(() => {
        shortcutHandlers.get('settings')!();
      });

      expect(useUIStore.getState().view).toBe('settings');
    });

    it('newSession shortcut creates a session', async () => {
      const mockSession = { id: 'session-1', title: 'Test' };
      (window.agentBridge as any).createSession.mockResolvedValue(mockSession);

      useProjectStore.setState({ currentProjectId: 'project-1' });

      const shortcutHandlers = new Map<string, (...args: unknown[]) => void>();
      const adapter: PlatformAdapter = {
        platform: 'desktop',
        onShortcut: (shortcut: string, callback: (...args: unknown[]) => void) => {
          shortcutHandlers.set(shortcut, callback);
          return () => { shortcutHandlers.delete(shortcut); };
        },
      };

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(PlatformProvider, { adapter, children });

      renderHook(() => useShortcuts(), { wrapper });

      await act(async () => {
        shortcutHandlers.get('newSession')!();
      });

      expect(window.agentBridge!.createSession).toHaveBeenCalledWith('project-1');
    });

    it('toggleSidebar shortcut toggles left sidebar', () => {
      useUIStore.setState({ leftSidebarCollapsed: false });

      const shortcutHandlers = new Map<string, (...args: unknown[]) => void>();
      const adapter: PlatformAdapter = {
        platform: 'desktop',
        onShortcut: (shortcut: string, callback: (...args: unknown[]) => void) => {
          shortcutHandlers.set(shortcut, callback);
          return () => { shortcutHandlers.delete(shortcut); };
        },
      };

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(PlatformProvider, { adapter, children });

      renderHook(() => useShortcuts(), { wrapper });

      act(() => {
        shortcutHandlers.get('toggleSidebar')!();
      });

      expect(useUIStore.getState().leftSidebarCollapsed).toBe(true);
    });

    it('showKeyboardShortcuts shortcut sets state to true', () => {
      const shortcutHandlers = new Map<string, (...args: unknown[]) => void>();
      const adapter: PlatformAdapter = {
        platform: 'desktop',
        onShortcut: (shortcut: string, callback: (...args: unknown[]) => void) => {
          shortcutHandlers.set(shortcut, callback);
          return () => { shortcutHandlers.delete(shortcut); };
        },
      };

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(PlatformProvider, { adapter, children });

      const { result } = renderHook(() => useShortcuts(), { wrapper });

      act(() => {
        shortcutHandlers.get('showKeyboardShortcuts')!();
      });

      expect(result.current.showKeyboardShortcuts).toBe(true);
    });

    it('stop shortcut calls cancelMessage', async () => {
      useProjectStore.setState({ currentProjectId: 'project-1' });

      const shortcutHandlers = new Map<string, (...args: unknown[]) => void>();
      const adapter: PlatformAdapter = {
        platform: 'desktop',
        onShortcut: (shortcut: string, callback: (...args: unknown[]) => void) => {
          shortcutHandlers.set(shortcut, callback);
          return () => { shortcutHandlers.delete(shortcut); };
        },
      };

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(PlatformProvider, { adapter, children });

      renderHook(() => useShortcuts(), { wrapper });

      await act(async () => {
        shortcutHandlers.get('stop')!();
      });

      expect(window.agentBridge!.cancelMessage).toHaveBeenCalledWith('project-1');
    });

    it('cleans up shortcut handlers on unmount', () => {
      const unsubFns: Array<() => void> = [];
      const adapter: PlatformAdapter = {
        platform: 'desktop',
        onShortcut: (_shortcut: string, _callback: (...args: unknown[]) => void) => {
          const unsub = vi.fn();
          unsubFns.push(unsub);
          return unsub;
        },
      };

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(PlatformProvider, { adapter, children });

      const { unmount } = renderHook(() => useShortcuts(), { wrapper });
      const registeredCount = unsubFns.length;
      expect(registeredCount).toBeGreaterThan(0);

      unmount();

      // All unsubscribe functions should have been called
      for (const unsub of unsubFns) {
        expect(unsub).toHaveBeenCalled();
      }
    });
  });

  describe('DOM keydown fallback (web platform)', () => {
    it('handles Cmd+, for settings', () => {
      renderHook(() => useShortcuts());

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: ',',
          metaKey: true,
          bubbles: true,
        }));
      });

      expect(useUIStore.getState().activeScreen).toBe('settings');
    });

    it('handles Cmd+N for new session', async () => {
      const mockSession = { id: 'session-1', title: 'New' };
      (window.agentBridge as any).createSession.mockResolvedValue(mockSession);
      useProjectStore.setState({ currentProjectId: 'project-1' });

      renderHook(() => useShortcuts());

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'n',
          metaKey: true,
          bubbles: true,
        }));
      });

      expect(window.agentBridge!.createSession).toHaveBeenCalledWith('project-1');
    });

    it('handles Cmd+B for toggle sidebar', () => {
      useUIStore.setState({ leftSidebarCollapsed: false });

      renderHook(() => useShortcuts());

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'b',
          metaKey: true,
          bubbles: true,
        }));
      });

      expect(useUIStore.getState().leftSidebarCollapsed).toBe(true);
    });

    it('handles Cmd+[ for previous session', () => {
      useProjectStore.setState({ currentProjectId: 'project-1' });
      useSessionStore.setState({
        sessionsByProject: {
          'project-1': [
            { id: 's1', title: 'S1', createdAt: 1 } as any,
            { id: 's2', title: 'S2', createdAt: 2 } as any,
          ],
        },
        currentSessionId: 's2',
      });

      renderHook(() => useShortcuts());

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: '[',
          metaKey: true,
          bubbles: true,
        }));
      });

      expect(useSessionStore.getState().currentSessionId).toBe('s1');
    });

    it('handles Cmd+] for next session', () => {
      useProjectStore.setState({ currentProjectId: 'project-1' });
      useSessionStore.setState({
        sessionsByProject: {
          'project-1': [
            { id: 's1', title: 'S1', createdAt: 1 } as any,
            { id: 's2', title: 'S2', createdAt: 2 } as any,
          ],
        },
        currentSessionId: 's1',
      });

      renderHook(() => useShortcuts());

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: ']',
          metaKey: true,
          bubbles: true,
        }));
      });

      expect(useSessionStore.getState().currentSessionId).toBe('s2');
    });

    it('handles Cmd+? for keyboard shortcuts help', () => {
      const { result } = renderHook(() => useShortcuts());

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: '?',
          metaKey: true,
          bubbles: true,
        }));
      });

      expect(result.current.showKeyboardShortcuts).toBe(true);
    });

    it('handles Escape for stop', async () => {
      useProjectStore.setState({ currentProjectId: 'project-1' });

      renderHook(() => useShortcuts());

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
        }));
      });

      expect(window.agentBridge!.cancelMessage).toHaveBeenCalledWith('project-1');
    });

    it('ignores keydowns without meta/ctrl key (except Escape)', () => {
      renderHook(() => useShortcuts());

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: ',',
          bubbles: true,
        }));
      });

      // Settings should not change
      expect(useUIStore.getState().activeScreen).toBe('project');
    });

    it('cleans up DOM listener on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

      const { unmount } = renderHook(() => useShortcuts());
      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
      removeEventListenerSpy.mockRestore();
    });
  });

  describe('session navigation', () => {
    it('wraps around when navigating past the last session', () => {
      useProjectStore.setState({ currentProjectId: 'project-1' });
      useSessionStore.setState({
        sessionsByProject: {
          'project-1': [
            { id: 's1', title: 'S1', createdAt: 1 } as any,
            { id: 's2', title: 'S2', createdAt: 2 } as any,
          ],
        },
        currentSessionId: 's2',
      });

      renderHook(() => useShortcuts());

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: ']',
          metaKey: true,
          bubbles: true,
        }));
      });

      // Should wrap to first session
      expect(useSessionStore.getState().currentSessionId).toBe('s1');
    });

    it('wraps around when navigating before the first session', () => {
      useProjectStore.setState({ currentProjectId: 'project-1' });
      useSessionStore.setState({
        sessionsByProject: {
          'project-1': [
            { id: 's1', title: 'S1', createdAt: 1 } as any,
            { id: 's2', title: 'S2', createdAt: 2 } as any,
          ],
        },
        currentSessionId: 's1',
      });

      renderHook(() => useShortcuts());

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: '[',
          metaKey: true,
          bubbles: true,
        }));
      });

      // Should wrap to last session
      expect(useSessionStore.getState().currentSessionId).toBe('s2');
    });

    it('does nothing when no project is selected', () => {
      useProjectStore.setState({ currentProjectId: null });

      renderHook(() => useShortcuts());

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: ']',
          metaKey: true,
          bubbles: true,
        }));
      });

      expect(useSessionStore.getState().currentSessionId).toBeNull();
    });
  });

  describe('deeplink handling', () => {
    it('subscribes to deeplinks from platform adapter', () => {
      let deeplinkHandler: ((url: string) => void) | null = null;
      const adapter: PlatformAdapter = {
        platform: 'desktop',
        onDeeplink: (callback: (url: string) => void) => {
          deeplinkHandler = callback;
          return () => { deeplinkHandler = null; };
        },
      };

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(PlatformProvider, { adapter, children });

      renderHook(() => useShortcuts(), { wrapper });

      expect(deeplinkHandler).not.toBeNull();
    });

    it('handles home deeplink', () => {
      let deeplinkHandler: ((url: string) => void) | null = null;
      const adapter: PlatformAdapter = {
        platform: 'desktop',
        onDeeplink: (callback: (url: string) => void) => {
          deeplinkHandler = callback;
          return () => { deeplinkHandler = null; };
        },
      };

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(PlatformProvider, { adapter, children });

      useUIStore.setState({ view: 'settings' });

      renderHook(() => useShortcuts(), { wrapper });

      act(() => {
        deeplinkHandler!('openmgr://');
      });

      expect(useUIStore.getState().view).toBe('home');
    });
  });
});
