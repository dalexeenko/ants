import React, { useState, useCallback } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from '../primitives/Text';
import { Icon } from '../primitives/IconButton';
import { MarkdownContent } from './MarkdownContent';
import { useTheme } from '../styles/theme';
import { borderRadius, spacing } from '../styles/tokens';
import type { Message } from '../agent/types';

const COMPACTION_SUMMARY_PREFIX = '[Conversation Summary]';

export interface CompactionSummaryBlockProps {
  message: Message;
  /** Whether the summary is still being streamed in */
  isStreaming?: boolean;
}

/**
 * Collapsible block for compaction summary messages.
 * Default: collapsed with a compact indicator row.
 * Expanded: shows the full structured markdown summary.
 * While streaming, the block is expanded automatically.
 */
export const CompactionSummaryBlock = React.memo(function CompactionSummaryBlock({
  message,
  isStreaming = false,
}: CompactionSummaryBlockProps) {
  const { colors, palette } = useTheme();
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback(() => setExpanded((v) => !v), []);

  // Strip the "[Conversation Summary]" prefix from content since the visual
  // treatment already conveys the purpose.
  const displayContent = message.content.startsWith(COMPACTION_SUMMARY_PREFIX)
    ? message.content.slice(COMPACTION_SUMMARY_PREFIX.length).trimStart()
    : message.content;

  const isOpen = expanded || isStreaming;

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.block,
          {
            backgroundColor: colors.bg.secondary,
            borderColor: palette.indigo + '60',
            borderLeftColor: palette.indigo,
          },
        ]}
      >
        {/* Header row — always visible */}
        <Pressable onPress={toggle} style={styles.header}>
          <Icon name="layers" size={14} color={palette.indigo} />
          <Text variant="caption" style={[styles.headerLabel, { color: palette.indigo }]}>
            Conversation summarized
          </Text>
          {isStreaming && (
            <Text variant="caption" color="muted" style={styles.streamingLabel}>
              writing...
            </Text>
          )}
          <View style={styles.spacer} />
          <Icon
            name={isOpen ? 'chevronUp' : 'chevronDown'}
            size={12}
            color={colors.text.muted}
          />
        </Pressable>

        {/* Expandable summary content */}
        {isOpen && displayContent.length > 0 && (
          <View style={[styles.content, { borderTopColor: colors.border.light }]}>
            <MarkdownContent content={displayContent} inverted={false} />
          </View>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[1],
  },
  block: {
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    gap: spacing[2],
  },
  headerLabel: {
    fontWeight: '600',
  },
  streamingLabel: {
    fontStyle: 'italic',
  },
  spacer: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing[3],
    paddingBottom: spacing[3],
    borderTopWidth: 1,
  },
});
