import React, { useState } from 'react';
import { View, StyleSheet, Pressable, TextInput } from 'react-native';
import { Text } from '../primitives/Text';
import { IconButton } from '../primitives/IconButton';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius } from '../styles/tokens';
import type { Session, ModelInfo } from '../agent/types';

export interface SessionHeaderProps {
  /** Current session */
  session: Session;
  /** Selected model */
  selectedModel?: ModelInfo;
  /** Callback when title is updated */
  onUpdateTitle?: (title: string) => void;
  /** Callback when model selector is clicked */
  onModelSelectorClick?: () => void;
  /** Callback when settings is clicked */
  onSettingsClick?: () => void;
  /** Whether the session is processing */
  isProcessing?: boolean;
}

/**
 * Header component for chat sessions.
 * Shows session title (editable), model selector, and settings button.
 */
export function SessionHeader({
  session,
  selectedModel,
  onUpdateTitle,
  onModelSelectorClick,
  onSettingsClick,
  isProcessing = false,
}: SessionHeaderProps) {
  const { colors } = useTheme();
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(session.title);

  const handleStartEdit = () => {
    if (onUpdateTitle) {
      setEditedTitle(session.title);
      setIsEditing(true);
    }
  };

  const handleFinishEdit = () => {
    setIsEditing(false);
    if (editedTitle.trim() && editedTitle !== session.title) {
      onUpdateTitle?.(editedTitle.trim());
    } else {
      setEditedTitle(session.title);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditedTitle(session.title);
  };

  return (
    <View style={[styles.container, { borderBottomColor: colors.border.light }]}>
      {/* Title Section */}
      <View style={styles.titleSection}>
        {isEditing ? (
          <View style={styles.editContainer}>
            <TextInput
              style={[
                styles.titleInput,
                { color: colors.text.primary, borderColor: colors.primary },
              ]}
              value={editedTitle}
              onChangeText={setEditedTitle}
              onBlur={handleFinishEdit}
              onSubmitEditing={handleFinishEdit}
              autoFocus
              selectTextOnFocus
            />
            <IconButton icon="check" size="sm" onPress={handleFinishEdit} />
            <IconButton icon="x" size="sm" onPress={handleCancelEdit} />
          </View>
        ) : (
          <Pressable
            style={styles.titleContainer}
            onPress={handleStartEdit}
            disabled={!onUpdateTitle}
          >
            <Text
              variant="heading"
              style={styles.title}
              numberOfLines={1}
            >
              {session.title}
            </Text>
            {onUpdateTitle && (
              <Text style={[styles.editHint, { color: colors.text.muted }]}>
                ✏️
              </Text>
            )}
          </Pressable>
        )}
      </View>

      {/* Right Section */}
      <View style={styles.rightSection}>
        {/* Model Selector */}
        {selectedModel && onModelSelectorClick && (
          <Pressable
            style={[styles.modelBadge, { backgroundColor: colors.bg.tertiary }]}
            onPress={onModelSelectorClick}
          >
            <Text style={[styles.modelName, { color: colors.text.secondary }]}>
              {selectedModel.name}
            </Text>
            <Text style={[styles.modelChevron, { color: colors.text.muted }]}>
              ▼
            </Text>
          </Pressable>
        )}

        {/* Processing Indicator */}
        {isProcessing && (
          <View style={[styles.processingBadge, { backgroundColor: colors.primary }]}>
            <Text style={[styles.processingText, { color: colors.text.inverse }]}>Processing...</Text>
          </View>
        )}

        {/* Settings Button */}
        {onSettingsClick && (
          <IconButton icon="settings" size="sm" onPress={onSettingsClick} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    minHeight: 56,
  },
  titleSection: {
    flex: 1,
    marginRight: spacing[3],
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  title: {
    flex: 1,
  },
  editHint: {
    fontSize: 12,
    opacity: 0.5,
  },
  editContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  titleInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderWidth: 1,
    borderRadius: borderRadius.sm,
  },
  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  modelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.sm,
    gap: spacing[1],
  },
  modelName: {
    fontSize: 12,
  },
  modelChevron: {
    fontSize: 8,
  },
  processingBadge: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.sm,
  },
  processingText: {
    fontSize: 12,
    fontWeight: '500',
  },
});
