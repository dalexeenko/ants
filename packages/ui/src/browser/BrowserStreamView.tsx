/**
 * BrowserStreamView — renders a live browser screencast via WebSocket.
 *
 * Connects to the screencast WebSocket endpoint and renders JPEG frames
 * to a canvas element. Captures mouse and keyboard events and forwards
 * them back over the WebSocket for remote interaction.
 *
 * Protocol:
 *   Server sends: JSON metadata message, then binary JPEG frame data
 *   Client sends: JSON messages for start, stop, ack, mouse, key
 */
import React, { useEffect, useRef, useCallback, useState } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Text } from '../primitives/Text';
import { IconButton } from '../primitives/IconButton';
import { Spinner } from '../primitives/Spinner';
import { useTheme } from '../styles/theme';
import { spacing } from '../styles/tokens';
import { createLogger } from '../utils/logger';
import { mapMouseButton, getModifiers } from './utils';

const log = createLogger('BrowserStreamView');

export interface BrowserStreamViewProps {
  /** WebSocket URL for the screencast endpoint */
  wsUrl: string;
  /** Browser instance ID (for display) */
  browserId: string;
  /** Initial screencast options */
  screencastOptions?: {
    format?: 'jpeg' | 'png';
    quality?: number;
    maxWidth?: number;
    maxHeight?: number;
    everyNthFrame?: number;
  };
  /** Called when the browser connection is lost */
  onDisconnect?: () => void;
  /** Called when the browser URL changes */
  onNavigate?: (url: string) => void;
}

type ConnectionState = 'connecting' | 'connected' | 'streaming' | 'disconnected' | 'error';

