/**
 * MorePanel - The "More" tab content for the session screen.
 *
 * Displays a default view with static actions (Activity, New Terminal)
 * and a dynamic list of open tabs (terminals, files, subagents).
 * When a tab entry is selected, it renders the corresponding sub-screen
 * with a back button to return to the default view.
 */

import React, { useCallback } from 'react';
import { View, Pressable, ScrollView, StyleSheet } from 'react-native';
import {
  ThemeContext,
  Text,
  Icon,
  IconButton,
  ActivityPanel,
  RemoteTerminal,
  SubagentChatView,
  FileEditorTab,
  WorktreeDiffPanel,
  spacing,
  borderRadius,
  fontSize,
  type AgentBridge,
  type WorktreeInfo,
} from '@ants/ui';

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export type MoreTabEntryType = 'activity' | 'terminal' | 'subagent' | 'file-editor' | 'worktree-diff';

export interface MoreTabEntry {
  id: string;
  type: MoreTabEntryType;
  label: string;
  data: Record<string, unknown>;
}

interface MorePanelProps {
  bridge: AgentBridge;
  projectId: string;
  sessionId: string;
  isRemote: boolean;
  worktree?: WorktreeInfo | null;
  openTabs: MoreTabEntry[];
  activeTabId: string | null;
  onOpenTab: (entry: MoreTabEntry) => void;
  onCloseTab: (id: string) => void;
  onSelectTab: (id: string | null) => void;
  onNavigateToSettings?: () => void;
}

// -------------------------------------------------------------------
// Icon helpers
// -------------------------------------------------------------------

const TAB_TYPE_ICONS: Record<MoreTabEntryType, string> = {
  activity: 'activity',
  terminal: 'terminal',
  subagent: 'users',
  'file-editor': 'file',
  'worktree-diff': 'git-branch',
};

// -------------------------------------------------------------------
// Component
// -------------------------------------------------------------------

