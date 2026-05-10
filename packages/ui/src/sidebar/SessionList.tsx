import React from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Text } from '../primitives/Text';
import { SessionListItem } from './SessionListItem';
import { useTheme } from '../styles/theme';
import { spacing } from '../styles/tokens';
import type { Session } from '../agent/types';

export interface SessionListProps {
  sessions: Session[];
  selectedSessionId?: string;
  onSelectSession: (session: Session) => void;
  onDeleteSession?: (session: Session) => void;
  loading?: boolean;
}

export function SessionList({
  sessions,
  selectedSessionId,
  onSelectSession,
  onDeleteSession,
  loading,
}: SessionListProps) {
  const { colors } = useTheme();

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={colors.text.muted} />
      </View>
    );
  }

  if (sessions.length === 0) {
    return (
      <View style={styles.empty}>
        <Text variant="caption" color="muted" align="center">
          No sessions yet
        </Text>
      </View>
    );
  }

  return (
    <View testID="ants-session-list" style={styles.list}>
      {sessions.map((session) => (
        <SessionListItem
          key={session.id}
          session={session}
          selected={session.id === selectedSessionId}
          onPress={() => onSelectSession(session)}
          onDelete={onDeleteSession ? () => onDeleteSession(session) : undefined}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingVertical: spacing[1],
  },
  loading: {
    padding: spacing[4],
    alignItems: 'center',
  },
  empty: {
    padding: spacing[4],
  },
});
