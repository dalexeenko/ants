import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from './Text';
import { useTheme } from '../styles/theme';
import { spacing, colors as tokenColors } from '../styles/tokens';

export type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'error';

export interface ConnectionStatusProps {
  /** Current connection state */
  state: ConnectionState;
  /** Optional label to display */
  label?: string;
  /** Error message when state is 'error' */
  errorMessage?: string;
  /** Callback when retry is clicked (only shown for disconnected/error states) */
  onRetry?: () => void;
  /** Size variant */
  size?: 'sm' | 'md';
}

/**
 * Connection status indicator component.
 * Shows a colored dot with optional label indicating connection state.
 */
export function ConnectionStatus({
  state,
  label,
  errorMessage,
  onRetry,
  size = 'md',
}: ConnectionStatusProps) {
  const { colors } = useTheme();

  const getStatusColor = () => {
    switch (state) {
      case 'connected':
        return tokenColors.success;
      case 'connecting':
        return tokenColors.warning;
      case 'disconnected':
        return colors.text.muted;
      case 'error':
        return tokenColors.error;
    }
  };

  const getStatusLabel = () => {
    if (label) return label;
    switch (state) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'disconnected':
        return 'Disconnected';
      case 'error':
        return errorMessage || 'Connection error';
    }
  };

  const dotSize = size === 'sm' ? 8 : 10;
  const fontSize = size === 'sm' ? 12 : 14;

  const content = (
    <View style={styles.container}>
      <View
        style={[
          styles.dot,
          {
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: getStatusColor(),
          },
        ]}
      />
      <Text
        style={[
          styles.label,
          { color: colors.text.secondary, fontSize },
        ]}
        numberOfLines={1}
      >
        {getStatusLabel()}
      </Text>
    </View>
  );

  if (onRetry && (state === 'disconnected' || state === 'error')) {
    return (
      <Pressable onPress={onRetry} style={styles.pressable}>
        {content}
        <Text style={[styles.retry, { color: colors.primary, fontSize }]}>
          Retry
        </Text>
      </Pressable>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  pressable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  dot: {
    flexShrink: 0,
  },
  label: {
    flexShrink: 1,
  },
  retry: {
    marginLeft: spacing[1],
  },
});
