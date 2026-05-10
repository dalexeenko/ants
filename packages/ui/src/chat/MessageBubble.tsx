import React, { useState, useCallback } from 'react';
import { View, StyleSheet, Pressable, Platform, ViewStyle } from 'react-native';
import { Text } from '../primitives/Text';
import { IconButton } from '../primitives/IconButton';
import { ToolCallBlock } from './ToolCallBlock';
import { MarkdownContent } from './MarkdownContent';
import { useTheme } from '../styles/theme';
import { borderRadius, spacing, palette } from '../styles/tokens';
import type { Message, ContentBlock } from '../agent/types';
import { createLogger } from '../utils/logger';
import { usePluginChatDecorators } from '../plugins/UIPluginContext';

const log = createLogger('MessageBubble');

// Shadow style for the action popover (web uses boxShadow, native uses shadow* props)
const actionPopoverShadow = Platform.select<ViewStyle>({
  web: {
    // boxShadow is valid on web but not in RN types
    ...({ boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.15)' } as ViewStyle),
  },
  default: {
    shadowColor: palette.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
});

export interface MessageBubbleProps {
  message: Message;
  onToolCallExpand?: (toolCallId: string) => void;
  expandedToolCalls?: Set<string>;
  /** Called when copy button is clicked. If not provided, uses clipboard API. */
  onCopy?: (content: string) => void;
  /** Called when user clicks a file path in a tool call */
  onFilePathClick?: (filePath: string) => void;
}

export const MessageBubble = React.memo(function MessageBubble({
  message,
  onToolCallExpand,
  expandedToolCalls,
  onCopy,
  onFilePathClick,
}: MessageBubbleProps) {
  const { colors } = useTheme();
  const isUser = message.role === 'user';
  const [isHovered, setIsHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const content = message.content || '';
    
    if (onCopy) {
      onCopy(content);
    } else if (Platform.OS === 'web') {
      try {
        // Use clipboard API on web
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const nav = (globalThis as any).navigator;
        if (nav?.clipboard?.writeText) {
          await nav.clipboard.writeText(content);
        }
      } catch (err) {
        log.error('Failed to copy:', err);
        return;
      }
    }
    
    // Show "copied" feedback
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [message.content, onCopy]);

  // Chat decorators from plugins
  const beforeDecorators = usePluginChatDecorators('before');
  const afterDecorators = usePluginChatDecorators('after');
  const wrapDecorators = usePluginChatDecorators('wrap');

  const showCopyButton = message.content && message.content.length > 0;
  const hasContent = !!message.content;
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;
  const hasContentBlocks = message.contentBlocks && message.contentBlocks.length > 0;

  // Don't render an empty bubble while waiting for the agent to start streaming
  if (!hasContent && !hasToolCalls && !hasContentBlocks) {
    return null;
  }

  // Render content blocks sequentially if available, otherwise fall back to legacy layout
  const renderContent = () => {
    if (hasContentBlocks) {
      // Sequential rendering: text and tool calls in the order they arrived
      return message.contentBlocks!.map((block: ContentBlock, index: number) => {
        if (block.type === 'text') {
          return block.text ? (
            <MarkdownContent
              key={`text-${index}`}
              content={block.text}
              inverted={false}
            />
          ) : null;
        } else if (block.type === 'tool_call') {
          return (
            <ToolCallBlock
              key={block.toolCall.id}
              toolCall={block.toolCall}
              expanded={expandedToolCalls?.has(block.toolCall.id)}
              onToggle={() => onToolCallExpand?.(block.toolCall.id)}
              isFirst={index === 0}
              onFilePathClick={onFilePathClick}
            />
          );
        }
        return null;
      });
    }

    // Legacy fallback: all text first, then all tool calls
    return (
      <>
        {message.content ? (
          <MarkdownContent
            content={message.content}
            inverted={false}
          />
        ) : null}
        {message.toolCalls?.map((toolCall, idx) => (
          <ToolCallBlock
            key={toolCall.id}
            toolCall={toolCall}
            expanded={expandedToolCalls?.has(toolCall.id)}
            onToggle={() => onToolCallExpand?.(toolCall.id)}
            isFirst={idx === 0 && !hasContent}
            onFilePathClick={onFilePathClick}
          />
        ))}
      </>
    );
  };

  return (
    <Pressable
      style={[
        styles.container,
        isUser ? styles.userContainer : styles.assistantContainer,
      ]}
      onHoverIn={() => setIsHovered(true)}
      onHoverOut={() => setIsHovered(false)}
    >
      <View style={styles.bubbleWrapper}>
        <View
          style={[
            styles.bubble,
            isUser
              ? [styles.userBubble, { backgroundColor: colors.bg.tertiary }]
              : [styles.assistantBubble, { backgroundColor: colors.bg.tertiary }],
          ]}
        >
          {/* Plugin 'before' decorators */}
          {beforeDecorators
            .filter((d) => !d.filter || d.filter(message))
            .map((d) => {
              const D = d.component;
              return <D key={d.id} bridge={undefined as any} projectId="" pluginName={d.pluginName} message={message} />;
            })}
          {/* Main content, optionally wrapped by 'wrap' decorators */}
          {(() => {
            const activeWraps = wrapDecorators.filter((d) => !d.filter || d.filter(message));
            if (activeWraps.length === 0) return renderContent();
            return activeWraps.reduceRight(
              (children, d) => {
                const W = d.component;
                return <W key={d.id} bridge={undefined as any} projectId="" pluginName={d.pluginName} message={message}>{children}</W>;
              },
              <>{renderContent()}</>,
            );
          })()}
          {/* Plugin 'after' decorators */}
          {afterDecorators
            .filter((d) => !d.filter || d.filter(message))
            .map((d) => {
              const D = d.component;
              return <D key={d.id} bridge={undefined as any} projectId="" pluginName={d.pluginName} message={message} />;
            })}
        </View>

        {/* Floating action popover - shows on hover, positioned above top-right corner (hidden on mobile for now) */}
        {Platform.OS === 'web' && showCopyButton && (isHovered || copied) ? (
          <View
            style={[
              styles.actionPopover,
              actionPopoverShadow,
              { backgroundColor: colors.bg.elevated },
              styles.actionPopoverRight,
            ]}
          >
            <IconButton
              icon={copied ? 'check' : 'copy'}
              size="sm"
              variant="ghost"
              onPress={handleCopy}
            />
          </View>
        ) : null}
      </View>

      <Text
        variant="caption"
        color="muted"
        style={[styles.timestamp, isUser && styles.userTimestamp]}
      >
        {formatTimestamp(message.createdAt)}
      </Text>
    </Pressable>
  );
});

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const styles = StyleSheet.create({
  container: {
    marginVertical: spacing[2],
  },
  userContainer: {
    // Full-width bubble for user messages
    alignSelf: 'stretch',
  },
  assistantContainer: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
  },
  bubbleWrapper: {
    position: 'relative',
  },
  bubble: {
    padding: spacing[3],
    borderRadius: borderRadius.lg,
  },
  userBubble: {
    borderRadius: borderRadius.sm,
  },
  assistantBubble: {
    borderBottomLeftRadius: borderRadius.sm,
  },
  content: {
    lineHeight: 22,
  },
  actionPopover: {
    position: 'absolute',
    top: -spacing[5],
    borderRadius: borderRadius.md,
    zIndex: 10,
  },
  actionPopoverRight: {
    right: 0,
  },
  timestamp: {
    marginTop: spacing[1],
    marginLeft: spacing[2],
  },
  userTimestamp: {
    marginLeft: spacing[2],
  },
});
