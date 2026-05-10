/**
 * ChatPanel — shared chat UI used by both project sessions and the Director.
 *
 * Callers provide data + callbacks via props so that state management
 * (which store, which bridge methods) stays outside this component.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, FlatList, Pressable, ScrollView, StyleSheet, ActivityIndicator, Platform, KeyboardAvoidingView } from 'react-native';
import { useKeyboardVisible } from '../hooks/useKeyboardVisible';
import { Text } from '../primitives/Text';
import { Icon } from '../primitives/IconButton';
import { useTheme } from '../styles/theme';
import { spacing, palette } from '../styles/tokens';
import { MessageBubble } from './MessageBubble';
import { AssistantMessage } from './AssistantMessage';
import { ChatInput } from './ChatInput';
import { TypingIndicator } from './TypingIndicator';
import { CompactionSummaryBlock } from './CompactionSummaryBlock';
import { SubagentBlock } from './SubagentBlock';
import { PermissionBanner } from '../permissions/PermissionBanner';
import { QuestionBanner } from '../questions/QuestionBanner';
import type { Message, ToolCall, PermissionResponse, SubagentInfo, QuestionRequest, QuestionResponsePayload } from '../agent/types';

export interface ChatPanelProps {
  /** Current messages to display */
  messages: Message[];
  /** Whether the agent is currently processing */
  isProcessing: boolean;
  /** Whether compaction (conversation summarization) is in progress */
  isCompacting?: boolean;
  /** Current error message, if any */
  error?: string | null;
  /** Pending tool permission request */
  pendingPermission?: ToolCall | null;
  /** Pending question from the question tool */
  pendingQuestion?: QuestionRequest | null;

  /** Called when user sends a message */
  onSendMessage: (content: string) => Promise<void>;
  /** Called when user cancels the current message */
  onCancelMessage: () => void;
  /** Called when user responds to a permission request */
  onPermissionResponse?: (response: PermissionResponse) => Promise<void>;
  /** Called when user responds to a question */
  onQuestionResponse?: (response: QuestionResponsePayload) => Promise<void>;
  /** Called when user clicks a file path in a tool call */
  onFilePathClick?: (filePath: string) => void;

  // --- Optional pagination support ---
  /** Whether there are older messages to load */
  hasMore?: boolean;
  /** Whether older messages are currently loading */
  loadingMore?: boolean;
  /** Called to load older messages */
  onLoadMore?: () => void;

  // --- Optional subagent support ---
  subagents?: SubagentInfo[];

  /** Whether to show the "new messages" indicator when scrolled up (default: true) */
  showNewMessageIndicator?: boolean;

  // --- Customisation ---
  /** Placeholder text for the input */
  placeholder?: string;
  /** Whether the input should be disabled */
  inputDisabled?: boolean;
  /** Component rendered above the message list (e.g. chat header) */
  headerComponent?: React.ReactNode;
  /** Component shown when there are no messages and not processing */
  emptyComponent?: React.ReactNode;

  /** When true, hides the input box and permission banner entirely (read-only mode) */
  hideInput?: boolean;

  /** External control of input text (optional) */
  inputValue?: string;
  onInputChange?: (value: string) => void;

  /** Optional testID for the outer container */
  testID?: string;
  /** Height of UI chrome outside the KeyboardAvoidingView (header above + bars below).
   *  Passed directly as keyboardVerticalOffset. Defaults to 0. */
  keyboardOffset?: number;
}

/** Inline error block rendered in the message list when a session error occurs. */
function ErrorBlock({ error }: { error: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.errorBlock,
        {
          backgroundColor: colors.error + '10',
          borderColor: colors.error + '30',
        },
      ]}
    >
      <Icon name="alertCircle" size={16} color={colors.error} />
      <Text style={[styles.errorBlockText, { color: colors.error }]}>
        {error}
      </Text>
    </View>
  );
}

