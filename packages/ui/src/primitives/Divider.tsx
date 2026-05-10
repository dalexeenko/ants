import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../styles/theme';
import { spacing } from '../styles/tokens';

export interface DividerProps {
  orientation?: 'horizontal' | 'vertical';
  spacing?: 'none' | 'sm' | 'md' | 'lg';
}

export function Divider({
  orientation = 'horizontal',
  spacing: spacingProp = 'md',
}: DividerProps) {
  const { colors } = useTheme();

  const spacingValues = {
    none: 0,
    sm: spacing[2],
    md: spacing[4],
    lg: spacing[6],
  };

  const marginValue = spacingValues[spacingProp];

  return (
    <View
      style={[
        {
          backgroundColor: colors.border.light,
        },
        orientation === 'horizontal'
          ? {
              height: 1,
              width: '100%',
              marginVertical: marginValue,
            }
          : {
              width: 1,
              height: '100%',
              marginHorizontal: marginValue,
            },
      ]}
    />
  );
}
