import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Text } from '../primitives/Text';
import { Modal } from '../primitives/Modal';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius } from '../styles/tokens';
import type { ModelInfo, AgentBridge } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('ModelSelector');

export interface ModelSelectorProps {
  /** Current selected model ID */
  selectedModelId?: string;
  /** Callback when model is selected */
  onSelect: (model: ModelInfo) => void;
  /** Agent bridge to fetch models */
  bridge: AgentBridge;
  /** Project ID to fetch models for */
  projectId: string;
  /** Whether the selector is disabled */
  disabled?: boolean;
}

/**
 * Model selector component that shows available AI models
 * and allows the user to switch between them.
 */
export function ModelSelector({
  selectedModelId,
  onSelect,
  bridge,
  projectId,
  disabled = false,
}: ModelSelectorProps) {
  const { colors } = useTheme();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadModels();
  }, [projectId]);

  const loadModels = async () => {
    try {
      const modelList = await bridge.getModels(projectId);
      setModels(modelList);
    } catch (e) {
      log.error('Failed to load models:', e);
    } finally {
      setLoading(false);
    }
  };

  const selectedModel = models.find((m) => m.id === selectedModelId) || models[0];

  const handleSelect = (model: ModelInfo) => {
    onSelect(model);
    setIsOpen(false);
  };

  // Group models by provider
  const modelsByProvider = models.reduce((acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = [];
    }
    acc[model.provider].push(model);
    return acc;
  }, {} as Record<string, ModelInfo[]>);

  return (
    <>
      <Pressable
        onPress={() => !disabled && setIsOpen(true)}
        style={[
          styles.trigger,
          { backgroundColor: colors.bg.secondary, borderColor: colors.border.light },
          disabled && styles.triggerDisabled,
        ]}
        disabled={disabled}
      >
        <View style={styles.triggerContent}>
          {selectedModel ? (
            <>
              <Text style={[styles.modelName, { color: colors.text.primary }]}>
                {selectedModel.name}
              </Text>
              <Text style={[styles.providerName, { color: colors.text.muted }]}>
                {formatProviderName(selectedModel.provider)}
              </Text>
            </>
          ) : (
            <Text style={{ color: colors.text.muted }}>
              {loading ? 'Loading...' : 'Select model'}
            </Text>
          )}
        </View>
        <Text style={[styles.chevron, { color: colors.text.muted }]}>▼</Text>
      </Pressable>

      <Modal visible={isOpen} onClose={() => setIsOpen(false)} title="Select Model">
        <ScrollView style={styles.modelList}>
          {Object.entries(modelsByProvider).map(([provider, providerModels]) => (
            <View key={provider} style={styles.providerSection}>
              <Text
                style={[styles.providerHeader, { color: colors.text.secondary }]}
              >
                {formatProviderName(provider)}
              </Text>
              {providerModels.map((model) => (
                <Pressable
                  key={model.id}
                  style={[
                    styles.modelItem,
                    { borderBottomColor: colors.border.light },
                    model.id === selectedModelId && {
                      backgroundColor: colors.bg.tertiary,
                    },
                  ]}
                  onPress={() => handleSelect(model)}
                >
                  <View style={styles.modelInfo}>
                    <Text
                      style={[
                        styles.modelItemName,
                        { color: colors.text.primary },
                        model.id === selectedModelId && { color: colors.primary },
                      ]}
                    >
                      {model.name}
                    </Text>
                    {model.contextLength && (
                      <Text style={[styles.modelContext, { color: colors.text.muted }]}>
                        {formatContextLength(model.contextLength)} context
                      </Text>
                    )}
                  </View>
                  {model.id === selectedModelId && (
                    <Text style={[styles.checkmark, { color: colors.primary }]}>✓</Text>
                  )}
                </Pressable>
              ))}
            </View>
          ))}
        </ScrollView>
      </Modal>
    </>
  );
}

// ============ Compact Model Selector ============

export interface CompactModelSelectorProps {
  /** Current selected model */
  selectedModel?: ModelInfo;
  /** Callback when clicked */
  onPress: () => void;
  /** Whether disabled */
  disabled?: boolean;
}

/**
 * Compact model selector that just shows the current model
 * and opens a full selector on press.
 */
export function CompactModelSelector({
  selectedModel,
  onPress,
  disabled = false,
}: CompactModelSelectorProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.compactTrigger,
        { backgroundColor: colors.bg.tertiary },
        disabled && styles.triggerDisabled,
      ]}
      disabled={disabled}
    >
      <Text style={[styles.compactText, { color: colors.text.secondary }]}>
        {selectedModel?.name || 'Select model'}
      </Text>
      <Text style={[styles.compactChevron, { color: colors.text.muted }]}>▼</Text>
    </Pressable>
  );
}

// ============ Helpers ============

function formatProviderName(provider: string): string {
  const names: Record<string, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    google: 'Google AI',
    openrouter: 'OpenRouter',
    groq: 'Groq',
    xai: 'xAI',
  };
  return names[provider] || provider;
}

function formatContextLength(length: number): string {
  if (length >= 1000000) {
    return `${(length / 1000000).toFixed(1)}M`;
  }
  if (length >= 1000) {
    return `${(length / 1000).toFixed(0)}K`;
  }
  return String(length);
}

// ============ Styles ============

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    minWidth: 160,
  },
  triggerDisabled: {
    opacity: 0.5,
  },
  triggerContent: {
    flex: 1,
  },
  modelName: {
    fontSize: 14,
    fontWeight: '500',
  },
  providerName: {
    fontSize: 12,
    marginTop: 2,
  },
  chevron: {
    fontSize: 10,
    marginLeft: spacing[2],
  },
  modelList: {
    maxHeight: 400,
  },
  providerSection: {
    marginBottom: spacing[3],
  },
  providerHeader: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  modelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
  },
  modelInfo: {
    flex: 1,
  },
  modelItemName: {
    fontSize: 14,
    fontWeight: '500',
  },
  modelContext: {
    fontSize: 12,
    marginTop: 2,
  },
  checkmark: {
    fontSize: 16,
    fontWeight: '600',
  },
  compactTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.sm,
    gap: spacing[1],
  },
  compactText: {
    fontSize: 12,
  },
  compactChevron: {
    fontSize: 8,
  },
});
