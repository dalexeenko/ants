/**
 * TodosPanel - Shows todos and phases for the current session.
 *
 * Displays todo items with status indicators (pending/in-progress/completed/cancelled)
 * and phase items with progress bars. Data is synced from the agent via SSE events.
 */

import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text } from '../primitives/Text';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius, fontSize } from '../styles/tokens';
import { useSessionStore } from '../store/sessionStore';
import type { TodoItem, PhaseItem } from '../agent/types';

interface TodosPanelProps {
  sessionId: string;
}

const STATUS_ICONS: Record<string, string> = {
  pending: '\u25CB',       // empty circle
  in_progress: '\u25D4',   // half circle
  completed: '\u25CF',     // filled circle
  cancelled: '\u2715',     // X
};

function getPriorityColors(colors: any): Record<string, string> {
  return {
    high: colors.error,
    medium: colors.warning,
    low: colors.text.muted,
  };
}

function TodoRow({ todo, colors }: { todo: TodoItem; colors: any }) {
  const isDone = todo.status === 'completed' || todo.status === 'cancelled';
  return (
    <View style={[styles.todoRow, { borderBottomColor: colors.border.light }]}>
      <Text style={[
        styles.statusIcon,
        { color: isDone ? colors.text.muted : (todo.status === 'in_progress' ? colors.primary : colors.text.secondary) },
      ]}>
        {STATUS_ICONS[todo.status] || STATUS_ICONS.pending}
      </Text>
      <View style={styles.todoContent}>
        <Text
          style={[
            styles.todoText,
            { color: isDone ? colors.text.muted : colors.text.primary },
            isDone && styles.todoTextDone,
          ]}
          numberOfLines={2}
        >
          {todo.content}
        </Text>
        <View style={styles.todoMeta}>
          <View style={[styles.priorityDot, { backgroundColor: getPriorityColors(colors)[todo.priority] || colors.text.muted }]} />
          <Text style={[styles.metaText, { color: colors.text.muted }]}>
            {todo.priority}
          </Text>
        </View>
      </View>
    </View>
  );
}

function PhaseRow({ phase, colors }: { phase: PhaseItem; colors: any }) {
  const isDone = phase.status === 'completed' || phase.status === 'cancelled';
  return (
    <View style={[styles.phaseRow, { borderBottomColor: colors.border.light }]}>
      <Text style={[
        styles.statusIcon,
        { color: isDone ? colors.text.muted : (phase.status === 'in_progress' ? colors.primary : colors.text.secondary) },
      ]}>
        {STATUS_ICONS[phase.status] || STATUS_ICONS.pending}
      </Text>
      <Text
        style={[
          styles.phaseText,
          { color: isDone ? colors.text.muted : colors.text.primary },
          isDone && styles.todoTextDone,
        ]}
        numberOfLines={1}
      >
        {phase.content}
      </Text>
    </View>
  );
}

export function TodosPanel({ sessionId }: TodosPanelProps) {
  const { colors } = useTheme();
  const todos = useSessionStore((state) => state.todosBySession[sessionId] ?? []);
  const phases = useSessionStore((state) => state.phasesBySession[sessionId] ?? []);

  const hasTodos = todos.length > 0;
  const hasPhases = phases.length > 0;
  const completedTodos = todos.filter((t) => t.status === 'completed').length;
  const completedPhases = phases.filter((p) => p.status === 'completed').length;

  if (!hasTodos && !hasPhases) {
    return (
      <View style={styles.emptyContainer}>
        <Text color="muted" style={styles.emptyText}>
          No todos or phases yet. The agent will create them as it works.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} testID="ants-todos-panel">
      {/* Todos Section */}
      {hasTodos && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>
              Todos
            </Text>
            <Text style={[styles.countBadge, { color: colors.text.muted }]}>
              {completedTodos}/{todos.length}
            </Text>
          </View>
          {/* Progress bar */}
          <View style={[styles.progressBar, { backgroundColor: colors.border.light }]}>
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: colors.primary,
                  width: `${todos.length > 0 ? (completedTodos / todos.length) * 100 : 0}%`,
                },
              ]}
            />
          </View>
          {todos.map((todo) => (
            <TodoRow key={todo.id} todo={todo} colors={colors} />
          ))}
        </View>
      )}

      {/* Phases Section */}
      {hasPhases && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>
              Phases
            </Text>
            <Text style={[styles.countBadge, { color: colors.text.muted }]}>
              {completedPhases}/{phases.length}
            </Text>
          </View>
          <View style={[styles.progressBar, { backgroundColor: colors.border.light }]}>
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: colors.primary,
                  width: `${phases.length > 0 ? (completedPhases / phases.length) * 100 : 0}%`,
                },
              ]}
            />
          </View>
          {phases.map((phase) => (
            <PhaseRow key={phase.id} phase={phase} colors={colors} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: spacing[3],
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[4],
  },
  emptyText: {
    textAlign: 'center',
    fontSize: fontSize.sm,
  },
  section: {
    marginBottom: spacing[4],
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[2],
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  countBadge: {
    fontSize: fontSize.xs,
  },
  progressBar: {
    height: 4,
    borderRadius: 2,
    marginBottom: spacing[2],
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  todoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing[2],
  },
  statusIcon: {
    fontSize: 14,
    marginTop: 2,
    width: 16,
    textAlign: 'center',
  },
  todoContent: {
    flex: 1,
  },
  todoText: {
    fontSize: fontSize.sm,
    lineHeight: 18,
  },
  todoTextDone: {
    textDecorationLine: 'line-through',
    opacity: 0.7,
  },
  todoMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: 4,
  },
  priorityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  metaText: {
    fontSize: 10,
  },
  phaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing[2],
  },
  phaseText: {
    flex: 1,
    fontSize: fontSize.sm,
  },
});
