import React, { useState, useRef } from 'react';
import { View, TextInput, StyleSheet, Pressable } from 'react-native';
import { Text } from './Text';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius } from '../styles/tokens';

export interface SearchInputProps {
  /** Current search value */
  value: string;
  /** Called when value changes */
  onChange: (value: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Called when search is submitted (Enter key) */
  onSubmit?: () => void;
  /** Called when input is focused */
  onFocus?: () => void;
  /** Called when input loses focus */
  onBlur?: () => void;
  /** Whether to auto-focus on mount */
  autoFocus?: boolean;
  /** Size variant */
  size?: 'sm' | 'md';
  /** Whether the input is disabled */
  disabled?: boolean;
}

/**
 * Search input component with icon and clear button.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search...',
  onSubmit,
  onFocus,
  onBlur,
  autoFocus = false,
  size = 'md',
  disabled = false,
}: SearchInputProps) {
  const { colors } = useTheme();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inputRef = useRef<any>(null);
  const [isFocused, setIsFocused] = useState(false);

  const handleFocus = () => {
    setIsFocused(true);
    onFocus?.();
  };

  const handleBlur = () => {
    setIsFocused(false);
    onBlur?.();
  };

  const handleClear = () => {
    onChange('');
    inputRef.current?.focus();
  };

  const paddingVertical = size === 'sm' ? spacing[1.5] : spacing[2];
  const paddingHorizontal = size === 'sm' ? spacing[2] : spacing[3];
  const fontSize = size === 'sm' ? 13 : 14;
  const iconSize = size === 'sm' ? 14 : 16;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.bg.secondary,
          borderColor: isFocused ? colors.primary : colors.border.light,
          paddingVertical,
          paddingHorizontal,
        },
        disabled && styles.disabled,
      ]}
    >
      {/* Search Icon */}
      <Text style={[styles.icon, { fontSize: iconSize, color: colors.text.muted }]}>
        🔍
      </Text>

      {/* Input */}
      <TextInput
        ref={inputRef}
        style={[
          styles.input,
          { color: colors.text.primary, fontSize },
        ]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.text.muted}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onSubmitEditing={onSubmit}
        autoFocus={autoFocus}
        editable={!disabled}
        returnKeyType="search"
      />

      {/* Clear Button */}
      {value.length > 0 && (
        <Pressable onPress={handleClear} style={styles.clearButton}>
          <Text style={[styles.clearIcon, { color: colors.text.muted }]}>×</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    gap: spacing[2],
  },
  disabled: {
    opacity: 0.5,
  },
  icon: {
    opacity: 0.7,
  },
  input: {
    flex: 1,
    padding: 0,
    margin: 0,
  },
  clearButton: {
    padding: spacing[1],
    marginRight: -spacing[1],
  },
  clearIcon: {
    fontSize: 18,
    fontWeight: '600',
  },
});
