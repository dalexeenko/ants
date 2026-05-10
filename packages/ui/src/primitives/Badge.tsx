import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from './Text';
import { useTheme } from '../styles/theme';
import { borderRadius, spacing, colors as tokenColors } from '../styles/tokens';

export interface BadgeProps {
  variant?: 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error';
  size?: 'sm' | 'md';
  children: React.ReactNode;
}

export function Badge({
  variant = 'default',
  size = 'md',
  children,
}: BadgeProps) {
  const { colors } = useTheme();

  const variantStyles = {
    default: {
      bg: colors.bg.tertiary,
      text: colors.text.secondary,
    },
    primary: {
      bg: tokenColors.primary + '20',
      text: tokenColors.primary,
    },
    secondary: {
      bg: colors.bg.tertiary,
      text: colors.text.secondary,
    },
    success: {
      bg: tokenColors.success + '20',
      text: tokenColors.success,
    },
    warning: {
      bg: tokenColors.warning + '20',
      text: tokenColors.warning,
    },
    error: {
      bg: tokenColors.error + '20',
      text: tokenColors.error,
    },
  };

  const sizeStyles = {
    sm: {
      paddingHorizontal: spacing[1.5],
      paddingVertical: spacing[0.5],
      fontSize: 10,
    },
    md: {
      paddingHorizontal: spacing[2],
      paddingVertical: spacing[1],
      fontSize: 12,
    },
  };

  const currentVariant = variantStyles[variant];
  const currentSize = sizeStyles[size];

  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: currentVariant.bg,
          paddingHorizontal: currentSize.paddingHorizontal,
          paddingVertical: currentSize.paddingVertical,
        },
      ]}
    >
      <Text
        style={[
          styles.text,
          {
            color: currentVariant.text,
            fontSize: currentSize.fontSize,
          },
        ]}
        weight="medium"
      >
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: borderRadius.full,
    alignSelf: 'flex-start',
  },
  text: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
