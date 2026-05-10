import React from 'react';
import {
  Pressable,
  PressableProps,
  StyleSheet,
  View,
  ActivityIndicator,
} from 'react-native';
import { Text } from './Text';
import { useTheme } from '../styles/theme';
import { colors as tokenColors, borderRadius, spacing } from '../styles/tokens';

export interface ButtonProps extends Omit<PressableProps, 'children'> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  children: React.ReactNode;
  /** Test identifier — maps to data-testid on web, testID on native */
  testID?: string;
}

export function Button({
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  onPress,
  children,
  style,
  testID,
  ...props
}: ButtonProps) {
  const { colors, palette } = useTheme();

  const isDisabled = disabled || loading;

  const variantStyles = {
    primary: {
      bg: tokenColors.primary,
      bgPressed: tokenColors.primaryHover,
      text: colors.text.inverse,
    },
    secondary: {
      bg: colors.bg.tertiary,
      bgPressed: colors.border.light,
      text: colors.text.primary,
    },
    ghost: {
      bg: 'transparent',
      bgPressed: colors.bg.tertiary,
      text: colors.text.primary,
    },
    danger: {
      bg: tokenColors.error,
      bgPressed: palette.errorHover,
      text: colors.text.inverse,
    },
  };

  const sizeStyles = {
    sm: {
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[1.5],
      fontSize: 14,
    },
    md: {
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2],
      fontSize: 16,
    },
    lg: {
      paddingHorizontal: spacing[6],
      paddingVertical: spacing[3],
      fontSize: 18,
    },
  };

  const currentVariant = variantStyles[variant];
  const currentSize = sizeStyles[size];

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: pressed ? currentVariant.bgPressed : currentVariant.bg,
          paddingHorizontal: currentSize.paddingHorizontal,
          paddingVertical: currentSize.paddingVertical,
          opacity: isDisabled ? 0.5 : 1,
        },
        variant === 'secondary' && {
          borderWidth: 1,
          borderColor: colors.border.medium,
        },
        style as any,
      ]}
      {...props}
    >
      <View style={styles.content}>
        {loading && (
          <ActivityIndicator
            size="small"
            color={currentVariant.text}
            style={styles.spinner}
          />
        )}
        <Text
          style={[
            { color: currentVariant.text, fontSize: currentSize.fontSize },
            styles.text,
          ]}
          weight="medium"
        >
          {children}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    marginRight: spacing[2],
  },
  text: {
    textAlign: 'center',
  },
});
