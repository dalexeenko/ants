import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import {
  ThemeContext,
  useUIStore,
  useSessionStore,
  ChatPanel,
  TokenUsageBar,
  ModelPickerDropdown,
  ModePicker,
  AutoCompleteToggle,
  EmptyState,
  ToolSettings,
  PermissionSettings,
  spacing,
  createLogger,
  type Message,
  type PermissionResponse,
  type QuestionResponsePayload,
} from '../index';

const log = createLogger('ChatView');

const PAGE_SIZE = 50;

export function ChatView({ projectId, showSessionSettings = false }: { projectId: string; showSessionSettings?: boolean }) {
  const { colors } = React.useContext(ThemeContext);

  // Use granular selectors to avoid re-rendering on unrelated store changes
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const isProcessing = useSessionStore(
    (s) => (currentSessionId ? s.processingBySession[currentSessionId] || false : false),
  );
  const pendingPermission = useSessionStore(
    (s) => (currentSessionId ? s.pendingPermissionsBySession[currentSessionId] || null : null),
  );
  const pendingQuestion = useSessionStore(
    (s) => (currentSessionId ? s.pendingQuestionsBySession[currentSessionId] || null : null),
  );
  const error = useSessionStore(
    (s) => (currentSessionId ? s.errorBySession[currentSessionId] || null : null),
  );
  const subagents = useSessionStore(
    (s) => (currentSessionId ? s.subagentsBySession[currentSessionId] || [] : []),
  );
  const isCompacting = useSessionStore(
    (s) => (currentSessionId ? s.compactingBySession[currentSessionId] || false : false),
  );
  const contextUsage = useSessionStore(
    (s) => (currentSessionId ? s.contextUsageBySession[currentSessionId] || null : null),
  );

  // Pagination state
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Subscribe to store messages for live updates (new messages from events).
  // Merge live store messages with paginated messages using an indexed lookup
  // instead of O(n*m) scans on every store update.
  const prevIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!currentSessionId) return;

    // Reset the cached ID set when the session changes so stale IDs from
    // a previous session don't filter out messages in the new one.
    prevIdsRef.current = new Set();

    const sessionId = currentSessionId;
    const unsub = useSessionStore.subscribe((state, prevState) => {
      const liveMessages = state.messagesBySession[sessionId] || [];
      const prevMessages = prevState.messagesBySession[sessionId] || [];

      // Skip if the messages array for this session didn't change
      if (liveMessages === prevMessages) return;
      if (liveMessages.length === 0) return;

      setMessages((prev) => {
        // Rebuild the ID set only when the local array changes length
        if (prevIdsRef.current.size !== prev.length) {
          prevIdsRef.current = new Set(prev.map((m) => m.id));
        }
        const prevIds = prevIdsRef.current;

        // Check for brand-new messages from the store
        const newFromStore = liveMessages.filter((m) => !prevIds.has(m.id));
        if (newFromStore.length > 0) {
          // Add new IDs to our cached set
          for (const m of newFromStore) prevIds.add(m.id);
          return [...prev, ...newFromStore];
        }

        // Build an index of store messages for O(1) lookup
        const storeById = new Map<string, Message>();
        for (const m of liveMessages) storeById.set(m.id, m);

        // Update existing messages in place (e.g., streaming deltas, tool completions)
        let changed = false;
        const updated = prev.map((m) => {
          const storeVersion = storeById.get(m.id);
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
  }, [currentSessionId]);

  // Load older messages when scrolling to top (cursor-based pagination)
  const loadOlderMessages = useCallback(async () => {
    if (!currentSessionId || !window.agentBridge || loadingMore || !hasMore) return;

    setLoadingMore(true);
    try {
      const oldestMessage = messages[0];
      const beforeSequence = oldestMessage?.sequence;

      const result = await window.agentBridge.getMessagesPaginated(
        projectId,
        currentSessionId,
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
  }, [currentSessionId, projectId, loadingMore, hasMore, messages]);

  // Reset state when session changes
  useEffect(() => {
    setMessages([]);
    setHasMore(false);
  }, [currentSessionId]);

  // Track session event subscriptions for cleanup
  const sessionEventUnsubRef = React.useRef<(() => void) | null>(null);

  // Load messages when session changes
  useEffect(() => {
    if (!currentSessionId || !window.agentBridge) return;

    if (sessionEventUnsubRef.current) {
      sessionEventUnsubRef.current();
      sessionEventUnsubRef.current = null;
    }

    const loadInitialMessages = async () => {
      await window.agentBridge!.syncRemoteMessages(projectId, currentSessionId);

      const result = await window.agentBridge!.getMessagesPaginated(projectId, currentSessionId, PAGE_SIZE);

      // Check if the store already has messages (from a previous visit or live SSE events).
      // If the store has more messages than the fresh load, keep the store messages
      // and just fill in the local state from them. Otherwise, use the fresh load.
      const existingStoreMessages = useSessionStore.getState().messagesBySession[currentSessionId] || [];
      if (existingStoreMessages.length > result.messages.length) {
        // Store has more messages (likely from SSE streaming). Use them.
        setMessages(existingStoreMessages);
        setHasMore(result.hasMore);
      } else {
        setMessages(result.messages);
        setHasMore(result.hasMore);
        // Update the store so live events can merge properly
        useSessionStore.getState().setMessages(currentSessionId, result.messages);
      }
    };
    loadInitialMessages().catch((e) => {
      log.error('Failed to load messages:', e);
      // Fall back to loading all messages
      window.agentBridge!.getMessages(projectId, currentSessionId).then(msgs => {
        setMessages(msgs);
        useSessionStore.getState().setMessages(currentSessionId, msgs);
      }).catch(() => {});
    });

    // Check if the session is actively processing on the server
    const bridge = window.agentBridge;
    bridge.getSessionStatus(projectId, currentSessionId)
      .then(async (status) => {
        if (status && status.stream.status === 'active') {
          log.info('Session is active on server, subscribing to event stream');
          useSessionStore.getState().setProcessing(currentSessionId, true);
          const unsub = await bridge.subscribeToSessionEvents(projectId, currentSessionId, 0);
          if (unsub) {
            sessionEventUnsubRef.current = unsub;
          }
        }
      })
      .catch((e) => {
        log.debug('Could not check session status:', e);
      });

    return () => {
      if (sessionEventUnsubRef.current) {
        sessionEventUnsubRef.current();
        sessionEventUnsubRef.current = null;
      }
    };
  }, [projectId, currentSessionId]);

  const handleSend = useCallback(async (content: string) => {
    if (!currentSessionId) return;

    useSessionStore.getState().setProcessing(currentSessionId, true);

    // Add user message optimistically
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      createdAt: Date.now(),
    };
    useSessionStore.getState().addMessage(currentSessionId, userMsg);

    try {
      await window.agentBridge?.sendMessage(projectId, currentSessionId, content);
    } catch (e) {
      log.error('Failed to send message:', e);
      useSessionStore.getState().setProcessing(currentSessionId, false);
    }
  }, [projectId, currentSessionId]);

  const handleCancel = useCallback(async () => {
    try {
      await window.agentBridge?.cancelMessage(projectId);
    } catch (e) {
      log.error('Failed to cancel:', e);
    }
  }, [projectId]);

  const handlePermissionResponse = useCallback(async (response: PermissionResponse) => {
    if (!pendingPermission || !currentSessionId) return;
    try {
      await window.agentBridge?.respondToPermission(projectId, currentSessionId, pendingPermission.id, response);
      useSessionStore.getState().setPendingPermission(currentSessionId, null);
    } catch (e) {
      log.error('Failed to respond to permission:', e);
    }
  }, [projectId, currentSessionId, pendingPermission]);

  const handleQuestionResponse = useCallback(async (response: QuestionResponsePayload) => {
    if (!pendingQuestion || !currentSessionId) return;
    try {
      await window.agentBridge?.respondToQuestion(projectId, currentSessionId, pendingQuestion.questionId, response);
      useSessionStore.getState().setPendingQuestion(currentSessionId, null);
    } catch (e) {
      log.error('Failed to respond to question:', e);
    }
  }, [projectId, currentSessionId, pendingQuestion]);

  const handleFilePathClick = useCallback((filePath: string) => {
    useUIStore.getState().openFileTab(filePath);
  }, []);

  const headerComponent = useMemo(
    () => (
      <>
        {/* Chat header */}
        <View style={[styles.chatHeader, { borderBottomColor: colors.border.light }]}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
            {currentSessionId && (
              <ModePicker
                bridge={window.agentBridge!}
                projectId={projectId}
                sessionId={currentSessionId}
              />
            )}
            {currentSessionId && (
              <AutoCompleteToggle sessionId={currentSessionId} />
            )}
            {currentSessionId && (
              <ModelPickerDropdown
                bridge={window.agentBridge!}
                projectId={projectId}
                sessionId={currentSessionId}
              />
            )}
            {window.agentBridge && (
              <TokenUsageBar
                bridge={window.agentBridge}
                projectId={projectId}
                contextUsage={contextUsage}
              />
            )}
          </View>
        </View>

        {/* Session settings panel */}
        {showSessionSettings && window.agentBridge && (
          <ScrollView style={{ maxHeight: 300, borderBottomWidth: 1, borderBottomColor: colors.border.light }}>
            <View style={{ padding: 16 }}>
              <ToolSettings
                bridge={window.agentBridge}
                projectId={projectId}
              />
              <PermissionSettings bridge={window.agentBridge} projectId={projectId} />
            </View>
          </ScrollView>
        )}
      </>
    ),
    [colors.border.light, currentSessionId, projectId, showSessionSettings, contextUsage],
  );

  const emptyComponent = useMemo(
    () => (
      <View style={styles.emptyStateWrapper}>
        <EmptyState
          icon="zap"
          title="Start a Conversation"
          description="Type a message below to begin working with the AI agent"
          compact
        />
      </View>
    ),
    [],
  );

  if (!currentSessionId) {
    return (
      <View style={[styles.chatEmpty, { backgroundColor: colors.bg.primary }]}>
        <View style={styles.chatEmptyContent}>
          <EmptyState
            icon="message"
            title="No Session Selected"
            description="Select a session from the sidebar or create a new one to start chatting"
            compact
          />
        </View>
      </View>
    );
  }

  return (
    <View testID="openmgr-chat-view" style={{ flex: 1 }}>
      <ChatPanel
        messages={messages}
        isProcessing={isProcessing}
        isCompacting={isCompacting}
        error={error}
        pendingPermission={pendingPermission}
        pendingQuestion={pendingQuestion}
        onSendMessage={handleSend}
        onCancelMessage={handleCancel}
        onPermissionResponse={handlePermissionResponse}
        onQuestionResponse={handleQuestionResponse}
        onFilePathClick={handleFilePathClick}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={loadOlderMessages}
        subagents={subagents}
        placeholder="Type a message..."
        inputDisabled={!currentSessionId}
        headerComponent={headerComponent}
        emptyComponent={emptyComponent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    zIndex: 10,
  },
  chatEmpty: {
    flex: 1,
  },
  chatEmptyContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
