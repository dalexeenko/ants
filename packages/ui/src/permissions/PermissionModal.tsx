import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Modal } from '../primitives/Modal';
import { Text } from '../primitives/Text';
import { Button } from '../primitives/Button';
import { Icon } from '../primitives/IconButton';
import { useTheme } from '../styles/theme';
import { borderRadius, spacing, colors as tokenColors } from '../styles/tokens';
import type { ToolCall, PermissionResponse } from '../agent/types';

export interface PermissionModalProps {
  visible: boolean;
  toolCall: ToolCall | null;
  onResponse: (response: PermissionResponse) => void;
}

export function PermissionModal({
  visible,
  toolCall,
  onResponse,
}: PermissionModalProps) {
  const { colors } = useTheme();

  if (!toolCall) return null;

  const warning = getToolWarning(toolCall.name);
  const toolName = formatToolName(toolCall.name);

  return (
    <Modal visible={visible} title="Permission Required">
      <View style={styles.content}>
        <View style={[styles.iconContainer, { backgroundColor: tokenColors.warning + '20' }]}>
          <Icon name="settings" size={32} color={tokenColors.warning} />
        </View>

        <Text color="secondary" style={styles.description}>
          {toolCall.subagentDescription
            ? `A subagent wants to use:`
            : 'The agent wants to use:'}
        </Text>
        <Text variant="heading" style={styles.toolName}>
          {toolName}
        </Text>

        {toolCall.subagentDescription && (
          <View style={[styles.subagentBadge, { backgroundColor: tokenColors.info + '15' }]}>
            <Icon name="settings" size={14} color={tokenColors.info} />
            <Text style={[styles.subagentText, { color: tokenColors.info }]}>
              From subagent: {toolCall.subagentDescription}
            </Text>
          </View>
        )}

        <View style={[styles.details, { backgroundColor: colors.bg.tertiary }]}>
          <Text variant="caption" color="muted" style={styles.detailsLabel}>
            Arguments:
          </Text>
          <View style={styles.codeBlock}>
            <Text style={[styles.code, { color: colors.text.secondary }]}>
              {JSON.stringify(toolCall.arguments, null, 2)}
            </Text>
          </View>
        </View>

        {warning && (
          <View style={[styles.warning, { backgroundColor: tokenColors.warning + '10' }]}>
            <Icon name="settings" size={16} color={tokenColors.warning} />
            <Text style={[styles.warningText, { color: tokenColors.warning }]}>
              {warning}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.actions}>
        <Button variant="ghost" onPress={() => onResponse('deny')}>
          Deny
        </Button>
        <Button variant="secondary" onPress={() => onResponse('allow_once')}>
          Allow Once
        </Button>
        <Button variant="primary" onPress={() => onResponse('allow_always')}>
          Always Allow
        </Button>
      </View>
    </Modal>
  );
}

function getToolWarning(toolName: string): string | null {
  const warnings: Record<string, string> = {
    bash: 'This will execute a shell command on your system.',
    write: 'This will create or overwrite files on your system.',
    edit: 'This will modify existing files on your system.',
    mcp_bash: 'This will execute a shell command on your system.',
  };
  return warnings[toolName] || null;
}

function formatToolName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\bmcp\b/gi, 'MCP')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const styles = StyleSheet.create({
  content: {
    alignItems: 'center',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[4],
  },
  description: {
    marginBottom: spacing[1],
  },
  toolName: {
    marginBottom: spacing[4],
    textAlign: 'center' as const,
  },
  subagentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.md,
    marginBottom: spacing[3],
    width: '100%',
  },
  subagentText: {
    flex: 1,
    fontSize: 13,
  },
  details: {
    width: '100%',
    padding: spacing[3],
    borderRadius: borderRadius.md,
    marginBottom: spacing[3],
  },
  detailsLabel: {
    marginBottom: spacing[2],
  },
  codeBlock: {
    maxHeight: 150,
    overflow: 'hidden',
  },
  code: {
    fontFamily: 'monospace',
    fontSize: 12,
  },
  warning: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[3],
    borderRadius: borderRadius.md,
    gap: spacing[2],
  },
  warningText: {
    flex: 1,
    fontSize: 14,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[2],
    marginTop: spacing[4],
  },
});
