import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { View, Pressable, Image, StyleSheet } from 'react-native';
import { Text } from '../primitives/Text';
import { Icon } from '../primitives/IconButton';
import { ToolCallBlock } from './ToolCallBlock';
import { MarkdownContent } from './MarkdownContent';
import { useTheme } from '../styles/theme';
import { spacing, fontSize } from '../styles/tokens';
import type { Message, ContentBlock } from '../agent/types';
import { usePluginChatDecorators } from '../plugins/UIPluginContext';

export interface AssistantMessageProps {
  message: Message;
  onToolCallExpand?: (toolCallId: string) => void;
  expandedToolCalls?: Set<string>;
  /** Called when user clicks a file path in a tool call */
  onFilePathClick?: (filePath: string) => void;
  /** Whether this message is the last one in the list (used for auto-collapse) */
  isLastMessage?: boolean;
  /** Whether the agent is currently processing (streaming) */
  isProcessing?: boolean;
  /** Whether to auto-collapse intermediate steps when the agent finishes its turn */
  autoCollapseOnDone?: boolean;
}

/**
 * AssistantMessage renders agent responses as inline content (no bubble).
 *
 * For each agent turn, all intermediate content (tool calls and intermediate text)
 * is grouped into a collapsible "steps" block. Only the final text response is
 * always visible. While the agent is streaming, the steps are expanded; once the
 * turn finishes, they auto-collapse (if autoCollapseOnDone is true) to show only
 * the final response.
 */
