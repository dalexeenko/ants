import React, { useEffect, useRef, useCallback, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Text } from '../primitives/Text';
import { IconButton } from '../primitives/IconButton';
import { Spinner } from '../primitives/Spinner';
import { useTheme } from '../styles/theme';
import { spacing } from '../styles/tokens';
import type { AgentBridge, TerminalSession } from '../agent/types';
import { createLogger } from '../utils/logger';
import type { RemoteTerminalProps } from './RemoteTerminal';

const log = createLogger('XtermTerminal');

// ---------------------------------------------------------------------------
// Persistent terminal session cache
// ---------------------------------------------------------------------------
// Keeps Terminal + WebSocket alive across component unmount/remount so that
// switching tabs doesn't lose scrollback or disconnect the PTY.

interface CachedSession {
  term: Terminal;
  fitAddon: FitAddon;
  ws: WebSocket | null;
  inputDisposable: { dispose(): void };
  resizeDisposable: { dispose(): void };
  connected: boolean;
  /** Callback to push connected state into the currently-mounted component */
  onConnectedChange: ((connected: boolean) => void) | null;
  /** Callback to push errors into the currently-mounted component */
  onError: ((error: string) => void) | null;
}

const sessionCache = new Map<string, CachedSession>();

function destroyCache(sessionId: string) {
  const cached = sessionCache.get(sessionId);
  if (!cached) return;
  cached.inputDisposable.dispose();
  cached.resizeDisposable.dispose();
  cached.ws?.close();
  cached.term.dispose();
  sessionCache.delete(sessionId);
}

/**
 * Terminal component for web/desktop that uses xterm.js for full terminal
 * emulation. Properly handles ANSI codes, cursor movement, colors, etc.
 */
