/**
 * ActivityPanel - Timeline of recent agent actions for the current session.
 *
 * Shows tool calls, file changes, and other significant events derived from
 * the session's message history. Provides a quick overview of what the agent
 * has been doing.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text } from '../primitives/Text';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius, fontSize } from '../styles/tokens';
import { useSessionStore } from '../store/sessionStore';
import type { Message, ToolCall } from '../agent/types';

interface ActivityPanelProps {
  sessionId: string;
}

interface ActivityItem {
  id: string;
  type: 'tool' | 'message' | 'error';
  label: string;
  detail?: string;
  timestamp?: number;
  status?: 'success' | 'error' | 'running';
}

/** Extract activity items from messages */
function extractActivity(messages: Message[]): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const msg of messages) {
    // Extract tool calls from assistant messages
    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tc of msg.toolCalls) {
        const args = tc.arguments || {};
        let detail = '';

        // Generate a human-readable detail based on tool name
        if (tc.name === 'write' || tc.name === 'edit') {
          detail = args.filePath as string || args.path as string || '';
        } else if (tc.name === 'read') {
          detail = args.filePath as string || args.path as string || '';
        } else if (tc.name === 'bash') {
          const cmd = args.command as string || '';
          detail = cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
        } else if (tc.name === 'glob' || tc.name === 'grep') {
          detail = args.pattern as string || '';
        } else if (tc.name === 'task') {
          detail = args.description as string || '';
        } else if (tc.name === 'todowrite' || tc.name === 'phasewrite') {
          detail = 'Updated task list';
        } else {
          // Generic: show first string arg
          const firstStr = Object.values(args).find((v) => typeof v === 'string');
          if (firstStr && typeof firstStr === 'string') {
            detail = firstStr.length > 60 ? (firstStr as string).slice(0, 57) + '...' : firstStr as string;
          }
        }

        items.push({
          id: `${msg.id}-${tc.id || tc.name}`,
          type: 'tool',
          label: tc.name || 'unknown',
          detail,
          timestamp: msg.createdAt,
          status: 'success',
        });
      }
    }

    // Track errors
    if (msg.role === 'assistant' && msg.content && typeof msg.content === 'string' && msg.content.includes('Error')) {
      // Don't double-count tool calls, just track standalone error messages
      if (!msg.toolCalls || msg.toolCalls.length === 0) {
        items.push({
          id: `${msg.id}-error`,
          type: 'error',
          label: 'Error',
          detail: msg.content.slice(0, 100),
          timestamp: msg.createdAt,
          status: 'error',
        });
      }
    }
  }

  return items;
}

function getToolCategoryColors(colors: any, palette: any): Record<string, string> {
  return {
    write: colors.success,
    edit: colors.success,
    bash: palette.violet,
    read: colors.info,
    glob: colors.info,
    grep: colors.info,
    task: colors.warning,
    todowrite: palette.indigo,
    phasewrite: palette.indigo,
  };
}

function ActivityRow({ item, colors, palette }: { item: ActivityItem; colors: any; palette: any }) {
  const toolCategoryColors = getToolCategoryColors(colors, palette);
  const toolColor = toolCategoryColors[item.label] || colors.text.secondary;

  return (
    <View style={[styles.activityRow, { borderBottomColor: colors.border.light }]}>
      <View style={[styles.toolBadge, { backgroundColor: `${toolColor}18` }]}>
        <Text style={[styles.toolName, { color: toolColor }]}>
          {item.label}
        </Text>
      </View>
      {item.detail ? (
        <Text style={[styles.detail, { color: colors.text.muted }]} numberOfLines={1}>
          {item.detail}
        </Text>
      ) : null}
    </View>
  );
}

export function ActivityPanel({ sessionId }: ActivityPanelProps) {
  const { colors, palette } = useTheme();
  const messages = useSessionStore((state) => state.messagesBySession[sessionId] ?? []);

  const activities = useMemo(() => extractActivity(messages), [messages]);

  if (activities.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text color="muted" style={styles.emptyText}>
          No activity yet. Actions will appear here as the agent works.
        </Text>
      </View>
    );
  }

  // Show most recent first, limited to last 50
  const recentActivities = activities.slice(-50).reverse();

  // Summary stats
  const toolCounts: Record<string, number> = {};
  for (const a of activities) {
    if (a.type === 'tool') {
      toolCounts[a.label] = (toolCounts[a.label] || 0) + 1;
    }
  }
  const topTools = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* Summary */}
      <View style={styles.summarySection}>
        <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>
          Summary
        </Text>
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: colors.text.muted }]}>Total actions</Text>
          <Text style={[styles.summaryValue, { color: colors.text.primary }]}>{activities.length}</Text>
        </View>
        {topTools.map(([name, count]) => (
          <View key={name} style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: colors.text.muted }]}>{name}</Text>
            <Text style={[styles.summaryValue, { color: colors.text.primary }]}>{count}</Text>
          </View>
        ))}
      </View>

      {/* Timeline */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>
          Recent Activity
        </Text>
        {recentActivities.map((item) => (
          <ActivityRow key={item.id} item={item} colors={colors} palette={palette} />
        ))}
      </View>
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
  summarySection: {
    marginBottom: spacing[3],
  },
  section: {
    marginBottom: spacing[3],
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginBottom: spacing[2],
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  summaryLabel: {
    fontSize: fontSize.xs,
  },
  summaryValue: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[1] + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing[2],
  },
  toolBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    minWidth: 50,
  },
  toolName: {
    fontSize: 10,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  detail: {
    flex: 1,
    fontSize: fontSize.xs,
    fontFamily: 'monospace',
  },
});
