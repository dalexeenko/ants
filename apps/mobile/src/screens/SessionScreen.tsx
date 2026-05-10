import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Pressable, StyleSheet, Modal } from 'react-native';
import {
  ThemeContext,
  Text,
  IconButton,
  Icon,
  Spinner,
  FileBrowser,
  TodosPanel,
  SubagentsPanel,
  ModelPicker,
  ModePickerModal,
  TokenUsageBar,
  GlobalSearch,
  useSessionStore,
  getSessionStatus,
  type SessionStatus,
  type SearchResult,
  spacing,
  colors as tokenColors,
  type AgentBridge,
  type SubagentInfo,
  createLogger,
  type Project,
} from '@ants/ui';
import { ChatScreen } from './ChatScreen';
import { MorePanel, type MoreTabEntry } from './MorePanel';

const log = createLogger('SessionScreen');

// -------------------------------------------------------------------
// Tab definitions
// -------------------------------------------------------------------

type TabId = 'chat' | 'files' | 'todos' | 'tasks' | 'more';

interface Tab {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: Tab[] = [
  { id: 'chat', label: 'Chat', icon: 'chat' },
  { id: 'files', label: 'Files', icon: 'folder' },
  { id: 'todos', label: 'Todos', icon: 'checkCircle' },
  { id: 'tasks', label: 'Tasks', icon: 'users' },
  { id: 'more', label: 'More', icon: 'moreHorizontal' },
];

// -------------------------------------------------------------------
// Props
// -------------------------------------------------------------------

interface SessionScreenProps {
  bridge: AgentBridge;
  projectId: string;
  sessionId: string;
  sessionTitle?: string;
  onNavigateBack: () => void;
  onNavigateToSettings?: () => void;
}

// -------------------------------------------------------------------
// Component
// -------------------------------------------------------------------

export function SessionScreen({
  bridge,
  projectId,
  sessionId,
  sessionTitle,
  onNavigateBack,
  onNavigateToSettings,
}: SessionScreenProps) {
  const { colors } = React.useContext(ThemeContext);
  const [activeTab, setActiveTab] = useState<TabId>('chat');
  const [project, setProject] = useState<Project | null>(null);

  // -------------------------------------------------------------------
  // More tab state — lifted so other tabs can push into it
  // -------------------------------------------------------------------
  const [moreTabs, setMoreTabs] = useState<MoreTabEntry[]>([]);
  const [activeMoreTabId, setActiveMoreTabId] = useState<string | null>(null);

  const openInMoreTab = useCallback((entry: MoreTabEntry) => {
    setMoreTabs((prev) => {
      const exists = prev.find((t) => t.id === entry.id);
      if (exists) return prev;
      return [...prev, entry];
    });
    setActiveMoreTabId(entry.id);
    setActiveTab('more');
  }, []);

  const closeMoreTab = useCallback((id: string) => {
    setMoreTabs((prev) => prev.filter((t) => t.id !== id));
    setActiveMoreTabId((prev) => (prev === id ? null : prev));
  }, []);

  const selectMoreTab = useCallback((id: string | null) => {
    setActiveMoreTabId(id);
  }, []);

  // -------------------------------------------------------------------
  // Session status from Zustand store
  // -------------------------------------------------------------------
  const {
    processingBySession,
    pendingPermissionsBySession,
    pendingQuestionsBySession,
    errorBySession,
    doneBySession,
  } = useSessionStore();
  const sessionStatus = getSessionStatus(
    sessionId,
    processingBySession,
    pendingPermissionsBySession,
    pendingQuestionsBySession,
    errorBySession,
    doneBySession,
  );

  // -------------------------------------------------------------------
  // Load project info (to check remote status)
  // -------------------------------------------------------------------
  useEffect(() => {
    const loadProject = async () => {
      const projects = await bridge.listProjects();
      const found = projects.find((p: Project) => p.id === projectId);
      setProject(found || null);
    };
    loadProject();
  }, [bridge, projectId]);

  const isRemote = project?.providerType === 'remote';

  // Look up session for worktree info
  const session = useSessionStore((state) => {
    const sessions = state.sessionsByProject[projectId] || [];
    return sessions.find((s) => s.id === sessionId) || null;
  });
  const worktree = session?.worktree || null;

  // -------------------------------------------------------------------
  // Search overlay state
  // -------------------------------------------------------------------
  const [showSearch, setShowSearch] = useState(false);

  const handleSearchResult = useCallback((result: SearchResult) => {
    setShowSearch(false);
    // If the result is for the current session, just dismiss the overlay
    // Otherwise, navigate back (the parent will handle navigation to a different session)
    if (result.session.id !== sessionId) {
      log.debug('Search selected different session:', result.session.id);
      // For now, just close the overlay. The search result points to another session.
    }
  }, [sessionId]);

  // -------------------------------------------------------------------
  // Cross-tab navigation handlers
  // -------------------------------------------------------------------

  const handleFileOpen = useCallback((file: { path: string; name: string; size?: number }) => {
    log.debug('File opened:', file.path);
    openInMoreTab({
      id: `file:${file.path}`,
      type: 'file-editor',
      label: file.name,
      data: { filePath: file.path },
    });
  }, [openInMoreTab]);

  const handleFilePathClick = useCallback((filePath: string) => {
    const fileName = filePath.split('/').pop() || filePath;
    log.debug('File path clicked in chat:', filePath);
    openInMoreTab({
      id: `file:${filePath}`,
      type: 'file-editor',
      label: fileName,
      data: { filePath },
    });
  }, [openInMoreTab]);

  const handleSubagentSelect = useCallback((subagent: SubagentInfo) => {
    log.debug('Subagent selected:', subagent.sessionId);
    openInMoreTab({
      id: `subagent:${subagent.sessionId}`,
      type: 'subagent',
      label: subagent.description || 'Subagent',
      data: { subagentSessionId: subagent.sessionId },
    });
  }, [openInMoreTab]);

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------

  return (
    <View testID="ants-session-screen" style={[styles.container, { backgroundColor: colors.bg.secondary }]}>
      {/* Main content area */}
      <View style={[styles.mainArea, { backgroundColor: colors.bg.primary }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border.light }]}>
          <IconButton icon="arrow-left" size="md" onPress={onNavigateBack} />
          <View style={styles.headerTitle}>
            <View style={styles.headerTitleRow}>
              {sessionStatus !== 'idle' && (
                <SessionStatusIndicator status={sessionStatus} />
              )}
              <Text variant="heading" numberOfLines={1} style={{ flexShrink: 1 }}>
                {sessionTitle || 'Session'}
              </Text>
            </View>
          </View>
          <View style={styles.headerSpacer} />
        </View>

        {/* Content based on active tab */}
        <View style={styles.content}>
          {activeTab === 'chat' && (
            <ChatScreen
              bridge={bridge}
              projectId={projectId}
              sessionId={sessionId}
              onFilePathClick={handleFilePathClick}
            />
          )}
          {activeTab === 'files' && (
            <FileBrowser
              bridge={bridge}
              projectId={projectId}
              onFileSelect={(file) => {
                log.debug('File selected:', file.path);
              }}
              onFileOpen={handleFileOpen}
            />
          )}
          {activeTab === 'todos' && (
            <TodosPanel sessionId={sessionId} />
          )}
          {activeTab === 'tasks' && (
            <SubagentsPanel
              sessionId={sessionId}
              onSubagentSelect={handleSubagentSelect}
            />
          )}
          {activeTab === 'more' && (
            <MorePanel
              bridge={bridge}
              projectId={projectId}
              sessionId={sessionId}
              isRemote={isRemote}
              worktree={worktree}
              openTabs={moreTabs}
              activeTabId={activeMoreTabId}
              onOpenTab={openInMoreTab}
              onCloseTab={closeMoreTab}
              onSelectTab={selectMoreTab}
              onNavigateToSettings={onNavigateToSettings}
            />
          )}
        </View>
      </View>

      {/* Model Picker, Mode Picker & Token Usage — only visible on Chat tab */}
      {activeTab === 'chat' && (
        <View style={[styles.modelPickerBar, { backgroundColor: colors.bg.primary }]}>
          <View style={[styles.modelPickerDivider, { backgroundColor: colors.border.light }]} />
          <View style={styles.modelPickerContent}>
            <ModePickerModal
              bridge={bridge}
              projectId={projectId}
              sessionId={sessionId}
            />
            <TokenUsageBar bridge={bridge} projectId={projectId} />
            <ModelPicker
              bridge={bridge}
              projectId={projectId}
              sessionId={sessionId}
            />
          </View>
        </View>
      )}

      {/* Tab Bar */}
      <View style={[styles.tabBar, { backgroundColor: colors.bg.secondary, borderTopColor: colors.border.light }]}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <Pressable
              key={tab.id}
              style={styles.tab}
              onPress={() => setActiveTab(tab.id)}
            >
              <Icon
                name={tab.icon}
                size={22}
                color={isActive ? colors.primary : colors.text.muted}
              />
              <Text
                variant="caption"
                style={[
                  styles.tabLabel,
                  { color: isActive ? colors.primary : colors.text.muted },
                ]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Search overlay */}
      <Modal
        visible={showSearch}
        animationType="slide"
        transparent
        onRequestClose={() => setShowSearch(false)}
      >
        <View style={[styles.searchOverlay, { backgroundColor: colors.bg.primary }]}>
          <View style={[styles.searchHeader, { borderBottomColor: colors.border.light }]}>
            <View style={styles.searchInputWrapper}>
              <GlobalSearch
                bridge={bridge}
                onSelectResult={handleSearchResult}
                placeholder="Search sessions..."
              />
            </View>
            <IconButton icon="x" size="md" onPress={() => setShowSearch(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

// -------------------------------------------------------------------
// Session status indicator
// -------------------------------------------------------------------

const STATUS_DOT_COLORS: Record<SessionStatus, string | null> = {
  processing: tokenColors.primary,
  needsPermission: tokenColors.warning,
  needsAnswer: tokenColors.warning,
  error: tokenColors.error,
  done: tokenColors.info,
  idle: null,
};

function SessionStatusIndicator({ status }: { status: SessionStatus }) {
  if (status === 'processing') {
    return <Spinner size="small" />;
  }
  const color = STATUS_DOT_COLORS[status];
  if (!color) return null;
  return (
    <View style={[statusStyles.dot, { backgroundColor: color }]} />
  );
}

const statusStyles = StyleSheet.create({
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});

// -------------------------------------------------------------------
// Styles
// -------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mainArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
  },
  headerTitle: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  headerSpacer: {
    width: 40,
  },
  content: {
    flex: 1,
  },
  modelPickerBar: {
    paddingHorizontal: spacing[4],
  },
  modelPickerDivider: {
    height: 1,
    marginBottom: spacing[2],
  },
  modelPickerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: spacing[2],
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingBottom: spacing[3],
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[2.5],
    gap: 2,
  },
  tabLabel: {
    fontSize: 11,
  },
  searchOverlay: {
    flex: 1,
    paddingTop: 50,
  },
  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
  },
  searchInputWrapper: {
    flex: 1,
  },
});
