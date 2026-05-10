import React, { useState } from 'react';
import { Pressable, PressableProps, StyleSheet } from 'react-native';
import { useTheme } from '../styles/theme';
import { borderRadius } from '../styles/tokens';
import { iconMap } from './icons';

export type IconName = keyof typeof iconMap;

export interface IconButtonProps extends Omit<PressableProps, 'children'> {
  icon: IconName | string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'ghost';
  /** Test identifier — maps to data-testid on web, testID on native */
  testID?: string;
}

export function IconButton({
  icon,
  size = 'md',
  variant = 'default',
  disabled,
  onPress,
  style,
  testID,
  ...props
}: IconButtonProps) {
  const { colors } = useTheme();
  const [isHovered, setIsHovered] = useState(false);

  const sizeStyles = {
    sm: { buttonSize: 28, iconSize: 14 },
    md: { buttonSize: 36, iconSize: 18 },
    lg: { buttonSize: 44, iconSize: 22 },
  };

  const currentSize = sizeStyles[size];
  const IconComponent = iconMap[icon];

  const getBackgroundColor = (pressed: boolean) => {
    if (variant === 'ghost') {
      if (pressed) return colors.bg.tertiary;
      if (isHovered) return colors.bg.secondary;
      return 'transparent';
    }
    // default variant
    if (pressed) return colors.bg.tertiary;
    if (isHovered) return colors.bg.tertiary;
    return colors.bg.secondary;
  };

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      onHoverIn={() => setIsHovered(true)}
      onHoverOut={() => setIsHovered(false)}
      style={({ pressed }) => [
        styles.base,
        {
          width: currentSize.buttonSize,
          height: currentSize.buttonSize,
          backgroundColor: getBackgroundColor(pressed),
          opacity: disabled ? 0.5 : 1,
        },
        style as any,
      ]}
      {...props}
    >
      {IconComponent ? (
        <IconComponent
          size={currentSize.iconSize}
          color={isHovered ? colors.text.primary : colors.text.secondary}
          strokeWidth={2}
          style={{ pointerEvents: 'none' }}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// Export a simple Icon component for non-button usage
export interface IconProps {
  name: IconName | string;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 18, color, strokeWidth = 2 }: IconProps) {
  const { colors } = useTheme();
  const IconComponent = iconMap[name];

  if (!IconComponent) {
    return null;
  }

  return (
    <IconComponent
      size={size}
      color={color || colors.text.secondary}
      strokeWidth={strokeWidth}
    />
  );
}
