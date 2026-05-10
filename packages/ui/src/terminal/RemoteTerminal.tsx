import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, TextInput, ScrollView, StyleSheet, Pressable, Switch } from 'react-native';
import { Text } from '../primitives/Text';
import { IconButton } from '../primitives/IconButton';
import { Spinner } from '../primitives/Spinner';
import { useTheme } from '../styles/theme';
import { spacing } from '../styles/tokens';
import type { AgentBridge, TerminalSession, TerminalHelperSuggestion } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('RemoteTerminal');

export interface RemoteTerminalProps {
  bridge: AgentBridge;
  projectId: string;
}

interface TerminalLine {
  id: string;
  content: string;
  timestamp: Date;
}

// ---------------------------------------------------------------------------
// ANSI escape code stripping
// ---------------------------------------------------------------------------

/**
 * Strip ANSI escape codes (colors, cursor movement, etc.) from terminal output.
 * These codes render as garbage in a Text component.
 */
function stripAnsi(str: string): string {
  // Match all common ANSI escape sequences:
  // - CSI (Control Sequence Introducer): ESC[ ... final byte
  // - OSC (Operating System Command): ESC] ... ST
  // - Other escape sequences: ESC followed by single char
  // Also strip carriage return for clean line display
  let result = str
    // CSI sequences (e.g., \x1b[31m for red, \x1b[0m for reset, \x1b[2K for erase line)
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    // CSI sequences with ? prefix (e.g., \x1b[?25h for show cursor)
    .replace(/\x1b\[\?[0-9;]*[A-Za-z]/g, '')
    // OSC sequences (e.g., \x1b]0;title\x07 for window title)
    .replace(/\x1b\][^\x07]*\x07/g, '')
    // OSC sequences with ST terminator
    .replace(/\x1b\][^\x1b]*\x1b\\/g, '')
    // Single-char escape sequences (e.g., \x1b= for DECKPAM)
    .replace(/\x1b[^[\]()][A-Za-z0-9=<>]/g, '')
    // Standalone ESC (fallback)
    .replace(/\x1b/g, '')
    // Strip carriage returns (keep newlines)
    .replace(/\r/g, '');

  // Process backspace characters (0x08) by removing the preceding character.
  // The PTY uses these for line-redraw (e.g. zsh bracketed paste: "e\x08echo ..."
  // means "print e, back up, then overwrite with echo ...").
  // A <Text> component doesn't interpret backspace, so we must apply it here.
  while (result.includes('\x08')) {
    // Replace the char before backspace plus the backspace itself
    result = result.replace(/[^\x08]\x08/, '');
    // If backspace is at the very start there's nothing to delete — just remove it
    result = result.replace(/^\x08+/, '');
  }

  return result;
}

// ---------------------------------------------------------------------------
// Error & Natural Language Detection
// ---------------------------------------------------------------------------

/** Patterns that indicate a command error in terminal output */
const ERROR_PATTERNS = [
  /command not found/i,
  /no such file or directory/i,
  /permission denied/i,
  /syntax error/i,
  /not recognized as/i,
  /cannot find/i,
  /is not recognized/i,
  /zsh: (command not found|no matches found)/i,
  /bash: .*: (command not found|No such file)/i,
  /error:/i,
  /npm ERR!/i,
  /fatal:/i,
  /ENOENT/i,
  /EACCES/i,
];

/**
 * Check if a string of recent terminal output contains error patterns.
 */
function detectError(output: string): boolean {
  return ERROR_PATTERNS.some((pattern) => pattern.test(output));
}

/**
 * Check if user input looks like natural language rather than a command.
 * Heuristic: contains spaces, starts with common English words, no leading
 * special chars like ./ or $, etc.
 */
function isNaturalLanguage(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length < 5) return false;
  // Starts with known command prefixes — not NL
  if (/^[.\/~$!]/.test(trimmed)) return false;
  if (/^(sudo|cd|ls|cat|echo|mkdir|rm|cp|mv|chmod|chown|grep|find|awk|sed|curl|wget|git|docker|npm|pnpm|yarn|node|python|pip|brew|apt|yum|dnf)\b/i.test(trimmed)) return false;
  // Contains multiple spaces and starts with a common English word
  const words = trimmed.split(/\s+/);
  if (words.length < 3) return false;
  const nlStarters = ['show', 'find', 'list', 'create', 'delete', 'remove', 'move', 'copy', 'rename', 'search', 'open', 'close', 'start', 'stop', 'restart', 'install', 'update', 'upgrade', 'check', 'run', 'build', 'deploy', 'how', 'what', 'where', 'which', 'can', 'please', 'help', 'i', 'make', 'get', 'set', 'change', 'add', 'put', 'tell', 'give'];
  return nlStarters.includes(words[0].toLowerCase());
}

