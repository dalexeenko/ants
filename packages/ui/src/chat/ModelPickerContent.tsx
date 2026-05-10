/**
 * ModelPickerContent - Shared inner content for model selection.
 *
 * Renders the search bar, clear-override button, and scrollable model list
 * grouped by provider. Platform wrappers decide the container:
 *  - Mobile: full-screen Modal (via ModelPicker)
 *  - Desktop: inline dropdown (via ModelPickerDropdown)
 */

import React, { useState, useMemo } from 'react';
import { View, StyleSheet, Pressable, ScrollView, TextInput } from 'react-native';
import { Text } from '../primitives/Text';
import { Icon } from '../primitives/IconButton';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius } from '../styles/tokens';
import type { ModelInfo, ModelConfig } from '../agent/types';

export interface ModelPickerContentProps {
  models: ModelInfo[];
  effectiveModel: ModelConfig | null;
  projectModel: ModelConfig | null;
  isOverridden: boolean;
  onSelectModel: (model: ModelInfo) => void;
  onClearOverride: () => void;
  /** Max height for the scroll area. Omit for flex: 1. */
  maxHeight?: number;
  /** Whether to auto-focus the search input */
  autoFocusSearch?: boolean;
}

export function getProviderDisplayName(provider: string): string {
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

export function ModelPickerContent({
  models,
  effectiveModel,
  projectModel,
  isOverridden,
  onSelectModel,
  onClearOverride,
  maxHeight,
  autoFocusSearch = false,
}: ModelPickerContentProps) {
  const { colors } = useTheme();
  const [search, setSearch] = useState('');

  // Filter models by search
  const filteredModels = useMemo(() => {
    if (!search.trim()) return models;
    const q = search.toLowerCase();
    return models.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q),
    );
  }, [models, search]);

  // Group by provider
  const modelsByProvider = useMemo(() => {
    const groups: Record<string, ModelInfo[]> = {};
    for (const model of filteredModels) {
      if (!groups[model.provider]) groups[model.provider] = [];
      groups[model.provider].push(model);
    }
    return groups;
  }, [filteredModels]);

  return (
    <View style={styles.container}>
      {/* Clear override button */}
      {isOverridden && (
        <Pressable
          style={[
            styles.clearRow,
            { backgroundColor: colors.bg.secondary, borderBottomColor: colors.border.light },
          ]}
          onPress={onClearOverride}
        >
          <Icon name="close" size={14} color={colors.warning} />
          <Text style={[styles.clearText, { color: colors.warning }]}>
            Clear override (use project default: {projectModel?.model})
          </Text>
        </Pressable>
      )}

      {/* Search */}
      <View
        style={[
          styles.searchContainer,
          { backgroundColor: colors.bg.secondary, borderBottomColor: colors.border.light },
        ]}
      >
        <Icon name="search" size={14} color={colors.text.muted} />
        <TextInput
          style={[styles.searchInput, { color: colors.text.primary }]}
          value={search}
          onChangeText={setSearch}
          placeholder="Search models..."
          placeholderTextColor={colors.text.muted}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={autoFocusSearch}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch('')}>
            <Icon name="close" size={14} color={colors.text.muted} />
          </Pressable>
        )}
      </View>

      {/* Model list */}
      <ScrollView
        style={[styles.scrollArea, maxHeight != null ? { maxHeight } : { flex: 1 }]}
        nestedScrollEnabled
      >
        {Object.entries(modelsByProvider).map(([provider, providerModels]) => (
          <View key={provider}>
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
                effectiveModel?.model === model.id && effectiveModel?.provider === model.provider;
              const isLast = index === providerModels.length - 1;

              return (
                <Pressable
                  key={`${model.provider}-${model.id}`}
                  style={[
                    styles.modelRow,
                    { backgroundColor: isSelected ? colors.bg.tertiary : colors.bg.secondary },
                    !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border.light },
                  ]}
                  onPress={() => onSelectModel(model)}
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
              {search ? 'No models match your search' : 'No models available'}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  clearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
  },
  clearText: {
    fontSize: 13,
    fontWeight: '500',
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
    fontSize: 13,
    paddingVertical: 2,
  },
  scrollArea: {},
  providerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[1] + 2,
    paddingHorizontal: spacing[3],
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
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
  },
  modelInfo: {
    flex: 1,
    marginRight: spacing[3],
  },
  modelName: {
    fontSize: 13,
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
    padding: spacing[4],
    alignItems: 'center',
  },
});
