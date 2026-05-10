import { useEffect, useCallback, useState, useRef } from 'react';
import {
  useUIStore,
  useProjectStore,
  useSessionStore,
  parseDeeplink,
  createLogger,
  type DeeplinkRoute,
} from '../index';
import { usePlatform } from '../platform/PlatformContext';

const log = createLogger('Shortcuts');

/**
 * Registers keyboard shortcuts and deeplink handlers via the platform adapter.
 * Falls back to DOM keydown listeners when the platform doesn't provide
 * `onShortcut` (e.g., web platform).
 *
 * Returns the showKeyboardShortcuts state and setter for the help modal.
 */
export interface PendingServerConnect {
  serverName: string;
  url: string;
  token?: string;
}

export interface DeeplinkLoadingState {
  message: string;
}

export function useShortcuts() {
  const platform = usePlatform();
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const showKeyboardShortcutsRef = useRef(showKeyboardShortcuts);
  showKeyboardShortcutsRef.current = showKeyboardShortcuts;

  // Pending server connect — set when a deeplink needs user confirmation
  const [pendingServerConnect, setPendingServerConnect] = useState<PendingServerConnect | null>(null);

  // Loading state for async deeplink operations (token exchange, etc.)
  const [deeplinkLoading, setDeeplinkLoading] = useState<DeeplinkLoadingState | null>(null);

  // Handle opening a project from path
  const handleOpenProjectFromPath = useCallback(async (path: string) => {
    try {
      const project = await window.agentBridge?.createProject(path, 'local');
      if (project) {
        useProjectStore.getState().addProject(project);
        useProjectStore.getState().setCurrentProject(project.id);
      }
    } catch (e) {
      log.error('Failed to open project:', e);
      useUIStore.getState().addToast({ message: 'Failed to open project', type: 'error' });
    }
  }, []);

  // Handle creating a new session
  const handleNewSession = useCallback(async () => {
    const projectId = useProjectStore.getState().currentProjectId;
    if (!projectId) {
      useUIStore.getState().addToast({ message: 'Select a project first', type: 'warning' });
      return;
    }
    try {
      const session = await window.agentBridge?.createSession(projectId);
      if (session) {
        useSessionStore.getState().addSession(projectId, session);
        useSessionStore.getState().setCurrentSession(session.id);
      }
    } catch (e) {
      log.error('Failed to create session:', e);
      useUIStore.getState().addToast({ message: 'Failed to create session', type: 'error' });
    }
  }, []);

  // Handle closing current session
  const handleCloseSession = useCallback(async () => {
    const projectId = useProjectStore.getState().currentProjectId;
    const sessionId = useSessionStore.getState().currentSessionId;
    if (!projectId || !sessionId) return;
    
    try {
      await window.agentBridge?.deleteSession(projectId, sessionId);
      useSessionStore.getState().removeSession(projectId, sessionId);
      useSessionStore.getState().setCurrentSession(null);
    } catch (e) {
      log.error('Failed to close session:', e);
    }
  }, []);

  // Handle navigating to previous/next session
  const handleNavigateSession = useCallback((direction: 'prev' | 'next') => {
    const projectId = useProjectStore.getState().currentProjectId;
    if (!projectId) return;
    
    const sessions = useSessionStore.getState().sessionsByProject[projectId] || [];
    const currentSessionId = useSessionStore.getState().currentSessionId;
    
    if (sessions.length === 0) return;
    
    const currentIndex = sessions.findIndex(s => s.id === currentSessionId);
    let newIndex: number;
    
    if (currentIndex === -1) {
      newIndex = 0;
    } else if (direction === 'prev') {
      newIndex = currentIndex > 0 ? currentIndex - 1 : sessions.length - 1;
    } else {
      newIndex = currentIndex < sessions.length - 1 ? currentIndex + 1 : 0;
    }
    
    useSessionStore.getState().setCurrentSession(sessions[newIndex]!.id);
  }, []);

  // Handle stopping current operation
  const handleStop = useCallback(async () => {
    const projectId = useProjectStore.getState().currentProjectId;
    if (!projectId) return;
    
    try {
      await window.agentBridge?.cancelMessage(projectId);
    } catch (e) {
      log.error('Failed to stop operation:', e);
    }
  }, []);

  // Handle deeplink navigation
  const handleDeeplink = useCallback(async (route: DeeplinkRoute) => {
    log.info('Handling deeplink:', route);

    switch (route.type) {
      case 'home':
        useUIStore.getState().setView('home');
        break;

      case 'project':
        useProjectStore.getState().setCurrentProject(route.projectId);
        useUIStore.getState().setView('home');
        break;

      case 'session':
        useProjectStore.getState().setCurrentProject(route.projectId);
        useSessionStore.getState().setCurrentSession(route.sessionId);
        useUIStore.getState().setView('home');
        break;

      case 'project-settings':
        useProjectStore.getState().setCurrentProject(route.projectId);
        useUIStore.getState().setView('settings');
        break;

      case 'settings':
        useUIStore.getState().setView('settings');
        break;

      case 'auth-callback':
        log.info('Auth callback received with code:', route.code);
        if (route.server && route.code) {
          try {
            setDeeplinkLoading({ message: 'Authenticating...' });
            // Exchange the one-time auth code for a bearer token
            const tokenRes = await fetch(`${route.server}/api/beta/auth/token`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                code: route.code,
                redirect_uri: 'openmgr://auth/callback',
              }),
            });
            if (!tokenRes.ok) {
              const err = await tokenRes.json().catch(() => ({ error: 'Token exchange failed' }));
              throw new Error(err.error || `HTTP ${tokenRes.status}`);
            }
            const tokenData = await tokenRes.json() as {
              token: string;
              user: { id: string; username: string; displayName?: string; role: string };
            };

            // Add or update the remote server with the obtained token
            const serverName = tokenData.user.displayName || tokenData.user.username || new URL(route.server).hostname;
            const existingServers = await window.agentBridge?.listRemoteServers() || [];
            const existing = existingServers.find((s) => s.url === route.server);
            if (existing) {
              await window.agentBridge?.updateRemoteServer(existing.id, {
                token: tokenData.token,
                name: serverName,
              });
            } else {
              await window.agentBridge?.addRemoteServer({
                name: serverName,
                url: route.server!,
                token: tokenData.token,
              });
            }

            useUIStore.getState().addToast({
              message: `Authenticated with ${serverName}`,
              type: 'success',
            });
            useUIStore.getState().setView('settings');
          } catch (e) {
            log.error('Auth code exchange failed:', e);
            useUIStore.getState().addToast({
              message: e instanceof Error ? e.message : 'Authentication failed',
              type: 'error',
            });
          } finally {
            setDeeplinkLoading(null);
          }
        } else {
          log.warn('Auth callback missing server URL or code');
          useUIStore.getState().addToast({
            message: 'Authentication callback incomplete',
            type: 'error',
          });
        }
        break;

      case 'connect':
        log.info('Deeplink connect: starting, url=', route.url, 'name=', route.name, 'hasCode=', !!route.code);
        try {
          let token: string | undefined;
          let serverName = route.name || new URL(route.url).hostname;

          // If a one-time auth code is provided, exchange it for a bearer token
          if (route.code) {
            setDeeplinkLoading({ message: `Connecting to ${serverName}...` });
            log.info('Deeplink connect: exchanging auth code for token at', `${route.url}/api/beta/auth/token`);
            const tokenRes = await fetch(`${route.url}/api/beta/auth/token`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                code: route.code,
                redirect_uri: 'openmgr://connect',
              }),
            });
            log.info('Deeplink connect: token exchange response status=', tokenRes.status);
            if (!tokenRes.ok) {
              const err = await tokenRes.json().catch(() => ({ error: 'Token exchange failed' }));
              throw new Error(err.error || `HTTP ${tokenRes.status}`);
            }
            const tokenData = await tokenRes.json() as {
              token: string;
              user: { id: string; username: string; displayName?: string; role: string };
            };
            token = tokenData.token;
            serverName = tokenData.user.displayName || tokenData.user.username || serverName;
            log.info('Deeplink connect: got token, serverName=', serverName);
          }

          // Show confirmation before adding
          log.info('Deeplink connect: awaiting user confirmation');
          setPendingServerConnect({ serverName, url: route.url, token });
        } catch (e) {
          log.error('Deeplink connect: failed:', e);
          useUIStore.getState().addToast({ 
            message: e instanceof Error ? e.message : 'Failed to connect to server', 
            type: 'error' 
          });
        } finally {
          setDeeplinkLoading(null);
        }
        break;

      case 'open':
        handleOpenProjectFromPath(route.path);
        break;

      case 'unknown':
        log.warn('Unknown deeplink:', route.url);
        break;
    }
  }, [handleOpenProjectFromPath]);

  // Subscribe to deeplinks from platform adapter
  useEffect(() => {
    if (!platform.onDeeplink) {
      log.info('Deeplink: platform.onDeeplink not available, skipping subscription');
      return;
    }

    log.info('Deeplink: subscribing to platform deeplinks');
    const unsubscribe = platform.onDeeplink((url) => {
      log.info('Deeplink: received URL from platform:', url);
      const route = parseDeeplink(url);
      log.info('Deeplink: parsed route:', JSON.stringify(route));
      handleDeeplink(route);
    });

    return () => {
      log.info('Deeplink: unsubscribing from platform deeplinks');
      unsubscribe();
    };
  }, [platform, handleDeeplink]);

  // Subscribe to keyboard shortcuts from platform adapter
  useEffect(() => {
    const unsubscribers: Array<() => void> = [];

    if (platform.onShortcut) {
      unsubscribers.push(
        platform.onShortcut('settings', () => {
          useUIStore.getState().setView('settings');
        })
      );

      unsubscribers.push(
        platform.onShortcut('openProject', (path: unknown) => {
          if (typeof path === 'string') {
            handleOpenProjectFromPath(path);
          }
        })
      );

      unsubscribers.push(
        platform.onShortcut('newSession', () => {
          handleNewSession();
        })
      );

      unsubscribers.push(
        platform.onShortcut('closeSession', () => {
          handleCloseSession();
        })
      );

      unsubscribers.push(
        platform.onShortcut('toggleSidebar', () => {
          useUIStore.getState().toggleLeftSidebar();
        })
      );

      unsubscribers.push(
        platform.onShortcut('prevSession', () => {
          handleNavigateSession('prev');
        })
      );

      unsubscribers.push(
        platform.onShortcut('nextSession', () => {
          handleNavigateSession('next');
        })
      );

      unsubscribers.push(
        platform.onShortcut('stop', () => {
          handleStop();
        })
      );

      unsubscribers.push(
        platform.onShortcut('showKeyboardShortcuts', () => {
          setShowKeyboardShortcuts(true);
        })
      );
    }

    // Always register DOM keydown listeners as a complement to platform shortcuts.
    // On desktop, Electron menu accelerators handle native keyboard events via IPC,
    // but synthetic key events (e.g. from Playwright E2E tests) bypass the native
    // menu system and only fire DOM events. This listener ensures shortcuts work
    // in both cases.
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) {
        // Escape — close keyboard shortcuts modal if open, otherwise stop
        if (e.key === 'Escape') {
          if (showKeyboardShortcutsRef.current) {
            setShowKeyboardShortcuts(false);
          } else {
            handleStop();
          }
          return;
        }
        return;
      }

      // Cmd/Ctrl + ,  → settings
      if (e.key === ',') {
        e.preventDefault();
        useUIStore.getState().setActiveScreen('settings');
        return;
      }

      // Cmd/Ctrl + N → newSession
      if (e.key === 'n') {
        e.preventDefault();
        handleNewSession();
        return;
      }

      // Cmd/Ctrl + W → closeSession
      if (e.key === 'w') {
        e.preventDefault();
        handleCloseSession();
        return;
      }

      // Cmd/Ctrl + B → toggleSidebar
      if (e.key === 'b') {
        e.preventDefault();
        useUIStore.getState().toggleLeftSidebar();
        return;
      }

      // Cmd/Ctrl + [ → prevSession
      if (e.key === '[') {
        e.preventDefault();
        handleNavigateSession('prev');
        return;
      }

      // Cmd/Ctrl + ] → nextSession
      if (e.key === ']') {
        e.preventDefault();
        handleNavigateSession('next');
        return;
      }

      // Cmd/Ctrl + / or Cmd/Ctrl + ? → showKeyboardShortcuts
      if (e.key === '?' || e.key === '/') {
        e.preventDefault();
        setShowKeyboardShortcuts(true);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    unsubscribers.push(() => window.removeEventListener('keydown', handleKeyDown));

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, [platform, handleOpenProjectFromPath, handleNewSession, handleCloseSession, handleNavigateSession, handleStop]);

  const confirmServerConnect = useCallback(async () => {
    const pending = pendingServerConnect;
    if (!pending) return;
    setPendingServerConnect(null);

    try {
      const existingServers = await window.agentBridge?.listRemoteServers() || [];
      const existing = existingServers.find((s) => s.url === pending.url);
      if (existing) {
        log.info('Deeplink connect: updating existing server id=', existing.id);
        await window.agentBridge?.updateRemoteServer(existing.id, {
          ...(pending.token ? { token: pending.token } : {}),
          name: pending.serverName,
        });
      } else {
        log.info('Deeplink connect: adding new server');
        await window.agentBridge?.addRemoteServer({
          name: pending.serverName,
          url: pending.url,
          ...(pending.token ? { token: pending.token } : {}),
        });
      }

      log.info('Deeplink connect: success');
      useUIStore.getState().addToast({
        message: `Connected to ${pending.serverName}`,
        type: 'success',
      });
      useUIStore.getState().setView('settings');
    } catch (e) {
      log.error('Deeplink connect: failed:', e);
      useUIStore.getState().addToast({
        message: e instanceof Error ? e.message : 'Failed to connect to server',
        type: 'error',
      });
    }
  }, [pendingServerConnect]);

  const cancelServerConnect = useCallback(() => {
    setPendingServerConnect(null);
  }, []);

  return {
    showKeyboardShortcuts,
    setShowKeyboardShortcuts,
    pendingServerConnect,
    confirmServerConnect,
    cancelServerConnect,
    deeplinkLoading,
  };
}
