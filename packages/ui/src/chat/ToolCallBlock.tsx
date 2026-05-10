import React from 'react';
import { View, Pressable, StyleSheet, Image } from 'react-native';
import { Text } from '../primitives/Text';
import { Icon, type IconName } from '../primitives/IconButton';
import { Spinner } from '../primitives/Spinner';
import { useTheme } from '../styles/theme';
import { borderRadius, spacing, fontSize } from '../styles/tokens';
import type { ToolCall } from '../agent/types';
import { usePluginToolRenderer } from '../plugins/UIPluginContext';
import { useElapsedTime } from '../hooks/useElapsedTime';

/** Check if a result contains an image (e.g., from screenshot tool) */
function isImageResult(result: unknown): result is { dataUrl: string; width?: number; height?: number } {
  if (!result || typeof result !== 'object') return false;
  const obj = result as Record<string, unknown>;
  return typeof obj.dataUrl === 'string' && obj.dataUrl.startsWith('data:image/');
}

// Known icon names from our icon set
const KNOWN_ICONS = new Set([
  'wrench', 'tool', 'hammer', 'build', 'folder', 'file', 'terminal', 'code',
  'globe', 'server', 'database', 'git', 'gitBranch', 'search', 'eye', 'lock',
  'key', 'shield', 'zap', 'lightning', 'settings', 'gear', 'message', 'chat',
]);

/** Check if a string is an emoji (starts with emoji character) */
function isEmoji(str: string): boolean {
  const code = str.codePointAt(0) || 0;
  return code > 0x1F300;
}

/** Render a tool icon - either an emoji or an icon from our icon set */
function ToolIcon({ icon, size = 14, color }: { icon?: string; size?: number; color?: string }) {
  const { colors } = useTheme();
  const iconColor = color || colors.text.muted;
  
  if (!icon) {
    return <Icon name="wrench" size={size} color={iconColor} />;
  }
  
  if (isEmoji(icon)) {
    return (
      <Text style={{ fontSize: size - 2, lineHeight: size }}>
        {icon}
      </Text>
    );
  }
  
  if (KNOWN_ICONS.has(icon)) {
    return <Icon name={icon as IconName} size={size} color={iconColor} />;
  }
  
  return <Icon name="wrench" size={size} color={iconColor} />;
}

export interface ToolCallBlockProps {
  toolCall: ToolCall;
  /** Optional icon for the tool - can be emoji or icon name */
  icon?: string;
  expanded?: boolean;
  onToggle?: () => void;
  /** When true, suppresses the top margin (first tool call with no text content above) */
  isFirst?: boolean;
  /** Called when user clicks a file path in the tool call arguments or header */
  onFilePathClick?: (filePath: string) => void;
}

/** Extract file path from tool call arguments if present */
function extractFilePath(toolCall: ToolCall): string | null {
  const args = toolCall.arguments;
  if (!args) return null;
  // Common file path argument names
  const pathKey = args.filePath || args.path || args.file;
  if (typeof pathKey === 'string' && pathKey.length > 0) return pathKey;
  return null;
}

