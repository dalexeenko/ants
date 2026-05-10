import React, { useEffect, useState, useMemo } from 'react';
import { View, StyleSheet, Pressable, ScrollView, TextInput } from 'react-native';
import { Text } from '../primitives/Text';
import { SettingsSection } from './SettingsSection';
import { Icon } from '../primitives/IconButton';
import { useTheme } from '../styles/theme';
import { spacing } from '../styles/tokens';
import type { AgentBridge, ModelInfo, ModelConfig } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('ModelSettings');

interface ModelSettingsProps {
  bridge: AgentBridge;
  projectId: string;
}

/**
 * Model selection settings component.
 * Shows current model and allows switching between available models.
 * Includes search filtering for the (potentially large) model list from models.dev.
 */
export function ModelSettings({ bridge, projectId }: ModelSettingsProps) {
  const { colors } = useTheme();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [currentModel, setCurrentModel] = useState<ModelConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadModels();
  }, [projectId]);

  const loadModels = async () => {
    try {
      setLoading(true);
      const [modelsData, currentModelData] = await Promise.all([
        bridge.getModels(projectId),
        bridge.getCurrentModel(projectId),
      ]);
      setModels(modelsData);
      setCurrentModel(currentModelData);
    } catch (e) {
      log.error('Failed to load models:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectModel = async (model: ModelInfo) => {
    if (updating) return;

    try {
      setUpdating(true);
      await bridge.setModel(projectId, model.provider, model.id);
      setCurrentModel({ provider: model.provider, model: model.id });
      setExpanded(false);
      setSearch('');
    } catch (e) {
      log.error('Failed to set model:', e);
    } finally {
      setUpdating(false);
    }
  };

  // Filter models by search query
  const filteredModels = useMemo(() => {
    if (!search.trim()) return models;
    const q = search.toLowerCase();
    return models.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        (m.description?.toLowerCase().includes(q) ?? false),
    );
  }, [models, search]);

  // Group filtered models by provider
  const modelsByProvider = useMemo(() => {
    const groups: Record<string, ModelInfo[]> = {};
    for (const model of filteredModels) {
      if (!groups[model.provider]) groups[model.provider] = [];
      groups[model.provider].push(model);
    }
    return groups;
  }, [filteredModels]);

  const currentModelInfo = models.find(
    (m) => m.id === currentModel?.model && m.provider === currentModel?.provider,
  );

  if (loading) {
    return (
      <SettingsSection
        title="Model"
        description="Select the AI model to use for this project"
      >
        <View style={styles.loading}>
          <Text style={{ color: colors.text.muted }}>Loading models...</Text>
        </View>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title="Model"
      description="Select the AI model to use for this project"
    >
      {/* Current model display / toggle button */}
      <Pressable
        style={[
          styles.currentModelCard,
          { backgroundColor: colors.bg.secondary, borderColor: colors.border.light },
        ]}
        onPress={() => {
          setExpanded(!expanded);
          if (!expanded) setSearch('');
        }}
      >
        <View style={styles.currentModelContent}>
          <View style={styles.currentModelHeader}>
            <View style={styles.currentModelInfo}>
              <Text style={[styles.currentModelName, { color: colors.text.primary }]}>
                {currentModelInfo?.name || currentModel?.model || 'Select a model'}
              </Text>
              <Text style={[styles.currentModelProvider, { color: colors.text.secondary }]}>
                {getProviderDisplayName(currentModelInfo?.provider || currentModel?.provider || '')}
              </Text>
            </View>
            <Icon
              name={expanded ? 'chevronUp' : 'chevronDown'}
              size={18}
              color={colors.text.muted}
            />
          </View>
          {currentModelInfo?.description && (
            <Text style={[styles.currentModelDescription, { color: colors.text.muted }]}>
              {currentModelInfo.description}
            </Text>
          )}
        </View>
      </Pressable>

      {/* Expanded model list */}
      {expanded && (
        <View style={[styles.modelList, { borderColor: colors.border.light }]}>
          {/* Search bar */}
          <View style={[styles.searchContainer, { backgroundColor: colors.bg.tertiary, borderBottomColor: colors.border.light }]}>
            <Icon name="search" size={14} color={colors.text.muted} />
            <TextInput
              style={[styles.searchInput, { color: colors.text.primary }]}
              value={search}
              onChangeText={setSearch}
              placeholder="Search models..."
              placeholderTextColor={colors.text.muted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch('')}>
                <Icon name="close" size={14} color={colors.text.muted} />
              </Pressable>
            )}
          </View>

          {/* Scrollable model list */}
          <ScrollView style={styles.scrollArea} nestedScrollEnabled>
            {Object.entries(modelsByProvider).map(([provider, providerModels]) => (
              <View key={provider} style={styles.providerGroup}>
                <View style={[styles.providerHeader, { backgroundColor: colors.bg.tertiary }]}>
                  <Text style={[styles.providerName, { color: colors.text.muted }]}>
                    {getProviderDisplayName(provider)}
                  </Text>
                  <Text style={[styles.providerCount, { color: colors.text.muted }]}>
                    {providerModels.length}
                  </Text>
                </View>
                {providerModels.map((model, index) => {
                  const isSelected =
                    currentModel?.model === model.id && currentModel?.provider === model.provider;
                  const isLast = index === providerModels.length - 1;

                  return (
                    <Pressable
                      key={`${model.provider}-${model.id}`}
                      style={[
                        styles.modelRow,
                        { backgroundColor: isSelected ? colors.bg.tertiary : colors.bg.secondary },
                        !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border.light },
                      ]}
                      onPress={() => handleSelectModel(model)}
                      disabled={updating}
                    >
                      <View style={styles.modelInfo}>
                        <Text style={[styles.modelName, { color: colors.text.primary }]}>
                          {model.name}
                        </Text>
                        <Text style={[styles.modelId, { color: colors.text.muted }]}>
                          {model.id}
                        </Text>
                        {model.description ? (
                          <Text
                            style={[styles.modelDescription, { color: colors.text.secondary }]}
                            numberOfLines={1}
                          >
                            {model.description}
                          </Text>
                        ) : null}
                      </View>
                      {isSelected && <Icon name="check" size={18} color={colors.primary} />}
                    </Pressable>
                  );
                })}
              </View>
            ))}

            {filteredModels.length === 0 && (
              <View style={styles.emptyState}>
                <Text style={{ color: colors.text.muted }}>
                  {search
                    ? 'No models match your search'
                    : 'No models available. Sign in or add API keys to enable models.'}
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      )}
    </SettingsSection>
  );
}