/**
 * Remote terminal component that connects to a server terminal via WebSocket.
 * Supports "Smart Mode" (aish) — detects errors and natural language input,
 * then suggests commands via the terminal-helper agent.
 */
export function RemoteTerminal({ bridge, projectId }: RemoteTerminalProps) {
  const { colors, palette } = useTheme();
  const [session, setSession] = useState<TerminalSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<TerminalLine[]>([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);

  // Smart mode state
  const [smartMode, setSmartMode] = useState(false);
  const [suggestion, setSuggestion] = useState<TerminalHelperSuggestion | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const lineIdCounter = useRef(0);
  /** Buffer of recent output text for error detection */
  const recentOutputRef = useRef('');

  // Create or get existing terminal session
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

  // Connect WebSocket when session is available
  useEffect(() => {
    if (!session) return;

    let cancelled = false;

    const connect = async () => {
      const wsUrl = await Promise.resolve(bridge.getTerminalWebSocketUrl(projectId, session.id));
      if (cancelled) return;
      if (!wsUrl) {
        setError('Unable to get WebSocket URL');
        return;
      }

      log.debug('Connecting to:', wsUrl);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        log.debug('WebSocket connected');
        setConnected(true);
        addOutput('Connected to terminal\r\n');
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          switch (message.type) {
            case 'data':
              addOutput(message.data);
              // Accumulate recent output for smart mode error detection
              recentOutputRef.current += message.data;
              // Keep only last ~2000 chars
              if (recentOutputRef.current.length > 2000) {
                recentOutputRef.current = recentOutputRef.current.slice(-2000);
              }
              break;
            case 'exit':
              addOutput(`\r\nProcess exited with code ${message.exitCode}\r\n`);
              setConnected(false);
              break;
          }
        } catch (e) {
          log.error('Failed to parse message:', e);
        }
      };

      ws.onerror = (event) => {
        log.error('WebSocket error:', event);
        setError('WebSocket connection error');
      };

      ws.onclose = () => {
        log.debug('WebSocket closed');
        setConnected(false);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [session, bridge, projectId]);

  // After a command completes (detected by seeing a new prompt-like pattern),
  // check for errors if smart mode is enabled. We use a debounced approach:
  // check the recent output ~500ms after the last data event.
  const errorCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommandRef = useRef('');

  useEffect(() => {
    if (!smartMode) return;

    // Set up a polling check on recentOutput changes via the data handler
    // We piggyback on output state changes
    if (output.length === 0) return;

    if (errorCheckTimer.current) clearTimeout(errorCheckTimer.current);

    errorCheckTimer.current = setTimeout(() => {
      const recent = recentOutputRef.current;
      if (recent && detectError(recent) && bridge.askTerminalHelper && !suggestLoading) {
        // Get recent ~20 lines
        const lines = recent.split('\n').slice(-20).join('\n');
        setSuggestLoading(true);
        bridge.askTerminalHelper(projectId, {
          input: lastCommandRef.current,
          recentOutput: lines,
          workingDirectory: session?.workingDirectory || '',
          isError: true,
        }).then((result) => {
          if (result && result.command) {
            setSuggestion(result);
          }
          setSuggestLoading(false);
        }).catch(() => {
          setSuggestLoading(false);
        });
        // Clear the recent output to avoid re-triggering
        recentOutputRef.current = '';
      }
    }, 800);

    return () => {
      if (errorCheckTimer.current) clearTimeout(errorCheckTimer.current);
    };
  }, [output, smartMode, bridge, projectId, session, suggestLoading]);

  const addOutput = useCallback((data: string) => {
    const cleanContent = stripAnsi(data);
    // Skip empty lines from stripped control sequences
    if (!cleanContent) return;

    const newLine: TerminalLine = {
      id: `line-${++lineIdCounter.current}`,
      content: cleanContent,
      timestamp: new Date(),
    };

    setOutput((prev) => [...prev, newLine]);

    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 50);
  }, []);

  const sendInput = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'input',
        data,
      }));
    }
  }, []);

  const handleSubmit = useCallback(() => {
    if (!input.trim() && !input) return;

    // Dismiss any existing suggestion
    setSuggestion(null);

    // Check for natural language in smart mode
    if (smartMode && isNaturalLanguage(input) && bridge.askTerminalHelper) {
      const nlInput = input;
      setInput('');
      setSuggestLoading(true);
      const lines = recentOutputRef.current.split('\n').slice(-20).join('\n');
      bridge.askTerminalHelper(projectId, {
        input: nlInput,
        recentOutput: lines,
        workingDirectory: session?.workingDirectory || '',
        isError: false,
      }).then((result) => {
        if (result && result.command) {
          setSuggestion(result);
        } else {
          // Fall through — send as-is
          lastCommandRef.current = nlInput;
          sendInput(nlInput + '\n');
        }
        setSuggestLoading(false);
      }).catch(() => {
        // Fall through
        lastCommandRef.current = nlInput;
        sendInput(nlInput + '\n');
        setSuggestLoading(false);
      });
      return;
    }

    lastCommandRef.current = input;
    sendInput(input + '\n');
    setInput('');
  }, [input, sendInput, smartMode, bridge, projectId, session]);

  const handleKeyPress = useCallback((e: any) => {
    const key = e.nativeEvent.key;
    if (suggestion) {
      if (key === 'Tab') {
        e.preventDefault?.();
        // Insert the suggestion into the input
        setInput(suggestion.command);
        setSuggestion(null);
        return;
      }
      if (key === 'Escape') {
        setSuggestion(null);
        return;
      }
    }

    if (key === 'Enter') {
      // If there's a suggestion and user presses Enter with empty input, run the suggestion
      if (suggestion && !input.trim()) {
        e.preventDefault?.();
        lastCommandRef.current = suggestion.command;
        sendInput(suggestion.command + '\n');
        setSuggestion(null);
        return;
      }
      // Normal Enter submission is handled by onSubmitEditing — don't call handleSubmit here
      // to avoid sending the command to the PTY twice (causing garbled/doubled output).
    }
  }, [suggestion, input, sendInput]);

  const handleAcceptSuggestion = useCallback(() => {
    if (!suggestion) return;
    lastCommandRef.current = suggestion.command;
    sendInput(suggestion.command + '\n');
    setSuggestion(null);
  }, [suggestion, sendInput]);

  const handleInsertSuggestion = useCallback(() => {
    if (!suggestion) return;
    setInput(suggestion.command);
    setSuggestion(null);
    inputRef.current?.focus();
  }, [suggestion]);

  const handleDismissSuggestion = useCallback(() => {
    setSuggestion(null);
  }, []);

  const handleNewTerminal = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setOutput([]);
      setSuggestion(null);
      recentOutputRef.current = '';

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      if (session) {
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

  const hasHelper = !!bridge.askTerminalHelper;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg.primary }]}>
      {/* Terminal header */}
      <View style={[styles.header, { backgroundColor: colors.bg.secondary, borderBottomColor: colors.border.light }]}>
        <View style={styles.headerLeft}>
          <View style={[styles.statusDot, { backgroundColor: connected ? palette.green : colors.error }]} />
          <Text style={[styles.headerTitle, { color: colors.text.primary }]}>Terminal</Text>
        </View>
        <View style={styles.headerRight}>
          {hasHelper && (
            <View style={styles.smartToggle}>
              <Text style={[styles.smartLabel, { color: colors.primary }]}>Smart</Text>
              <Switch
                value={smartMode}
                onValueChange={setSmartMode}
                trackColor={{ false: colors.border.light, true: colors.primary }}
                thumbColor={smartMode ? colors.primary : colors.text.muted}
                style={styles.switchStyle}
              />
            </View>
          )}
          <IconButton
            icon="plus"
            size="sm"
            variant="ghost"
            onPress={handleNewTerminal}
          />
        </View>
      </View>

      {/* Terminal output with inline input */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.output}
        contentContainerStyle={styles.outputContent}
      >
        {output.map((line) => (
          <Text
            key={line.id}
            style={[styles.outputLine, { color: colors.text.primary }]}
            selectable
          >
            {line.content}
          </Text>
        ))}

        {/* Suggestion box - inline in the output flow */}
        {(suggestion || suggestLoading) && (
          <View style={[styles.suggestionContainer, { backgroundColor: colors.bg.elevated, borderColor: colors.primary }]}>
            {suggestLoading ? (
              <View style={styles.suggestionLoading}>
                <Spinner size="small" />
                <Text style={[styles.suggestionLoadingText, { color: colors.primary }]}>Thinking...</Text>
              </View>
            ) : suggestion ? (
              <View>
                <View style={styles.suggestionHeader}>
                  <Text style={[styles.suggestionIcon, { color: colors.primary, backgroundColor: colors.bg.tertiary }]}>aish</Text>
                  <Text style={[styles.suggestionCommand, { color: colors.text.primary }]}>{suggestion.command}</Text>
                </View>
                {suggestion.explanation ? (
                  <Text style={[styles.suggestionExplanation, { color: colors.text.muted }]}>{suggestion.explanation}</Text>
                ) : null}
                <View style={styles.suggestionActions}>
                  <Pressable onPress={handleAcceptSuggestion} style={[styles.suggestionAction, { backgroundColor: colors.primary }]}>
                    <Text style={[styles.suggestionActionText, { color: colors.text.inverse }]}>Run</Text>
                  </Pressable>
                  <Pressable onPress={handleInsertSuggestion} style={[styles.suggestionAction, { backgroundColor: colors.primary }]}>
                    <Text style={[styles.suggestionActionText, { color: colors.text.inverse }]}>Insert</Text>
                  </Pressable>
                  <Pressable onPress={handleDismissSuggestion} style={[styles.suggestionActionDismiss, { backgroundColor: colors.bg.tertiary }]}>
                    <Text style={[styles.suggestionDismissText, { color: colors.text.muted }]}>Dismiss</Text>
                  </Pressable>
                  <Text style={[styles.suggestionHint, { color: colors.text.muted }]}>Tab to insert, Enter to run, Esc to dismiss</Text>
                </View>
              </View>
            ) : null}
          </View>
        )}

        {/* Inline input - appears as part of the terminal output flow */}
        <View style={styles.inputContainer}>
          <Text style={[styles.prompt, { color: colors.primary }]}>{smartMode ? 'aish $' : '$'}</Text>
          <TextInput
            ref={inputRef}
            style={[styles.input, { color: colors.text.primary }]}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={handleSubmit}
            onKeyPress={handleKeyPress}
            placeholder={connected ? (smartMode ? 'Type command or describe what you want...' : 'Type command...') : 'Disconnected'}
            placeholderTextColor={colors.text.muted}
            autoCapitalize="none"
            autoCorrect={false}
            editable={connected}
            returnKeyType="send"
          />
        </View>
      </ScrollView>
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
  smartToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  smartLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  switchStyle: {
    transform: [{ scaleX: 0.7 }, { scaleY: 0.7 }],
  },
  output: {
    flex: 1,
  },
  outputContent: {
    padding: spacing[3],
  },
  outputLine: {
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 18,
  },
  // Suggestion box (inline in the output flow)
  suggestionContainer: {
    marginVertical: spacing[2],
    padding: spacing[3],
    borderRadius: 8,
    borderWidth: 1,
  },
  suggestionLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  suggestionLoadingText: {
    fontSize: 13,
  },
  suggestionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: 4,
  },
  suggestionIcon: {
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  suggestionCommand: {
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  suggestionExplanation: {
    fontSize: 12,
    marginBottom: spacing[2],
    marginLeft: spacing[1],
  },
  suggestionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[1],
  },
  suggestionAction: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  suggestionActionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  suggestionActionDismiss: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  suggestionDismissText: {
    fontSize: 12,
  },
  suggestionHint: {
    fontSize: 11,
    marginLeft: 'auto',
  },
  // Input (inline within the scroll content)
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing[1],
  },
  prompt: {
    fontFamily: 'monospace',
    fontSize: 14,
    marginRight: spacing[2],
  },
  input: {
    flex: 1,
    fontFamily: 'monospace',
    fontSize: 14,
    padding: 0,
  },
});
