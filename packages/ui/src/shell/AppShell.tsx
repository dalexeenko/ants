import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  ThemeContext,
  resolveTheme,
  useUIStore,
  useProjectStore,
  useSessionStore,
  Text,
  Modal,
  ErrorBoundary,
  KeyboardShortcutsHelp,
  ConfirmDialog,
  ServerSettings,
  GlobalSearch,
  AgentsPanel,
  MiddleTabBar,
  FileEditorTab,
  RemoteTerminal,
  BrowserStreamView,
  DirectorSidebar,
  DirectorChatView,
  SubagentChatView,
  type Theme,
  type SearchResult,
  createLogger,
} from '../index';
import {
  UIPluginRegistry,
  UIPluginProvider,
  usePluginMiddleTabs,
  usePluginScreens,
  cloudflareAccessAuthProvider,
} from '../plugins';
import { usePlatform } from '../platform/PlatformContext';

const log = createLogger('AppShell');

import {
  IconRail,
} from './IconRail';
import {
  ProjectSidebar,
} from './ProjectSidebar';
import {
  ChatView,
} from './ChatView';
import {
  RightSidebar,
} from './RightSidebar';
import {
  SettingsPanel,
} from './SettingsPanel';
import {
  ProjectSettingsPanel,
} from './ProjectSettingsPanel';
import {
  WelcomeScreen,
} from './WelcomeScreen';
import { Spinner } from '../primitives/Spinner';
import {
  ToastContainer,
} from './ToastContainer';
import { UpdateBanner } from './UpdateBanner';
import {
  BrowserEmbedView,
} from './BrowserEmbedView';
import { useProjectEvents } from './useProjectEvents';
import { useShortcuts } from './useShortcuts';
import { useDirectorEvents } from './useDirectorEvents';

// ============ Helpers ============

/**
 * Build the WebSocket URL for browser screencast streaming.
 * Uses the session store's current session and the bridge's base URL.
 */
function buildBrowserWsUrl(projectId: string, browserId: string): string {
  const sessionId = useSessionStore.getState().currentSessionId || 'default';
  const bridge = window.agentBridge;

  // If connected to a remote server, use its WebSocket proxy URL
  if (bridge && 'baseUrl' in bridge) {
    const baseUrl = (bridge as any).baseUrl as string;
    // Convert http(s):// to ws(s):// and append the screencast path
    const wsBase = baseUrl.replace(/^http/, 'ws');
    const token = (bridge as any).token || (bridge as any).secret || '';
    return `${wsBase}/api/beta/projects/${projectId}/sessions/${sessionId}/browser/${browserId}/screencast?token=${encodeURIComponent(token)}`;
  }

  // For local desktop, the agent-server runs on localhost.
  // The port is stored in the project config from the bridge.
  const project = useProjectStore.getState().projects.find((p) => p.id === projectId);
  const port = (project as any)?.serverPort;
  if (port) {
    return `ws://127.0.0.1:${port}/session/${sessionId}/browser/${browserId}/screencast`;
  }

  // Fallback: won't connect but won't crash
  return `ws://127.0.0.1:3000/session/${sessionId}/browser/${browserId}/screencast`;
}

// ============ Middle Tab Content ============

