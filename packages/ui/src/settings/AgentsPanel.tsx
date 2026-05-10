import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Text } from '../primitives/Text';
import { Badge } from '../primitives/Badge';
import { Switch } from '../primitives/Switch';
import { Spinner } from '../primitives/Spinner';
import { Icon } from '../primitives/IconButton';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius, fontSize } from '../styles/tokens';
import { useProjectStore } from '../store/projectStore';
import type { AgentBridge, AgentTypeInfo, AgentTypeConflictInfo } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('AgentsPanel');

// ============================================================================
// Family helpers
// ============================================================================

const FAMILY_LABELS: Record<string, string> = {
  code: 'Coding',
  notes: 'Notes',
  slides: 'Slides',
  calendar: 'Calendar',
  files: 'Files',
  prd: 'PRD',
  email: 'Email',
  terminal: 'Terminal',
};

function getFamily(tags?: string[]): string {
  if (!tags) return 'other';
  const family = tags.find(t => t !== 'root' && t !== 'subagent');
  return family || 'other';
}

function getFamilyLabel(family: string): string {
  return FAMILY_LABELS[family] || (family.charAt(0).toUpperCase() + family.slice(1));
}

// ============================================================================
// Types
// ============================================================================

/** Per-project status for an agent type */
interface AgentProjectStatus {
  id: string;
  name: string;
  providerType: 'local' | 'remote';
  enabled: boolean;
}

/** An agent type with the projects it was found in */
interface AggregatedAgentType {
  /** The agent type definition (from the first project that had it) */
  agentType: AgentTypeInfo;
  /** Which projects this agent type appears in, with per-project enabled status */
  projects: AgentProjectStatus[];
  /** The dedup key used (integrity hash or name fallback) */
  key: string;
}

// ============================================================================
// AgentsPanel - Full-page agent type list
// ============================================================================

export interface AgentsPanelProps {
  bridge: AgentBridge;
  /** Optional back button handler (used on mobile) */
  onBack?: () => void;
}

/**
 * Agents panel that fans out getAgentTypes() across all projects,
 * deduplicates by integrity hash (or name as fallback), and shows
 * a combined list with project provenance.
 */
/** A filter option for the filter bar */
interface FilterOption {
  /** Unique key */
  id: string;
  /** Display label */
  label: string;
  /** 'all' shows everything, 'provider' filters by providerType, 'project' filters by projectId, 'family' filters by agent family */
  type: 'all' | 'provider' | 'project' | 'family';
  /** For provider filters: the providerType value */
  providerType?: 'local' | 'remote';
  /** For project filters: the project id */
  projectId?: string;
  /** For family filters: the family key */
  family?: string;
}

