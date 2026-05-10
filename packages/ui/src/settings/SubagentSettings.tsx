import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Text } from '../primitives/Text';
import { Switch } from '../primitives/Switch';
import { Badge } from '../primitives/Badge';
import { Icon } from '../primitives/IconButton';
import { SettingsSection } from './SettingsSection';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius, fontSize } from '../styles/tokens';
import type { AgentBridge, AgentTypeInfo, AgentTypeConflictInfo } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('SubagentSettings');

// Re-export the old config type for backwards compatibility
export interface SubagentConfig {
  autoApprove: boolean;
  defaultModel: string;
  maxIterations: number;
  tokenBudget: number;
  deniedTools: string[];
}

// ============================================================================
// Summary Card (shown inline in settings)
// ============================================================================

interface SubagentSettingsProps {
  bridge: AgentBridge;
  projectId: string;
  onNavigateToSubagents?: () => void;
}

/**
 * Summary card for subagent types - shows count and a few names.
 * Tapping navigates to the full subagent management page.
 */
export function SubagentSettings({ bridge, projectId, onNavigateToSubagents }: SubagentSettingsProps) {
  const { colors, palette } = useTheme();
  const [agentTypes, setAgentTypes] = useState<AgentTypeInfo[]>([]);
  const [conflicts, setConflicts] = useState<AgentTypeConflictInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAgentTypes();
  }, [projectId]);

  const loadAgentTypes = async () => {
    try {
      setLoading(true);
      const [types, c] = await Promise.all([
        bridge.getAgentTypes(projectId),
        bridge.getAgentTypeConflicts(projectId),
      ]);
      setAgentTypes(types);
      setConflicts(c);
    } catch (e) {
      log.error('Failed to load agent types:', e);
    } finally {
      setLoading(false);
    }
  };

  const enabledTypes = agentTypes.filter((t) => t.enabled);
  const totalTypes = agentTypes.length;
  const previewTypes = enabledTypes.slice(0, 5);

  if (loading) {
    return (
      <SettingsSection
        title="Subagents"
        description="Named agent presets for the task tool"
      >
        <View style={styles.loading}>
          <Text style={{ color: colors.text.muted }}>Loading subagents...</Text>
        </View>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title="Subagents"
      description="Named agent presets for the task tool"
    >
      <Pressable
        style={[
          styles.summaryCard,
          { backgroundColor: colors.bg.secondary, borderColor: colors.border.light },
        ]}
        onPress={onNavigateToSubagents}
      >
        <View style={styles.summaryContent}>
          <View style={styles.summaryHeader}>
            <Text style={[styles.summaryTitle, { color: colors.text.primary }]}>
              {enabledTypes.length} of {totalTypes} agent types enabled
            </Text>
            <Icon name="chevronRight" size={18} color={colors.text.muted} />
          </View>

          {previewTypes.length > 0 && (
            <Text style={[styles.summaryPreview, { color: colors.text.secondary }]} numberOfLines={2}>
              {previewTypes.map((t) => t.name).join(', ')}
              {enabledTypes.length > 5 && ` and ${enabledTypes.length - 5} more...`}
            </Text>
          )}

          {conflicts.length > 0 && (
            <View style={styles.conflictRow}>
              <Icon name="alertCircle" size={12} color={palette.warningDark} />
              <Text style={{ color: palette.warningMuted, fontSize: fontSize.xs }}>
                {conflicts.length} name conflict{conflicts.length !== 1 ? 's' : ''}
              </Text>
            </View>
          )}
        </View>
      </Pressable>
    </SettingsSection>
  );
}

// ============================================================================
// Full Detail Page
// ============================================================================

interface SubagentSettingsPageProps {
  bridge: AgentBridge;
  projectId: string;
  onBack: () => void;
}

/**
 * Full subagent type management page with toggle controls.
 */
