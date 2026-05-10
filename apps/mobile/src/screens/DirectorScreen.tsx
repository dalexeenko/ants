import React, { useEffect, useCallback, useState } from 'react';
import { View, StyleSheet, Pressable, ScrollView, ActivityIndicator, LayoutChangeEvent } from 'react-native';
import {
  ThemeContext,
  Text,
  IconButton,
  DirectorChatView,
  useDirectorStore,
  spacing,
  type AgentBridge,
} from '@ants/ui';
import { Plus, Trash2, Sparkles, MessageSquare, Clock } from 'lucide-react-native';

interface DirectorScreenProps {
  bridge: AgentBridge;
  onOpenDrawer?: () => void;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

type TabId = 'chat' | 'sessions';

export function DirectorScreen({ bridge, onOpenDrawer }: DirectorScreenProps) {
  const { colors } = React.useContext(ThemeContext);
  const [activeTab, setActiveTab] = useState<TabId>('chat');
  const [headerHeight, setHeaderHeight] = useState(0);
  const [tabBarHeight, setTabBarHeight] = useState(0);

  const sessions = useDirectorStore((s) => s.sessions);
  const currentSessionId = useDirectorStore((s) => s.currentSessionId);
  const processingBySession = useDirectorStore((s) => s.processingBySession);

  // Load sessions on mount
  useEffect(() => {
    bridge.directorListSessions().then((list) => {
      useDirectorStore.getState().setSessions(list);
    }).catch(() => {});
  }, [bridge]);

  // Subscribe to Director events
  useEffect(() => {
    const unsubscribe = bridge.directorSubscribeToEvents((event) => {
      const store = useDirectorStore.getState();

      switch (event.type) {
        case 'message.start':
          store.setProcessing(event.sessionId, true);
          store.setError(event.sessionId, null);
          store.setDone(event.sessionId, false);
          store.addMessage(event.sessionId, {
            id: event.messageId,
            role: 'assistant',
            content: '',
            contentBlocks: [],
            createdAt: Date.now(),
          });
          break;

        case 'message.delta':
          store.updateMessage(event.sessionId, event.messageId, (msg) => {
            const blocks = [...(msg.contentBlocks || [])];
            const lastBlock = blocks[blocks.length - 1];
            if (lastBlock && lastBlock.type === 'text') {
              blocks[blocks.length - 1] = { type: 'text', text: lastBlock.text + event.delta };
            } else {
              blocks.push({ type: 'text', text: event.delta });
            }
            return {
              content: msg.content + event.delta,
              contentBlocks: blocks,
            };
          });
          break;

        case 'tool.start': {
          const newToolCall = {
            id: event.toolCall.id,
            name: event.toolCall.name,
            arguments: event.toolCall.arguments,
            status: 'running' as const,
          };
          store.updateMessage(event.sessionId, event.messageId, (msg) => {
            const blocks = [...(msg.contentBlocks || [])];
            blocks.push({ type: 'tool_call' as const, toolCall: newToolCall });
            return {
              toolCalls: [...(msg.toolCalls || []), newToolCall],
              contentBlocks: blocks,
            };
          });
          break;
        }

        case 'tool.complete':
          store.updateMessage(event.sessionId, event.messageId, (msg) => {
            const updatedToolCalls = msg.toolCalls?.map((tc) =>
              tc.id === event.toolResult.id
                ? { ...tc, result: event.toolResult.result, status: 'complete' as const }
                : tc
            );
            const updatedBlocks = msg.contentBlocks?.map((block) => {
              if (block.type === 'tool_call' && block.toolCall.id === event.toolResult.id) {
                return {
                  ...block,
                  toolCall: { ...block.toolCall, result: event.toolResult.result, status: 'complete' as const },
                };
              }
              return block;
            });
            return {
              toolCalls: updatedToolCalls,
              contentBlocks: updatedBlocks,
            };
          });
          break;

        case 'tool.permission.request':
          store.setPendingPermission(event.sessionId, event.toolCall);
          break;

        case 'tool.permission.granted':
        case 'tool.permission.denied':
          store.setPendingPermission(event.sessionId, null);
          break;

        case 'question.request':
          store.setPendingQuestion(event.sessionId, {
            questionId: event.questionId,
            question: event.question,
            options: event.options,
            multiple: event.multiple,
            allowFreeform: event.allowFreeform,
          });
          break;

        case 'session.title.updated':
          store.updateSession(event.sessionId, { title: event.title });
          break;

        case 'todos.updated':
          store.setTodos(event.sessionId, event.todos);
          break;

        case 'done':
          store.setProcessing(event.sessionId, false);
          break;

        case 'error':
          if (event.sessionId) {
            store.setProcessing(event.sessionId, false);
            store.setError(event.sessionId, event.error);
          }
          break;
      }
    });

    return unsubscribe;
  }, [bridge]);

  const handleNewSession = useCallback(async () => {
    try {
      const session = await bridge.directorCreateSession();
      useDirectorStore.getState().addSession(session);
      useDirectorStore.getState().setCurrentSession(session.id);
      setActiveTab('chat');
    } catch {
      // ignore
    }
  }, [bridge]);

  const handleSelectSession = useCallback((sessionId: string) => {
    useDirectorStore.getState().setCurrentSession(sessionId);
    setActiveTab('chat');
  }, []);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    try {
      await bridge.directorDeleteSession(sessionId);
      useDirectorStore.getState().removeSession(sessionId);
    } catch {
      // ignore
    }
  }, [bridge]);

  const handleHeaderLayout = useCallback((e: LayoutChangeEvent) => {
    setHeaderHeight(e.nativeEvent.layout.height);
  }, []);

  const handleTabBarLayout = useCallback((e: LayoutChangeEvent) => {
    setTabBarHeight(e.nativeEvent.layout.height);
  }, []);

  const keyboardOffset = headerHeight + tabBarHeight;

  return (
    <View testID="ants-director-screen" style={[styles.container, { backgroundColor: colors.bg.primary }]}>
      {/* Header */}
      <View
        style={[styles.header, { backgroundColor: colors.bg.secondary, borderBottomColor: colors.border.light }]}
        onLayout={handleHeaderLayout}
      >
        {onOpenDrawer && (
          <IconButton testID="ants-drawer-toggle" icon="menu" size="md" onPress={onOpenDrawer} />
        )}
        <Text variant="heading" style={styles.headerTitle}>Director</Text>
        <IconButton
          testID="director-new-session"
          icon="plus"
          size="md"
          onPress={handleNewSession}
        />
      </View>

      {/* Content */}
      <View style={styles.content}>
        {activeTab === 'chat' && (
          <DirectorChatView bridge={bridge} keyboardOffset={keyboardOffset} />
        )}
        {activeTab === 'sessions' && (
          <SessionsTab
            sessions={sessions}
            currentSessionId={currentSessionId}
            processingBySession={processingBySession}
            onSelect={handleSelectSession}
            onDelete={handleDeleteSession}
            onNew={handleNewSession}
          />
        )}
      </View>

      {/* Tab bar */}
      <View
        style={[styles.tabBar, { backgroundColor: colors.bg.secondary, borderTopColor: colors.border.light }]}
        onLayout={handleTabBarLayout}
      >
        <Pressable
          style={styles.tab}
          onPress={() => setActiveTab('chat')}
        >
          <MessageSquare size={22} color={activeTab === 'chat' ? colors.primary : colors.text.muted} />
          <Text variant="caption" style={[styles.tabLabel, { color: activeTab === 'chat' ? colors.primary : colors.text.muted }]}>
            Chat
          </Text>
        </Pressable>
        <Pressable
          style={styles.tab}
          onPress={() => setActiveTab('sessions')}
        >
          <Clock size={22} color={activeTab === 'sessions' ? colors.primary : colors.text.muted} />
          <Text variant="caption" style={[styles.tabLabel, { color: activeTab === 'sessions' ? colors.primary : colors.text.muted }]}>
            Sessions
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sessions tab
// ---------------------------------------------------------------------------

interface SessionsTabProps {
  sessions: ReturnType<typeof useDirectorStore.getState>['sessions'];
  currentSessionId: string | null;
  processingBySession: Record<string, boolean>;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}

function SessionsTab({ sessions, currentSessionId, processingBySession, onSelect, onDelete, onNew }: SessionsTabProps) {
  const { colors } = React.useContext(ThemeContext);

  return (
    <View style={styles.sessionsContainer}>
      {sessions.length === 0 ? (
        <View style={styles.emptyState}>
          <Sparkles size={32} color={colors.text.muted} />
          <Text color="muted" style={styles.emptyText}>No conversations yet</Text>
          <Pressable
            onPress={onNew}
            style={[styles.newButton, { backgroundColor: colors.primary }]}
          >
            <Plus size={16} color={colors.text.inverse} />
            <Text style={{ color: colors.text.inverse, fontSize: 14, fontWeight: '600' }}>
              New Session
            </Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.sessionList}>
          <Pressable
            onPress={onNew}
            style={[styles.newSessionRow, { borderColor: colors.border.medium, borderRadius: 10 }]}
          >
            <Plus size={16} color={colors.primary} />
            <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '600' }}>New Session</Text>
          </Pressable>

          {sessions.map((session) => {
            const isSelected = session.id === currentSessionId;
            const isProcessing = !!processingBySession[session.id];
            return (
              <Pressable
                key={session.id}
                testID={`director-session-${session.id}`}
                onPress={() => onSelect(session.id)}
                style={({ pressed }) => [
                  styles.sessionItem,
                  {
                    backgroundColor: isSelected
                      ? colors.bg.tertiary
                      : pressed
                      ? colors.bg.tertiary + '80'
                      : colors.bg.secondary,
                    borderRadius: 10,
                  },
                ]}
              >
                <View style={styles.sessionItemLeft}>
                  {isProcessing ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Sparkles size={16} color={isSelected ? colors.primary : colors.text.muted} />
                  )}
                </View>
                <View style={styles.sessionItemContent}>
                  <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: isSelected ? '600' : '400' }}>
                    {session.title || 'Untitled'}
                  </Text>
                  <Text color="muted" style={{ fontSize: 12 }}>
                    {formatRelativeTime(session.createdAt)}
                  </Text>
                </View>
                <Pressable
                  testID={`director-delete-session-${session.id}`}
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    onDelete(session.id);
                  }}
                  style={({ pressed }) => [
                    styles.deleteButton,
                    { backgroundColor: pressed ? colors.bg.tertiary : 'transparent' },
                  ]}
                  hitSlop={8}
                >
                  <Trash2 size={15} color={colors.text.muted} />
                </Pressable>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    flex: 1,
    textAlign: 'center',
  },
  content: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingBottom: spacing[3],
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[2.5],
    gap: 2,
  },
  tabLabel: {
    fontSize: 11,
  },
  // Sessions tab
  sessionsContainer: {
    flex: 1,
  },
  sessionList: {
    padding: spacing[3],
    gap: spacing[2],
  },
  newSessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  sessionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[3],
    gap: spacing[3],
  },
  sessionItemLeft: {
    width: 24,
    alignItems: 'center',
  },
  sessionItemContent: {
    flex: 1,
    gap: 2,
  },
  deleteButton: {
    padding: spacing[1],
    borderRadius: 6,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    padding: spacing[8],
  },
  emptyText: {
    fontSize: 14,
  },
  newButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: 8,
    marginTop: spacing[2],
  },
});