export function AgentsPanel({ bridge, onBack }: AgentsPanelProps) {
  const { colors, palette } = useTheme();
  const projects = useProjectStore((s) => s.projects);
  const [aggregated, setAggregated] = useState<AggregatedAgentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [conflicts, setConflicts] = useState<AgentTypeConflictInfo[]>([]);
  const [screen, setScreen] = useState<'list' | 'detail'>('list');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Build filter options from projects
  const filterOptions = useMemo<FilterOption[]>(() => {
    const options: FilterOption[] = [
      { id: 'all', label: 'All', type: 'all' },
    ];

    // Provider-level filters (only show if there are projects of that type)
    const hasLocal = projects.some((p) => p.providerType === 'local');
    const hasRemote = projects.some((p) => p.providerType === 'remote');
    if (hasLocal && hasRemote) {
      options.push({ id: 'provider:local', label: 'Local', type: 'provider', providerType: 'local' });
      options.push({ id: 'provider:remote', label: 'Remote', type: 'provider', providerType: 'remote' });
    }

    // Per-project filters (only if more than 1 project)
    if (projects.length > 1) {
      for (const project of projects) {
        options.push({
          id: `project:${project.id}`,
          label: project.name,
          type: 'project',
          projectId: project.id,
        });
      }
    }

    // Family-level filters
    const families = new Set<string>();
    for (const item of aggregated) {
      families.add(getFamily(item.agentType.tags));
    }
    const sortedFamilies = [...families].sort();
    for (const fam of sortedFamilies) {
      if (fam === 'other') continue; // skip 'other' in filter bar
      options.push({
        id: `family:${fam}`,
        label: getFamilyLabel(fam),
        type: 'family',
        family: fam,
      });
    }

    return options;
  }, [projects, aggregated]);

  // Fan out across all projects and aggregate
  const loadRef = React.useRef(0);
  const loadAgentTypes = useCallback(async () => {
    const loadId = ++loadRef.current;
    setLoading(true);
    setError(null);

    try {
      const [typeResults, conflictResults] = await Promise.all([
        Promise.allSettled(
          projects.map(async (project) => {
            const types = await bridge.getAgentTypes(project.id);
            return { project, types };
          })
        ),
        Promise.allSettled(
          projects.map(async (project) => {
            const c = await bridge.getAgentTypeConflicts(project.id);
            return c;
          })
        ),
      ]);
      const results = typeResults;

      if (loadId !== loadRef.current) return;

      const byKey = new Map<string, AggregatedAgentType>();

      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const { project, types } = result.value;

        for (const agentType of types) {
          const key = agentType.integrity || `name:${agentType.name}`;
          const existing = byKey.get(key);
          const projectStatus: AgentProjectStatus = {
            id: project.id,
            name: project.name,
            providerType: project.providerType,
            enabled: agentType.enabled,
          };

          if (existing) {
            if (!existing.projects.some((p) => p.id === project.id)) {
              existing.projects.push(projectStatus);
            }
          } else {
            byKey.set(key, {
              agentType,
              projects: [projectStatus],
              key,
            });
          }
        }
      }

        // Deduplicate conflicts by name across all projects
        const conflictsByName = new Map<string, AgentTypeConflictInfo>();
        for (const cr of conflictResults) {
          if (cr.status !== 'fulfilled') continue;
          for (const c of cr.value) {
            if (!conflictsByName.has(c.name)) {
              conflictsByName.set(c.name, c);
            }
          }
        }
        setConflicts(Array.from(conflictsByName.values()));

        setAggregated(Array.from(byKey.values()));
    } catch (e) {
      if (loadId === loadRef.current) {
        setError((e as Error).message);
      }
    } finally {
      if (loadId === loadRef.current) {
        setLoading(false);
      }
    }
  }, [bridge, projects]);

  useEffect(() => {
    loadAgentTypes();
  }, [loadAgentTypes]);

  // Apply active filter
  const filtered = useMemo(() => {
    if (activeFilter === 'all') return aggregated;

    const filter = filterOptions.find((f) => f.id === activeFilter);
    if (!filter) return aggregated;

    if (filter.type === 'project') {
      return aggregated.filter((a) =>
        a.projects.some((p) => p.id === filter.projectId)
      );
    }

    if (filter.type === 'provider') {
      // Need to match project ids whose providerType matches
      const matchingProjectIds = new Set(
        projects
          .filter((p) => p.providerType === filter.providerType)
          .map((p) => p.id)
      );
      return aggregated.filter((a) =>
        a.projects.some((p) => matchingProjectIds.has(p.id))
      );
    }

    if (filter.type === 'family') {
      return aggregated.filter((a) => getFamily(a.agentType.tags) === filter.family);
    }

    return aggregated;
  }, [aggregated, activeFilter, filterOptions, projects]);

  const enabledCount = filtered.filter((a) => a.agentType.enabled).length;

  const handleToggle = async (item: AggregatedAgentType, enabled: boolean) => {
    // Toggle across all projects that have this agent type
    try {
      await Promise.all(
        item.projects.map((p) =>
          bridge.setAgentTypeEnabled(p.id, item.agentType.name, enabled)
        )
      );
      // Optimistic update
      setAggregated((prev) =>
        prev.map((a) =>
          a.key === item.key
            ? {
                ...a,
                agentType: { ...a.agentType, enabled },
                projects: a.projects.map((p) => ({ ...p, enabled })),
              }
            : a
        )
      );
    } catch (e) {
      log.error('Failed to toggle agent type:', e);
    }
  };

  /** Toggle a single project's enabled status for an agent type */
  const handleProjectToggle = useCallback(
    async (agentKey: string, projectId: string, agentName: string, enabled: boolean) => {
      try {
        await bridge.setAgentTypeEnabled(projectId, agentName, enabled);
        // Optimistic update
        setAggregated((prev) =>
          prev.map((a) => {
            if (a.key !== agentKey) return a;
            const updatedProjects = a.projects.map((p) =>
              p.id === projectId ? { ...p, enabled } : p
            );
            // Derive overall enabled: true if any project has it enabled
            const anyEnabled = updatedProjects.some((p) => p.enabled);
            return {
              ...a,
              agentType: { ...a.agentType, enabled: anyEnabled },
              projects: updatedProjects,
            };
          })
        );
      } catch (e) {
        log.error('Failed to toggle agent type for project:', e);
      }
    },
    [bridge]
  );

  const handleOpenDetail = useCallback((key: string) => {
    setSelectedKey(key);
    setScreen('detail');
  }, []);

  const handleBackToList = useCallback(() => {
    setScreen('list');
    setSelectedKey(null);
  }, []);

  const selectedItem = useMemo(
    () => aggregated.find((a) => a.key === selectedKey) ?? null,
    [aggregated, selectedKey]
  );

  // ---- Detail screen ----
  if (screen === 'detail' && selectedItem) {
    return (
      <AgentTypeDetailView
        item={selectedItem}
        onBack={handleBackToList}
        onToggle={(enabled) => handleToggle(selectedItem, enabled)}
        onProjectToggle={(projectId, enabled) =>
          handleProjectToggle(selectedItem.key, projectId, selectedItem.agentType.name, enabled)
        }
      />
    );
  }

  // ---- List screen ----
  return (
    <View testID="openmgr-agents-panel" style={[styles.container, { backgroundColor: colors.bg.primary }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border.light }]}>
        {onBack && (
          <Pressable onPress={onBack} style={styles.backButton}>
            <Text style={{ color: colors.primary }}>← Back</Text>
          </Pressable>
        )}
        <Text variant="heading" style={[styles.headerTitle, !onBack && { textAlign: 'left', paddingLeft: spacing[3] }]}>
          Agents
        </Text>
        <Pressable onPress={loadAgentTypes} style={styles.refreshButton} disabled={loading}>
          <Icon name="refresh" size={16} color={loading ? colors.text.muted : colors.primary} />
        </Pressable>
      </View>

      {/* Summary bar */}
      <View style={[styles.summaryBar, { borderBottomColor: colors.border.light }]}>
        <Text style={{ color: colors.text.secondary, fontSize: fontSize.sm }}>
          {enabledCount} of {filtered.length} agent types enabled
          {activeFilter === 'all'
            ? ` across ${projects.length} project${projects.length !== 1 ? 's' : ''}`
            : ''}
        </Text>
      </View>

      {/* Filter bar */}
      {filterOptions.length > 1 && (
        <View style={[styles.filterBar, { borderBottomColor: colors.border.light }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterBarContent}
          >
            {filterOptions.map((option) => {
              const isActive = activeFilter === option.id;
              return (
                <Pressable
                  key={option.id}
                  onPress={() => setActiveFilter(option.id)}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: isActive ? colors.primary : colors.bg.tertiary,
                      borderColor: isActive ? colors.primary : colors.border.light,
                    },
                  ]}
                >
                  {option.type === 'provider' && (
                    <Icon
                      name={option.providerType === 'local' ? 'laptop' : 'server'}
                      size={12}
                      color={isActive ? colors.text.inverse : colors.text.secondary}
                    />
                  )}
                  {option.type === 'project' && (
                    <Icon
                      name="folder"
                      size={12}
                      color={isActive ? colors.text.inverse : colors.text.secondary}
                    />
                  )}
                  {option.type === 'family' && (
                    <Icon
                      name="users"
                      size={12}
                      color={isActive ? colors.text.inverse : colors.text.secondary}
                    />
                  )}
                  <Text
                    style={[
                      styles.filterChipText,
                      { color: isActive ? colors.text.inverse : colors.text.secondary },
                    ]}
                    numberOfLines={1}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Conflict warnings */}
      {conflicts.length > 0 && !loading && (
        <View style={[styles.conflictBanner, { backgroundColor: palette.warningLight, borderBottomColor: colors.border.light }]}>
          <Icon name="alertCircle" size={14} color={palette.warningDark} />
          <View style={styles.conflictBannerText}>
            <Text style={{ color: palette.warningMuted, fontSize: fontSize.xs, fontWeight: '600' }}>
              {conflicts.length} name conflict{conflicts.length !== 1 ? 's' : ''} detected
            </Text>
            {conflicts.map((c) => (
              <Text key={c.name} style={{ color: palette.warningMuted, fontSize: fontSize.xs }}>
                "{c.name}" — {c.replacedSource} definition replaced by {c.keptSource}
              </Text>
            ))}
          </View>
        </View>
      )}

      {/* Content */}
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {loading ? (
          <View style={styles.centered}>
            <Spinner size="small" />
            <Text style={{ color: colors.text.muted, marginTop: spacing[2] }}>
              Loading agent types from all projects...
            </Text>
          </View>
        ) : error ? (
          <View style={styles.centered}>
            <Icon name="alertCircle" size={24} color={colors.text.muted} />
            <Text style={{ color: colors.text.muted, marginTop: spacing[2] }}>
              {error}
            </Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.centered}>
            <Icon name="users" size={32} color={colors.text.muted} />
            <Text style={{ color: colors.text.muted, marginTop: spacing[2], textAlign: 'center' }}>
              {aggregated.length === 0
                ? 'No agent types registered.\nAdd them via plugins or project config.'
                : 'No agent types match the current filter.'}
            </Text>
          </View>
        ) : (
          (() => {
            // Group by family
            const groups = new Map<string, AggregatedAgentType[]>();
            for (const item of filtered) {
              const fam = getFamily(item.agentType.tags);
              const group = groups.get(fam) || [];
              group.push(item);
              groups.set(fam, group);
            }
            // Sort groups: named families first (alphabetically), then 'other' last
            const sortedKeys = [...groups.keys()].sort((a, b) => {
              if (a === 'other') return 1;
              if (b === 'other') return -1;
              return getFamilyLabel(a).localeCompare(getFamilyLabel(b));
            });
            return sortedKeys.map((family) => (
              <View key={family}>
                <Text style={[styles.groupHeader, { color: colors.text.secondary }]}>
                  {getFamilyLabel(family)} ({groups.get(family)!.length})
                </Text>
                {groups.get(family)!.map((item) => (
                  <AgentTypeCard
                    key={item.key}
                    item={item}
                    onPress={() => handleOpenDetail(item.key)}
                  />
                ))}
              </View>
            ));
          })()
        )}
      </ScrollView>
    </View>
  );
}

