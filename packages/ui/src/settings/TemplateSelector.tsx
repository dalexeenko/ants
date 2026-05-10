/**
 * TemplateSelector - Compact dropdown that opens a full overlay for template selection.
 *
 * Shows the currently selected template in a single-line selector.
 * Tapping it opens a full-screen overlay with template cards.
 * "Blank Project" is always available as the first option.
 * For remote servers, fetches templates from the server API.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  ScrollView,
  Modal as RNModal,
  Dimensions,
} from 'react-native';
import { Text } from '../primitives/Text';
import { Spinner } from '../primitives/Spinner';
import { Icon, IconButton } from '../primitives/IconButton';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius, fontSize, shadows, palette as paletteTokens } from '../styles/tokens';
import type { AgentBridge } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('TemplateSelector');

export interface TemplateInfo {
  id: string;
  name: string;
  slug: string;
  description?: string;
  category?: string;
  rootAgentType?: string;
  agentTypes?: string[];
}

export interface TemplateSelectorProps {
  /** Currently selected template (null = blank) */
  selectedTemplate: TemplateInfo | null;
  /** Called when a template is selected */
  onSelect: (template: TemplateInfo | null) => void;
  /** The bridge for fetching remote templates */
  bridge: AgentBridge;
  /** Remote server ID if creating a remote project */
  remoteServerId?: string;
}

/** Built-in template definitions for local projects (mirrors server's built-in templates) */
const LOCAL_TEMPLATES: TemplateInfo[] = [
  {
    id: 'builtin-react-app',
    name: 'React Application',
    slug: 'react-app',
    description: 'React + TypeScript with testing and build tools',
    category: 'web',
    rootAgentType: 'general-code',
    agentTypes: ['general-code', 'explore-code', 'code-review', 'code-test', 'code-refactor'],
  },
  {
    id: 'builtin-node-api',
    name: 'Node.js API',
    slug: 'node-api',
    description: 'REST API service with TypeScript and testing',
    category: 'api',
    rootAgentType: 'general-code',
    agentTypes: ['general-code', 'explore-code', 'code-review', 'code-test', 'code-debug'],
  },
  {
    id: 'builtin-python-project',
    name: 'Python Project',
    slug: 'python-project',
    description: 'Python with virtual environment and pytest',
    category: 'other',
    rootAgentType: 'general-code',
    agentTypes: ['general-code', 'explore-code', 'code-review', 'code-test'],
  },
  {
    id: 'builtin-fullstack-app',
    name: 'Full-Stack App',
    slug: 'fullstack-app',
    description: 'React frontend + Node.js backend monorepo',
    category: 'web',
    rootAgentType: 'general-code',
    agentTypes: ['general-code', 'explore-code', 'code-review', 'code-test', 'code-refactor', 'code-debug'],
  },
  {
    id: 'builtin-cli-tool',
    name: 'CLI Tool',
    slug: 'cli-tool',
    description: 'Command-line tool with TypeScript and commander.js',
    category: 'cli',
    rootAgentType: 'general-code',
    agentTypes: ['general-code', 'explore-code', 'code-review', 'code-test'],
  },
  {
    id: 'builtin-devops-automation',
    name: 'DevOps Automation',
    slug: 'devops-automation',
    description: 'Infrastructure scripts and CI/CD automation',
    category: 'devops',
    rootAgentType: 'general-code',
    agentTypes: ['general-code', 'explore-code', 'files-root', 'files-analyzer', 'files-organizer'],
  },
];

const CATEGORY_COLORS: Record<string, string> = {
  web: paletteTokens.info,
  api: paletteTokens.success,
  cli: paletteTokens.violet,
  devops: paletteTokens.warning,
  library: paletteTokens.pink,
  data: paletteTokens.teal,
};

