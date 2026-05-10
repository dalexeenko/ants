import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from '../primitives/Text';
import { useTheme } from '../styles/theme';
import { spacing } from '../styles/tokens';

interface SettingsSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text.primary }]}>{title}</Text>
        {description && (
          <Text style={[styles.description, { color: colors.text.secondary }]}>
            {description}
          </Text>
        )}
      </View>
      <View style={[styles.content, { borderColor: colors.border.light }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing[6],
  },
  header: {
    marginBottom: spacing[3],
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: spacing[1],
  },
  description: {
    fontSize: 14,
  },
  content: {
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
});