export function SubagentSettingsPage({ bridge, projectId, onBack }: SubagentSettingsPageProps) {
  const { colors, palette } = useTheme();
  const [agentTypes, setAgentTypes] = useState<AgentTypeInfo[]>([]);
  const [conflicts, setConflicts] = useState<AgentTypeConflictInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAgentTypes();
  }, [projectId]);

  const loadAgentTypes = async () => {
    try {
      setLoading(true);
      const [types, c] = await Promise.all([
        bridge.getAgentTypes(projectId),
        bridge.getAgentTypeConflicts(projectId),
      ]);
      setAgentTypes(types);
      setConflicts(c);
    } catch (e) {
      log.error('Failed to load agent types:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (name: string, enabled: boolean) => {
    try {
      await bridge.setAgentTypeEnabled(projectId, name, enabled);
      setAgentTypes((prev) =>
        prev.map((t) => (t.name === name ? { ...t, enabled } : t))
      );
    } catch (e) {
      log.error('Failed to toggle agent type:', e);
    }
  };

  const enabledCount = agentTypes.filter((t) => t.enabled).length;

  return (
    <View style={[styles.page, { backgroundColor: colors.bg.primary }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border.light }]}>
        <Pressable onPress={onBack} style={styles.backButton}>
          <Text style={{ color: colors.primary }}>← Back</Text>
        </Pressable>
        <Text variant="heading" style={{ flex: 1, textAlign: 'center' }}>
          Subagents
        </Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Summary */}
      <View style={[styles.summaryBar, { borderBottomColor: colors.border.light }]}>
        <Text style={{ color: colors.text.secondary, fontSize: fontSize.sm }}>
          {enabledCount} of {agentTypes.length} agent types enabled
        </Text>
      </View>

      {/* Conflict warnings */}
      {conflicts.length > 0 && !loading && (
        <View style={[styles.conflictBanner, { backgroundColor: palette.warningLight, borderBottomColor: colors.border.light }]}>
          <Icon name="alertCircle" size={14} color={palette.warningDark} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: palette.warningMuted, fontSize: fontSize.xs, fontWeight: '600' }}>
              {conflicts.length} name conflict{conflicts.length !== 1 ? 's' : ''}
            </Text>
            {conflicts.map((c) => (
              <Text key={c.name} style={{ color: palette.warningMuted, fontSize: fontSize.xs }}>
                "{c.name}" — {c.replacedSource} definition replaced by {c.keptSource}
              </Text>
            ))}
          </View>
        </View>
      )}

      {/* Agent type list */}
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {loading ? (
          <View style={styles.loading}>
            <Text style={{ color: colors.text.muted }}>Loading agent types...</Text>
          </View>
        ) : agentTypes.length === 0 ? (
          <View style={styles.empty}>
            <Text style={{ color: colors.text.muted }}>
              No agent types registered. Add them via config or plugins.
            </Text>
          </View>
        ) : (
          agentTypes.map((agentType) => (
            <View
              key={agentType.name}
              style={[
                styles.agentTypeRow,
                {
                  backgroundColor: colors.bg.secondary,
                  borderColor: colors.border.light,
                  opacity: agentType.enabled ? 1 : 0.6,
                },
              ]}
            >
              <View style={styles.agentTypeInfo}>
                <View style={styles.agentTypeHeader}>
                  <Text
                    style={[
                      styles.agentTypeName,
                      { color: colors.text.primary },
                    ]}
                  >
                    {agentType.name}
                  </Text>
                  {agentType.version && (
                    <Badge variant="default" size="sm">
                      v{agentType.version}
                    </Badge>
                  )}
                  <Badge
                    variant={agentType.source === 'builtin' ? 'default' : agentType.source === 'config' ? 'primary' : 'secondary'}
                  >
                    {agentType.source}
                  </Badge>
                </View>
                <Text
                  style={[styles.agentTypeDescription, { color: colors.text.secondary }]}
                  numberOfLines={3}
                >
                  {agentType.description}
                </Text>

                {/* Details row */}
                <View style={styles.detailsRow}>
                  {agentType.model && (
                    <Text style={[styles.detailChip, { color: colors.text.muted }]}>
                      model: {agentType.model}
                    </Text>
                  )}
                  {agentType.allowedTools && agentType.allowedTools.length > 0 && (
                    <Text style={[styles.detailChip, { color: colors.text.muted }]}>
                      tools: {agentType.allowedTools.length} allowed
                    </Text>
                  )}
                  {agentType.deniedTools && agentType.deniedTools.length > 0 && (
                    <Text style={[styles.detailChip, { color: colors.text.muted }]}>
                      {agentType.deniedTools.length} denied
                    </Text>
                  )}
                  {agentType.maxIterations && (
                    <Text style={[styles.detailChip, { color: colors.text.muted }]}>
                      max: {agentType.maxIterations} steps
                    </Text>
                  )}
                  {agentType.integrity && (
                    <Text style={[styles.detailChip, { color: colors.text.muted }]}>
                      {agentType.integrity.slice(0, 15)}...
                    </Text>
                  )}
                </View>
              </View>

              <Switch
                value={agentType.enabled}
                onValueChange={(v) => handleToggle(agentType.name, v)}
              />
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  // Summary card styles
  summaryCard: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing[3],
  },
  summaryContent: {
    gap: spacing[1],
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryTitle: {
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  summaryPreview: {
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  conflictRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  loading: {
    padding: spacing[4],
    alignItems: 'center',
  },

  conflictBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    // backgroundColor set dynamically via palette.warningLight
  },

  // Full page styles
  page: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
  },
  backButton: {
    width: 60,
  },
  summaryBar: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: spacing[3],
    gap: spacing[2],
  },
  empty: {
    padding: spacing[4],
    alignItems: 'center',
  },
  agentTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing[3],
    gap: spacing[3],
  },
  agentTypeInfo: {
    flex: 1,
    gap: spacing[1],
  },
  agentTypeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  agentTypeName: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  agentTypeDescription: {
    fontSize: fontSize.xs,
    lineHeight: 18,
  },
  detailsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[1],
    marginTop: 2,
  },
  detailChip: {
    fontSize: 11,
    fontFamily: 'monospace',
  },
});