export function BrowserStreamView({
  wsUrl,
  browserId,
  screencastOptions,
  onDisconnect,
  onNavigate,
}: BrowserStreamViewProps) {
  const theme = useTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<ConnectionState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 1280, height: 720 });

  // Track the latest metadata for coordinate scaling
  const metadataRef = useRef<{
    offsetTop: number;
    pageScaleFactor: number;
    deviceWidth: number;
    deviceHeight: number;
    scrollOffsetX: number;
    scrollOffsetY: number;
    sessionId: number;
  } | null>(null);

  // Track pending metadata (arrives before the binary frame)
  const pendingMetadataRef = useRef<typeof metadataRef.current>(null);

  /**
   * Scale canvas coordinates to page coordinates.
   */
  const scaleCoordinates = useCallback((canvasX: number, canvasY: number): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas || !metadataRef.current) return { x: canvasX, y: canvasY };

    const rect = canvas.getBoundingClientRect();
    const meta = metadataRef.current;

    // Scale from CSS pixels to the device coordinates
    const scaleX = meta.deviceWidth / rect.width;
    const scaleY = meta.deviceHeight / rect.height;

    return {
      x: Math.round((canvasX - rect.left) * scaleX),
      y: Math.round((canvasY - rect.top) * scaleY),
    };
  }, []);

  /**
   * Send a JSON message over the WebSocket.
   */
  const sendMessage = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  /**
   * Connect to the screencast WebSocket.
   */
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    log.info(`Connecting to screencast: ${wsUrl}`);
    setState('connecting');
    setError(null);

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      log.info('Screencast WebSocket connected');
      setState('connected');
    };

    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        // JSON control message
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case 'ready':
              log.debug('Screencast ready, starting...');
              // Start the screencast
              sendMessage({
                type: 'start',
                options: screencastOptions || {
                  format: 'jpeg',
                  quality: 40,
                  maxWidth: 1280,
                  maxHeight: 720,
                  everyNthFrame: 30,
                },
              });
              break;

            case 'started':
              log.info('Screencast streaming started');
              setState('streaming');
              break;

            case 'stopped':
              log.info('Screencast streaming stopped');
              setState('connected');
              break;

            case 'metadata':
              // Store metadata, the next binary message is the frame
              pendingMetadataRef.current = {
                offsetTop: msg.offsetTop,
                pageScaleFactor: msg.pageScaleFactor,
                deviceWidth: msg.deviceWidth,
                deviceHeight: msg.deviceHeight,
                scrollOffsetX: msg.scrollOffsetX,
                scrollOffsetY: msg.scrollOffsetY,
                sessionId: msg.sessionId,
              };
              // Update dimensions
              if (msg.deviceWidth && msg.deviceHeight) {
                setDimensions({ width: msg.deviceWidth, height: msg.deviceHeight });
              }
              break;

            case 'error':
              log.error('Screencast error:', msg.message);
              setError(msg.message);
              break;
          }
        } catch (err) {
          log.error('Failed to parse screencast message:', err);
        }
      } else if (event.data instanceof ArrayBuffer) {
        // Binary frame data — render to canvas
        const meta = pendingMetadataRef.current;
        if (meta) {
          metadataRef.current = meta;
          pendingMetadataRef.current = null;

          renderFrame(event.data);

          // Acknowledge the frame
          sendMessage({ type: 'ack', sessionId: meta.sessionId });
        }
      }
    };

    ws.onclose = (event: CloseEvent) => {
      log.info(`Screencast WebSocket closed: ${event.code} ${event.reason}`);
      setState('disconnected');
      wsRef.current = null;
      onDisconnect?.();
    };

    ws.onerror = () => {
      log.error('Screencast WebSocket error');
      setState('error');
      setError('WebSocket connection failed');
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, 'Component unmounting');
      }
      wsRef.current = null;
    };
  }, [wsUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Render a JPEG frame to the canvas.
   */
  const renderFrame = useCallback((data: ArrayBuffer) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const blob = new Blob([data], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      // Resize canvas if needed
      if (canvas.width !== img.width || canvas.height !== img.height) {
        canvas.width = img.width;
        canvas.height = img.height;
      }
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
    };

    img.src = url;
  }, []);

  // ── Mouse event handlers ────────────────────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const { x, y } = scaleCoordinates(e.clientX, e.clientY);
    sendMessage({
      type: 'mouse',
      event: { type: 'mousePressed', x, y, button: mapMouseButton(e.button), clickCount: 1 },
    });
  }, [scaleCoordinates, sendMessage]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const { x, y } = scaleCoordinates(e.clientX, e.clientY);
    sendMessage({
      type: 'mouse',
      event: { type: 'mouseReleased', x, y, button: mapMouseButton(e.button), clickCount: 1 },
    });
  }, [scaleCoordinates, sendMessage]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Only send move events while a button is pressed (drag) to reduce traffic
    if (e.buttons === 0) return;
    const { x, y } = scaleCoordinates(e.clientX, e.clientY);
    sendMessage({
      type: 'mouse',
      event: { type: 'mouseMoved', x, y, button: mapMouseButton(e.button) },
    });
  }, [scaleCoordinates, sendMessage]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Clicks are already handled by mouseDown + mouseUp
    e.preventDefault();
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault(); // Prevent browser context menu
  }, []);

  // ── Keyboard event handlers ─────────────────────────────────────────

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    sendMessage({
      type: 'key',
      event: {
        type: 'keyDown',
        key: e.key,
        code: e.code,
        text: e.key.length === 1 ? e.key : undefined,
        modifiers: getModifiers(e),
      },
    });

    // Also send a 'char' event for printable characters
    if (e.key.length === 1) {
      sendMessage({
        type: 'key',
        event: {
          type: 'char',
          text: e.key,
          modifiers: getModifiers(e),
        },
      });
    }
  }, [sendMessage]);

  const handleKeyUp = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    sendMessage({
      type: 'key',
      event: {
        type: 'keyUp',
        key: e.key,
        code: e.code,
        modifiers: getModifiers(e),
      },
    });
  }, [sendMessage]);

  // ── Toolbar actions ─────────────────────────────────────────────────

  const handleReconnect = useCallback(() => {
    // Force re-mount by toggling wsUrl (handled by parent)
    setState('connecting');
  }, []);

  // ── Render ──────────────────────────────────────────────────────────

  if (Platform.OS !== 'web') {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.surfaceRaised }]}>
        <Text style={{ color: theme.colors.textSecondary }}>
          Browser streaming is not available on mobile.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
      {/* Toolbar */}
      <View style={[styles.toolbar, { borderBottomColor: theme.colors.border }]}>
        <Text style={[styles.toolbarText, { color: theme.colors.textSecondary }]}>
          Browser: {browserId.slice(0, 8)}
        </Text>
        <View style={styles.toolbarRight}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor:
                  state === 'streaming'
                    ? theme.colors.success
                    : state === 'connected'
                    ? theme.colors.warning
                    : state === 'error'
                    ? theme.colors.error
                    : theme.colors.textTertiary,
              },
            ]}
          />
          <Text style={[styles.statusText, { color: theme.colors.textTertiary }]}>
            {state}
          </Text>
          {(state === 'disconnected' || state === 'error') && (
            <IconButton name="refresh" size={16} onPress={handleReconnect} />
          )}
        </View>
      </View>

      {/* Canvas area */}
      <View style={styles.canvasContainer}>
        {(state === 'connecting' || state === 'connected') && (
          <View style={styles.overlay}>
            <Spinner size={24} />
            <Text style={[styles.overlayText, { color: theme.colors.textSecondary }]}>
              {state === 'connecting' ? 'Connecting...' : 'Starting screencast...'}
            </Text>
          </View>
        )}

        {state === 'error' && (
          <View style={styles.overlay}>
            <Text style={[styles.overlayText, { color: theme.colors.error }]}>
              {error || 'Connection failed'}
            </Text>
          </View>
        )}

        {state === 'disconnected' && (
          <View style={styles.overlay}>
            <Text style={[styles.overlayText, { color: theme.colors.textSecondary }]}>
              Disconnected
            </Text>
          </View>
        )}

        {/* The canvas is always rendered but may be hidden behind overlay */}
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            cursor: state === 'streaming' ? 'default' : 'wait',
            outline: 'none',
          }}
          tabIndex={0}
          onMouseDown={handleMouseDown as any}
          onMouseUp={handleMouseUp as any}
          onMouseMove={handleMouseMove as any}
          onClick={handleClick as any}
          onContextMenu={handleContextMenu as any}
          onKeyDown={handleKeyDown as any}
          onKeyUp={handleKeyUp as any}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toolbarText: {
    fontSize: 12,
    fontFamily: 'monospace',
  },
  toolbarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11,
  },
  canvasContainer: {
    flex: 1,
    position: 'relative',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  overlayText: {
    marginTop: spacing.sm,
    fontSize: 14,
  },
});
