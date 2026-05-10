/**
 * ModelPicker - Mobile-oriented model picker (full-screen modal).
 *
 * Shows a compact badge with the current model name. Tapping opens a
 * full-screen modal with search and model selection. Uses the shared
 * ModelPickerContent for the inner content.
 *
 * For desktop, use ModelPickerDropdown instead (inline scrollable dropdown).
 */

import React, { useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, Pressable, Modal, SafeAreaView } from 'react-native';
import { Text } from '../primitives/Text';
import { Icon } from '../primitives/IconButton';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius } from '../styles/tokens';
import { ModelPickerContent } from './ModelPickerContent';
import type { AgentBridge, ModelInfo, ModelConfig } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('ModelPicker');

interface ModelPickerProps {
  bridge: AgentBridge;
  projectId: string;
  sessionId: string;
}

/**
 * Compact model picker for the session header.
 * Shows a badge with the current model name. Tapping opens a full-screen
 * modal to search and select from the full models.dev catalog.
 */
export function ModelPicker({ bridge, projectId, sessionId }: ModelPickerProps) {
  const { colors } = useTheme();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [projectModel, setProjectModel] = useState<ModelConfig | null>(null);
  const [sessionModel, setSessionModel] = useState<ModelConfig | null>(null);
  const [showPicker, setShowPicker] = useState(false);
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

  // The effective model: session override or project default
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
        setShowPicker(false);
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
      setShowPicker(false);
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
    <>
      {/* Badge that opens the picker */}
      <Pressable
        style={[
          styles.badge,
          { backgroundColor: colors.bg.tertiary },
          isOverridden && { borderWidth: 1, borderColor: colors.primary },
        ]}
        onPress={() => setShowPicker(true)}
        testID="openmgr-model-picker"
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
        <Icon name="chevronDown" size={10} color={colors.text.muted} />
      </Pressable>

      {/* Full-screen model picker modal (mobile) */}
      <Modal
        visible={showPicker}
        animationType="slide"
        onRequestClose={() => setShowPicker(false)}
      >
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.bg.primary }]} testID="openmgr-model-picker-dropdown">
          {/* Header */}
          <View style={[styles.modalHeader, { borderBottomColor: colors.border.light }]}>
            <Pressable onPress={() => setShowPicker(false)}>
              <Text style={{ color: colors.primary }}>Cancel</Text>
            </Pressable>
            <Text variant="heading" style={styles.modalTitle as object}>
              Session Model
            </Text>
            <View style={{ width: 50 }} />
          </View>

          {/* Shared content */}
          <ModelPickerContent
            models={models}
            effectiveModel={effectiveModel}
            projectModel={projectModel}
            isOverridden={isOverridden}
            onSelectModel={handleSelectModel}
            onClearOverride={handleClearOverride}
            autoFocusSearch
          />
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
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
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
  },
  modalTitle: {
    textAlign: 'center',
  },
});
