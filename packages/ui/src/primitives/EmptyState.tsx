import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from './Text';
import { Button } from './Button';
import { Icon, type IconName } from './IconButton';
import { useTheme } from '../styles/theme';
import { spacing } from '../styles/tokens';

export interface EmptyStateProps {
  /** Icon to display - can be an IconName (e.g. 'message', 'folder') or emoji string */
  icon?: IconName | string;
  /** Main title */
  title: string;
  /** Description text */
  description?: string;
  /** Action button label */
  actionLabel?: string;
  /** Action button callback */
  onAction?: () => void;
  /** Secondary action label */
  secondaryActionLabel?: string;
  /** Secondary action callback */
  onSecondaryAction?: () => void;
  /** Compact mode for smaller spaces */
  compact?: boolean;
}

/**
 * Empty state component for displaying when there's no content.
 * Used for empty lists, search results, etc.
 */
export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  compact = false,
}: EmptyStateProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      {icon && (
        <View
          style={[
            styles.iconContainer,
            compact && styles.iconContainerCompact,
            { backgroundColor: colors.bg.tertiary },
          ]}
        >
          <Icon
            name={icon}
            size={compact ? 24 : 32}
            color={colors.text.muted}
          />
        </View>
      )}

      <Text
        variant={compact ? 'body' : 'heading'}
        style={[styles.title, { color: colors.text.primary }]}
      >
        {title}
      </Text>

      {description && (
        <Text
          color="secondary"
          style={[styles.description, compact && styles.descriptionCompact]}
        >
          {description}
        </Text>
      )}

      {(actionLabel || secondaryActionLabel) && (
        <View style={[styles.actions, compact && styles.actionsCompact]}>
          {actionLabel && onAction && (
            <Button
              onPress={onAction}
              size={compact ? 'sm' : 'md'}
            >
              {actionLabel}
            </Button>
          )}
          {secondaryActionLabel && onSecondaryAction && (
            <Button
              variant="ghost"
              onPress={onSecondaryAction}
              size={compact ? 'sm' : 'md'}
            >
              {secondaryActionLabel}
            </Button>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[8],
  },
  containerCompact: {
    padding: spacing[4],
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing[4],
  },
  iconContainerCompact: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginBottom: spacing[3],
  },
  title: {
    textAlign: 'center',
    marginBottom: spacing[2],
  },
  description: {
    textAlign: 'center',
    maxWidth: 300,
    marginBottom: spacing[4],
  },
  descriptionCompact: {
    marginBottom: spacing[3],
  },
  actions: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  actionsCompact: {
    gap: spacing[1],
  },
});
