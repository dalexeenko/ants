import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, FlatList, Pressable, StyleSheet, KeyboardAvoidingView, Platform, Alert, ActivityIndicator } from 'react-native';
import {
  ThemeContext,
  MessageBubble,
  AssistantMessage,
  ChatInput,
  PermissionModal,
  QuestionBanner,
  SubagentBlock,
  TypingIndicator,
  EmptyState,
  Spinner,
  useSessionStore,
  spacing,
  createLogger,
  type Message,
  type AgentBridge,
  type ToolCall,
  type AgentEvent,
  type SubagentInfo,
  type QuestionRequest,
  type QuestionResponsePayload,
} from '@openmgr/ui';

const log = createLogger('ChatScreen');

// Global counter to track handleSend invocations
let handleSendInvocationCount = 0;

interface ChatScreenProps {
  bridge: AgentBridge;
  projectId: string;
  sessionId: string;
  onFilePathClick?: (filePath: string) => void;
}

export function ChatScreen({
  bridge,
  projectId,
  sessionId,
  onFilePathClick,
}: ChatScreenProps) {
  const { colors } = React.useContext(ThemeContext);
  const flatListRef = useRef<FlatList<Message>>(null);
  
  // Use ref to prevent double-sends (state updates are async)
  const isSendingRef = useRef(false);
  
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingPermission, setPendingPermission] = useState<ToolCall | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<QuestionRequest | null>(null);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [subagents, setSubagents] = useState<SubagentInfo[]>([]);
  const [expandedSubagents, setExpandedSubagents] = useState<Set<string>>(new Set());
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const PAGE_SIZE = 50;

  // Sync local processing/permission state to the Zustand store so that
  // SessionScreen (parent) can display a status indicator in the header.
  useEffect(() => {
    useSessionStore.getState().setProcessing(sessionId, isProcessing);
  }, [sessionId, isProcessing]);

  useEffect(() => {
    useSessionStore.getState().setPendingPermission(sessionId, pendingPermission);
  }, [sessionId, pendingPermission]);

  // Clean up store state when unmounting
  useEffect(() => {
    return () => {
      useSessionStore.getState().setProcessing(sessionId, false);
      useSessionStore.getState().setPendingPermission(sessionId, null);
    };
  }, [sessionId]);

  // Track session event subscription for cleanup
  const sessionEventUnsubRef = useRef<(() => void) | null>(null);
  
  useEffect(() => {
    loadMessages();
    const unsubscribe = subscribeToEvents();
    return () => {
      unsubscribe();
      // Also clean up any session event subscription
      if (sessionEventUnsubRef.current) {
        sessionEventUnsubRef.current();
        sessionEventUnsubRef.current = null;
      }
    };
  }, [sessionId]);

  const loadMessages = async () => {
    try {
      // Sync remote messages first (no-op for local projects)
      await bridge.syncRemoteMessages(projectId, sessionId);
      
      // Load the most recent page of messages
      const result = await bridge.getMessagesPaginated(projectId, sessionId, PAGE_SIZE);
      setMessages(result.messages);
      setHasMore(result.hasMore);
      
      // Check if the session is actively processing on the server.
      // If so, subscribe to its event stream to pick up where we left off.
      try {
        const status = await bridge.getSessionStatus(projectId, sessionId);
        if (status && status.stream.status === 'active') {
          log.info('Session is active on server, subscribing to event stream');
          setIsProcessing(true);
          const unsub = await bridge.subscribeToSessionEvents(projectId, sessionId, 0);
          if (unsub) {
            sessionEventUnsubRef.current = unsub;
          }
        }
      } catch (e) {
        // Session status check is best-effort
        log.debug('Could not check session status:', e);
      }
    } catch (e) {
      log.error('Failed to load messages:', e);
      // Fall back to loading all messages
      try {
        const msgs = await bridge.getMessages(projectId, sessionId);
        setMessages(msgs);
      } catch { /* ignore */ }
    } finally {
      setLoading(false);
    }
  };

  const subscribeToEvents = () => {
    return bridge.subscribeToProject(projectId, (event: AgentEvent) => {
      // Filter events by session if available
      if ('sessionId' in event && event.sessionId !== sessionId) return;

      switch (event.type) {
        case 'message.start':
          setIsProcessing(true);
          setMessages((prev) => [
            ...prev,
            {
              id: event.messageId,
              role: 'assistant',
              content: '',
              contentBlocks: [],
              createdAt: Date.now(),
            },
          ]);
          break;

        case 'message.delta':
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== event.messageId) return m;
              const blocks = [...(m.contentBlocks || [])];
              const lastBlock = blocks[blocks.length - 1];
              if (lastBlock && lastBlock.type === 'text') {
                blocks[blocks.length - 1] = { type: 'text', text: lastBlock.text + event.delta };
              } else {
                blocks.push({ type: 'text', text: event.delta });
              }
              return { ...m, content: m.content + event.delta, contentBlocks: blocks };
            })
          );
          scrollToBottom();
          break;

        case 'message.complete':
          // Don't clear isProcessing here — the agent may still be running
          // (e.g., tool calls in progress between turns). Only 'done' or
          // 'error' events signal the end of the full agent turn.
          break;

        case 'done':
          setIsProcessing(false);
          break;

        case 'tool.start': {
          const newToolCall = {
            id: event.toolCall.id,
            name: event.toolCall.name,
            arguments: event.toolCall.arguments,
            status: 'running' as const,
          };
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== event.messageId) return m;
              const blocks = [...(m.contentBlocks || [])];
              blocks.push({ type: 'tool_call' as const, toolCall: newToolCall });
              return {
                ...m,
                toolCalls: [...(m.toolCalls || []), newToolCall],
                contentBlocks: blocks,
              };
            })
          );
          break;
        }

        case 'tool.complete':
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== event.messageId) return m;
              return {
                ...m,
                toolCalls: m.toolCalls?.map((tc) =>
                  tc.id === event.toolResult.id
                    ? { ...tc, result: event.toolResult.result, status: 'complete' as const }
                    : tc
                ),
                contentBlocks: m.contentBlocks?.map((block) => {
                  if (block.type === 'tool_call' && block.toolCall.id === event.toolResult.id) {
                    return {
                      ...block,
                      toolCall: { ...block.toolCall, result: event.toolResult.result, status: 'complete' as const },
                    };
                  }
                  return block;
                }),
              };
            })
          );
          break;

        case 'tool.permission.request':
          setPendingPermission(event.toolCall);
          break;

        case 'tool.permission.granted':
        case 'tool.permission.denied':
          setPendingPermission(null);
          break;

        case 'question.request':
          setPendingQuestion({
            questionId: event.questionId,
            question: event.question,
            options: event.options,
            multiple: event.multiple,
            allowFreeform: event.allowFreeform,
          });
          break;

        case 'subagent.start':
          setSubagents((prev) => [
            ...prev,
            {
              sessionId: event.sessionId,
              parentSessionId: event.parentSessionId,
              description: event.description,
              status: 'running',
              startedAt: Date.now(),
              async: event.async,
            },
          ]);
          break;

        case 'subagent.complete':
          setSubagents((prev) =>
            prev.map((s) =>
              s.sessionId === event.sessionId
                ? { ...s, status: 'completed' as const, completedAt: Date.now(), result: event.result }
                : s
            )
          );
          break;

        case 'subagent.error':
          setSubagents((prev) =>
            prev.map((s) =>
              s.sessionId === event.sessionId
                ? { ...s, status: 'failed' as const, completedAt: Date.now(), error: event.error }
                : s
            )
          );
          break;

        case 'error':
          setIsProcessing(false);
          // Show the error inline in the chat as an assistant message
          setMessages((prev) => [
            ...prev.filter((m) => m.role !== 'assistant' || m.content !== ''),
            {
              id: `error-${Date.now()}`,
              role: 'assistant',
              content: `Error: ${event.error}`,
              createdAt: Date.now(),
            },
          ]);
          scrollToBottom();
          break;

        case 'setup.start':
          log.info(`[Setup] ${event.component}: ${event.message}`);
          break;

        case 'setup.progress':
          log.info(`[Setup] ${event.component}: ${event.message}${event.progress != null ? ` (${event.progress}%)` : ''}`);
          break;

        case 'setup.complete':
          log.info(`[Setup] ${event.component}: ${event.message}`);
          break;

        case 'setup.error':
          log.error(`[Setup Error] ${event.component}: ${event.error}`);
          break;
      }
    });
  };

  const loadOlderMessages = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    
    setLoadingMore(true);
    try {
      // Use the sequence of the oldest loaded message as the cursor
      const oldestMessage = messages[0];
      const beforeSequence = oldestMessage?.sequence;

      const result = await bridge.getMessagesPaginated(
        projectId,
        sessionId,
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
  }, [loadingMore, hasMore, messages, bridge, projectId, sessionId]);

  const handleScroll = useCallback((event: any) => {
    const { contentOffset } = event.nativeEvent;
    // Load older messages when scrolled near the top
    if (contentOffset.y < 200 && hasMore && !loadingMore) {
      loadOlderMessages();
    }
  }, [hasMore, loadingMore, loadOlderMessages]);

  const scrollToBottom = () => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  const handleSend = useCallback(async () => {
    const invocationId = ++handleSendInvocationCount;
    log.debug(`handleSend #${invocationId} called, input length: ${input.trim().length}, isSendingRef: ${isSendingRef.current}, isProcessing: ${isProcessing}`);
    
    if (!input.trim()) {
      log.debug(`#${invocationId} Empty input, returning`);
      return;
    }
    
    // Prevent double-sends using ref (sync check, unlike state)
    if (isSendingRef.current) {
      log.debug(`#${invocationId} Already sending (ref=true), IGNORING`);
      return;
    }
    
    // Prevent sending while already processing (backup check)
    if (isProcessing) {
      log.debug(`#${invocationId} Already processing (state=true), IGNORING`);
      return;
    }

    // Lock immediately with ref
    log.debug(`#${invocationId} Setting isSendingRef=true`);
    isSendingRef.current = true;
    
    const content = input;
    setInput('');
    setIsProcessing(true);
    log.debug(`#${invocationId} Set isProcessing=true, cleared input`);

    // For user message, we have two approaches:
    // 1. Optimistic: Add immediately, replace with server version on sync
    // 2. Wait: Let server confirm before showing
    // We use approach 1 for responsiveness, but track the ID to dedupe
    const userMessageId = `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const userMessage: Message = {
      id: userMessageId,
      role: 'user',
      content,
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);
    scrollToBottom();
    log.debug(`#${invocationId} Added optimistic message: ${userMessageId}`);

    try {
      log.debug(`#${invocationId} Calling bridge.sendMessage...`);
      await bridge.sendMessage(projectId, sessionId, content);
      log.debug(`#${invocationId} bridge.sendMessage completed`);
      
      // After streaming completes, sync with server to get the final state
      // This REPLACES local messages with server versions (different IDs)
      // IMPORTANT: Must call syncRemoteMessages first to update the cache from server
      log.debug(`#${invocationId} Syncing messages from server...`);
      await bridge.syncRemoteMessages(projectId, sessionId);
      const updatedMessages = await bridge.getMessages(projectId, sessionId);
      log.debug(`#${invocationId} Got ${updatedMessages.length} messages from cache after sync`);
      if (updatedMessages.length > 0) {
        setMessages(updatedMessages);
      }
      scrollToBottom();
      log.debug(`#${invocationId} Sync complete`);
    } catch (e) {
      log.error(`#${invocationId} Failed to send message:`, e);
      
      // Parse the error message for user-friendly display
      const errorMessage = e instanceof Error ? e.message : String(e);
      
      // Check for "already processing" error - remove the optimistic message and retry later
      if (errorMessage.includes('already processing')) {
        log.debug(`#${invocationId} Session busy error, removing optimistic message`);
        // Remove the optimistic user message since the send failed
        setMessages((prev) => prev.filter(m => m.id !== userMessageId));
        // Restore the input so user can try again
        setInput(content);
        // Reset refs/state so user can try again
        isSendingRef.current = false;
        setIsProcessing(false);
        log.debug(`#${invocationId} Reset isSendingRef=false, isProcessing=false`);
        return;
      }
      
      // For other errors, keep the user message but show error
      // Check for specific error codes/messages
      if (errorMessage.includes('NO_PROVIDER') || errorMessage.includes('No AI provider configured')) {
        Alert.alert(
          'Provider Not Configured',
          'Please go to Settings and configure an AI provider (sign in with Anthropic or add an API key) on the remote server.'
        );
      } else if (errorMessage.includes('INVALID_API_KEY') || errorMessage.includes('Invalid API key')) {
        Alert.alert(
          'Invalid API Key',
          'The API key for this server is invalid. Please update it in Settings > Server Settings.'
        );
      } else if (errorMessage.includes('RATE_LIMITED') || errorMessage.includes('Rate limit')) {
        Alert.alert(
          'Rate Limited',
          'You\'ve sent too many requests. Please wait a moment and try again.'
        );
      } else if (errorMessage.includes('QUOTA_EXCEEDED') || errorMessage.includes('quota')) {
        Alert.alert(
          'Quota Exceeded',
          'Your API quota has been exceeded. Please check your account billing.'
        );
      } else {
        Alert.alert(
          'Error',
          `Failed to send message: ${errorMessage}`
        );
      }
      
      // Reset refs/state on error
      log.debug(`#${invocationId} Error path: Reset isSendingRef=false, isProcessing=false`);
      isSendingRef.current = false;
      setIsProcessing(false);
    } finally {
      // Always reset the sending ref when done
      log.debug(`#${invocationId} finally block: isSendingRef was ${isSendingRef.current}, setting to false`);
      isSendingRef.current = false;
    }
  }, [input, isProcessing, bridge, projectId, sessionId]);

  const handleCancel = async () => {
    try {
      await bridge.cancelMessage(projectId);
    } catch (e) {
      log.error('Failed to cancel:', e);
    }
  };

  const handlePermissionResponse = async (response: 'allow_once' | 'allow_always' | 'deny') => {
    if (!pendingPermission) return;
    try {
      await bridge.respondToPermission(projectId, sessionId, pendingPermission.id, response);
      setPendingPermission(null);
    } catch (e) {
      log.error('Failed to respond to permission:', e);
    }
  };

  const handleQuestionResponse = async (response: QuestionResponsePayload) => {
    if (!pendingQuestion) return;
    try {
      await bridge.respondToQuestion(projectId, sessionId, pendingQuestion.questionId, response);
      setPendingQuestion(null);
    } catch (e) {
      log.error('Failed to respond to question:', e);
    }
  };

  const toggleToolExpanded = (toolId: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  };

  const toggleSubagentExpanded = (subagentSessionId: string) => {
    setExpandedSubagents((prev) => {
      const next = new Set(prev);
      if (next.has(subagentSessionId)) {
        next.delete(subagentSessionId);
      } else {
        next.add(subagentSessionId);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.bg.primary }]}>
        <Spinner size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.bg.primary }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 110 : 0}
    >
      {/* Messages */}
      {messages.length === 0 ? (
        <View style={styles.emptyStateWrapper}>
          <EmptyState
            icon="💬"
            title="Start a Conversation"
            description="Type a message to begin working with the AI agent"
            compact
          />
        </View>
      ) : (
        <FlatList
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          ref={flatListRef}
          data={messages}
          renderItem={({ item, index }) => {
            if (item.role === 'assistant') {
              return (
                <AssistantMessage
                  message={item}
                  expandedToolCalls={expandedTools}
                  onToolCallExpand={toggleToolExpanded}
                  isLastMessage={index === messages.length - 1}
                  isProcessing={isProcessing}
                  autoCollapseOnDone
                  onFilePathClick={onFilePathClick}
                />
              );
            }
            return (
              <MessageBubble
                message={item}
                expandedToolCalls={expandedTools}
                onToolCallExpand={toggleToolExpanded}
                onFilePathClick={onFilePathClick}
              />
            );
          }}
          keyExtractor={(item) => item.id}
          style={styles.messages}
          contentContainerStyle={styles.messagesContent}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          ListHeaderComponent={
            loadingMore ? (
              <View style={styles.loadMoreContainer}>
                <ActivityIndicator size="small" />
              </View>
            ) : hasMore ? (
              <Pressable style={styles.loadMoreContainer} onPress={loadOlderMessages}>
                <Spinner size="small" />
              </Pressable>
            ) : null
          }
          ListFooterComponent={
            <>
              {subagents.length > 0 && subagents.some(s => s.status === 'running') && (
                <View style={{ marginTop: spacing[2] }}>
                  {subagents.filter(s => s.status === 'running').map((subagent) => (
                    <SubagentBlock
                      key={subagent.sessionId}
                      subagent={subagent}
                      expanded={expandedSubagents.has(subagent.sessionId)}
                      onToggle={() => toggleSubagentExpanded(subagent.sessionId)}
                    />
                  ))}
                </View>
              )}
              {isProcessing && (
                <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
                  <TypingIndicator />
                </View>
              )}
            </>
          }
          // Performance optimizations
          removeClippedSubviews={Platform.OS !== 'web'}
          maxToRenderPerBatch={10}
          windowSize={11}
          initialNumToRender={PAGE_SIZE}
          onContentSizeChange={() => {
            // Only auto-scroll on initial load, not when prepending older messages
            if (!loadingMore) {
              scrollToBottom();
            }
          }}
        />
      )}

      {/* Question Banner */}
      <QuestionBanner
        question={pendingQuestion}
        onResponse={handleQuestionResponse}
      />

      {/* Input */}
      <View style={styles.inputContainer}>
        <ChatInput
          value={input}
          onChange={setInput}
          onSubmit={handleSend}
          onCancel={handleCancel}
          isProcessing={isProcessing}
          placeholder="Type a message..."
        />
      </View>

      {/* Permission Modal */}
      <PermissionModal
        visible={!!pendingPermission}
        toolCall={pendingPermission}
        onResponse={handlePermissionResponse}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messages: {
    flex: 1,
  },
  messagesContent: {
    padding: spacing[2],
    paddingBottom: spacing[2],
  },
  emptyStateWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadMoreContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  inputContainer: {
    borderTopWidth: 1,
    borderTopColor: 'transparent',
    paddingHorizontal: spacing[2],
  },

});
