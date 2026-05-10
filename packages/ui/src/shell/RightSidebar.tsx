import React, { useCallback } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import {
  ThemeContext,
  useUIStore,
  useSessionStore,
  Text,
  FileBrowser,
  RemoteTerminal,
  ResizablePanel,
  TodosPanel,
  SubagentsPanel,
  ActivityPanel,
  ErrorBoundary,
  RIGHT_SIDEBAR_MIN_WIDTH,
  RIGHT_SIDEBAR_COLLAPSE_THRESHOLD,
  type FileEntry,
  type RightSidebarTab,
  createLogger,
} from '../index';
import { usePluginSidebarPanels } from '../plugins';

const log = createLogger('RightSidebar');

interface TabConfig {
  id: RightSidebarTab;
  label: string;
  /** Only show this tab when condition is true (default: always) */
  condition?: boolean;
}

export function RightSidebar({ projectId, sessionId }: { projectId: string; sessionId: string }) {
  const { colors } = React.useContext(ThemeContext);
  const { 
    rightSidebarCollapsed, 
    rightSidebarWidth,
    rightSidebarTab,
    setRightSidebarWidth,
    setRightSidebarCollapsed,
    setRightSidebarTab,
  } = useUIStore();
  const handleFileSelect = useCallback((file: FileEntry) => {
    log.debug('File selected:', file.path);
    // Single-click on a file opens it in the editor tab
    if (!file.isDirectory) {
      useUIStore.getState().openFileTab(file.path);
    }
  }, []);

  const handleFileOpen = useCallback((file: FileEntry) => {
    log.debug('File opened:', file.path);
    // Open the file in a new middle panel tab
    useUIStore.getState().openFileTab(file.path);
  }, []);

  const pluginPanels = usePluginSidebarPanels();

  if (rightSidebarCollapsed) {
    return null;
  }

  // Define available tabs — terminal is available for all project types
  const tabs: TabConfig[] = [
    { id: 'files', label: 'Files' },
    { id: 'todos', label: 'Todos' },
    { id: 'subagents', label: 'Tasks' },
    { id: 'activity', label: 'Activity' },
    { id: 'terminal', label: 'Terminal' },
    // Append plugin-contributed sidebar panels
    ...pluginPanels.map((panel) => ({
      id: panel.id as RightSidebarTab,
      label: panel.label,
    })),
  ];

  const visibleTabs = tabs.filter((t) => t.condition !== false);
  const activeTab = visibleTabs.find((t) => t.id === rightSidebarTab) ? rightSidebarTab : 'files';

  return (
    <ResizablePanel
      width={rightSidebarWidth}
      minWidth={RIGHT_SIDEBAR_MIN_WIDTH}
      collapseThreshold={RIGHT_SIDEBAR_COLLAPSE_THRESHOLD}
      collapsed={rightSidebarCollapsed}
      handleSide="left"
      onWidthChange={setRightSidebarWidth}
      onCollapsedChange={setRightSidebarCollapsed}
      style={[styles.rightSidebar, { backgroundColor: colors.bg.secondary }]}
      testID="openmgr-right-sidebar"
    >
      {/* Header with tabs */}
      <View style={[styles.rightSidebarHeader, { borderBottomColor: colors.border.light }]}>
        {visibleTabs.map((tab) => (
          <Pressable key={tab.id} onPress={() => setRightSidebarTab(tab.id)} style={styles.tabButton} testID={`openmgr-right-sidebar-tab-${tab.id}`}>
            <Text style={[
              styles.rightSidebarTitle,
              { color: activeTab === tab.id ? colors.text.primary : colors.text.muted },
            ]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* Content */}
      <View style={styles.rightSidebarContent}>
        {activeTab === 'files' && window.agentBridge && (
          <FileBrowser
            bridge={window.agentBridge}
            projectId={projectId}
            onFileSelect={handleFileSelect}
            onFileOpen={handleFileOpen}
          />
        )}
        {activeTab === 'todos' && (
          <TodosPanel sessionId={sessionId} />
        )}
        {activeTab === 'subagents' && (
          <SubagentsPanel
            sessionId={sessionId}
            onSubagentSelect={(subagent) => {
              useUIStore.getState().openSubagentTab(subagent.sessionId, subagent.description);
            }}
          />
        )}
        {activeTab === 'activity' && (
          <ActivityPanel sessionId={sessionId} />
        )}
        {activeTab === 'terminal' && window.agentBridge && (
          <RemoteTerminal
            bridge={window.agentBridge}
            projectId={projectId}
          />
        )}
        {/* Plugin-contributed sidebar panels */}
        {!['files', 'todos', 'subagents', 'activity', 'terminal'].includes(activeTab) && (() => {
          const pluginPanel = pluginPanels.find((p) => p.id === activeTab);
          if (!pluginPanel || !window.agentBridge) return null;
          const PluginComponent = pluginPanel.component;
          return (
            <ErrorBoundary key={pluginPanel.id} onError={(error) => log.error(`Plugin sidebar panel "${pluginPanel.id}" error:`, error)}>
              <PluginComponent
                bridge={window.agentBridge}
                projectId={projectId}
                sessionId={sessionId}
                pluginName={pluginPanel.pluginName}
              />
            </ErrorBoundary>
          );
        })()}
      </View>
    </ResizablePanel>
  );
}

const styles = StyleSheet.create({
  rightSidebar: {
    borderLeftWidth: 1,
  },
  rightSidebarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 12,
    flexWrap: 'wrap',
  },
  tabButton: {
    paddingVertical: 2,
  },
  rightSidebarTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  rightSidebarContent: {
    flex: 1,
  },
});