export function ChatPanel({
  messages,
  isProcessing,
  isCompacting,
  error,
  pendingPermission,
  pendingQuestion,
  onSendMessage,
  onCancelMessage,
  onPermissionResponse,
  onQuestionResponse,
  onFilePathClick,
  hasMore,
  loadingMore,
  onLoadMore,
  subagents,
  showNewMessageIndicator = true,
  placeholder = 'Type a message...',
  inputDisabled = false,
  headerComponent,
  emptyComponent,
  hideInput = false,
  inputValue: externalInputValue,
  onInputChange: externalOnInputChange,
  testID,
  keyboardOffset = 0,
}: ChatPanelProps) {
  const { colors } = useTheme();
  const keyboardVisible = useKeyboardVisible();
  const flatListRef = useRef<FlatList<Message>>(null);

  // Internal input state (used when external control is not provided)
  const [internalInput, setInternalInput] = useState('');
  const inputValue = externalInputValue ?? internalInput;
  const onInputChange = externalOnInputChange ?? setInternalInput;

  // Auto-scroll state
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const lastMessageCountRef = useRef(0);
  // Track whether the next scroll-to-end should skip animation (e.g. initial load)
  const skipNextScrollAnimationRef = useRef(true);

  // Tool expansion state
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [expandedSubagents, setExpandedSubagents] = useState<Set<string>>(new Set());

  const toggleToolExpanded = useCallback((toolId: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
  }, []);

  const toggleSubagentExpanded = useCallback((sessionId: string) => {
    setExpandedSubagents((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }, []);

  // Reset scroll state when messages are cleared (e.g. session switch)
  useEffect(() => {
    if (messages.length === 0) {
      setIsNearBottom(true);
      setNewMessageCount(0);
      lastMessageCountRef.current = 0;
      // Next scroll after loading messages should skip animation
      skipNextScrollAnimationRef.current = true;
    }
  }, [messages.length]);

  // Auto-scroll when new messages arrive, track new-message count
  useEffect(() => {
    const currentCount = messages.length;
    const prevCount = lastMessageCountRef.current;
    if (currentCount > prevCount) {
      if (isNearBottom) {
        // Skip animation for the initial batch load (e.g. opening a saved session)
        const animated = !skipNextScrollAnimationRef.current;
        skipNextScrollAnimationRef.current = false;
        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated });
        }, 50);
      } else {
        setNewMessageCount((prev) => prev + (currentCount - prevCount));
      }
    }
    lastMessageCountRef.current = currentCount;
  }, [messages.length, isNearBottom]);

  // Scroll when processing starts
  useEffect(() => {
    if (isProcessing && isNearBottom) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 50);
    }
  }, [isProcessing, isNearBottom]);

  // Auto-scroll when an error appears
  useEffect(() => {
    if (error && isNearBottom) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 50);
    }
  }, [error, isNearBottom]);

  // Also scroll on content changes of the last message (streaming deltas)
  const lastMsg = messages[messages.length - 1];
  useEffect(() => {
    if (isNearBottom && lastMsg) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: false });
      }, 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMsg?.content, lastMsg?.toolCalls?.length]);

  // Track scroll position
  const handleScroll = useCallback(
    (event: any) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const scrollY = contentOffset.y;
      const contentHeight = contentSize.height;
      const viewHeight = layoutMeasurement.height;
      const distanceFromBottom = contentHeight - scrollY - viewHeight;
      const nearBottom = distanceFromBottom < 100;
      setIsNearBottom(nearBottom);
      if (nearBottom) {
        setNewMessageCount(0);
      }

      // Load older messages when scrolled near the top
      if (scrollY < 200 && hasMore && !loadingMore && onLoadMore) {
        onLoadMore();
      }
    },
    [hasMore, loadingMore, onLoadMore],
  );

  const scrollToBottom = useCallback(() => {
    flatListRef.current?.scrollToEnd({ animated: true });
    setNewMessageCount(0);
  }, []);

  const handleSend = useCallback(async () => {
    const content = inputValue.trim();
    if (!content) return;
    onInputChange('');
    await onSendMessage(content);
  }, [inputValue, onInputChange, onSendMessage]);

  // Use refs for values that change frequently but should not recreate renderItem.
  // The message components that need these (AssistantMessage) read from refs so
  // renderMessage's identity stays stable across re-renders.
  const messagesLengthRef = useRef(messages.length);
  messagesLengthRef.current = messages.length;
  const isProcessingRef = useRef(isProcessing);
  isProcessingRef.current = isProcessing;

  // Render message - user messages get bubbles, assistant messages are inline,
  // compaction summaries get a distinct collapsible block.
  const isCompactingRef = useRef(isCompacting);
  isCompactingRef.current = isCompacting;

  const renderMessage = useCallback(
    ({ item, index }: { item: Message; index: number }) => {
      if (item.isCompactionSummary) {
        return (
          <CompactionSummaryBlock
            message={item}
            isStreaming={isCompactingRef.current && index === messagesLengthRef.current - 1}
          />
        );
      }
      if (item.role === 'assistant') {
        return (
          <AssistantMessage
            message={item}
            expandedToolCalls={expandedTools}
            onToolCallExpand={toggleToolExpanded}
            onFilePathClick={onFilePathClick}
            isLastMessage={index === messagesLengthRef.current - 1}
            isProcessing={isProcessingRef.current}
            autoCollapseOnDone
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
    },
    [expandedTools, toggleToolExpanded, onFilePathClick],
  );

  // List header (load more)
  const ListHeaderComponent = useCallback(() => {
    if (loadingMore) {
      return (
        <View style={styles.loadMoreContainer}>
          <ActivityIndicator size="small" />
          <Text color="muted" style={styles.loadMoreText}>
            Loading older messages...
          </Text>
        </View>
      );
    }
    if (hasMore && onLoadMore) {
      return (
        <Pressable style={styles.loadMoreContainer} onPress={onLoadMore}>
          <Text color="muted" style={styles.loadMoreText}>
            Load older messages
          </Text>
        </Pressable>
      );
    }
    return null;
  }, [loadingMore, hasMore, onLoadMore]);

  // List footer (subagents + error block + typing indicator)
  const runningSubagents = useMemo(
    () => subagents?.filter((s) => s.status === 'running') ?? [],
    [subagents],
  );
  const ListFooterComponent = useCallback(
    () => (
      <>
        {runningSubagents.length > 0 && (
          <View style={{ marginTop: spacing[2] }}>
            {runningSubagents.map((subagent) => (
              <SubagentBlock
                key={subagent.sessionId}
                subagent={subagent}
                expanded={expandedSubagents.has(subagent.sessionId)}
                onToggle={() => toggleSubagentExpanded(subagent.sessionId)}
              />
            ))}
          </View>
        )}
        {error ? (
          <ErrorBlock error={error} />
        ) : null}
        {isProcessing && (
          <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
            <TypingIndicator label={isCompacting ? 'Summarizing conversation' : 'Thinking'} />
          </View>
        )}
      </>
    ),
    [runningSubagents, expandedSubagents, toggleSubagentExpanded, error, isProcessing, isCompacting],
  );

  const keyExtractor = useCallback((item: Message) => item.id, []);

  // Show empty state when no messages
  const showEmpty = messages.length === 0 && !isProcessing;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.bg.primary }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? keyboardOffset : 0}
      testID={testID}
    >
      {headerComponent}

      {showEmpty && emptyComponent ? (
        <ScrollView
          style={styles.emptyContainer}
          contentContainerStyle={styles.emptyContentContainer}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {emptyComponent}
        </ScrollView>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={keyExtractor}
          style={styles.messageList}
          contentContainerStyle={styles.messageListContent}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          ListHeaderComponent={ListHeaderComponent}
          ListFooterComponent={ListFooterComponent}
          extraData={expandedTools}
          removeClippedSubviews={Platform.OS !== 'web'}
          maxToRenderPerBatch={10}
          windowSize={7}
          initialNumToRender={15}
        />
      )}

      {/* Notifications above input */}
      <View style={[styles.notificationsContainer, styles.bottomArea]}>
        {showNewMessageIndicator && newMessageCount > 0 && !isNearBottom && (
          <View style={styles.newMessagesWrapper}>
            <Pressable
              style={[styles.newMessagesButton, { backgroundColor: colors.primary }]}
              onPress={scrollToBottom}
            >
              <Text style={[styles.newMessagesText, { color: colors.text.inverse }]}>
                {newMessageCount} new message{newMessageCount !== 1 ? 's' : ''} ↓
              </Text>
            </Pressable>
          </View>
        )}

        {!hideInput && onPermissionResponse && (
          <PermissionBanner
            toolCall={pendingPermission ?? null}
            onResponse={onPermissionResponse}
          />
        )}

        {!hideInput && onQuestionResponse && (
          <QuestionBanner
            question={pendingQuestion ?? null}
            onResponse={onQuestionResponse}
          />
        )}
      </View>

      {!hideInput && (
        <View style={styles.bottomArea}>
          <View style={[styles.inputContainer, Platform.OS !== 'web' && { paddingBottom: keyboardVisible ? 4 : 20 }]}>
            <ChatInput
              value={inputValue}
              onChange={onInputChange}
              onSubmit={handleSend}
              onCancel={onCancelMessage}
              isProcessing={isProcessing}
              disabled={inputDisabled}
              placeholder={placeholder}
            />
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

// Max width for the chat content area so messages don't stretch too wide
const CHAT_MAX_WIDTH = 768;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
  },
  emptyContentContainer: {
    flexGrow: 1,
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    paddingVertical: 16,
    paddingHorizontal: Platform.OS === 'web' ? 24 : 12,
    maxWidth: CHAT_MAX_WIDTH,
    width: '100%',
    alignSelf: 'center',
  },
  // Shared style for areas below the message list (error bar, notifications, input)
  // to keep them aligned with the message content width
  bottomArea: {
    maxWidth: CHAT_MAX_WIDTH,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: Platform.OS === 'web' ? 24 : 12,
  },
  errorBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: spacing[3],
    marginBottom: spacing[2],
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  errorBlockText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  loadMoreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  loadMoreText: {
    fontSize: 13,
  },
  notificationsContainer: {
    gap: 8,
  },
  newMessagesWrapper: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  newMessagesButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    ...Platform.select({
      web: { boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.2)' } as any,
      default: {
        shadowColor: palette.black,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 4,
      },
    }),
  },
  newMessagesText: {
    fontSize: 13,
    fontWeight: '600',
  },
  inputContainer: {
    paddingTop: 0,
    paddingBottom: Platform.OS === 'web' ? 16 : 20,
  },
});
