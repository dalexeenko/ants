import React, { useCallback, useEffect } from 'react';
import { View, ScrollView, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Text } from '../primitives/Text';
import { IconButton, Icon } from '../primitives/IconButton';
import { Divider } from '../primitives/Divider';
import { useTheme } from '../styles/theme';
import { borderRadius } from '../styles/tokens';
import { useDirectorStore } from '../store/directorStore';
import type { Session, AgentBridge } from '../agent/types';

interface DirectorSidebarProps {
  bridge: AgentBridge;
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

function DirectorSessionItem({
  session,
  selected,
  onPress,
  onDelete,
  processing,
}: {
  session: Session;
  selected: boolean;
  onPress: () => void;
  onDelete: () => void;
  processing: boolean;
}) {
  const { colors } = useTheme();
  const [hovered, setHovered] = React.useState(false);

  return (
    <Pressable
      testID={`director-session-${session.id}`}
      style={[
        styles.sessionItem,
        {
          backgroundColor: selected ? colors.bg.tertiary : hovered ? colors.bg.secondary : 'transparent',
          borderRadius: borderRadius.md,
        },
      ]}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
    >
      <View style={styles.sessionItemLeft}>
        {processing ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Icon name="sparkles" size={14} color={colors.text.muted} />
        )}
      </View>
      <View style={styles.sessionItemContent}>
        <Text numberOfLines={1} style={{ fontSize: 13 }}>
          {session.title || 'Untitled'}
        </Text>
        <Text color="muted" style={{ fontSize: 11 }}>
          {formatRelativeTime(session.createdAt)}
        </Text>
      </View>
      {(hovered || selected) && (
        <IconButton
          icon="trash-2"
          size="sm"
          variant="ghost"
          onPress={(e) => {
            e?.stopPropagation?.();
            onDelete();
          }}
        />
      )}
    </Pressable>
  );
}

export function DirectorSidebar({ bridge }: DirectorSidebarProps) {
  const { colors } = useTheme();
  const sessions = useDirectorStore((s) => s.sessions);
  const currentSessionId = useDirectorStore((s) => s.currentSessionId);
  const processingBySession = useDirectorStore((s) => s.processingBySession);
  const setSessions = useDirectorStore((s) => s.setSessions);
  const setCurrentSession = useDirectorStore((s) => s.setCurrentSession);
  const removeSession = useDirectorStore((s) => s.removeSession);
  const addSession = useDirectorStore((s) => s.addSession);

  // Load sessions on mount
  useEffect(() => {
    bridge.directorListSessions().then(setSessions).catch(() => {});
  }, [bridge]);

  const handleNewSession = useCallback(async () => {
    try {
      const session = await bridge.directorCreateSession();
      addSession(session);
      setCurrentSession(session.id);
    } catch (e) {
      // Could show a toast here
    }
  }, [bridge, addSession, setCurrentSession]);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    try {
      await bridge.directorDeleteSession(sessionId);
      removeSession(sessionId);
    } catch (e) {
      // Could show a toast here
    }
  }, [bridge, removeSession]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setCurrentSession(sessionId);
  }, [setCurrentSession]);

  return (
    <View
      testID="director-sidebar"
      style={[styles.container, { backgroundColor: colors.bg.secondary, borderRightColor: colors.border.light }]}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Icon name="sparkles" size={16} color={colors.primary} />
          <Text variant="heading" style={styles.title}>Director</Text>
        </View>
        <IconButton
          testID="director-new-session"
          icon="plus"
          size="sm"
          variant="ghost"
          onPress={handleNewSession}
        />
      </View>
      <Divider spacing="none" />
      <ScrollView style={styles.sessionList} contentContainerStyle={styles.sessionListContent}>
        {sessions.length === 0 ? (
          <View style={styles.emptyState}>
            <Icon name="sparkles" size={32} color={colors.text.muted} />
            <Text color="muted" style={styles.emptyTitle}>
              Meet the Director
            </Text>
            <Text color="muted" style={styles.emptyDescription as any}>
              Your configuration assistant. Ask about setting up projects, servers, authentication, Docker, and more.
            </Text>
            <Pressable
              testID="director-start-chat"
              style={[styles.startButton, { backgroundColor: colors.primary }]}
              onPress={handleNewSession}
            >
              <Text style={{ color: colors.text.inverse, fontSize: 13, fontWeight: '600' }}>
                Start a conversation
              </Text>
            </Pressable>
          </View>
        ) : (
          sessions.map((session) => (
            <DirectorSessionItem
              key={session.id}
              session={session}
              selected={session.id === currentSessionId}
              processing={!!processingBySession[session.id]}
              onPress={() => handleSelectSession(session.id)}
              onDelete={() => handleDeleteSession(session.id)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 280,
    borderRightWidth: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 18,
  },
  sessionList: {
    flex: 1,
  },
  sessionListContent: {
    padding: 8,
    gap: 2,
  },
  sessionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 8,
  },
  sessionItemLeft: {
    width: 20,
    alignItems: 'center',
  },
  sessionItemContent: {
    flex: 1,
    gap: 2,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
    paddingTop: 60,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  emptyDescription: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  startButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    marginTop: 8,
  },
});