function MiddleTabContent({ projectId }: { projectId: string }) {
  const platform = usePlatform();
  const middleTabs = useUIStore((state) => state.middleTabs);
  const activeMiddleTabId = useUIStore((state) => state.activeMiddleTabId);
  const activeTab = middleTabs.find((t) => t.id === activeMiddleTabId);
  const rightSidebarCollapsed = useUIStore((state) => state.rightSidebarCollapsed);
  const toggleRightSidebar = useUIStore((state) => state.toggleRightSidebar);
  const [showSessionSettings, setShowSessionSettings] = useState(false);
  const pluginTabs = usePluginMiddleTabs();

  // Hide all browser WebContentsViews when switching to a non-browser tab
  useEffect(() => {
    if (!platform.browserView) return;
    if (!activeTab || activeTab.type !== 'browser') {
      platform.browserView.hideAll();
    }
  }, [activeTab?.id, activeTab?.type, platform.browserView]);

  return (
    <View style={{ flex: 1 }}>
      <MiddleTabBar
        onSettingsPress={() => setShowSessionSettings((v) => !v)}
        settingsActive={showSessionSettings}
        onSidebarToggle={toggleRightSidebar}
        sidebarCollapsed={rightSidebarCollapsed}
      />
      {/* ChatView is always mounted to preserve SSE connections across tab switches */}
      <View style={{ flex: 1, display: (!activeTab || activeTab.type === 'chat') ? 'flex' : 'none' }}>
        <ChatView projectId={projectId} showSessionSettings={showSessionSettings} />
      </View>
      {activeTab?.type === 'file-editor' && activeTab.data?.filePath && window.agentBridge ? (
        <FileEditorTab
          filePath={activeTab.data.filePath as string}
          projectId={projectId}
          bridge={window.agentBridge}
        />
      ) : null}
      {activeTab?.type === 'subagent' && activeTab.data?.subagentSessionId && window.agentBridge ? (
        <SubagentChatView
          bridge={window.agentBridge}
          projectId={projectId}
          subagentSessionId={activeTab.data.subagentSessionId as string}
        />
      ) : null}
      {activeTab?.type === 'terminal' && window.agentBridge ? (
        <RemoteTerminal
          bridge={window.agentBridge}
          projectId={projectId}
        />
      ) : null}
      {activeTab?.type === 'browser' && activeTab.data?.browserId ? (
        ((): React.ReactNode => {
          // Use native embedded WebContentsView for local projects,
          // fall back to screencast streaming for remote projects
          const browserId = activeTab.data!.browserId as string;
          const project = useProjectStore.getState().projects.find((p) => p.id === projectId);
          const isLocal = !project?.providerType || project.providerType === 'local';
          if (isLocal && platform.browserView) {
            return (
              <BrowserEmbedView
                browserId={browserId}
                isActive={activeTab.id === activeMiddleTabId}
              />
            );
          }
          return (
            <BrowserStreamView
              wsUrl={buildBrowserWsUrl(projectId, browserId)}
              browserId={browserId}
              onDisconnect={() => {
                useUIStore.getState().closeBrowserTab(browserId);
              }}
            />
          );
        })()
      ) : null}
      {/* Plugin-contributed tab fallback */}
      {activeTab && !['chat', 'file-editor', 'subagent', 'terminal', 'browser'].includes(activeTab.type) ? ((): React.ReactNode => {
        const pluginTab = pluginTabs.find((t) => t.type === activeTab.type);
        if (!pluginTab || !window.agentBridge) return null;
        const PluginComponent = pluginTab.component;
        return (
          <ErrorBoundary key={activeTab.id} onError={(error) => log.error(`Plugin tab "${activeTab.type}" error:`, error)}>
            <PluginComponent
              bridge={window.agentBridge}
              projectId={projectId}
              pluginName={pluginTab.pluginName}
              tabId={activeTab.id}
              tabData={activeTab.data}
            />
          </ErrorBoundary>
        );
      })() : null}
    </View>
  );
}

// ============ Plugin Screen Fallback ============

function PluginScreenFallback({ activeScreen }: { activeScreen: string }) {
  const pluginScreens = usePluginScreens();
  const screen = pluginScreens.find((s) => s.id === activeScreen);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);

  if (!screen || !window.agentBridge || !currentProjectId) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text color="muted">Unknown screen: {activeScreen}</Text>
      </View>
    );
  }

  const PluginComponent = screen.component;
  return (
    <ErrorBoundary onError={(error) => log.error(`Plugin screen "${activeScreen}" error:`, error)}>
      <PluginComponent
        bridge={window.agentBridge}
        projectId={currentProjectId}
        pluginName={screen.pluginName}
      />
    </ErrorBoundary>
  );
}

// ============ Main AppShell ============

// Singleton registry — created once, plugins register at runtime
const globalUIPluginRegistry = new UIPluginRegistry();

// Register built-in plugins
globalUIPluginRegistry.registerAuthProvider(cloudflareAccessAuthProvider);

// Expose on window for plugins to register themselves
if (typeof window !== 'undefined') {
  (window as any).__uiPluginRegistry = globalUIPluginRegistry;
}

