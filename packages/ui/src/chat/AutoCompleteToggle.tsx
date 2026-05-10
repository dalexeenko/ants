/**
 * AutoCompleteToggle - Toggle for auto-complete (full complete) mode.
 *
 * When enabled, the agent will automatically continue working when it
 * finishes a turn but still has open todo items or phases remaining.
 * Shows the current loop count when active.
 */

import React, { useCallback } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from '../primitives/Text';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius } from '../styles/tokens';
import { useSessionStore } from '../store/sessionStore';
import { createLogger } from '../utils/logger';

const log = createLogger('AutoCompleteToggle');

export interface AutoCompleteToggleProps {
  sessionId: string;
}

export function AutoCompleteToggle({ sessionId }: AutoCompleteToggleProps) {
  const { colors } = useTheme();
  const autoComplete = useSessionStore(
    (s) => s.autoCompleteBySession[sessionId] ?? false,
  );
  const loopCount = useSessionStore(
    (s) => s.autoCompleteLoopBySession[sessionId] ?? 0,
  );
  const isProcessing = useSessionStore(
    (s) => s.processingBySession[sessionId] ?? false,
  );

  const handleToggle = useCallback(() => {
    const store = useSessionStore.getState();
    const next = !autoComplete;
    store.setAutoComplete(sessionId, next);
    if (!next) {
      store.resetAutoCompleteLoop(sessionId);
    }
    log.info(`Auto-complete ${next ? 'enabled' : 'disabled'} for session ${sessionId}`);
  }, [sessionId, autoComplete]);

  const isActive = autoComplete && isProcessing && loopCount > 0;

  return (
    <Pressable
      onPress={handleToggle}
      style={[
        styles.container,
        {
          backgroundColor: autoComplete ? colors.primary : colors.bg.tertiary,
          borderColor: autoComplete ? colors.primary : colors.border.light,
        },
      ]}
    >
      <Text
        style={[
          styles.label,
          { color: autoComplete ? colors.text.inverse : colors.text.tertiary },
        ]}
      >
        Auto
      </Text>
      {isActive && (
        <View style={[styles.badge, { backgroundColor: 'rgba(255,255,255,0.3)' }]}>
          <Text style={[styles.badgeText, { color: colors.text.inverse }]}>{loopCount}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    gap: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
  badge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: borderRadius.sm,
    minWidth: 18,
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
});
