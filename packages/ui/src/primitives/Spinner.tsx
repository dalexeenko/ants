import React from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { useTheme } from '../styles/theme';
import { colors as tokenColors } from '../styles/tokens';

export interface SpinnerProps {
  size?: 'small' | 'large';
  color?: string;
}

export function Spinner({ size = 'small', color }: SpinnerProps) {

  return (
    <ActivityIndicator
      size={size}
      color={color || tokenColors.primary}
    />
  );
}

export interface LoadingOverlayProps {
  visible: boolean;
}

export function LoadingOverlay({ visible }: LoadingOverlayProps) {
  const { colors } = useTheme();

  if (!visible) return null;

  return (
    <View style={[styles.overlay, { backgroundColor: colors.bg.primary + 'CC' }]}>
      <Spinner size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
});