export const AssistantMessage = React.memo(function AssistantMessage({
  message,
  onToolCallExpand,
  expandedToolCalls,
  onFilePathClick,
  isLastMessage = false,
  isProcessing = false,
  autoCollapseOnDone = true,
}: AssistantMessageProps) {
  const { colors } = useTheme();

  // Chat decorators from plugins
  const beforeDecorators = usePluginChatDecorators('before');
  const afterDecorators = usePluginChatDecorators('after');
  const wrapDecorators = usePluginChatDecorators('wrap');

  const hasContent = !!message.content;
  const hasToolCalls = !!(message.toolCalls && message.toolCalls.length > 0);
  const hasContentBlocks = !!(message.contentBlocks && message.contentBlocks.length > 0);
  const isEmpty = !hasContent && !hasToolCalls && !hasContentBlocks;

  // Split content blocks into three groups, preserving stream order:
  //   1. "before" — blocks that precede the final text (collapsible intermediate steps)
  //   2. "finalTextBlock" — the last text block (always visible)
  //   3. "after" — blocks that follow the final text (e.g., tool calls still streaming)
  const { intermediateBlocks, finalTextBlock, trailingBlocks } = useMemo(() => {
    if (hasContentBlocks) {
      const blocks = message.contentBlocks!;
      // Find the last text block
      let lastTextIndex = -1;
      for (let i = blocks.length - 1; i >= 0; i--) {
        if (blocks[i].type === 'text' && (blocks[i] as { type: 'text'; text: string }).text.trim()) {
          lastTextIndex = i;
          break;
        }
      }

      if (lastTextIndex === -1) {
        // No text blocks at all - everything is intermediate
        return { intermediateBlocks: blocks, finalTextBlock: null, trailingBlocks: [] as ContentBlock[] };
      }

      const blocksBefore = blocks.slice(0, lastTextIndex);
      const blocksAfter = blocks.slice(lastTextIndex + 1);

      return {
        intermediateBlocks: blocksBefore,
        finalTextBlock: blocks[lastTextIndex] as { type: 'text'; text: string },
        trailingBlocks: blocksAfter,
      };
    }

    // Legacy fallback: tool calls are intermediate, content is the final response
    if (hasToolCalls && hasContent) {
      return {
        intermediateBlocks: (message.toolCalls || []).map((tc) => ({ type: 'tool_call' as const, toolCall: tc })),
        finalTextBlock: { type: 'text' as const, text: message.content },
        trailingBlocks: [] as ContentBlock[],
      };
    }

    // Only content, no tool calls
    if (hasContent) {
      return { intermediateBlocks: [] as ContentBlock[], finalTextBlock: { type: 'text' as const, text: message.content }, trailingBlocks: [] as ContentBlock[] };
    }

    // Only tool calls, no final text
    if (hasToolCalls) {
      return {
        intermediateBlocks: (message.toolCalls || []).map((tc) => ({ type: 'tool_call' as const, toolCall: tc })),
        finalTextBlock: null,
        trailingBlocks: [] as ContentBlock[],
      };
    }

    return { intermediateBlocks: [] as ContentBlock[], finalTextBlock: null, trailingBlocks: [] as ContentBlock[] };
  }, [message.contentBlocks, message.toolCalls, message.content, hasContentBlocks, hasToolCalls, hasContent]);

  const hasIntermediate = intermediateBlocks.length > 0;

  // Collapse state: starts expanded while streaming, auto-collapses when done
  const [stepsCollapsed, setStepsCollapsed] = useState(false);

  // When the agent finishes its turn (isProcessing goes from true to false)
  // and this is the last message, auto-collapse the intermediate steps
  const prevProcessingRef = React.useRef(isProcessing);
  useEffect(() => {
    if (autoCollapseOnDone && isLastMessage && hasIntermediate && finalTextBlock) {
      if (prevProcessingRef.current && !isProcessing) {
        // Agent just finished its turn
        setStepsCollapsed(true);
      }
    }
    prevProcessingRef.current = isProcessing;
  }, [isProcessing, isLastMessage, autoCollapseOnDone, hasIntermediate, finalTextBlock]);

  // For historical messages (not actively streaming) that have both intermediate
  // steps and a final response, default to collapsed
  useEffect(() => {
    if (!isProcessing && !isLastMessage && hasIntermediate && finalTextBlock) {
      setStepsCollapsed(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  const toggleCollapsed = useCallback(() => {
    setStepsCollapsed((prev) => !prev);
  }, []);

  // Count the number of tool calls in intermediate blocks for the summary
  const toolCallCount = useMemo(() => {
    return intermediateBlocks.filter((b) => b.type === 'tool_call').length;
  }, [intermediateBlocks]);

  // Don't render an empty message while waiting for the agent to start streaming
  if (isEmpty) {
    return null;
  }

  const renderBlock = (block: ContentBlock, index: number) => {
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
    } else if (block.type === 'image') {
      return (
        <View key={`image-${index}`} style={styles.imageBlock}>
          <Image
            source={{ uri: block.dataUrl }}
            style={{
              width: '100%',
              maxWidth: block.width,
              aspectRatio: block.width / block.height,
            }}
            accessibilityLabel={block.alt}
            resizeMode="contain"
          />
        </View>
      );
    }
    return null;
  };

  const renderContent = () => (
    <>
      {/* Intermediate steps - collapsible */}
      {hasIntermediate && (
        <View style={styles.stepsContainer}>
          <Pressable
            style={[styles.stepsHeader, { borderColor: colors.border.light }]}
            onPress={toggleCollapsed}
          >
            <View style={styles.stepsHeaderLeft}>
              <Icon
                name={stepsCollapsed ? 'chevronRight' : 'chevronDown'}
                size={14}
                color={colors.text.muted}
              />
              <Text variant="caption" color="muted" style={styles.stepsLabel}>
                {toolCallCount > 0
                  ? `${toolCallCount} tool call${toolCallCount !== 1 ? 's' : ''}`
                  : 'Intermediate steps'}
              </Text>
            </View>
          </Pressable>

          {!stepsCollapsed && (
            <View style={[styles.stepsContent, { borderColor: colors.border.light }]}>
              {intermediateBlocks.map((block, index) => renderBlock(block, index))}
            </View>
          )}
        </View>
      )}

      {/* Final response - always visible */}
      {finalTextBlock && (
        <View style={styles.finalResponse}>
          <MarkdownContent
            content={finalTextBlock.text}
            inverted={false}
          />
        </View>
      )}

      {/* Trailing blocks — tool calls / text that arrived after the final text (preserves stream order) */}
      {trailingBlocks.length > 0 && (
        <View style={styles.trailingBlocks}>
          {trailingBlocks.map((block, index) => renderBlock(block, index))}
        </View>
      )}
    </>
  );

  return (
    <View style={styles.container}>
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

      <Text
        variant="caption"
        color="muted"
        style={styles.timestamp}
      >
        {formatTimestamp(message.createdAt)}
      </Text>
    </View>
  );
});

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const styles = StyleSheet.create({
  container: {
    marginVertical: spacing[2],
    alignSelf: 'stretch',
  },
  stepsContainer: {
    marginBottom: spacing[2],
  },
  stepsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[1.5],
    paddingHorizontal: spacing[1],
  },
  stepsHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
  },
  stepsLabel: {
    fontSize: fontSize.xs,
  },
  stepsContent: {
    borderLeftWidth: 2,
    marginLeft: spacing[2],
    paddingLeft: spacing[3],
    paddingVertical: spacing[1],
  },
  finalResponse: {
    // No special styling - content flows inline
  },
  trailingBlocks: {
    marginTop: spacing[2],
  },
  imageBlock: {
    marginVertical: spacing[2],
    borderRadius: 8,
    overflow: 'hidden' as const,
  },
  timestamp: {
    marginTop: spacing[1],
    marginLeft: spacing[1],
  },
});
