import React, { useEffect, useState, useCallback } from 'react';
import { View, Pressable, StyleSheet, Platform, ViewStyle } from 'react-native';
import { Text } from '../primitives/Text';
import { Icon } from '../primitives/IconButton';
import { useTheme } from '../styles/theme';
import { borderRadius, spacing, shadows } from '../styles/tokens';
import type { AgentBridge } from '../agent/types';

const dropdownShadow = Platform.select<ViewStyle>({
  web: {
    ...({ boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.15)' } as ViewStyle),
  },
  default: shadows.md,
});

export interface TokenUsageBarProps {
  bridge: AgentBridge;
  projectId: string;
  /** Context window usage from the session store (event-driven). */
  contextUsage?: { currentTokens: number; maxTokens: number } | null;
}

interface UsageData {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  estimatedCost: number;
  requestCount: number;
}

interface ContextData {
  currentTokens: number;
  maxTokens: number;
  model: string;
}

/**
 * Determine the fill color based on context window usage percentage.
 * Uses graduated palette colors: blue (normal) -> amber (warning) -> red (critical).
 */
function getFillColor(
  percent: number,
  colors: { primary: string; warning: string; error: string },
): string {
  if (percent >= 90) return colors.error;
  if (percent >= 70) return colors.warning;
  return colors.primary;
}

export function TokenUsageBar({ bridge, projectId, contextUsage: contextUsageProp }: TokenUsageBarProps) {
  const { colors, palette } = useTheme();
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [contextFromBridge, setContextFromBridge] = useState<ContextData | null>(null);
  const [expanded, setExpanded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await bridge.getTokenUsage(projectId);
      setUsage(data);
    } catch {
      // Ignore - bridge method may not exist on remote servers
    }
    try {
      const ctx = await bridge.getContextUsage(projectId);
      setContextFromBridge(ctx);
    } catch {
      // Ignore - bridge method may not be available
    }
  }, [bridge, projectId]);

  // Poll every 10 seconds while mounted
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (!usage || usage.totalTokens === 0) {
    return null;
  }

  // Prefer event-driven context usage (more up-to-date) over polled bridge data
  const contextTokens = contextUsageProp?.currentTokens ?? contextFromBridge?.currentTokens ?? 0;
  const contextMax = contextUsageProp?.maxTokens ?? contextFromBridge?.maxTokens ?? 0;
  const contextPercent = contextMax > 0 ? Math.min((contextTokens / contextMax) * 100, 100) : 0;
  const fillColor = getFillColor(contextPercent, colors);

  const costStr = usage.estimatedCost < 0.01
    ? '<$0.01'
    : `$${usage.estimatedCost.toFixed(2)}`;

  return (
    <View style={styles.wrapper}>
      <Pressable
        onPress={() => setExpanded(!expanded)}
        style={[styles.container, { backgroundColor: colors.bg.tertiary, borderColor: colors.border.light }]}
      >
        {/* Base layer — muted appearance */}
        <View style={styles.summary}>
          <Icon name="zap" size={12} color={colors.text.muted} />
          <Text variant="caption" color="muted">
            {formatTokenCount(usage.totalTokens)} tokens
          </Text>
          <Text variant="caption" color="muted">
            {costStr}
          </Text>
          <Icon name={expanded ? 'chevronUp' : 'chevronDown'} size={10} color={colors.text.muted} />
        </View>

        {/* Fill overlay — absolutely positioned, clipped to contextPercent width */}
        {contextPercent > 0 && (
          <View
            style={[
              styles.fillOverlay,
              {
                width: `${contextPercent}%` as unknown as number,
                backgroundColor: fillColor,
                borderRadius: borderRadius.sm,
              },
            ]}
          >
            <View style={styles.summary}>
              <Icon name="zap" size={12} color={palette.warningLight} />
              <Text variant="caption" style={{ color: colors.text.inverse }}>
                {formatTokenCount(usage.totalTokens)} tokens
              </Text>
              <Text variant="caption" style={{ color: colors.text.inverse }}>
                {costStr}
              </Text>
              <Icon name={expanded ? 'chevronUp' : 'chevronDown'} size={10} color={colors.text.inverse} />
            </View>
          </View>
        )}
      </Pressable>

      {expanded && (
        <View style={[styles.dropdown, dropdownShadow, { backgroundColor: colors.bg.elevated, borderColor: colors.border.light }]}>
          {/* Context Window section */}
          {contextMax > 0 && (
            <>
              <Text variant="caption" style={[styles.sectionLabel, { color: colors.text.muted }]}>
                Context Window
              </Text>
              <View style={styles.detailRow}>
                <Text variant="caption" color="muted">Usage</Text>
                <Text variant="caption" color="secondary">
                  {formatTokenCount(contextTokens)} / {formatTokenCount(contextMax)}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text variant="caption" color="muted">Filled</Text>
                <Text variant="caption" style={{ color: fillColor }}>
                  {contextPercent.toFixed(1)}%
                </Text>
              </View>
              {contextFromBridge?.model && (
                <View style={styles.detailRow}>
                  <Text variant="caption" color="muted">Model</Text>
                  <Text variant="caption" color="secondary">{contextFromBridge.model}</Text>
                </View>
              )}
              {/* Context bar */}
              <View style={[styles.contextBar, { backgroundColor: colors.border.light }]}>
                <View
                  style={[
                    styles.contextBarFill,
                    {
                      width: `${contextPercent}%` as unknown as number,
                      backgroundColor: fillColor,
                    },
                  ]}
                />
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border.light }]} />
              <Text variant="caption" style={[styles.sectionLabel, { color: colors.text.muted }]}>
                Session Usage
              </Text>
            </>
          )}
          <View style={styles.detailRow}>
            <Text variant="caption" color="muted">Prompt</Text>
            <Text variant="caption" color="secondary">{formatTokenCount(usage.promptTokens)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text variant="caption" color="muted">Completion</Text>
            <Text variant="caption" color="secondary">{formatTokenCount(usage.completionTokens)}</Text>
          </View>
          {(usage.cacheReadInputTokens ?? 0) > 0 && (
            <View style={styles.detailRow}>
              <Text variant="caption" color="muted">Cache Read</Text>
              <Text variant="caption" color="secondary">{formatTokenCount(usage.cacheReadInputTokens!)}</Text>
            </View>
          )}
          {(usage.cacheCreationInputTokens ?? 0) > 0 && (
            <View style={styles.detailRow}>
              <Text variant="caption" color="muted">Cache Write</Text>
              <Text variant="caption" color="secondary">{formatTokenCount(usage.cacheCreationInputTokens!)}</Text>
            </View>
          )}
          <View style={styles.detailRow}>
            <Text variant="caption" color="muted">Requests</Text>
            <Text variant="caption" color="secondary">{usage.requestCount}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text variant="caption" color="muted">Est. Cost</Text>
            <Text variant="caption" color="secondary">{costStr}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

function formatTokenCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    zIndex: 10,
  },
  container: {
    borderWidth: 1,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    overflow: 'hidden',
    position: 'relative',
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  fillOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    overflow: 'hidden',
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    // Content inside mirrors the base layer exactly so it lines up
    justifyContent: 'center',
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: spacing[1],
    minWidth: 220,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing[3],
    gap: spacing[1],
    zIndex: 11,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing[4],
  },
  sectionLabel: {
    fontWeight: '600',
    marginTop: spacing[1],
    marginBottom: spacing[0.5],
  },
  contextBar: {
    height: 4,
    borderRadius: 2,
    marginTop: spacing[1.5],
    overflow: 'hidden',
  },
  contextBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  divider: {
    height: 1,
    marginVertical: spacing[2],
  },
});
