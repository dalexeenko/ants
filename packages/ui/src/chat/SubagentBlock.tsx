import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from '../primitives/Text';
import { Icon } from '../primitives/IconButton';
import { Spinner } from '../primitives/Spinner';
import { useTheme } from '../styles/theme';
import { borderRadius, spacing, fontSize } from '../styles/tokens';
import type { SubagentInfo } from '../agent/types';
import { useElapsedTime } from '../hooks/useElapsedTime';

export interface SubagentBlockProps {
  subagent: SubagentInfo;
  expanded?: boolean;
  onToggle?: () => void;
}

export function SubagentBlock({ subagent, expanded, onToggle }: SubagentBlockProps) {
  const { colors, palette } = useTheme();

  const statusIcon = getStatusIcon(subagent.status, colors);
  const duration = useElapsedTime(subagent.startedAt, subagent.completedAt, subagent.status === 'running');

  return (
    <View style={[styles.container, { borderColor: getBorderColor(subagent.status, colors) }]}>
      <Pressable
        style={[styles.header, { backgroundColor: colors.bg.tertiary }]}
        onPress={onToggle}
      >
        <View style={styles.headerLeft}>
          {statusIcon}
          <Icon name="gitBranch" size={14} color={colors.text.secondary} />
          <Text style={styles.description} weight="medium" numberOfLines={1}>
            {subagent.description}
          </Text>
          {subagent.async && (
            <View style={[styles.asyncBadge, { backgroundColor: colors.bg.elevated }]}>
              <Text variant="caption" color="muted">async</Text>
            </View>
          )}
        </View>
        <View style={styles.headerRight}>
          <Text variant="caption" color="muted">
            {duration}
          </Text>
          <Icon
            name={expanded ? 'chevronUp' : 'chevronDown'}
            size={14}
            color={colors.text.muted}
          />
        </View>
      </Pressable>

      {expanded && (
        <View style={[styles.details, { backgroundColor: colors.bg.secondary }]}>
          <View style={styles.infoRow}>
            <Text variant="caption" color="muted">Status</Text>
            <Text variant="caption" style={{ color: getStatusColor(subagent.status, colors) }}>
              {subagent.status.toUpperCase()}
            </Text>
          </View>
          
          <View style={styles.infoRow}>
            <Text variant="caption" color="muted">Session ID</Text>
            <Text variant="caption" color="secondary" style={{ fontFamily: 'monospace' }}>
              {subagent.sessionId.slice(0, 16)}...
            </Text>
          </View>

          {subagent.result && (
            <>
              <Text variant="caption" color="muted" style={styles.label}>
                Result
              </Text>
              <View style={[styles.codeBlock, { backgroundColor: colors.bg.tertiary }]}>
                <Text style={[styles.code, { color: colors.text.secondary }]} numberOfLines={20}>
                  {subagent.result.length > 2000
                    ? subagent.result.slice(0, 2000) + '\n...(truncated)'
                    : subagent.result}
                </Text>
              </View>
            </>
          )}

          {subagent.error && (
            <View style={[styles.errorBanner, { backgroundColor: palette.errorLight }]}>
              <Icon name="close" size={14} color={palette.errorHover} />
              <Text style={{ color: palette.errorHover, marginLeft: spacing[2], flex: 1 }} numberOfLines={3}>
                {subagent.error}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function getStatusIcon(status: SubagentInfo['status'], colors: any) {
  switch (status) {
    case 'running':
      return <Spinner size="small" />;
    case 'completed':
      return <Icon name="check" size={14} color={colors.success} />;
    case 'failed':
      return <Icon name="close" size={14} color={colors.error} />;
    case 'cancelled':
      return <Icon name="close" size={14} color={colors.text.muted} />;
    default:
      return null;
  }
}

function getStatusColor(status: SubagentInfo['status'], colors: any): string {
  switch (status) {
    case 'running': return colors.info;
    case 'completed': return colors.success;
    case 'failed': return colors.error;
    case 'cancelled': return colors.text.muted;
    default: return colors.text.muted;
  }
}

function getBorderColor(status: SubagentInfo['status'], colors: any): string {
  switch (status) {
    case 'running': return colors.info;
    case 'failed': return colors.error;
    default: return colors.border.light;
  }
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    marginTop: spacing[2],
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    flex: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  description: {
    fontSize: fontSize.sm,
    flex: 1,
  },
  asyncBadge: {
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
    borderRadius: borderRadius.sm,
  },
  details: {
    padding: spacing[3],
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[1],
  },
  label: {
    marginBottom: spacing[1],
    marginTop: spacing[2],
  },
  codeBlock: {
    padding: spacing[2],
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
  },
  code: {
    fontFamily: 'monospace',
    fontSize: fontSize.xs,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[2],
    borderRadius: borderRadius.sm,
    marginTop: spacing[2],
  },
});