// ============================================================================
// AgentTypeCard
// ============================================================================

function AgentTypeCard({
  item,
  onPress,
}: {
  item: AggregatedAgentType;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const { agentType, projects } = item;

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.card,
        {
          backgroundColor: colors.bg.secondary,
          borderColor: colors.border.light,
          opacity: agentType.enabled ? 1 : 0.6,
        },
      ]}
    >
      <View style={styles.cardBody}>
        {/* Name + badges */}
        <View style={styles.cardHeader}>
          <Text style={[styles.cardName, { color: colors.text.primary }]}>
            {agentType.name}
          </Text>
          {agentType.version && (
            <Badge variant="default" size="sm">v{agentType.version}</Badge>
          )}
          <Badge
            variant={
              agentType.source === 'builtin'
                ? 'default'
                : agentType.source === 'config'
                  ? 'primary'
                  : 'secondary'
            }
            size="sm"
          >
            {agentType.source}
          </Badge>
          {agentType.tags?.map((tag) => (
            <Badge key={tag} variant="secondary" size="sm">{tag}</Badge>
          ))}
        </View>

        {/* Description */}
        <Text
          style={[styles.cardDescription, { color: colors.text.secondary }]}
          numberOfLines={3}
        >
          {agentType.description}
        </Text>

        {/* Details chips */}
        <View style={styles.detailsRow}>
          {agentType.model && (
            <Text style={[styles.chip, { color: colors.text.muted }]}>
              model: {agentType.model}
            </Text>
          )}
          {agentType.allowedTools && agentType.allowedTools.length > 0 && (
            <Text style={[styles.chip, { color: colors.text.muted }]}>
              {agentType.allowedTools.length} tools allowed
            </Text>
          )}
          {agentType.deniedTools && agentType.deniedTools.length > 0 && (
            <Text style={[styles.chip, { color: colors.text.muted }]}>
              {agentType.deniedTools.length} tools denied
            </Text>
          )}
          {agentType.maxIterations != null && (
            <Text style={[styles.chip, { color: colors.text.muted }]}>
              max {agentType.maxIterations} steps
            </Text>
          )}
          {agentType.integrity && (
            <Text style={[styles.chip, { color: colors.text.muted }]}>
              {agentType.integrity.slice(0, 15)}...
            </Text>
          )}
        </View>

        {/* Project provenance */}
        <View style={styles.projectsRow}>
          <Icon name="folder" size={12} color={colors.text.muted} />
          <Text style={[styles.projectsText, { color: colors.text.muted }]}>
            {projects.length === 1
              ? projects[0].name
              : `${projects.length} projects`}
          </Text>
          {projects.length > 1 && (
            <Text style={[styles.projectsList, { color: colors.text.muted }]} numberOfLines={1}>
              ({projects.map((p) => p.name).join(', ')})
            </Text>
          )}
        </View>
      </View>

      <Icon name="chevronRight" size={14} color={colors.text.muted} />
    </Pressable>
  );
}