export function TemplateSelector({
  selectedTemplate,
  onSelect,
  bridge,
  remoteServerId,
}: TemplateSelectorProps) {
  const { colors } = useTheme();
  const [remoteTemplates, setRemoteTemplates] = useState<TemplateInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Fetch remote templates if applicable
  useEffect(() => {
    if (!remoteServerId) return;

    const fetchTemplates = async () => {
      setLoading(true);
      try {
        const response = await bridge.remoteServerFetch(remoteServerId, '/templates');
        if (response.ok) {
          const data = JSON.parse(response.body);
          const templates = Array.isArray(data) ? data : data.templates || [];
          setRemoteTemplates(
            templates
              .filter((t: any) => t.slug !== 'blank')
              .map((t: any) => ({
                id: t.id,
                name: t.name,
                slug: t.slug,
                description: t.description,
                category: t.category,
                rootAgentType: t.rootAgentType || t.root_agent_type,
                agentTypes: t.agentTypes ? (typeof t.agentTypes === 'string' ? JSON.parse(t.agentTypes) : t.agentTypes) : undefined,
              }))
          );
        }
      } catch (e) {
        log.warn('Failed to fetch remote templates:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchTemplates();
  }, [remoteServerId, bridge]);

  const templates = remoteServerId ? remoteTemplates : LOCAL_TEMPLATES;

  const handleSelect = (template: TemplateInfo | null) => {
    onSelect(template);
    setPickerOpen(false);
  };

  const selectedName = selectedTemplate ? selectedTemplate.name : 'Blank Project';
  const selectedDesc = selectedTemplate
    ? selectedTemplate.description
    : 'Empty project with default settings';
  const selectedCategory = selectedTemplate?.category;
  const selectedCategoryColor = CATEGORY_COLORS[selectedCategory || ''] || colors.text.muted;

  return (
    <View style={styles.container}>
      <Text variant="label" style={styles.label}>
        Template
      </Text>

      {/* Compact selector row */}
      <Pressable
        onPress={() => setPickerOpen(true)}
        style={[
          styles.selector,
          {
            backgroundColor: colors.bg.secondary,
            borderColor: colors.border.light,
          },
        ]}
      >
        <Icon
          name={selectedTemplate ? 'folder' : 'file'}
          size={18}
          color={colors.primary}
        />
        <View style={styles.selectorText}>
          <View style={styles.selectorNameRow}>
            <Text style={{ fontWeight: '600' }} numberOfLines={1}>
              {selectedName}
            </Text>
            {selectedCategory && (
              <View style={[styles.categoryBadgeInline, { backgroundColor: `${selectedCategoryColor}20` }]}>
                <Text style={[styles.categoryTextInline, { color: selectedCategoryColor }]}>
                  {selectedCategory}
                </Text>
              </View>
            )}
          </View>
          {selectedDesc && (
            <Text variant="caption" color="muted" numberOfLines={1}>
              {selectedDesc}
            </Text>
          )}
        </View>
        {loading ? (
          <Spinner size="small" />
        ) : (
          <Icon name="chevron-down" size={16} color={colors.text.muted} />
        )}
      </Pressable>

      {/* Full overlay picker */}
      <RNModal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setPickerOpen(false)}>
          <Pressable
            style={[
              styles.pickerContent,
              { backgroundColor: colors.bg.primary },
              shadows.lg,
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <View style={[styles.pickerHeader, { borderBottomColor: colors.border.light }]}>
              <Text variant="heading" style={{ flex: 1 }}>
                Choose Template
              </Text>
              <IconButton icon="close" onPress={() => setPickerOpen(false)} size="sm" />
            </View>

            {/* Template list */}
            <ScrollView
              style={styles.pickerScroll}
              contentContainerStyle={styles.pickerScrollInner}
            >
              {loading ? (
                <View style={styles.loadingContainer}>
                  <Spinner size="small" />
                  <Text color="muted" style={{ marginTop: spacing[2] }}>
                    Loading templates...
                  </Text>
                </View>
              ) : (
                <View style={styles.grid}>
                  {/* Blank Project card */}
                  <Pressable
                    onPress={() => handleSelect(null)}
                    style={[
                      styles.card,
                      {
                        backgroundColor: colors.bg.secondary,
                        borderColor: selectedTemplate === null ? colors.primary : colors.border.light,
                        borderWidth: selectedTemplate === null ? 2 : 1,
                      },
                    ]}
                  >
                    <Icon name="file" size={20} color={selectedTemplate === null ? colors.primary : colors.text.muted} />
                    <Text
                      style={[
                        styles.cardName,
                        { color: selectedTemplate === null ? colors.primary : colors.text.primary },
                      ]}
                    >
                      Blank Project
                    </Text>
                    <Text style={[styles.cardDesc, { color: colors.text.muted }]} numberOfLines={2}>
                      Empty project with default settings
                    </Text>
                  </Pressable>

                  {/* Template cards */}
                  {templates.map((template) => {
                    const isSelected = selectedTemplate?.slug === template.slug;
                    const categoryColor = CATEGORY_COLORS[template.category || ''] || colors.text.muted;

                    return (
                      <Pressable
                        key={template.id}
                        onPress={() => handleSelect(template)}
                        style={[
                          styles.card,
                          {
                            backgroundColor: colors.bg.secondary,
                            borderColor: isSelected ? colors.primary : colors.border.light,
                            borderWidth: isSelected ? 2 : 1,
                          },
                        ]}
                      >
                        <View style={styles.cardHeader}>
                          <Icon
                            name="folder"
                            size={18}
                            color={isSelected ? colors.primary : colors.text.muted}
                          />
                          {template.category && (
                            <View style={[styles.categoryBadge, { backgroundColor: `${categoryColor}20` }]}>
                              <Text style={[styles.categoryText, { color: categoryColor }]}>
                                {template.category}
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text
                          style={[
                            styles.cardName,
                            { color: isSelected ? colors.primary : colors.text.primary },
                          ]}
                          numberOfLines={1}
                        >
                          {template.name}
                        </Text>
                        <Text style={[styles.cardDesc, { color: colors.text.muted }]} numberOfLines={2}>
                          {template.description || 'No description'}
                        </Text>
                        {template.agentTypes && template.agentTypes.length > 0 && (
                          <Text style={[styles.agentCount, { color: colors.text.muted }]}>
                            {template.agentTypes.length} agent{template.agentTypes.length !== 1 ? 's' : ''} included
                          </Text>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </RNModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing[2],
  },
  label: {
    marginBottom: spacing[2],
  },
  // Compact selector row
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2] + 2,
    gap: spacing[2],
  },
  selectorText: {
    flex: 1,
    gap: 2,
  },
  selectorNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  categoryBadgeInline: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: borderRadius.sm,
  },
  categoryTextInline: {
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  // Overlay
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[4],
  },
  pickerContent: {
    width: '100%',
    maxWidth: 520,
    // Use a pixel value instead of percentage for maxHeight. On React Native,
    // percentage-based maxHeight with flex: 1 children causes the ScrollView
    // to collapse to zero height because the parent computes its height only
    // from non-flex content (the header). A pixel value gives the layout engine
    // a concrete constraint so flex: 1 children receive remaining space.
    maxHeight: Math.round(Dimensions.get('window').height * 0.8),
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
  },
  pickerScroll: {
    flex: 1,
  },
  pickerScrollInner: {
    padding: spacing[4],
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: spacing[4],
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  card: {
    width: '48%',
    minWidth: 140,
    padding: spacing[3],
    borderRadius: borderRadius.md,
    gap: spacing[1],
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardName: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  cardDesc: {
    fontSize: fontSize.xs,
    lineHeight: 16,
  },
  categoryBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  categoryText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  agentCount: {
    fontSize: 10,
    marginTop: 2,
  },
});
