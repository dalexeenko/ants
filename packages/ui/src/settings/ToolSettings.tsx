import React, { useEffect, useState, useMemo } from 'react';
import { View, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Text } from '../primitives/Text';
import { Switch } from '../primitives/Switch';
import { SearchInput } from '../primitives/SearchInput';
import { SettingsSection } from './SettingsSection';
import { Badge } from '../primitives/Badge';
import { Icon, type IconName } from '../primitives/IconButton';
import { useTheme } from '../styles/theme';
import { spacing } from '../styles/tokens';
import type { AgentBridge, ToolInfo } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('ToolSettings');

// Known icon names from our icon set
const KNOWN_ICONS = new Set([
  'wrench', 'tool', 'hammer', 'build', 'folder', 'file', 'terminal', 'code',
  'globe', 'server', 'database', 'git', 'gitBranch', 'search', 'eye', 'lock',
  'key', 'shield', 'zap', 'lightning', 'settings', 'gear', 'message', 'chat',
]);

/** Check if a string is an emoji (starts with emoji character) */
function isEmoji(str: string): boolean {
  // Check if first character is in emoji ranges
  const code = str.codePointAt(0) || 0;
  return code > 0x1F300; // Most emojis start after this point
}

/** Render a tool icon - either an emoji or an icon from our icon set */
function ToolIcon({ icon, size = 16, color }: { icon?: string; size?: number; color?: string }) {
  const { colors } = useTheme();
  const iconColor = color || colors.text.muted;
  
  // Default to wrench icon
  if (!icon) {
    return <Icon name="wrench" size={size} color={iconColor} />;
  }
  
  // If it's an emoji, render as text
  if (isEmoji(icon)) {
    return (
      <Text style={{ fontSize: size - 2, lineHeight: size }}>
        {icon}
      </Text>
    );
  }
  
  // If it's a known icon name, render the icon
  if (KNOWN_ICONS.has(icon)) {
    return <Icon name={icon as IconName} size={size} color={iconColor} />;
  }
  
  // Unknown string - treat as emoji or fallback to wrench
  return <Icon name="wrench" size={size} color={iconColor} />;
}

interface ToolSettingsProps {
  bridge: AgentBridge;
  projectId: string;
  onNavigateToTools?: () => void;
}

/**
 * Summary card for tools - shows count and a few tool names.
 * Tapping navigates to the full tools management page.
 */
export function ToolSettings({ bridge, projectId, onNavigateToTools }: ToolSettingsProps) {
  const { colors } = useTheme();
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTools();
  }, [projectId]);

  const loadTools = async () => {
    try {
      setLoading(true);
      const toolsInfo = await bridge.getToolsInfo(projectId);
      setTools(toolsInfo);
    } catch (e) {
      log.error('Failed to load tools:', e);
    } finally {
      setLoading(false);
    }
  };

  const enabledTools = tools.filter((t) => !t.disabled && t.available);
  const totalTools = tools.filter((t) => t.available).length;
  const previewTools = enabledTools.slice(0, 5);

  if (loading) {
    return (
      <SettingsSection
        title="Tools"
        description="Configure which tools are available to the agent"
      >
        <View style={styles.loading}>
          <Text style={{ color: colors.text.muted }}>Loading tools...</Text>
        </View>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title="Tools"
      description="Configure which tools are available to the agent"
    >
      <Pressable
        style={[
          styles.summaryCard,
          { backgroundColor: colors.bg.secondary },
        ]}
        onPress={onNavigateToTools}
      >
        <View style={styles.summaryContent}>
          <View style={styles.summaryHeader}>
            <Text style={[styles.summaryTitle, { color: colors.text.primary }]}>
              {enabledTools.length} of {totalTools} tools enabled
            </Text>
            <Icon name="chevronRight" size={18} color={colors.text.muted} />
          </View>
          
          {previewTools.length > 0 && (
            <Text style={[styles.summaryPreview, { color: colors.text.secondary }]} numberOfLines={2}>
              {previewTools.map((t) => t.name).join(', ')}
              {enabledTools.length > 5 && ` and ${enabledTools.length - 5} more...`}
            </Text>
          )}
        </View>
      </Pressable>
    </SettingsSection>
  );
}

/**
 * Full tools management page with search, filtering, and toggle controls.
 */
