import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from '../primitives/Text';
import { useTheme } from '../styles/theme';
import { spacing } from '../styles/tokens';

interface SettingsRowProps {
  title: string;
  description?: string;
  value?: string;
  action?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
}

export function SettingsRow({
  title,
  description,
  value,
  action,
  onPress,
  disabled,
}: SettingsRowProps) {
  const { colors } = useTheme();

  const content = (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.bg.secondary, borderBottomColor: colors.border.light },
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.labelContainer}>
        <Text style={[styles.title, { color: colors.text.primary }]}>{title}</Text>
        {description && (
          <Text style={[styles.description, { color: colors.text.secondary }]}>
            {description}
          </Text>
        )}
      </View>
      <View style={styles.right}>
        {value && (
          <Text style={[styles.value, { color: colors.text.muted }]}>{value}</Text>
        )}
        {action}
      </View>
    </View>
  );

  if (onPress && !disabled) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => pressed ? { opacity: 0.8 } : undefined}>
        {content}
      </Pressable>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderBottomWidth: 1,
  },
  disabled: {
    opacity: 0.5,
  },
  labelContainer: {
    flex: 1,
    marginRight: spacing[3],
  },
  title: {
    fontSize: 14,
    fontWeight: '500',
  },
  description: {
    fontSize: 12,
    marginTop: spacing[0.5],
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  value: {
    fontSize: 14,
  },
});
