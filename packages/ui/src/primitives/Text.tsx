import React from 'react';
import {
  Text as RNText,
  TextProps as RNTextProps,
  TextStyle,
} from 'react-native';
import { useTheme } from '../styles/theme';
import { fontSize, fontWeight } from '../styles/tokens';

export interface TextProps extends RNTextProps {
  variant?: 'body' | 'caption' | 'label' | 'heading' | 'title';
  size?: keyof typeof fontSize;
  weight?: keyof typeof fontWeight;
  color?: 'primary' | 'secondary' | 'muted' | 'inverse' | 'error' | 'success';
  align?: 'left' | 'center' | 'right';
}

export function Text({
  variant = 'body',
  size,
  weight,
  color = 'primary',
  align,
  style,
  children,
  ...props
}: TextProps) {
  const { colors } = useTheme();

  const variantStyles: Record<string, TextStyle> = {
    body: { fontSize: fontSize.base, fontWeight: fontWeight.normal },
    caption: { fontSize: fontSize.xs, fontWeight: fontWeight.normal },
    label: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
    heading: { fontSize: fontSize.xl, fontWeight: fontWeight.semibold },
    title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold },
  };

  const colorMap: Record<string, string> = {
    primary: colors.text.primary,
    secondary: colors.text.secondary,
    muted: colors.text.muted,
    inverse: colors.text.inverse,
    error: colors.error,
    success: colors.success,
  };

  return (
    <RNText
      style={[
        variantStyles[variant],
        { color: colorMap[color] },
        size && { fontSize: fontSize[size] },
        weight && { fontWeight: fontWeight[weight] },
        align && { textAlign: align },
        style,
      ]}
      {...props}
    >
      {children}
    </RNText>
  );
}
