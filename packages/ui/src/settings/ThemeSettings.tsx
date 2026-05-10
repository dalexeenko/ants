import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from '../primitives/Text';
import { Icon, type IconName } from '../primitives/IconButton';
import { SettingsSection } from './SettingsSection';
import { useTheme } from '../styles/theme';
import { useUIStore } from '../store/uiStore';
import { spacing, borderRadius } from '../styles/tokens';

type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeOptionProps {
  label: string;
  description: string;
  icon: IconName;
  selected: boolean;
  onSelect: () => void;
}

function ThemeOption({ label, description, icon, selected, onSelect }: ThemeOptionProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      style={[
        styles.option,
        { borderColor: selected ? colors.primary : colors.border.medium },
        selected && { backgroundColor: colors.bg.tertiary },
      ]}
      onPress={onSelect}
    >
      <View style={styles.optionIcon}>
        <Icon
          name={icon}
          size={24}
          color={selected ? colors.primary : colors.text.secondary}
        />
      </View>
      <View style={styles.optionContent}>
        <Text
          style={[
            styles.optionLabel,
            { color: selected ? colors.primary : colors.text.primary },
          ]}
        >
          {label}
        </Text>
        <Text style={[styles.optionDescription, { color: colors.text.muted }]}>
          {description}
        </Text>
      </View>
      {selected && (
        <Icon name="check" size={18} color={colors.primary} />
      )}
    </Pressable>
  );
}

export function ThemeSettings() {
  const themeMode = useUIStore((state) => state.themeMode);
  const setThemeMode = useUIStore((state) => state.setThemeMode);

  const options: Array<{ mode: ThemeMode; label: string; description: string; icon: IconName }> = [
    {
      mode: 'system',
      label: 'System',
      description: 'Follow your system settings',
      icon: 'monitor',
    },
    {
      mode: 'light',
      label: 'Light',
      description: 'Always use light theme',
      icon: 'sun',
    },
    {
      mode: 'dark',
      label: 'Dark',
      description: 'Always use dark theme',
      icon: 'moon',
    },
  ];

  return (
    <SettingsSection
      title="Appearance"
      description="Choose how OpenMgr looks on your device"
    >
      <View style={styles.options}>
        {options.map((option) => (
          <ThemeOption
            key={option.mode}
            label={option.label}
            description={option.description}
            icon={option.icon}
            selected={themeMode === option.mode}
            onSelect={() => setThemeMode(option.mode)}
          />
        ))}
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  options: {
    gap: spacing[2],
    padding: spacing[3],
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[3],
    borderWidth: 1,
    borderRadius: borderRadius.md,
    gap: spacing[3],
  },
  optionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionContent: {
    flex: 1,
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  optionDescription: {
    fontSize: 12,
    marginTop: 2,
  },
});
