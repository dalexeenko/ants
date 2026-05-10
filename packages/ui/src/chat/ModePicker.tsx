/**
 * ModePicker - Pill toggle for switching between Plan and Build modes.
 *
 * Shows a compact segmented control in the session header.
 * Plan mode restricts the agent to read-only operations.
 * Build mode gives the agent full tool access.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { View, Pressable, StyleSheet, Platform } from 'react-native';
import { Text } from '../primitives/Text';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius, palette } from '../styles/tokens';
import type { AgentBridge, AgentMode } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('ModePicker');

export interface ModePickerProps {
  bridge: AgentBridge;
  projectId: string;
  sessionId: string;
}

export function ModePicker({ bridge, projectId, sessionId }: ModePickerProps) {
  const { colors } = useTheme();
  const [mode, setMode] = useState<AgentMode>('build');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMode();
  }, [projectId, sessionId]);

  const loadMode = async () => {
    try {
      setLoading(true);
      const currentMode = await bridge.getSessionMode(projectId, sessionId);
      setMode(currentMode);
    } catch (e) {
      log.error('Failed to load mode:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleModeChange = useCallback(async (newMode: AgentMode) => {
    if (newMode === mode) return;
    
    try {
      setMode(newMode); // Optimistic update
      await bridge.setSessionMode(projectId, sessionId, newMode);
    } catch (e) {
      log.error('Failed to set mode:', e);
      setMode(mode); // Revert on error
    }
  }, [bridge, projectId, sessionId, mode]);

  if (loading) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg.tertiary, borderColor: colors.border.light }]} testID="ants-mode-picker">
      <Pressable
        style={[
          styles.option,
          mode === 'plan' && { backgroundColor: colors.bg.primary },
          mode === 'plan' && styles.activeOption,
        ]}
        onPress={() => handleModeChange('plan')}
        testID="ants-mode-option-plan"
      >
        <Text
          style={[
            styles.optionText,
            { color: mode === 'plan' ? colors.text.primary : colors.text.tertiary },
          ]}
        >
          Plan
        </Text>
      </Pressable>
      <Pressable
        style={[
          styles.option,
          mode === 'build' && { backgroundColor: colors.bg.primary },
          mode === 'build' && styles.activeOption,
        ]}
        onPress={() => handleModeChange('build')}
        testID="ants-mode-option-build"
      >
        <Text
          style={[
            styles.optionText,
            { color: mode === 'build' ? colors.text.primary : colors.text.tertiary },
          ]}
        >
          Build
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    padding: 2,
    gap: 2,
  },
  option: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeOption: {
    ...Platform.select({
      web: { boxShadow: '0px 1px 2px rgba(0, 0, 0, 0.1)' } as any,
      default: {
        shadowColor: palette.black,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
      },
    }),
  },
  optionText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
