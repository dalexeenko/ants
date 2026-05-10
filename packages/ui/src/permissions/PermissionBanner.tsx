import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text } from '../primitives/Text';
import { Button } from '../primitives/Button';
import { Icon } from '../primitives/IconButton';
import { useTheme } from '../styles/theme';
import { borderRadius, spacing, colors as tokenColors } from '../styles/tokens';
import type { ToolCall, PermissionResponse } from '../agent/types';

export interface PermissionBannerProps {
  toolCall: ToolCall | null;
  onResponse: (response: PermissionResponse) => void;
}

/**
 * Inline permission banner that appears above the chat input.
 * Shows tool name, arguments preview, and allow/deny buttons.
 */
export function PermissionBanner({
  toolCall,
  onResponse,
}: PermissionBannerProps) {
  const { colors } = useTheme();

  if (!toolCall) return null;

  const warning = getToolWarning(toolCall.name);
  const toolName = formatToolName(toolCall.name);
  const argsPreview = formatArgsPreview(toolCall.arguments);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg.elevated, borderColor: tokenColors.warning }]}>
      <View style={styles.header}>
        <View style={[styles.iconContainer, { backgroundColor: tokenColors.warning + '20' }]}>
          <Icon name="settings" size={16} color={tokenColors.warning} />
        </View>
        <View style={styles.headerText}>
          <Text variant="caption" color="muted">
            {toolCall.subagentDescription
              ? `Permission required (from subagent: ${toolCall.subagentDescription})`
              : 'Permission required'}
          </Text>
          <Text variant="body" style={styles.toolName}>{toolName}</Text>
        </View>
      </View>

      {argsPreview ? (
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          style={[styles.argsContainer, { backgroundColor: colors.bg.tertiary }]}
        >
          <Text style={[styles.argsText, { color: colors.text.secondary }]} numberOfLines={1}>
            {argsPreview}
          </Text>
        </ScrollView>
      ) : null}

      {warning ? (
        <View style={styles.warningRow}>
          <Icon name="settings" size={12} color={tokenColors.warning} />
          <Text variant="caption" style={{ color: tokenColors.warning }}>
            {warning}
          </Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button variant="ghost" size="sm" onPress={() => onResponse('deny')}>
          {'Deny'}
        </Button>
        <View style={styles.actionSpacer} />
        <Button variant="secondary" size="sm" onPress={() => onResponse('allow_once')}>
          {'Allow'}
        </Button>
        <View style={styles.actionSpacer} />
        <Button variant="primary" size="sm" onPress={() => onResponse('allow_always')}>
          {'Always'}
        </Button>
      </View>
    </View>
  );
}

function getToolWarning(toolName: string): string | null {
  const warnings: Record<string, string> = {
    bash: 'Executes shell command',
    write: 'Creates/overwrites files',
    edit: 'Modifies files',
    mcp_bash: 'Executes shell command',
  };
  return warnings[toolName] || null;
}

function formatToolName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\bmcp\b/gi, '')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatArgsPreview(args: Record<string, unknown>): string {
  // Show a compact preview of the arguments
  const entries = Object.entries(args);
  if (entries.length === 0) return '';
  
  // For common tools, show the most relevant argument
  if ('command' in args) {
    return String(args.command);
  }
  if ('filePath' in args) {
    return String(args.filePath);
  }
  if ('path' in args) {
    return String(args.path);
  }
  if ('pattern' in args) {
    return String(args.pattern);
  }
  
  // Otherwise show first argument value
  return String(entries[0][1]).slice(0, 100);
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    padding: spacing[3],
    marginHorizontal: spacing[4],
    marginBottom: spacing[2],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  toolName: {
    fontWeight: '600',
  },
  argsContainer: {
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    marginBottom: spacing[2],
    maxHeight: 32,
  },
  argsText: {
    fontFamily: 'monospace',
    fontSize: 12,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    marginBottom: spacing[2],
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  actionSpacer: {
    width: spacing[2],
  },
});