// ============================================================================
// AgentTypeDetailView
// ============================================================================

function AgentTypeDetailView({
  item,
  onBack,
  onToggle,
  onProjectToggle,
}: {
  item: AggregatedAgentType;
  onBack: () => void;
  onToggle: (enabled: boolean) => void;
  onProjectToggle: (projectId: string, enabled: boolean) => void;
}) {
  const { colors } = useTheme();
  const { agentType, projects } = item;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg.primary }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border.light }]}>
        <Pressable onPress={onBack} style={styles.backButton}>
          <Text style={{ color: colors.primary }}>← Back</Text>
        </Pressable>
        <Text
          variant="heading"
          style={{ flex: 1, textAlign: 'center' }}
          numberOfLines={1}
        >
          {agentType.name}
        </Text>
        <View style={{ width: 60, alignItems: 'flex-end' }}>
          <Switch
            value={agentType.enabled}
            onValueChange={onToggle}
          />
        </View>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.detailContent}>
        {/* Source + version badges */}
        <View style={styles.detailBadgeRow}>
          <Badge
            variant={
              agentType.source === 'builtin'
                ? 'default'
                : agentType.source === 'config'
                  ? 'primary'
                  : 'secondary'
            }
            size="sm"
          >
            {agentType.source}
          </Badge>
          {agentType.version && (
            <Badge variant="default" size="sm">v{agentType.version}</Badge>
          )}
          {agentType.tags?.map((tag) => (
            <Badge key={tag} variant="secondary" size="sm">{tag}</Badge>
          ))}
        </View>

        {/* Description */}
        <View style={[styles.detailSection, { borderBottomColor: colors.border.light }]}>
          <Text style={[styles.detailLabel, { color: colors.text.muted }]}>Description</Text>
          <Text style={[styles.detailValue, { color: colors.text.primary }]}>
            {agentType.description}
          </Text>
        </View>

        {/* Config fields */}
        {agentType.model && (
          <DetailRow label="Model" value={agentType.model} colors={colors} />
        )}
        {agentType.provider && (
          <DetailRow label="Provider" value={agentType.provider} colors={colors} />
        )}
        {agentType.temperature != null && (
          <DetailRow label="Temperature" value={String(agentType.temperature)} colors={colors} />
        )}
        {agentType.maxIterations != null && (
          <DetailRow label="Max Iterations" value={String(agentType.maxIterations)} colors={colors} />
        )}
        {agentType.tokenBudget != null && (
          <DetailRow label="Token Budget" value={agentType.tokenBudget.toLocaleString()} colors={colors} />
        )}

        {/* System prompt */}
        {agentType.systemPrompt && (
          <SystemPromptSection
            systemPrompt={agentType.systemPrompt}
            colors={colors}
          />
        )}

        {/* Allowed tools */}
        {agentType.allowedTools && agentType.allowedTools.length > 0 && (
          <View style={[styles.detailSection, { borderBottomColor: colors.border.light }]}>
            <Text style={[styles.detailLabel, { color: colors.text.muted }]}>
              Allowed Tools ({agentType.allowedTools.length})
            </Text>
            <View style={styles.toolsList}>
              {agentType.allowedTools.map((tool) => (
                <View key={tool} style={[styles.toolChip, { backgroundColor: colors.bg.tertiary }]}>
                  <Text style={[styles.toolChipText, { color: colors.text.secondary }]}>{tool}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Denied tools */}
        {agentType.deniedTools && agentType.deniedTools.length > 0 && (
          <View style={[styles.detailSection, { borderBottomColor: colors.border.light }]}>
            <Text style={[styles.detailLabel, { color: colors.text.muted }]}>
              Denied Tools ({agentType.deniedTools.length})
            </Text>
            <View style={styles.toolsList}>
              {agentType.deniedTools.map((tool) => (
                <View key={tool} style={[styles.toolChip, { backgroundColor: colors.bg.tertiary }]}>
                  <Text style={[styles.toolChipText, { color: colors.text.secondary }]}>{tool}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Integrity hash */}
        {agentType.integrity && (
          <View style={[styles.detailSection, { borderBottomColor: colors.border.light }]}>
            <Text style={[styles.detailLabel, { color: colors.text.muted }]}>Integrity</Text>
            <Text
              style={[styles.codeInline, { color: colors.text.secondary, backgroundColor: colors.bg.tertiary }]}
              selectable
            >
              {agentType.integrity}
            </Text>
          </View>
        )}

        {/* Installed in — per-project toggles */}
        <View style={[styles.detailSection, { borderBottomWidth: 0 }]}>
          <Text style={[styles.detailLabel, { color: colors.text.muted }]}>
            Installed In ({projects.length} project{projects.length !== 1 ? 's' : ''})
          </Text>
          <View style={styles.projectToggleList}>
            {projects.map((proj) => (
              <View
                key={proj.id}
                style={[
                  styles.projectToggleRow,
                  { borderBottomColor: colors.border.light },
                ]}
              >
                <View style={styles.projectToggleInfo}>
                  <Text style={[styles.projectToggleName, { color: colors.text.primary }]}>
                    {proj.name}
                  </Text>
                  <Badge
                    variant={proj.providerType === 'local' ? 'default' : 'secondary'}
                    size="sm"
                  >
                    {proj.providerType}
                  </Badge>
                </View>
                <Switch
                  value={proj.enabled}
                  onValueChange={(v) => onProjectToggle(proj.id, v)}
                />
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// ============================================================================
// SystemPromptSection — collapsible code block with fade
// ============================================================================

const COLLAPSED_MAX_HEIGHT = 200;

function SystemPromptSection({
  systemPrompt,
  colors,
}: {
  systemPrompt: string;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const [expanded, setExpanded] = useState(false);
  const [needsTruncation, setNeedsTruncation] = useState(false);

  return (
    <View style={[styles.detailSection, { borderBottomColor: colors.border.light }]}>
      <Text style={[styles.detailLabel, { color: colors.text.muted }]}>System Prompt</Text>
      <View style={[styles.codeBlock, { backgroundColor: colors.bg.tertiary }]}>
        <View
          style={!expanded && needsTruncation ? { maxHeight: COLLAPSED_MAX_HEIGHT, overflow: 'hidden' } : undefined}
        >
          <Text
            style={[styles.codeText, { color: colors.text.secondary }]}
            onLayout={(e) => {
              if (e.nativeEvent.layout.height > COLLAPSED_MAX_HEIGHT) {
                setNeedsTruncation(true);
              }
            }}
          >
            {systemPrompt}
          </Text>
        </View>
        {/* Fade overlay when collapsed */}
        {!expanded && needsTruncation && (
          <View
            style={[
              styles.fadeOverlay,
              { backgroundColor: colors.bg.tertiary },
            ]}
          />
        )}
      </View>
      {needsTruncation && (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          style={styles.expandButton}
        >
          <Text style={{ color: colors.primary, fontSize: fontSize.xs, fontWeight: '500' }}>
            {expanded ? 'Show less' : 'Show full prompt'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/** Simple label: value row for the detail view */
function DetailRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={[styles.detailSection, { borderBottomColor: colors.border.light }]}>
      <Text style={[styles.detailLabel, { color: colors.text.muted }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: colors.text.primary }]}>{value}</Text>
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
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
  refreshButton: {
    width: 60,
    alignItems: 'flex-end',
    paddingRight: spacing[1],
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
  },
  summaryBar: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
  },
  filterBar: {
    borderBottomWidth: 1,
    paddingVertical: spacing[2],
  },
  filterBarContent: {
    paddingHorizontal: spacing[3],
    gap: spacing[1],
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[2],
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: fontSize.xs,
    fontWeight: '500',
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: spacing[3],
    gap: spacing[2],
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[8],
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing[3],
    gap: spacing[3],
  },
  cardBody: {
    flex: 1,
    gap: spacing[1],
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    flexWrap: 'wrap',
  },
  cardName: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  cardDescription: {
    fontSize: fontSize.xs,
    lineHeight: 18,
  },
  detailsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[1],
    marginTop: 2,
  },
  chip: {
    fontSize: 11,
    fontFamily: 'monospace',
  },
  projectsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  projectsText: {
    fontSize: 11,
    fontWeight: '500',
  },
  projectsList: {
    fontSize: 11,
    flex: 1,
  },
  // Conflict banner
  conflictBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
  },
  conflictBannerText: {
    flex: 1,
    gap: 2,
  },

  // Detail view styles
  detailContent: {
    padding: spacing[3],
    paddingBottom: spacing[8],
  },
  detailBadgeRow: {
    flexDirection: 'row',
    gap: spacing[1],
    marginBottom: spacing[3],
  },
  detailSection: {
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    gap: spacing[1],
  },
  detailLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  detailValue: {
    fontSize: fontSize.sm,
  },
  codeBlock: {
    padding: spacing[2],
    borderRadius: borderRadius.md,
    marginTop: spacing[1],
  },
  codeText: {
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  fadeOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 48,
    opacity: 0.85,
  },
  expandButton: {
    paddingTop: spacing[1],
  },
  codeInline: {
    fontSize: 11,
    fontFamily: 'monospace',
    padding: spacing[1],
    borderRadius: borderRadius.sm,
    overflow: 'hidden' as const,
  },
  toolsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[1],
    marginTop: spacing[1],
  },
  toolChip: {
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  toolChipText: {
    fontSize: 11,
    fontFamily: 'monospace',
  },
  projectToggleList: {
    marginTop: spacing[1],
  },
  projectToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
  },
  projectToggleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    flex: 1,
  },
  projectToggleName: {
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  groupHeader: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[1],
  },
});
