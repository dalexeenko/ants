import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from '../primitives/Text';
import { useTheme } from '../styles/theme';
import { borderRadius, spacing } from '../styles/tokens';

export interface TypingIndicatorProps {
  /** Optional label to show alongside the dots */
  label?: string;
  /** Size of the indicator */
  size?: 'sm' | 'md';
}

/**
 * Animated typing indicator with bouncing dots.
 * Shows when the assistant is processing/typing a response.
 */
export function TypingIndicator({
  label = 'Thinking',
  size = 'md',
}: TypingIndicatorProps) {
  const { colors } = useTheme();
  const [activeDot, setActiveDot] = useState(0);

  // Cycle through dots for animation
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveDot((prev) => (prev + 1) % 3);
    }, 300);
    
    return () => clearInterval(interval);
  }, []);

  const dotSize = size === 'sm' ? 6 : 8;
  const dotSpacing = size === 'sm' ? 3 : 4;
  const paddingH = size === 'sm' ? spacing[2] : spacing[3];
  const paddingV = size === 'sm' ? spacing[1.5] : spacing[2];

  const renderDot = (index: number) => {
    const isActive = activeDot === index;
    
    return (
      <View
        key={index}
        style={[
          styles.dot,
          {
            width: dotSize,
            height: dotSize,
            backgroundColor: colors.text.muted,
            marginHorizontal: dotSpacing / 2,
            opacity: isActive ? 1 : 0.4,
            transform: [{ translateY: isActive ? -3 : 0 }],
          },
        ]}
      />
    );
  };

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: colors.bg.secondary,
            paddingHorizontal: paddingH,
            paddingVertical: paddingV,
          },
        ]}
      >
        {label && (
          <Text
            variant="caption"
            color="muted"
            style={styles.label}
          >
            {label}
          </Text>
        )}
        <View style={styles.dotsContainer}>
          {[0, 1, 2].map(renderDot)}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
    marginVertical: spacing[2],
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.lg,
    borderBottomLeftRadius: borderRadius.sm,
  },
  label: {
    marginRight: spacing[2],
  },
  dotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 16,
  },
  dot: {
    borderRadius: 100,
  },
});
