import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from '../primitives/Text';
import { Badge } from '../primitives/Badge';
import { Card } from '../primitives/Card';
import { Divider } from '../primitives/Divider';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius } from '../styles/tokens';
import type { Project, Session } from '../agent/types';

export interface ProjectStats {
  /** Total number of sessions */
  totalSessions: number;
  /** Number of sessions in the last 24 hours */
  recentSessions: number;
  /** Total messages sent */
  totalMessages?: number;
  /** Total tool calls */
  totalToolCalls?: number;
  /** Provider type */
  providerType: 'local' | 'remote';
  /** Provider status */
  providerStatus?: 'connected' | 'disconnected' | 'error';
}

export interface ProjectInfoPanelProps {
  /** The project to display info for */
  project: Project;
  /** Project statistics */
  stats: ProjectStats;
  /** Called when settings is clicked */
  onSettings?: () => void;
  /** Called when close is clicked */
  onClose?: () => void;
}

/**
 * Panel showing detailed project information and statistics.
 */
export function ProjectInfoPanel({
  project,
  stats,
  onSettings,
  onClose,
}: ProjectInfoPanelProps) {
  const { colors } = useTheme();

  return (
    <Card variant="outlined" padding="none" style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border.light }]}>
        <View style={styles.headerLeft}>
          <Text variant="heading" numberOfLines={1} style={styles.title}>
            {project.name}
          </Text>
          <Badge
            variant={stats.providerType === 'remote' ? 'secondary' : 'primary'}
            size="sm"
          >
            {stats.providerType === 'remote' ? 'Remote' : 'Local'}
          </Badge>
        </View>
        {onClose && (
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Text style={{ color: colors.text.muted }}>×</Text>
          </Pressable>
        )}
      </View>

      {/* Project Path */}
      <View style={styles.section}>
        <Text variant="caption" color="muted" style={styles.sectionLabel}>
          Location
        </Text>
        <Text variant="body" numberOfLines={2} style={styles.path}>
          {project.path}
        </Text>
      </View>

      <Divider spacing="none" />

      {/* Stats Grid */}
      <View style={styles.statsGrid}>
        <StatItem
          label="Sessions"
          value={stats.totalSessions}
          subValue={stats.recentSessions > 0 ? `${stats.recentSessions} today` : undefined}
        />
        {stats.totalMessages !== undefined && (
          <StatItem
            label="Messages"
            value={stats.totalMessages}
          />
        )}
        {stats.totalToolCalls !== undefined && (
          <StatItem
            label="Tool Calls"
            value={stats.totalToolCalls}
          />
        )}
      </View>

      <Divider spacing="none" />

      {/* Provider Status */}
      <View style={styles.section}>
        <View style={styles.statusRow}>
          <Text variant="caption" color="muted">
            Provider Status
          </Text>
          <StatusIndicator status={stats.providerStatus || 'connected'} />
        </View>
      </View>

      {/* Actions */}
      {onSettings && (
        <>
          <Divider spacing="none" />
          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [
                styles.actionButton,
                pressed && { backgroundColor: colors.bg.tertiary },
              ]}
              onPress={onSettings}
            >
              <Text style={{ color: colors.primary }}>
                Project Settings
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </Card>
  );
}

// ============ Stat Item ============

interface StatItemProps {
  label: string;
  value: number;
  subValue?: string;
}

function StatItem({ label, value, subValue }: StatItemProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.statItem}>
      <Text variant="title" style={{ color: colors.text.primary }}>
        {value.toLocaleString()}
      </Text>
      <Text variant="caption" color="muted">
        {label}
      </Text>
      {subValue && (
        <Text variant="caption" color="muted" style={styles.subValue}>
          {subValue}
        </Text>
      )}
    </View>
  );
}

// ============ Status Indicator ============

interface StatusIndicatorProps {
  status: 'connected' | 'disconnected' | 'error';
}

function StatusIndicator({ status }: StatusIndicatorProps) {
  const { colors, palette } = useTheme();
  const statusConfig = {
    connected: { color: palette.green, label: 'Connected' },
    disconnected: { color: colors.text.muted, label: 'Disconnected' },
    error: { color: colors.error, label: 'Error' },
  };

  const config = statusConfig[status];

  return (
    <View style={styles.statusIndicator}>
      <View style={[styles.statusDot, { backgroundColor: config.color }]} />
      <Text variant="caption" style={{ color: config.color }}>
        {config.label}
      </Text>
    </View>
  );
}

// ============ Helper to calculate stats from sessions ============

export function calculateProjectStats(
  sessions: Session[],
  providerType: 'local' | 'remote',
  providerStatus?: 'connected' | 'disconnected' | 'error'
): ProjectStats {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;

  const recentSessions = sessions.filter(s => s.createdAt > dayAgo).length;

  return {
    totalSessions: sessions.length,
    recentSessions,
    providerType,
    providerStatus,
  };
}

// ============ Styles ============

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing[3],
    borderBottomWidth: 1,
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  title: {
    flex: 1,
  },
  closeButton: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    padding: spacing[3],
  },
  sectionLabel: {
    marginBottom: spacing[1],
  },
  path: {
    fontFamily: 'monospace',
    fontSize: 12,
  },
  statsGrid: {
    flexDirection: 'row',
    padding: spacing[3],
    gap: spacing[4],
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  subValue: {
    marginTop: spacing[0.5],
    fontSize: 10,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  actions: {
    padding: spacing[2],
  },
  actionButton: {
    padding: spacing[2],
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
});