export function ToolCallBlock({ toolCall, icon, expanded, onToggle, isFirst, onFilePathClick }: ToolCallBlockProps) {
  const { colors, palette } = useTheme();
  const pluginRenderer = usePluginToolRenderer(toolCall.name);
  const elapsed = useElapsedTime(toolCall.startedAt, toolCall.completedAt, toolCall.status === 'running');

  // If a plugin provides a custom renderer for this tool, use it
  if (pluginRenderer) {
    const PluginComponent = pluginRenderer.component;
    return (
      <View style={[styles.container, { borderColor: colors.border.light }, isFirst && { marginTop: 0 }]}>
        <PluginComponent
          bridge={undefined as any}
          projectId=""
          pluginName={pluginRenderer.pluginName}
          toolCall={toolCall}
          isStreaming={toolCall.status === 'running'}
        />
      </View>
    );
  }

  const statusIcon = getStatusIcon(toolCall.status, colors);
  const toolName = formatToolName(toolCall.name);
  const filePath = extractFilePath(toolCall);

  return (
    <View style={[styles.container, { borderColor: colors.border.light }, isFirst && { marginTop: 0 }]}>
      <Pressable
        style={[styles.header, { backgroundColor: colors.bg.tertiary }]}
        onPress={onToggle}
      >
        <View style={styles.headerLeft}>
          {statusIcon}
          <ToolIcon icon={icon} size={14} color={colors.text.secondary} />
          <Text style={styles.toolName} weight="medium">
            {toolName}
          </Text>
          {filePath && (
            <Pressable
              onPress={(e) => {
                e.stopPropagation?.();
                onFilePathClick?.(filePath);
              }}
            >
              <Text
                style={[styles.filePathLink, { color: colors.primary }]}
                numberOfLines={1}
              >
                {filePath.split('/').pop() || filePath}
              </Text>
            </Pressable>
          )}
        </View>
        <View style={styles.headerRight}>
          {elapsed ? (
            <Text style={[styles.elapsedText, { color: colors.text.muted }]}>
              {elapsed}
            </Text>
          ) : null}
          <Icon
            name={expanded ? 'chevronUp' : 'chevronDown'}
            size={14}
            color={colors.text.muted}
          />
        </View>
      </Pressable>

      {expanded && (
        <View style={[styles.details, { backgroundColor: colors.bg.secondary }]}>
          <Text variant="caption" color="muted" style={styles.label}>
            Input
          </Text>
          <View style={[styles.codeBlock, { backgroundColor: colors.bg.tertiary }]}>
            <Text selectable style={[styles.code, { color: colors.text.secondary }]}>
              {JSON.stringify(toolCall.arguments, null, 2)}
            </Text>
          </View>

          {toolCall.result !== undefined && (
            <>
              <Text variant="caption" color="muted" style={styles.label}>
                Output
              </Text>
              {isImageResult(toolCall.result) ? (
                <View style={styles.imageContainer}>
                  <Image
                    source={{ uri: toolCall.result.dataUrl }}
                    style={[
                      styles.resultImage,
                      toolCall.result.width && toolCall.result.height
                        ? { aspectRatio: toolCall.result.width / toolCall.result.height }
                        : {},
                    ]}
                    resizeMode="contain"
                  />
                  {toolCall.result.width && toolCall.result.height && (
                    <Text variant="caption" color="muted" style={styles.imageDimensions}>
                      {toolCall.result.width} × {toolCall.result.height}
                    </Text>
                  )}
                </View>
              ) : (
                <View style={[styles.codeBlock, { backgroundColor: colors.bg.tertiary }]}>
                  <Text selectable style={[styles.code, { color: colors.text.secondary }]}>
                    {formatResult(toolCall.result)}
                  </Text>
                </View>
              )}
            </>
          )}

          {toolCall.status === 'error' && (
            <View style={[styles.errorBanner, { backgroundColor: palette.errorLight }]}>
              <Icon name="close" size={14} color={palette.errorHover} />
              <Text style={{ color: palette.errorHover, marginLeft: spacing[2] }}>
                Tool execution failed
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function getStatusIcon(status: ToolCall['status'], colors: any) {
  switch (status) {
    case 'pending':
      return <Icon name="more" size={14} color={colors.text.muted} />;
    case 'running':
      return <Spinner size="small" />;
    case 'complete':
      return <Icon name="check" size={14} color={colors.success} />;
    case 'error':
      return <Icon name="close" size={14} color={colors.error} />;
    default:
      return null;
  }
}

function formatToolName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\bmcp\b/gi, 'MCP')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatResult(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object' && 'output' in result) {
    return String((result as { output: unknown }).output);
  }
  return JSON.stringify(result, null, 2);
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
  toolName: {
    fontSize: fontSize.sm,
  },
  elapsedText: {
    fontSize: fontSize.xs,
    fontFamily: 'monospace',
  },
  details: {
    padding: spacing[3],
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
  imageContainer: {
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
  },
  resultImage: {
    width: '100%',
    maxHeight: 400,
    borderRadius: borderRadius.sm,
  },
  imageDimensions: {
    marginTop: spacing[1],
    textAlign: 'center' as const,
  },
  filePathLink: {
    fontSize: fontSize.xs,
    textDecorationLine: 'underline',
    marginLeft: 4,
    flexShrink: 1,
  },
});
