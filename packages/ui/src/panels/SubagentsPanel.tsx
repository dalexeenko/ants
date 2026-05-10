/**
 * SubagentsPanel - Shows subagent tasks for the current session.
 *
 * Displays running and completed subagent tasks with status indicators,
 * descriptions, timing info, and expandable results.
 */

import React, { useState } from 'react';
import { View, Pressable, StyleSheet, ScrollView } from 'react-native';
import { Text } from '../primitives/Text';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius, fontSize } from '../styles/tokens';
import { useSessionStore } from '../store/sessionStore';
import { useElapsedTime } from '../hooks/useElapsedTime';
import type { SubagentInfo } from '../agent/types';

interface SubagentsPanelProps {
  sessionId: string;
  /** Called when a subagent is clicked (to open its detail view) */
  onSubagentSelect?: (subagent: SubagentInfo) => void;
}

function getStatusConfig(colors: any): Record<string, { label: string; color: string; icon: string }> {
  return {
    running: { label: 'Running', color: colors.info, icon: '\u25D4' },
    completed: { label: 'Done', color: colors.success, icon: '\u2713' },
    failed: { label: 'Failed', color: colors.error, icon: '\u2717' },
    cancelled: { label: 'Cancelled', color: colors.text.muted, icon: '\u2715' },
  };
}

function SubagentRow({
  subagent,
  colors,
  onSelect,
}: {
  subagent: SubagentInfo;
  colors: any;
  onSelect?: (subagent: SubagentInfo) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusConfig = getStatusConfig(colors);
  const config = statusConfig[subagent.status] ?? statusConfig.running!;
  const elapsed = useElapsedTime(subagent.startedAt, subagent.completedAt, subagent.status === 'running');

  return (
    <Pressable
      style={[styles.subagentRow, { borderBottomColor: colors.border.light }]}
      onPress={() => {
        if (onSelect) {
          onSelect(subagent);
        } else {
          setExpanded(!expanded);
        }
      }}
    >
      <View style={styles.subagentHeader}>
        <View style={[styles.statusBadge, { backgroundColor: `${config.color}20` }]}>
          <Text style={[styles.statusIcon, { color: config.color }]}>
            {config.icon}
          </Text>
          <Text style={[styles.statusLabel, { color: config.color }]}>
            {config.label}
          </Text>
        </View>
        <Text style={[styles.elapsed, { color: colors.text.muted }]}>
          {elapsed}
        </Text>
      </View>
      <Text
        style={[styles.description, { color: colors.text.primary }]}
        numberOfLines={expanded ? undefined : 2}
      >
        {subagent.description}
      </Text>
      {expanded && subagent.result && (
        <View style={[styles.resultBlock, { backgroundColor: colors.bg.tertiary || colors.bg.secondary }]}>
          <Text style={[styles.resultText, { color: colors.text.secondary }]} numberOfLines={10}>
            {subagent.result}
          </Text>
        </View>
      )}
      {expanded && subagent.error && (
        <View style={[styles.resultBlock, { backgroundColor: colors.error + '15' }]}>
          <Text style={[styles.resultText, { color: colors.error }]} numberOfLines={5}>
            {subagent.error}
          </Text>
        </View>
      )}
      {subagent.async && (
        <Text style={[styles.asyncBadge, { color: colors.text.muted }]}>async</Text>
      )}
    </Pressable>
  );
}

export function SubagentsPanel({ sessionId, onSubagentSelect }: SubagentsPanelProps) {
  const { colors } = useTheme();
  const subagents = useSessionStore((state) => state.subagentsBySession[sessionId] ?? []);

  if (subagents.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text color="muted" style={styles.emptyText}>
          No subagent tasks yet. The agent will launch subagents as needed.
        </Text>
      </View>
    );
  }

  const running = subagents.filter((s) => s.status === 'running');
  const completed = subagents.filter((s) => s.status !== 'running');

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {running.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>
            Running ({running.length})
          </Text>
          {running.map((s) => (
            <SubagentRow key={s.sessionId} subagent={s} colors={colors} onSelect={onSubagentSelect} />
          ))}
        </View>
      )}

      {completed.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>
            Completed ({completed.length})
          </Text>
          {completed.map((s) => (
            <SubagentRow key={s.sessionId} subagent={s} colors={colors} onSelect={onSubagentSelect} />
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
    marginBottom: spacing[3],
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginBottom: spacing[2],
  },
  subagentRow: {
    paddingVertical: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  subagentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    gap: 4,
  },
  statusIcon: {
    fontSize: 10,
  },
  statusLabel: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  elapsed: {
    fontSize: 10,
  },
  description: {
    fontSize: fontSize.sm,
    lineHeight: 18,
  },
  resultBlock: {
    marginTop: spacing[2],
    padding: spacing[2],
    borderRadius: borderRadius.sm,
  },
  resultText: {
    fontSize: fontSize.xs,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  asyncBadge: {
    fontSize: 10,
    marginTop: 4,
    fontStyle: 'italic',
  },
});