export function XtermTerminal({ bridge, projectId }: RemoteTerminalProps) {
  const { colors, palette } = useTheme();
  const [session, setSession] = useState<TerminalSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const terminalContainerRef = useRef<HTMLDivElement | null>(null);

  // ---------------------------------------------------------------------------
  // Create or get existing terminal session
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let mounted = true;

    const initTerminal = async () => {
      try {
        setLoading(true);
        setError(null);

        const sessions = await bridge.listTerminals(projectId);

        let terminalSession: TerminalSession;
        if (sessions.length > 0) {
          terminalSession = sessions[0];
        } else {
          terminalSession = await bridge.createTerminal(projectId);
        }

        if (mounted) {
          setSession(terminalSession);
        }
      } catch (e) {
        if (mounted) {
          setError(e instanceof Error ? e.message : 'Failed to initialize terminal');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    initTerminal();

    return () => {
      mounted = false;
    };
  }, [bridge, projectId]);

  // ---------------------------------------------------------------------------
  // Build xterm.js theme from app theme
  // ---------------------------------------------------------------------------
  const xtermTheme = useCallback(() => ({
    background: colors.bg.primary,
    foreground: colors.text.primary,
    cursor: colors.text.primary,
    cursorAccent: colors.bg.primary,
    selectionBackground: colors.primary + '40',
    selectionForeground: undefined,
    black: '#1A1F1A',
    red: '#B85C5C',
    green: '#4E9E76',
    yellow: '#B8923E',
    blue: '#5C6CA8',
    magenta: '#8A78B4',
    cyan: '#4E9E94',
    white: '#F5F7F5',
    brightBlack: '#5C665C',
    brightRed: '#D47272',
    brightGreen: '#5EAA68',
    brightYellow: '#C8A84E',
    brightBlue: '#7080BE',
    brightMagenta: '#9E8EC8',
    brightCyan: '#62B2A8',
    brightWhite: '#FFFFFF',
  }), [colors]);

  // ---------------------------------------------------------------------------
  // Attach (or create) xterm.js + WebSocket when session + container are ready
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!session || !terminalContainerRef.current) return;
    const container = terminalContainerRef.current;
    const sessionId = session.id;

    let cached = sessionCache.get(sessionId);

    if (cached) {
      // Re-attach existing terminal to the new DOM container
      // xterm.js doesn't have a native "re-attach" API, so we move its
      // internal DOM element into our container.
      const xtermEl = cached.term.element;
      if (xtermEl && xtermEl.parentElement !== container) {
        container.appendChild(xtermEl);
      }

      // Wire up state callbacks
      cached.onConnectedChange = setConnected;
      cached.onError = setError;
      setConnected(cached.connected);

      // Re-fit to potentially new container dimensions
      requestAnimationFrame(() => {
        try {
          cached!.fitAddon.fit();
        } catch {
          // Container may not have dimensions yet
        }
      });
    } else {
      // First time — create terminal and connect WebSocket
      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: 'monospace',
        theme: xtermTheme(),
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(container);

      const inputDisposable = term.onData((data) => {
        const c = sessionCache.get(sessionId);
        if (c?.ws?.readyState === WebSocket.OPEN) {
          c.ws.send(JSON.stringify({ type: 'input', data }));
        }
      });

      const resizeDisposable = term.onResize(({ cols, rows }) => {
        const c = sessionCache.get(sessionId);
        if (c?.ws?.readyState === WebSocket.OPEN) {
          c.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      });

      cached = {
        term,
        fitAddon,
        ws: null,
        inputDisposable,
        resizeDisposable,
        connected: false,
        onConnectedChange: setConnected,
        onError: setError,
      };
      sessionCache.set(sessionId, cached);

      // Fit after a tick so the DOM has settled
      requestAnimationFrame(() => {
        try {
          fitAddon.fit();
        } catch {
          // Container may not have dimensions yet
        }
      });

      // Connect WebSocket
      const connectWs = async () => {
        const wsUrl = await Promise.resolve(bridge.getTerminalWebSocketUrl(projectId, session.id));
        const c = sessionCache.get(sessionId);
        if (!c) return;

        if (!wsUrl) {
          c.onError?.('Unable to get WebSocket URL');
          return;
        }

        log.debug('Connecting to:', wsUrl);

        const ws = new WebSocket(wsUrl);
        c.ws = ws;

        ws.onopen = () => {
          log.debug('WebSocket connected');
          const cur = sessionCache.get(sessionId);
          if (cur) {
            cur.connected = true;
            cur.onConnectedChange?.(true);
          }

          const dims = fitAddon.proposeDimensions();
          if (dims) {
            ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
          }
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            switch (message.type) {
              case 'data':
                term.write(message.data);
                break;
              case 'exit':
                term.write(`\r\nProcess exited with code ${message.exitCode}\r\n`);
                {
                  const cur = sessionCache.get(sessionId);
                  if (cur) {
                    cur.connected = false;
                    cur.onConnectedChange?.(false);
                  }
                }
                break;
            }
          } catch (e) {
            log.error('Failed to parse message:', e);
          }
        };

        ws.onerror = (event) => {
          log.error('WebSocket error:', event);
          const cur = sessionCache.get(sessionId);
          cur?.onError?.('WebSocket connection error');
        };

        ws.onclose = () => {
          log.debug('WebSocket closed');
          const cur = sessionCache.get(sessionId);
          if (cur) {
            cur.connected = false;
            cur.onConnectedChange?.(false);
          }
        };
      };

      connectWs();
    }

    // Observe container size changes and re-fit
    const currentCached = cached;
    const resizeObserver = new ResizeObserver(() => {
      try {
        currentCached.fitAddon.fit();
      } catch {
        // ignore
      }
    });
    resizeObserver.observe(container);

    return () => {
      // On unmount: detach callbacks but keep terminal + WS alive
      resizeObserver.disconnect();
      const c = sessionCache.get(sessionId);
      if (c) {
        c.onConnectedChange = null;
        c.onError = null;
      }
    };
  }, [session, bridge, projectId, xtermTheme]);

  // ---------------------------------------------------------------------------
  // Update xterm theme when app theme changes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!session) return;
    const cached = sessionCache.get(session.id);
    if (cached) {
      cached.term.options.theme = xtermTheme();
    }
  }, [xtermTheme, session]);

  // ---------------------------------------------------------------------------
  // New terminal handler
  // ---------------------------------------------------------------------------
  const handleNewTerminal = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Destroy the cached session
      if (session) {
        destroyCache(session.id);
        await bridge.deleteTerminal(projectId, session.id);
      }

      const newSession = await bridge.createTerminal(projectId);
      setSession(newSession);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create terminal');
    } finally {
      setLoading(false);
    }
  }, [bridge, projectId, session]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.bg.primary }]}>
        <Spinner size="large" />
        <Text color="muted" style={styles.loadingText}>Starting terminal...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.bg.primary }]}>
        <Text color="error" style={styles.errorText}>{error}</Text>
        <Pressable onPress={handleNewTerminal} style={styles.retryButton}>
          <Text style={{ color: colors.primary }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg.primary }]}>
      {/* Terminal header */}
      <View style={[styles.header, { backgroundColor: colors.bg.secondary, borderBottomColor: colors.border.light }]}>
        <View style={styles.headerLeft}>
          <View style={[styles.statusDot, { backgroundColor: connected ? palette.green : colors.error }]} />
          <Text style={[styles.headerTitle, { color: colors.text.primary }]}>Terminal</Text>
        </View>
        <View style={styles.headerRight}>
          <IconButton
            icon="plus"
            size="sm"
            variant="ghost"
            onPress={handleNewTerminal}
          />
        </View>
      </View>

      {/* xterm.js terminal area */}
      <View style={styles.xtermWrapper}>
        <div
          ref={terminalContainerRef}
          style={{
            width: '100%',
            height: '100%',
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: spacing[3],
  },
  errorText: {
    textAlign: 'center',
    marginBottom: spacing[3],
  },
  retryButton: {
    padding: spacing[2],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '500',
  },
  xtermWrapper: {
    flex: 1,
    position: 'relative' as const,
  },
});
