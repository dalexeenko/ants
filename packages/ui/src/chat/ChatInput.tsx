import React, { useState, useRef, useEffect } from 'react';
import { View, TextInput, Pressable, StyleSheet, Platform } from 'react-native';
import { Text } from '../primitives/Text';
import { IconButton, Icon } from '../primitives/IconButton';
import { useTheme } from '../styles/theme';
import { borderRadius, spacing, fontSize, colors as tokenColors } from '../styles/tokens';
import type { Attachment, SlashCommand } from '../agent/types';

export interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  onAttach?: () => void;
  disabled?: boolean;
  isProcessing?: boolean;
  placeholder?: string;
  attachments?: Attachment[];
  onRemoveAttachment?: (id: string) => void;

  // Command autocomplete
  commands?: SlashCommand[];
  showAutocomplete?: boolean;
  selectedCommandIndex?: number;
  onSelectCommand?: (command: SlashCommand) => void;
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  onCancel,
  onAttach,
  disabled,
  isProcessing,
  placeholder = 'Type a message...',
  attachments,
  onRemoveAttachment,
  commands,
  showAutocomplete,
  selectedCommandIndex = 0,
  onSelectCommand,
}: ChatInputProps) {
  const { colors } = useTheme();
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<any>(null);

  // Auto-grow textarea on web/Electron as user types
  useEffect(() => {
    if (Platform.OS === 'web' && inputRef.current) {
      // react-native-web exposes the underlying DOM node directly on the ref
      const el = inputRef.current as unknown as HTMLTextAreaElement;
      if (el && el.style) {
        // Reset height so scrollHeight recalculates correctly
        el.style.height = 'auto';
        // Grow up to maxHeight (120px ≈ 6 lines at 13px font), then scroll
        const maxHeight = 120;
        el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
        el.style.overflow = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
      }
    }
  }, [value]);

  // Only handle Enter key on web (Electron), not on React Native
  // On React Native, Enter adds a newline and user taps the send button
  const handleKeyPress = (e: any) => {
    // Only handle Enter-to-submit on web platforms
    const isWeb = Platform.OS === 'web';
    if (isWeb && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
      e.preventDefault();
      if (!disabled && !isProcessing && value.trim()) {
        onSubmit();
      }
    }
  };

  return (
    <View testID="openmgr-chat-input" style={styles.wrapper}>
      {/* Attachments preview */}
      {attachments && attachments.length > 0 && (
        <View style={styles.attachments}>
          {attachments.map((attachment) => (
            <View
              key={attachment.id}
              style={[styles.attachment, { backgroundColor: colors.bg.tertiary }]}
            >
              <Icon name="attach" size={12} color={colors.text.secondary} />
              <Text variant="caption" style={styles.attachmentName} numberOfLines={1}>
                {attachment.name}
              </Text>
              {onRemoveAttachment && (
                <Pressable onPress={() => onRemoveAttachment(attachment.id)}>
                  <Icon name="close" size={12} color={colors.text.muted} />
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Command autocomplete */}
      {showAutocomplete && commands && commands.length > 0 && (
        <View style={[styles.autocomplete, { backgroundColor: colors.bg.elevated, borderColor: colors.border.light }]}>
          {commands.map((command, index) => (
            <Pressable
              key={command.name}
              style={[
                styles.autocompleteItem,
                index === selectedCommandIndex && { backgroundColor: colors.bg.tertiary },
              ]}
              onPress={() => onSelectCommand?.(command)}
            >
              <Text weight="medium" style={styles.commandName}>
                /{command.name}
              </Text>
              <Text variant="caption" color="muted">
                {command.description}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Input container */}
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.bg.secondary,
            borderColor: isFocused ? tokenColors.primary : colors.border.light,
          },
        ]}
      >
        {onAttach && (
          <IconButton
            icon="attach"
            size="sm"
            variant="ghost"
            onPress={onAttach}
            disabled={disabled || isProcessing}
          />
        )}

        <TextInput
          ref={inputRef}
          testID="openmgr-chat-input-field"
          style={[
            styles.input,
            { color: colors.text.primary },
          ]}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={colors.text.muted}
          multiline
          editable={!disabled}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyPress={handleKeyPress}
        />

        {isProcessing ? (
          <View style={styles.actionButton}>
            <Pressable
              testID="openmgr-chat-cancel"
              style={[styles.cancelButton, { backgroundColor: colors.bg.tertiary }]}
              onPress={onCancel}
            >
              <Icon name="close" size={16} color={colors.text.secondary} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.actionButton}>
            <Pressable
              testID="openmgr-chat-send"
              style={[
                styles.sendButton,
                {
                  backgroundColor:
                    !disabled && value.trim()
                      ? tokenColors.primary
                      : colors.bg.tertiary,
                },
              ]}
              onPress={onSubmit}
              disabled={disabled || !value.trim()}
            >
              <Icon
                name="send"
                size={16}
                color={!disabled && value.trim() ? colors.text.inverse : colors.text.muted}
              />
            </Pressable>
          </View>
        )}
      </View>


    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    padding: spacing[4],
    ...Platform.select({ ios: { paddingHorizontal: 0 }, android: { paddingHorizontal: 0 } }),
  },
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    minHeight: 48,
  },
  input: {
    flex: 1,
    fontSize: fontSize.base,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
    maxHeight: 120,
    minHeight: 24,
  },
  actionButton: {
    paddingBottom: spacing[1],
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachments: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  attachment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.sm,
  },
  attachmentName: {
    maxWidth: 100,
  },
  autocomplete: {
    position: 'absolute',
    bottom: '100%',
    left: spacing[4],
    right: spacing[4],
    marginBottom: spacing[2],
    borderWidth: 1,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    maxHeight: 200,
  },
  autocompleteItem: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  commandName: {
    marginBottom: spacing[0.5],
  },

});