function getProviderDisplayName(provider: string): string {
  const names: Record<string, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    google: 'Google',
    openrouter: 'OpenRouter',
    groq: 'Groq',
    xai: 'xAI',
  };
  return names[provider] || provider;
}

const styles = StyleSheet.create({
  loading: {
    padding: spacing[4],
    alignItems: 'center',
  },
  currentModelCard: {
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  currentModelContent: {
    padding: spacing[4],
  },
  currentModelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  currentModelInfo: {
    flex: 1,
  },
  currentModelName: {
    fontSize: 15,
    fontWeight: '500',
  },
  currentModelProvider: {
    fontSize: 12,
    marginTop: 2,
  },
  currentModelDescription: {
    fontSize: 13,
    marginTop: spacing[2],
  },
  modelList: {
    marginTop: spacing[2],
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    gap: spacing[2],
    borderBottomWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 2,
  },
  scrollArea: {
    maxHeight: 400,
  },
  providerGroup: {},
  providerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[4],
  },
  providerName: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  providerCount: {
    fontSize: 11,
  },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
  },
  modelInfo: {
    flex: 1,
    marginRight: spacing[3],
  },
  modelName: {
    fontSize: 14,
    fontWeight: '500',
  },
  modelId: {
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 1,
  },
  modelDescription: {
    fontSize: 12,
    marginTop: 2,
  },
  emptyState: {
    padding: spacing[6],
    alignItems: 'center',
  },
});