interface ToolSettingsPageProps {
  bridge: AgentBridge;
  projectId: string;
  onBack: () => void;
}

export function ToolSettingsPage({ bridge, projectId, onBack }: ToolSettingsPageProps) {
  const { colors } = useTheme();
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  useEffect(() => {
    loadTools();
  }, [projectId]);

  const loadTools = async () => {
    try {
      setLoading(true);
      const toolsInfo = await bridge.getToolsInfo(projectId);
      setTools(toolsInfo);
    } catch (e) {
      log.error('Failed to load tools:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleTool = async (toolName: string, enabled: boolean) => {
    // Optimistically update UI
    setTools((prev) =>
      prev.map((t) => (t.name === toolName ? { ...t, disabled: !enabled } : t))
    );

    try {
      if (enabled) {
        await bridge.enableTool(projectId, toolName);
      } else {
        await bridge.disableTool(projectId, toolName);
      }
    } catch (e) {
      log.error('Failed to toggle tool:', e);
      // Revert on error
      loadTools();
    }
  };

  // Extract all unique tags
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    tools.forEach((tool) => tool.tags.forEach((tag) => tagSet.add(tag)));
    return Array.from(tagSet).sort();
  }, [tools]);

  // Filter tools by search and tags
  const filteredTools = useMemo(() => {
    return tools.filter((tool) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          tool.name.toLowerCase().includes(query) ||
          tool.description.toLowerCase().includes(query) ||
          tool.tags.some((tag) => tag.toLowerCase().includes(query));
        if (!matchesSearch) return false;
      }

      // Tag filter
      if (selectedTags.length > 0) {
        const hasTags = selectedTags.some((tag) => tool.tags.includes(tag));
        if (!hasTags) return false;
      }

      return true;
    });
  }, [tools, searchQuery, selectedTags]);

  // Group tools by availability
  const { availableTools, unavailableTools } = useMemo(() => {
    const available: ToolInfo[] = [];
    const unavailable: ToolInfo[] = [];

    filteredTools.forEach((tool) => {
      if (tool.available) {
        available.push(tool);
      } else {
        unavailable.push(tool);
      }
    });

    return {
      availableTools: available.sort((a, b) => a.name.localeCompare(b.name)),
      unavailableTools: unavailable.sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [filteredTools]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleEnableAll = async () => {
    // Only enable available tools in the current filter
    const toolsToEnable = filteredTools.filter((t) => t.available && t.disabled);
    
    // Optimistically update UI
    setTools((prev) =>
      prev.map((t) =>
        toolsToEnable.some((ft) => ft.name === t.name) ? { ...t, disabled: false } : t
      )
    );

    // Update each tool
    for (const tool of toolsToEnable) {
      try {
        await bridge.enableTool(projectId, tool.name);
      } catch (e) {
        log.error(`Failed to enable tool ${tool.name}:`, e);
      }
    }
  };

  const handleDisableAll = async () => {
    // Only disable available tools in the current filter
    const toolsToDisable = filteredTools.filter((t) => t.available && !t.disabled);
    
    // Optimistically update UI
    setTools((prev) =>
      prev.map((t) =>
        toolsToDisable.some((ft) => ft.name === t.name) ? { ...t, disabled: true } : t
      )
    );

    // Update each tool
    for (const tool of toolsToDisable) {
      try {
        await bridge.disableTool(projectId, tool.name);
      } catch (e) {
        log.error(`Failed to disable tool ${tool.name}:`, e);
      }
    }
  };

  return (
    <View style={[styles.pageContainer, { backgroundColor: colors.bg.primary }]}>
      {/* Header */}
      <View style={[styles.pageHeader, { borderBottomColor: colors.border.light }]}>
        <Pressable onPress={onBack} style={styles.backButton}>
          <Text style={{ color: colors.primary }}>← Back</Text>
        </Pressable>
        <Text variant="heading" style={{ flex: 1, textAlign: 'center' }}>Tools</Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={styles.loading}>
          <Text style={{ color: colors.text.muted }}>Loading tools...</Text>
        </View>
      ) : (
        <>
          {/* Fixed header section */}
          <View style={[styles.filterSection, { backgroundColor: colors.bg.secondary }]}>
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search tools..."
            />

            {/* Tag filters */}
            {allTags.length > 0 && (
              <View style={styles.tagFilters}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.tagList}>
                    {allTags.map((tag) => (
                      <Pressable
                        key={tag}
                        onPress={() => toggleTag(tag)}
                        style={[
                          styles.tagButton,
                          { borderColor: colors.border.medium },
                          selectedTags.includes(tag) && {
                            backgroundColor: colors.primary,
                            borderColor: colors.primary,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.tagButtonText,
                            {
                              color: selectedTags.includes(tag)
                                ? colors.text.inverse
                                : colors.text.secondary,
                            },
                          ]}
                        >
                          {tag}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </View>
            )}
          </View>

          {/* Stats and bulk actions */}
          <View
            style={[
              styles.statsRow,
              { backgroundColor: colors.bg.tertiary, borderBottomColor: colors.border.light },
            ]}
          >
            <Text style={[styles.statsText, { color: colors.text.inverse, fontWeight: '600' }]}>
              {filteredTools.length} tool{filteredTools.length !== 1 ? 's' : ''}{' '}
              {searchQuery || selectedTags.length > 0 ? 'matching' : 'total'}
              {' - '}
              {filteredTools.filter((t) => !t.disabled && t.available).length} enabled
            </Text>
            <View style={styles.bulkActions}>
              <Pressable
                onPress={handleEnableAll}
                style={[
                  styles.bulkButton,
                  { backgroundColor: colors.primary },
                  filteredTools.filter((t) => t.available && t.disabled).length === 0 && { opacity: 0.4 },
                ]}
                disabled={filteredTools.filter((t) => t.available && t.disabled).length === 0}
              >
                <Text style={[styles.bulkButtonText, { color: colors.text.inverse }]}>
                  Enable {filteredTools.filter((t) => t.available && t.disabled).length} listed
                </Text>
              </Pressable>
              <Pressable
                onPress={handleDisableAll}
                style={[
                  styles.bulkButton,
                  { backgroundColor: colors.text.muted },
                  filteredTools.filter((t) => t.available && !t.disabled).length === 0 && { opacity: 0.4 },
                ]}
                disabled={filteredTools.filter((t) => t.available && !t.disabled).length === 0}
              >
                <Text style={[styles.bulkButtonText, { color: colors.text.inverse }]}>
                  Disable {filteredTools.filter((t) => t.available && !t.disabled).length} listed
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Scrollable tool list */}
          <ScrollView style={styles.toolList}>
            {/* Available Tools */}
            {availableTools.map((tool, index) => (
              <ToolRow
                key={tool.name}
                tool={tool}
                onToggle={(enabled) => handleToggleTool(tool.name, enabled)}
                isLast={index === availableTools.length - 1 && unavailableTools.length === 0}
              />
            ))}

            {/* Unavailable Tools */}
            {unavailableTools.length > 0 && (
              <View style={styles.toolGroup}>
                <View
                  style={[
                    styles.groupHeader,
                    { backgroundColor: colors.bg.tertiary, borderBottomColor: colors.border.light },
                  ]}
                >
                  <Text style={[styles.groupTitle, { color: colors.text.muted }]}>
                    Unavailable Tools ({unavailableTools.length})
                  </Text>
                  <Text style={[styles.groupSubtitle, { color: colors.text.muted }]}>
                    Missing required platform capabilities
                  </Text>
                </View>

                {unavailableTools.map((tool, index) => (
                  <ToolRow
                    key={tool.name}
                    tool={tool}
                    onToggle={(enabled) => handleToggleTool(tool.name, enabled)}
                    isLast={index === unavailableTools.length - 1}
                  />
                ))}
              </View>
            )}

            {filteredTools.length === 0 && (
              <View style={styles.emptyState}>
                <Text style={{ color: colors.text.muted }}>
                  No tools match your search criteria
                </Text>
              </View>
            )}
          </ScrollView>
        </>
      )}
    </View>
  );
}

// ============ Tool Row ============

interface ToolRowProps {
  tool: ToolInfo;
  onToggle: (enabled: boolean) => void;
  isLast: boolean;
}

function ToolRow({ tool, onToggle, isLast }: ToolRowProps) {
  const { colors } = useTheme();
  const enabled = !tool.disabled;

  return (
    <View
      style={[
        styles.toolRow,
        { backgroundColor: colors.bg.secondary },
        !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border.light },
        !tool.available && styles.toolRowUnavailable,
      ]}
    >
      {/* Tool Icon */}
      <View style={[styles.toolIcon, !enabled && { opacity: 0.5 }]}>
        <ToolIcon 
          icon={tool.icon} 
          size={18} 
          color={tool.available ? colors.text.secondary : colors.text.muted} 
        />
      </View>
      
      <View style={styles.toolInfo}>
        <View style={styles.toolNameRow}>
          <Text
            style={[
              styles.toolName,
              { color: tool.available ? colors.text.primary : colors.text.muted },
              !enabled && styles.toolNameDisabled,
            ]}
          >
            {tool.name}
          </Text>
          {!tool.available && (
            <Badge variant="warning" size="sm">
              Unavailable
            </Badge>
          )}
        </View>
        <Text
          style={[
            styles.toolDescription,
            { color: colors.text.secondary },
            !enabled && styles.toolDescriptionDisabled,
          ]}
          numberOfLines={2}
        >
          {tool.description}
        </Text>

        {/* Tags */}
        {tool.tags.length > 0 && (
          <View style={styles.toolTags}>
            {tool.tags.map((tag) => (
              <View
                key={tag}
                style={[styles.toolTag, { backgroundColor: colors.bg.tertiary }]}
              >
                <Text style={[styles.toolTagText, { color: colors.text.muted }]}>
                  {tag}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Requirements */}
        {tool.requires.length > 0 && !tool.available && (
          <View style={styles.requiresRow}>
            <Text style={[styles.requiresLabel, { color: colors.text.muted }]}>
              Requires:{' '}
            </Text>
            <Text style={[styles.requiresList, { color: colors.warning }]}>
              {tool.requires.join(', ')}
            </Text>
          </View>
        )}
      </View>

      <Switch
        value={enabled}
        onValueChange={onToggle}
        disabled={!tool.available}
        trackColor={{ false: colors.border.medium, true: colors.primary }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Summary card styles
  summaryCard: {
    overflow: 'hidden',
  },
  summaryContent: {
    padding: spacing[4],
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryTitle: {
    fontSize: 15,
    fontWeight: '500',
  },
  summaryPreview: {
    fontSize: 13,
    marginTop: spacing[2],
    lineHeight: 18,
  },
  // Page styles
  pageContainer: {
    flex: 1,
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 60,
  },
  pageContent: {
    flex: 1,
  },
  toolList: {
    flex: 1,
  },
  // Existing styles
  loading: {
    padding: spacing[4],
    alignItems: 'center',
  },
  filterSection: {
    padding: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: 'transparent',
  },
  searchInput: {
    marginBottom: spacing[2],
  },
  tagFilters: {
    marginTop: spacing[2],
  },
  tagList: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  tagButton: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: 16,
    borderWidth: 1,
  },
  tagButtonText: {
    fontSize: 12,
    fontWeight: '500',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[4],
    borderBottomWidth: 1,
  },
  statsText: {
    fontSize: 12,
  },
  toolGroup: {},
  groupHeader: {
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[4],
    borderBottomWidth: 1,
  },
  groupTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  groupSubtitle: {
    fontSize: 11,
    marginTop: spacing[0.5],
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
  },
  toolRowUnavailable: {
    opacity: 0.7,
  },
  toolIcon: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[3],
    marginTop: 2,
  },
  toolInfo: {
    flex: 1,
    marginRight: spacing[3],
  },
  toolNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[1],
  },
  toolName: {
    fontSize: 14,
    fontWeight: '500',
    fontFamily: 'monospace',
  },
  toolNameDisabled: {
    textDecorationLine: 'line-through',
    opacity: 0.7,
  },
  toolDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  toolDescriptionDisabled: {
    opacity: 0.7,
  },
  toolTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[1],
    marginTop: spacing[2],
  },
  toolTag: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[0.5],
    borderRadius: 4,
  },
  toolTagText: {
    fontSize: 10,
    fontWeight: '500',
  },
  requiresRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing[2],
  },
  requiresLabel: {
    fontSize: 11,
  },
  requiresList: {
    fontSize: 11,
    fontWeight: '500',
  },
  emptyState: {
    padding: spacing[6],
    alignItems: 'center',
  },
  bulkActions: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  bulkButton: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: 4,
  },
  bulkButtonText: {
    fontSize: 12,
    fontWeight: '500',
  },
});
