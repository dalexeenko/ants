import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../styles/theme';

interface SwitchProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  trackColor?: { false: string; true: string };
  thumbColor?: string;
}

export function Switch({
  value,
  onValueChange,
  disabled = false,
  trackColor,
  thumbColor,
}: SwitchProps) {
  const { colors } = useTheme();
  
  const defaultTrackColor = {
    false: colors.border.medium,
    true: colors.primary,
  };
  
  const resolvedTrackColor = trackColor || defaultTrackColor;
  const resolvedThumbColor = thumbColor || colors.text.inverse;

  return (
    <Pressable
      onPress={() => !disabled && onValueChange(!value)}
      style={[
        styles.track,
        {
          backgroundColor: value ? resolvedTrackColor.true : resolvedTrackColor.false,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.thumb,
          {
            backgroundColor: resolvedThumbColor,
            transform: [{ translateX: value ? 18 : 2 }],
          },
        ]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 44,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
  },
  thumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    boxShadow: '0px 1px 2px rgba(0, 0, 0, 0.2)',
  } as any,
});
