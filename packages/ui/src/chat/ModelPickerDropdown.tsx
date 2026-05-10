/**
 * ModelPickerDropdown - Desktop-oriented model picker.
 *
 * Shows a compact badge with the current model name. Clicking it toggles
 * an inline scrollable dropdown (not a full-screen modal) with search and
 * model selection. Uses the shared ModelPickerContent for the inner content.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from '../primitives/Text';
import { Icon } from '../primitives/IconButton';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius, shadows } from '../styles/tokens';
import { ModelPickerContent } from './ModelPickerContent';
import type { AgentBridge, ModelInfo, ModelConfig } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('ModelPickerDropdown');

export interface ModelPickerDropdownProps {
  bridge: AgentBridge;
  projectId: string;
  sessionId: string;
}

export function ModelPickerDropdown({ bridge, projectId, sessionId }: ModelPickerDropdownProps) {
  const { colors } = useTheme();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [projectModel, setProjectModel] = useState<ModelConfig | null>(null);
  const [sessionModel, setSessionModel] = useState<ModelConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadModels();
  }, [projectId, sessionId]);

  const loadModels = async () => {
    try {
      setLoading(true);
      const [modelsData, projModel, sessModel] = await Promise.all([
        bridge.getModels(projectId),
        bridge.getCurrentModel(projectId),
        bridge.getSessionModel(projectId, sessionId),
      ]);
      setModels(modelsData);
      setProjectModel(projModel);
      setSessionModel(sessModel);
    } catch (e) {
      log.error('Failed to load models for picker:', e);
    } finally {
      setLoading(false);
    }
  };

  const effectiveModel = sessionModel ?? projectModel;
  const isOverridden = sessionModel !== null;

  const currentModelInfo = models.find(
    (m) => m.id === effectiveModel?.model && m.provider === effectiveModel?.provider,
  );

  const handleSelectModel = useCallback(
    async (model: ModelInfo) => {
      try {
        await bridge.setSessionModel(projectId, sessionId, model.provider, model.id);
        setSessionModel({ provider: model.provider, model: model.id });
        setOpen(false);
      } catch (e) {
        log.error('Failed to set session model:', e);
      }
    },
    [bridge, projectId, sessionId],
  );

  const handleClearOverride = useCallback(async () => {
    try {
      await bridge.clearSessionModel(projectId, sessionId);
      setSessionModel(null);
      setOpen(false);
    } catch (e) {
      log.error('Failed to clear session model:', e);
    }
  }, [bridge, projectId, sessionId]);

  if (loading) {
    return (
      <View style={[styles.badge, { backgroundColor: colors.bg.tertiary }]}>
        <Text style={[styles.badgeText, { color: colors.text.muted }]}>...</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      {/* Badge trigger */}
      <Pressable
        style={[
          styles.badge,
          { backgroundColor: colors.bg.tertiary },
          isOverridden && { borderWidth: 1, borderColor: colors.primary },
        ]}
        onPress={() => setOpen(!open)}
        testID="ants-model-picker"
      >
        <Text
          style={[
            styles.badgeText,
            { color: isOverridden ? colors.primary : colors.text.secondary },
          ]}
          numberOfLines={1}
        >
          {currentModelInfo?.name || effectiveModel?.model || 'Select model'}
        </Text>
        <Icon name={open ? 'chevron-up' : 'chevronDown'} size={10} color={colors.text.muted} />
      </Pressable>

      {/* Dropdown */}
      {open && (
        <>
          {/* Backdrop to close on outside click */}
          <Pressable
            style={styles.backdrop}
            onPress={() => setOpen(false)}
          />
          <View
            style={[
              styles.dropdown,
              {
                backgroundColor: colors.bg.primary,
                borderColor: colors.border.medium,
              },
              shadows.lg,
            ]}
            testID="ants-model-picker-dropdown"
          >
            <ModelPickerContent
              models={models}
              effectiveModel={effectiveModel}
              projectModel={projectModel}
              isOverridden={isOverridden}
              onSelectModel={handleSelectModel}
              onClearOverride={handleClearOverride}
              maxHeight={400}
              autoFocusSearch
            />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    zIndex: 100,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.sm,
    gap: spacing[1],
    maxWidth: 180,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '500',
    flexShrink: 1,
  },
  backdrop: {
    position: 'fixed' as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 99,
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    width: 340,
    marginTop: 4,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    zIndex: 100,
  },
});
