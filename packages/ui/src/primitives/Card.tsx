import React from 'react';
import { View, ViewProps, StyleSheet } from 'react-native';
import { useTheme } from '../styles/theme';
import { borderRadius, spacing, shadows } from '../styles/tokens';

export interface CardProps extends ViewProps {
  variant?: 'default' | 'elevated' | 'outlined';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export function Card({
  variant = 'default',
  padding = 'md',
  style,
  children,
  ...props
}: CardProps) {
  const { colors } = useTheme();

  const paddingValues = {
    none: 0,
    sm: spacing[2],
    md: spacing[4],
    lg: spacing[6],
  };

  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: variant === 'elevated' ? colors.bg.elevated : colors.bg.secondary,
          padding: paddingValues[padding],
        },
        variant === 'outlined' && {
          borderWidth: 1,
          borderColor: colors.border.light,
          backgroundColor: 'transparent',
        },
        variant === 'elevated' && shadows.md,
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: borderRadius.lg,
  },
});