export function MorePanel({
  bridge,
  projectId,
  sessionId,
  isRemote,
  worktree,
  openTabs,
  activeTabId,
  onOpenTab,
  onCloseTab,
  onSelectTab,
  onNavigateToSettings,
}: MorePanelProps) {
  const { colors } = React.useContext(ThemeContext);

  const activeTab = activeTabId ? openTabs.find((t) => t.id === activeTabId) : null;

  // -------------------------------------------------------------------
  // Static action handlers
  // -------------------------------------------------------------------

  const handleOpenActivity = useCallback(() => {
    onOpenTab({
      id: 'activity',
      type: 'activity',
      label: 'Activity',
      data: {},
    });
  }, [onOpenTab]);

  const handleNewTerminal = useCallback(() => {
    const termId = `terminal:${Date.now()}`;
    onOpenTab({
      id: termId,
      type: 'terminal',
      label: 'Terminal',
      data: {},
    });
  }, [onOpenTab]);

  const handleOpenWorktreeDiff = useCallback(() => {
    onOpenTab({
      id: 'worktree-diff',
      type: 'worktree-diff',
      label: 'Worktree Diff',
      data: {},
    });
  }, [onOpenTab]);

  // -------------------------------------------------------------------
  // Sub-screen rendering
  // -------------------------------------------------------------------

  if (activeTab) {
    return (
      <View style={[styles.container, { backgroundColor: colors.bg.primary }]}>
        {/* Sub-screen header */}
        <View style={[styles.subHeader, { borderBottomColor: colors.border.light }]}>
          <IconButton icon="arrow-left" size="md" onPress={() => onSelectTab(null)} />
          <Text variant="heading" numberOfLines={1} style={styles.subHeaderTitle}>
            {activeTab.label}
          </Text>
          <Pressable
            onPress={() => onCloseTab(activeTab.id)}
            style={({ pressed }) => [
              styles.closeTabButton,
              { backgroundColor: pressed ? colors.bg.tertiary : 'transparent' },
            ]}
          >
            <Icon name="x" size={18} color={colors.text.muted} />
          </Pressable>
        </View>

        {/* Sub-screen content */}
        <View style={styles.subContent}>
          {activeTab.type === 'activity' && (
            <ActivityPanel sessionId={sessionId} />
          )}
          {activeTab.type === 'terminal' && (
            <RemoteTerminal bridge={bridge} projectId={projectId} />
          )}
          {activeTab.type === 'subagent' && (
            <SubagentChatView
              bridge={bridge}
              projectId={projectId}
              subagentSessionId={activeTab.data.subagentSessionId as string}
            />
          )}
          {activeTab.type === 'file-editor' && (
            <FileEditorTab
              bridge={bridge}
              projectId={projectId}
              filePath={activeTab.data.filePath as string}
            />
          )}
          {activeTab.type === 'worktree-diff' && worktree && (
            <WorktreeDiffPanel
              bridge={bridge}
              projectId={projectId}
              sessionId={sessionId}
              worktree={worktree}
            />
          )}
        </View>
      </View>
    );
  }

  // -------------------------------------------------------------------
  // Default view: static actions + open tabs list
  // -------------------------------------------------------------------

  return (
    <View style={[styles.container, { backgroundColor: colors.bg.primary }]}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Static actions section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text.muted }]}>
            Actions
          </Text>

          <Pressable
            style={({ pressed }) => [
              styles.actionRow,
              { backgroundColor: pressed ? colors.bg.tertiary : colors.bg.secondary },
            ]}
            onPress={handleOpenActivity}
          >
            <Icon name="activity" size={18} color={colors.text.secondary} />
            <Text style={[styles.actionLabel, { color: colors.text.primary }]}>
              Activity
            </Text>
            <Icon name="chevron-right" size={16} color={colors.text.muted} />
          </Pressable>

          {isRemote && (
            <Pressable
              style={({ pressed }) => [
                styles.actionRow,
                { backgroundColor: pressed ? colors.bg.tertiary : colors.bg.secondary },
              ]}
              onPress={handleNewTerminal}
            >
              <Icon name="terminal" size={18} color={colors.text.secondary} />
              <Text style={[styles.actionLabel, { color: colors.text.primary }]}>
                New Terminal
              </Text>
              <Icon name="plus" size={16} color={colors.text.muted} />
            </Pressable>
          )}

          {worktree && (
            <Pressable
              style={({ pressed }) => [
                styles.actionRow,
                { backgroundColor: pressed ? colors.bg.tertiary : colors.bg.secondary },
              ]}
              onPress={handleOpenWorktreeDiff}
            >
              <Icon name="git-branch" size={18} color={colors.text.secondary} />
              <Text style={[styles.actionLabel, { color: colors.text.primary }]}>
                Worktree Diff
              </Text>
              <Icon name="chevron-right" size={16} color={colors.text.muted} />
            </Pressable>
          )}

          {onNavigateToSettings && (
            <Pressable
              style={({ pressed }) => [
                styles.actionRow,
                { backgroundColor: pressed ? colors.bg.tertiary : colors.bg.secondary },
              ]}
              onPress={onNavigateToSettings}
            >
              <Icon name="settings" size={18} color={colors.text.secondary} />
              <Text style={[styles.actionLabel, { color: colors.text.primary }]}>
                Settings
              </Text>
              <Icon name="chevron-right" size={16} color={colors.text.muted} />
            </Pressable>
          )}
        </View>

        {/* Open tabs section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text.muted }]}>
            Open Tabs
          </Text>

          {openTabs.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text color="muted" style={styles.emptyText}>
                No open tabs. Open files, terminals, or subagent views and they will appear here.
              </Text>
            </View>
          ) : (
            openTabs.map((tab) => (
              <Pressable
                key={tab.id}
                style={({ pressed }) => [
                  styles.tabRow,
                  { backgroundColor: pressed ? colors.bg.tertiary : colors.bg.secondary },
                ]}
                onPress={() => onSelectTab(tab.id)}
              >
                <Icon
                  name={TAB_TYPE_ICONS[tab.type] || 'file'}
                  size={16}
                  color={colors.text.secondary}
                />
                <Text
                  style={[styles.tabLabel, { color: colors.text.primary }]}
                  numberOfLines={1}
                >
                  {tab.label}
                </Text>
                <Pressable
                  onPress={() => onCloseTab(tab.id)}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.tabCloseButton,
                    { backgroundColor: pressed ? colors.bg.tertiary : 'transparent' },
                  ]}
                >
                  <Icon name="x" size={14} color={colors.text.muted} />
                </Pressable>
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// -------------------------------------------------------------------
// Styles
// -------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing[3],
  },
  section: {
    marginBottom: spacing[4],
  },
  sectionTitle: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing[2],
    paddingHorizontal: spacing[1],
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.md,
    marginBottom: spacing[1],
    gap: spacing[3],
  },
  actionLabel: {
    flex: 1,
    fontSize: fontSize.base,
    fontWeight: '500',
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.md,
    marginBottom: spacing[1],
    gap: spacing[2],
  },
  tabLabel: {
    flex: 1,
    fontSize: fontSize.sm,
  },
  tabCloseButton: {
    padding: 4,
    borderRadius: borderRadius.sm,
  },
  emptyContainer: {
    padding: spacing[4],
    alignItems: 'center',
  },
  emptyText: {
    textAlign: 'center',
    fontSize: fontSize.sm,
  },
  // Sub-screen styles
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
  },
  subHeaderTitle: {
    flex: 1,
    textAlign: 'center',
    marginHorizontal: spacing[2],
  },
  closeTabButton: {
    padding: spacing[2],
    borderRadius: borderRadius.sm,
  },
  subContent: {
    flex: 1,
  },
});
