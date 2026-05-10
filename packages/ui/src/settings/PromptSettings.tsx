import React, { useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, Pressable, TextInput } from 'react-native';
import { Text } from '../primitives/Text';
import { Badge } from '../primitives/Badge';
import { Icon } from '../primitives/IconButton';
import { SettingsSection } from './SettingsSection';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius, fontSize } from '../styles/tokens';
import type { AgentBridge, AgentTypeInfo, Project } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('PromptSettings');

// ============================================================================
// PromptSettings — project-level prompt configuration
// ============================================================================

export interface PromptSettingsProps {
  bridge: AgentBridge;
  project: Project;
}

/**
 * Project settings section for configuring the root system prompt.
 * Allows selecting a root agent type (filtered by "root" tag) and
 * adding free-text custom instructions.
 */
export function PromptSettings({ bridge, project }: PromptSettingsProps) {
  const { colors } = useTheme();
  const [rootAgents, setRootAgents] = useState<AgentTypeInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | undefined>(project.rootAgentType);
  const [customInstructions, setCustomInstructions] = useState(project.customInstructions ?? '');
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Load agent types tagged "root"
  useEffect(() => {
    (async () => {
      try {
        const types = await bridge.getAgentTypes(project.id);
        setRootAgents(types.filter((t) => t.tags?.includes('root') && t.enabled));
      } catch (e) {
        log.error('Failed to load root agents:', e);
      }
    })();
  }, [bridge, project.id]);

  // Sync from project prop when it changes externally
  useEffect(() => {
    setSelectedAgent(project.rootAgentType);
    setCustomInstructions(project.customInstructions ?? '');
  }, [project.rootAgentType, project.customInstructions]);

  const handleSelectAgent = useCallback(async (name: string | undefined) => {
    setSelectedAgent(name);
    setSaving(true);
    try {
      await bridge.updateProject(project.id, { rootAgentType: name ?? '' });
    } catch (e) {
      log.error('Failed to update root agent:', e);
    } finally {
      setSaving(false);
    }
  }, [bridge, project.id]);

  const handleSaveInstructions = useCallback(async () => {
    setSaving(true);
    try {
      await bridge.updateProject(project.id, { customInstructions });
    } catch (e) {
      log.error('Failed to save custom instructions:', e);
    } finally {
      setSaving(false);
    }
  }, [bridge, project.id, customInstructions]);

  const selectedAgentInfo = rootAgents.find((a) => a.name === selectedAgent);

  return (
    <SettingsSection
      title="System Prompt"
      description="Configure the base prompt and custom instructions for this project"
    >
      <View style={[styles.container, { borderColor: colors.border.light }]}>
        {/* Root agent picker */}
        <View style={[styles.section, styles.sectionDivider, { borderBottomColor: colors.border.light }]}>
          <Text style={[styles.label, { color: colors.text.muted }]}>Base Prompt</Text>
          <Text style={[styles.hint, { color: colors.text.secondary }]}>
            Select an agent type to use as the base system prompt
          </Text>

          <View style={styles.agentList}>
            {/* Default option (no root agent) */}
            <Pressable
              style={[
                styles.agentOption,
                {
                  backgroundColor: !selectedAgent ? colors.primary + '18' : colors.bg.secondary,
                  borderColor: !selectedAgent ? colors.primary : colors.border.light,
                },
              ]}
              onPress={() => handleSelectAgent(undefined)}
            >
              <View style={styles.agentOptionContent}>
                <Text style={[styles.agentName, { color: colors.text.primary }]}>
                  Default
                </Text>
                <Text style={[styles.agentDescription, { color: colors.text.secondary }]} numberOfLines={1}>
                  Built-in coding assistant prompt
                </Text>
              </View>
              {!selectedAgent && (
                <Icon name="check" size={16} color={colors.primary} />
              )}
            </Pressable>

            {/* Root-tagged agents */}
            {rootAgents.map((agent) => {
              const isSelected = selectedAgent === agent.name;
              return (
                <Pressable
                  key={agent.name}
                  style={[
                    styles.agentOption,
                    {
                      backgroundColor: isSelected ? colors.primary + '18' : colors.bg.secondary,
                      borderColor: isSelected ? colors.primary : colors.border.light,
                    },
                  ]}
                  onPress={() => handleSelectAgent(agent.name)}
                >
                  <View style={styles.agentOptionContent}>
                    <View style={styles.agentNameRow}>
                      <Text style={[styles.agentName, { color: colors.text.primary }]}>
                        {agent.name}
                      </Text>
                      <Badge variant="default" size="sm">{agent.source}</Badge>
                    </View>
                    <Text style={[styles.agentDescription, { color: colors.text.secondary }]} numberOfLines={2}>
                      {agent.description}
                    </Text>
                  </View>
                  {isSelected && (
                    <Icon name="check" size={16} color={colors.primary} />
                  )}
                </Pressable>
              );
            })}
          </View>

          {/* Show selected agent's prompt preview */}
          {selectedAgentInfo?.systemPrompt && (
            <Pressable onPress={() => setExpanded((v) => !v)} style={styles.promptPreview}>
              <Text style={[styles.promptPreviewLabel, { color: colors.text.muted }]}>
                {expanded ? 'Hide prompt preview' : 'Show prompt preview'}
              </Text>
              {expanded && (
                <View style={[styles.promptPreviewBlock, { backgroundColor: colors.bg.tertiary }]}>
                  <Text style={[styles.promptPreviewText, { color: colors.text.secondary }]}>
                    {selectedAgentInfo.systemPrompt}
                  </Text>
                </View>
              )}
            </Pressable>
          )}
        </View>

        {/* Custom instructions */}
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.text.muted }]}>Custom Instructions</Text>
          <Text style={[styles.hint, { color: colors.text.secondary }]}>
            Additional instructions appended to the system prompt for this project
          </Text>

          <TextInput
            style={[
              styles.textArea,
              {
                color: colors.text.primary,
                backgroundColor: colors.bg.secondary,
                borderColor: colors.border.light,
              },
            ]}
            value={customInstructions}
            onChangeText={setCustomInstructions}
            onBlur={handleSaveInstructions}
            placeholder="e.g., Always use TypeScript strict mode. Prefer functional components..."
            placeholderTextColor={colors.text.muted}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />

          {saving && (
            <Text style={[styles.savingText, { color: colors.text.muted }]}>
              Saving...
            </Text>
          )}
        </View>
      </View>
    </SettingsSection>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  section: {
    padding: spacing[3],
  },
  sectionDivider: {
    borderBottomWidth: 1,
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  hint: {
    fontSize: fontSize.xs,
    marginBottom: spacing[2],
  },
  agentList: {
    gap: spacing[2],
  },
  agentOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[2],
    borderRadius: borderRadius.md,
    borderWidth: 1,
  },
  agentOptionContent: {
    flex: 1,
    gap: 2,
  },
  agentNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  agentName: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  agentDescription: {
    fontSize: fontSize.xs,
  },
  promptPreview: {
    marginTop: spacing[2],
  },
  promptPreviewLabel: {
    fontSize: fontSize.xs,
    fontWeight: '500',
    marginBottom: spacing[1],
  },
  promptPreviewBlock: {
    padding: spacing[2],
    borderRadius: borderRadius.md,
  },
  promptPreviewText: {
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing[2],
    fontSize: fontSize.sm,
    minHeight: 100,
    fontFamily: 'monospace',
  },
  savingText: {
    fontSize: fontSize.xs,
    marginTop: spacing[1],
  },
});
