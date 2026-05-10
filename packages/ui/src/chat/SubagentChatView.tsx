/**
 * SubagentChatView — Read-only chat view for subagent sessions.
 *
 * Displays the subagent's message history using ChatPanel without any
 * interactive features (no input box, no model picker, no mode picker, etc.).
 * Subscribes to live store updates so it shows real-time streaming output.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from '../primitives/Text';
import { Spinner } from '../primitives/Spinner';
import { useTheme } from '../styles/theme';
import { spacing } from '../styles/tokens';
import { useSessionStore } from '../store/sessionStore';
import { ChatPanel } from './ChatPanel';
import { EmptyState } from '../primitives/EmptyState';
import type { AgentBridge, Message } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('SubagentChatView');

const PAGE_SIZE = 50;

export interface SubagentChatViewProps {
  /** The bridge instance for loading messages */
  bridge: AgentBridge;
  /** The project ID the subagent belongs to */
  projectId: string;
  /** The subagent's session ID */
  subagentSessionId: string;
}

export function SubagentChatView({ bridge, projectId, subagentSessionId }: SubagentChatViewProps) {
  const { colors } = useTheme();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get subagent status from the store
  const { processingBySession, errorBySession, subagentsBySession } = useSessionStore();
  const isProcessing = processingBySession[subagentSessionId] || false;
  const sessionError = errorBySession[subagentSessionId] || null;
  const subagents = subagentsBySession[subagentSessionId] || [];

  // Track session event subscriptions for cleanup
  const sessionEventUnsubRef = useRef<(() => void) | null>(null);

  // Subscribe to store messages for live updates
  useEffect(() => {
    if (!subagentSessionId) return;

    const unsub = useSessionStore.subscribe((state: ReturnType<typeof useSessionStore.getState>) => {
      const liveMessages: Message[] = state.messagesBySession[subagentSessionId] || [];
      if (liveMessages.length === 0) return;

      setMessages((prev: Message[]) => {
        const prevIds = new Set(prev.map((m: Message) => m.id));
        const newFromStore = liveMessages.filter((m: Message) => !prevIds.has(m.id));
        if (newFromStore.length > 0) {
          return [...prev, ...newFromStore];
        }
        // Update existing messages in place (e.g., streaming deltas, tool completions)
        let changed = false;
        const updated = prev.map((m: Message) => {
          const storeVersion = liveMessages.find((sm: Message) => sm.id === m.id);
          if (storeVersion && storeVersion !== m) {
            changed = true;
            return storeVersion;
          }
          return m;
        });
        return changed ? updated : prev;
      });
    });

    return unsub;
  }, [subagentSessionId]);

  // Load messages when the component mounts or subagentSessionId changes
  useEffect(() => {
    setMessages([]);
    setHasMore(false);
    setLoading(true);
    setError(null);

    if (sessionEventUnsubRef.current) {
      sessionEventUnsubRef.current();
      sessionEventUnsubRef.current = null;
    }

    const loadMessages = async () => {
      try {
        await bridge.syncRemoteMessages(projectId, subagentSessionId);

        const result = await bridge.getMessagesPaginated(projectId, subagentSessionId, PAGE_SIZE);

        // Check if the store already has messages (from a previous visit or live SSE events).
        const existingStoreMessages = useSessionStore.getState().messagesBySession[subagentSessionId] || [];
        if (existingStoreMessages.length > result.messages.length) {
          setMessages(existingStoreMessages);
          setHasMore(result.hasMore);
        } else {
          setMessages(result.messages);
          setHasMore(result.hasMore);
          useSessionStore.getState().setMessages(subagentSessionId, result.messages);
        }
      } catch (e) {
        log.error('Failed to load subagent messages:', e);
        // Fall back to loading all messages
        try {
          const msgs = await bridge.getMessages(projectId, subagentSessionId);
          setMessages(msgs);
          useSessionStore.getState().setMessages(subagentSessionId, msgs);
        } catch (e2) {
          setError(e2 instanceof Error ? e2.message : 'Failed to load messages');
        }
      } finally {
        setLoading(false);
      }

      // Check if the subagent session is actively processing on the server
      try {
        const status = await bridge.getSessionStatus(projectId, subagentSessionId);
        if (status && status.stream.status === 'active') {
          log.info('Subagent session is active on server, subscribing to event stream');
          useSessionStore.getState().setProcessing(subagentSessionId, true);
          const unsub = await bridge.subscribeToSessionEvents(projectId, subagentSessionId, 0);
          if (unsub) {
            sessionEventUnsubRef.current = unsub;
          }
        }
      } catch (e) {
        log.debug('Could not check subagent session status:', e);
      }
    };

    loadMessages();

    return () => {
      if (sessionEventUnsubRef.current) {
        sessionEventUnsubRef.current();
        sessionEventUnsubRef.current = null;
      }
    };
  }, [bridge, projectId, subagentSessionId]);

  // Load older messages when scrolling to top
  const loadOlderMessages = useCallback(async () => {
    if (!bridge || loadingMore || !hasMore) return;

    setLoadingMore(true);
    try {
      const oldestMessage = messages[0];
      const beforeSequence = oldestMessage?.sequence;

      const result = await bridge.getMessagesPaginated(
        projectId,
        subagentSessionId,
        PAGE_SIZE,
        beforeSequence,
      );

      if (result.messages.length > 0) {
        setMessages((prev) => [...result.messages, ...prev]);
      }
      setHasMore(result.hasMore);
    } catch (e) {
      log.error('Failed to load older messages:', e);
    } finally {
      setLoadingMore(false);
    }
  }, [bridge, projectId, subagentSessionId, loadingMore, hasMore, messages]);

  // No-op handlers for read-only mode
  const noop = useCallback(async () => {}, []);
  const noopCancel = useCallback(() => {}, []);

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg.primary }]}>
        <Spinner size="large" />
        <Text color="muted" style={styles.loadingText}>Loading subagent session...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg.primary }]}>
        <EmptyState
          icon="alertCircle"
          title="Failed to Load"
          description={error}
          compact
        />
      </View>
    );
  }

  const emptyComponent = (
    <View style={styles.emptyStateWrapper}>
      <EmptyState
        icon="gitBranch"
        title="Subagent Session"
        description="This subagent hasn't produced any output yet"
        compact
      />
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <ChatPanel
        messages={messages}
        isProcessing={isProcessing}
        error={sessionError}
        onSendMessage={noop}
        onCancelMessage={noopCancel}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={loadOlderMessages}
        subagents={subagents}
        placeholder=""
        inputDisabled
        hideInput
        emptyComponent={emptyComponent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: spacing[3],
  },
  emptyStateWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