export interface AppShellProps {
  registry?: UIPluginRegistry;
}

export function AppShell({ registry }: AppShellProps) {
  const platform = usePlatform();
  const effectiveRegistry = registry || globalUIPluginRegistry;

  const themeMode = useUIStore((state) => state.themeMode);
  const view = useUIStore((state) => state.view);
  const activeScreen = useUIStore((state) => state.activeScreen);
  const leftSidebarCollapsed = useUIStore((state) => state.leftSidebarCollapsed);
  const selectedServer = useUIStore((state) => state.selectedServer);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const isInitialized = useProjectStore((state) => state.isInitialized);
  const currentSessionId = useSessionStore((state) => state.currentSessionId);
  const [theme, setTheme] = useState<Theme>(resolveTheme(themeMode));

  // Custom hooks for cross-cutting concerns
  const {
    showKeyboardShortcuts,
    setShowKeyboardShortcuts,
    pendingServerConnect,
    confirmServerConnect,
    cancelServerConnect,
    deeplinkLoading,
  } = useShortcuts();
  useProjectEvents(currentProjectId);
  useDirectorEvents();

  // Load persisted projects on startup, sync remote servers and their projects/sessions
  useEffect(() => {
    if (!window.agentBridge) return;

    const init = async () => {
      const bridge = window.agentBridge!;
      const store = useProjectStore.getState();

      // 1. Load local projects (also lazily loads remote servers from DB)
      let projects = await bridge.listProjects();

      // Auto-select the first project before marking initialized, so the UI
      // transitions directly from spinner → project view without flashing the
      // welcome screen for users who already have projects.
      if (projects.length > 0 && !store.currentProjectId) {
        store.setCurrentProject(projects[0]!.id);
      }
      store.setProjects(projects);
      store.setInitialized(true);

      // 2. Sync remote projects from all configured remote servers
      try {
        const syncResult = await bridge.syncRemoteProjects();
        useUIStore.getState().setUnreachableServers(syncResult.unreachableServers);
        projects = await bridge.listProjects();
        store.setProjects(projects);
      } catch (e) {
        log.error('Failed to sync remote projects:', e);
      }

      // 3. Sync sessions for all remote projects
      for (const project of projects) {
        if (project.providerType === 'remote') {
          try {
            await bridge.syncRemoteSessions(project.id);
            const sessions = await bridge.listSessions(project.id);
            useSessionStore.getState().setSessions(project.id, sessions);
          } catch (e) {
            log.error(`Failed to sync sessions for ${project.name}:`, e);
          }
        }
      }

      // 4. Re-select first project after remote sync if still none selected
      if (projects.length > 0 && !store.currentProjectId) {
        store.setCurrentProject(projects[0]!.id);
      }
    };

    init().catch((e) => {
      log.error('Failed to initialize:', e);
    });
  }, []);

  useEffect(() => {
    setTheme(resolveTheme(themeMode));
  }, [themeMode]);

  // Handle search result selection
  const handleSearchResultSelect = useCallback((result: SearchResult) => {
    useProjectStore.getState().setCurrentProject(result.projectId);
    useSessionStore.getState().setCurrentSession(result.session.id);
    useUIStore.getState().setView('home');
    useUIStore.getState().setActiveScreen('project');
  }, []);

  const isDesktop = platform.platform === 'desktop';

  return (
    <ErrorBoundary
      onError={(error, errorInfo) => {
        log.error('App error:', error, errorInfo);
      }}
      onReset={() => {
        window.location.reload();
      }}
    >
      <UIPluginProvider registry={effectiveRegistry}>
      <ThemeContext.Provider value={theme}>
        <View testID="ants-app" style={[styles.container, { backgroundColor: theme.colors.bg.primary }]}>
          {/* Title bar with search */}
          <View 
            style={[
              styles.titleBar, 
              { backgroundColor: theme.colors.bg.secondary, borderBottomColor: theme.colors.border.light }
            ]} 
            {...(isDesktop ? { className: 'titlebar-drag-region' } : {})}
          >
            <View style={isDesktop ? styles.titleBarLeftDesktop : styles.titleBarLeft} />
            <View style={styles.titleBarCenter} {...(isDesktop ? { className: 'titlebar-no-drag' } : {})}>
              {window.agentBridge && (
                <GlobalSearch
                  bridge={window.agentBridge}
                  onSelectResult={handleSearchResultSelect}
                  placeholder="Search sessions..."
                />
              )}
            </View>
            <View style={isDesktop ? styles.titleBarRightDesktop : styles.titleBarRight} />
          </View>

          {/* Update banner (desktop auto-updater) */}
          <UpdateBanner />

          {/* Main layout */}
          <View style={styles.layout}>
            {/* Icon rail - always visible */}
            <IconRail />

            {/* Left sidebar - project, director, or settings specific */}
            {activeScreen === 'project' && <ProjectSidebar />}
            {activeScreen === 'director' && !leftSidebarCollapsed && window.agentBridge && (
              <DirectorSidebar bridge={window.agentBridge} />
            )}


            {/* Main content */}
            <View testID="ants-main-content" style={styles.mainContent}>
              {activeScreen === 'director' && window.agentBridge ? (
                <DirectorChatView bridge={window.agentBridge} />
              ) : activeScreen === 'agents' && window.agentBridge ? (
                <AgentsPanel bridge={window.agentBridge} />
              ) : activeScreen === 'settings' ? (
                <SettingsPanel />
              ) : !['project', 'director', 'agents', 'settings'].includes(activeScreen) && window.agentBridge ? (
                <PluginScreenFallback activeScreen={activeScreen} />
              ) : view === 'serverSettings' && selectedServer && window.agentBridge ? (
                <ServerSettings
                  bridge={window.agentBridge}
                  server={selectedServer}
                  onNavigateBack={() => useUIStore.getState().setView('home')}
                />
              ) : view === 'projectSettings' && currentProjectId ? (
                <ProjectSettingsPanel projectId={currentProjectId} />
              ) : currentProjectId ? (
                <MiddleTabContent projectId={currentProjectId} />
              ) : !isInitialized ? (
                <View style={styles.loadingContainer}>
                  <Spinner size="large" />
                </View>
              ) : (
                <WelcomeScreen />
              )}
            </View>

            {/* Right sidebar - Only visible when session is open */}
            {activeScreen === 'project' && currentProjectId && currentSessionId && (
              <RightSidebar projectId={currentProjectId} sessionId={currentSessionId} />
            )}
          </View>

          {/* Toast notifications */}
          <ToastContainer />

          {/* Keyboard Shortcuts Help Modal */}
          <KeyboardShortcutsHelp
            visible={showKeyboardShortcuts}
            onClose={() => setShowKeyboardShortcuts(false)}
          />

          {/* Deeplink Loading Modal */}
          <Modal visible={!!deeplinkLoading} title="Connecting">
            <View style={styles.deeplinkLoading}>
              <Spinner size="large" />
              <Text style={[styles.deeplinkLoadingText, { color: theme.colors.text.secondary }]}>
                {deeplinkLoading?.message || 'Please wait...'}
              </Text>
            </View>
          </Modal>

          {/* Server Connect Confirmation Dialog */}
          <ConfirmDialog
            visible={!!pendingServerConnect}
            title="Add Server"
            message={pendingServerConnect
              ? `Connect to "${pendingServerConnect.serverName}" at ${pendingServerConnect.url}?`
              : ''}
            confirmText="Connect"
            cancelText="Cancel"
            onConfirm={confirmServerConnect}
            onCancel={cancelServerConnect}
          />
        </View>
      </ThemeContext.Provider>
      </UIPluginProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  titleBar: {
    height: 38,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    zIndex: 100,
  },
  titleBarLeft: {
    width: 12,
  },
  titleBarLeftDesktop: {
    width: 70, // Space for macOS traffic lights
  },
  titleBarCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBarRight: {
    width: 12,
  },
  titleBarRightDesktop: {
    width: 70,
  },
  layout: {
    flex: 1,
    flexDirection: 'row',
  },
  mainContent: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deeplinkLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    gap: 16,
  },
  deeplinkLoadingText: {
    fontSize: 14,
    lineHeight: 20,
  },
});
