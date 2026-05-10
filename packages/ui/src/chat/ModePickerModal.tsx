/**
 * ModePickerModal - Mobile popup modal for mode selection and auto-complete toggle.
 *
 * Opened by a button that displays the current mode ("Build" / "Plan") and
 * whether auto-complete is enabled (appending " (Auto)"). The modal shows
 * the ModePicker segmented control and AutoCompleteToggle in a compact popup.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { View, Pressable, StyleSheet, Modal, Platform } from 'react-native';
import { Text } from '../primitives/Text';
import { Icon } from '../primitives/IconButton';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius, palette } from '../styles/tokens';
import { useSessionStore } from '../store/sessionStore';
import type { AgentBridge, AgentMode } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('ModePickerModal');

export interface ModePickerModalProps {
  bridge: AgentBridge;
  projectId: string;
  sessionId: string;
}

export function ModePickerModal({ bridge, projectId, sessionId }: ModePickerModalProps) {
  const { colors } = useTheme();
  const [mode, setMode] = useState<AgentMode>('build');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const autoComplete = useSessionStore(
    (s) => s.autoCompleteBySession[sessionId] ?? false,
  );
  const loopCount = useSessionStore(
    (s) => s.autoCompleteLoopBySession[sessionId] ?? 0,
  );
  const isProcessing = useSessionStore(
    (s) => s.processingBySession[sessionId] ?? false,
  );

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
      setMode(newMode);
      await bridge.setSessionMode(projectId, sessionId, newMode);
    } catch (e) {
      log.error('Failed to set mode:', e);
      setMode(mode);
    }
  }, [bridge, projectId, sessionId, mode]);

  const handleAutoToggle = useCallback(() => {
    const store = useSessionStore.getState();
    const next = !autoComplete;
    store.setAutoComplete(sessionId, next);
    if (!next) {
      store.resetAutoCompleteLoop(sessionId);
    }
    log.info(`Auto-complete ${next ? 'enabled' : 'disabled'} for session ${sessionId}`);
  }, [sessionId, autoComplete]);

  // Button label: "Build" or "Plan", with " (Auto)" if auto-complete is on
  const modeLabel = mode === 'plan' ? 'Plan' : 'Build';
  const buttonLabel = autoComplete ? `${modeLabel} (Auto)` : modeLabel;

  const isAutoActive = autoComplete && isProcessing && loopCount > 0;

  if (loading) {
    return (
      <View style={[styles.triggerButton, { backgroundColor: colors.bg.tertiary }]}>
        <Text style={[styles.triggerText, { color: colors.text.muted }]}>...</Text>
      </View>
    );
  }

  return (
    <>
      {/* Trigger button */}
      <Pressable
        style={[
          styles.triggerButton,
          { backgroundColor: colors.bg.tertiary },
        ]}
        onPress={() => setShowModal(true)}
      >
        <Text
          style={[styles.triggerText, { color: colors.text.secondary }]}
          numberOfLines={1}
        >
          {buttonLabel}
        </Text>
        {isAutoActive && (
          <View style={[styles.loopBadge, { backgroundColor: colors.primary }]}>
            <Text style={[styles.loopBadgeText, { color: colors.text.inverse }]}>{loopCount}</Text>
          </View>
        )}
        <Icon name="chevronDown" size={10} color={colors.text.muted} />
      </Pressable>

      {/* Popup modal */}
      <Modal
        visible={showModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowModal(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setShowModal(false)}>
          <View style={styles.backdropInner} />
        </Pressable>
        <View style={styles.modalPositioner}>
          <View style={[styles.modalContent, { backgroundColor: colors.bg.primary, borderColor: colors.border.medium }]}>
            {/* Mode selection */}
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.text.muted }]}>Mode</Text>
              <View style={[styles.modeRow, { backgroundColor: colors.bg.tertiary, borderColor: colors.border.light }]}>
                <Pressable
                  style={[
                    styles.modeOption,
                    mode === 'plan' && { backgroundColor: colors.bg.primary },
                    mode === 'plan' && styles.activeModeOption,
                  ]}
                  onPress={() => handleModeChange('plan')}
                >
                  <Text
                    style={[
                      styles.modeText,
                      { color: mode === 'plan' ? colors.text.primary : colors.text.tertiary },
                    ]}
                  >
                    Plan
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.modeOption,
                    mode === 'build' && { backgroundColor: colors.bg.primary },
                    mode === 'build' && styles.activeModeOption,
                  ]}
                  onPress={() => handleModeChange('build')}
                >
                  <Text
                    style={[
                      styles.modeText,
                      { color: mode === 'build' ? colors.text.primary : colors.text.tertiary },
                    ]}
                  >
                    Build
                  </Text>
                </Pressable>
              </View>
              <Text style={[styles.modeDescription, { color: colors.text.muted }]}>
                {mode === 'plan' ? 'Read-only operations only' : 'Full tool access'}
              </Text>
            </View>

            {/* Auto-complete toggle */}
            <View style={[styles.section, styles.autoSection, { borderTopColor: colors.border.light }]}>
              <View style={styles.autoRow}>
                <View style={styles.autoInfo}>
                  <Text style={[styles.sectionLabel, { color: colors.text.muted }]}>Auto-complete</Text>
                  <Text style={[styles.autoDescription, { color: colors.text.muted }]}>
                    Continue when todos or phases remain
                  </Text>
                </View>
                <Pressable
                  onPress={handleAutoToggle}
                  style={[
                    styles.autoToggle,
                    {
                      backgroundColor: autoComplete ? colors.primary : colors.bg.tertiary,
                      borderColor: autoComplete ? colors.primary : colors.border.light,
                    },
                  ]}
                >
                  <Text style={[styles.autoToggleText, { color: autoComplete ? colors.text.inverse : colors.text.tertiary }]}>
                    {autoComplete ? 'On' : 'Off'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  triggerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.sm,
    gap: spacing[1],
  },
  triggerText: {
    fontSize: 12,
    fontWeight: '500',
  },
  loopBadge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: borderRadius.sm,
    minWidth: 16,
    alignItems: 'center',
  },
  loopBadgeText: {
    fontSize: 9,
    fontWeight: '700',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  backdropInner: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  modalPositioner: {
    position: 'absolute',
    bottom: 80,
    left: spacing[4],
    right: spacing[4],
  },
  modalContent: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0px -2px 8px rgba(0, 0, 0, 0.15)' } as any,
      default: {
        shadowColor: palette.black,
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 8,
      },
    }),
  },
  section: {
    padding: spacing[3],
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing[2],
  },
  modeRow: {
    flexDirection: 'row',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    padding: 2,
    gap: 2,
  },
  modeOption: {
    flex: 1,
    paddingVertical: spacing[1] + 2,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeModeOption: {
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
  modeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  modeDescription: {
    fontSize: 11,
    marginTop: spacing[1],
  },
  autoSection: {
    borderTopWidth: 1,
  },
  autoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  autoInfo: {
    flex: 1,
    marginRight: spacing[3],
  },
  autoDescription: {
    fontSize: 11,
    marginTop: 2,
  },
  autoToggle: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1] + 2,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  autoToggleText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
