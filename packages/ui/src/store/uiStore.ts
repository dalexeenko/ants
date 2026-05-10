import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '../styles/utils';
import type { RemoteServerConfig } from '../agent/types';
import { getPersistStorage } from './persistStorage';

export type View = 'home' | 'chat' | 'settings' | 'projectSettings' | 'serverSettings';

// Built-in types preserved for autocomplete; union with (string & {}) allows plugin-contributed values
export type BuiltinRightSidebarTab = 'files' | 'todos' | 'subagents' | 'activity' | 'terminal';
export type RightSidebarTab = BuiltinRightSidebarTab | (string & {});

export type BuiltinActiveScreen = 'project' | 'director' | 'agents' | 'settings';
export type ActiveScreen = BuiltinActiveScreen | (string & {});

export interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  /** Show a loading spinner instead of close button */
  loading?: boolean;
}

export interface RecentSession {
  projectId: string;
  sessionId: string;
  title: string;
  accessedAt: number;
}

// Middle panel tab types
export type BuiltinMiddleTabType = 'chat' | 'file-editor' | 'subagent' | 'terminal' | 'browser';
export type MiddleTabType = BuiltinMiddleTabType | (string & {});

export interface MiddleTab {
  id: string;
  type: MiddleTabType;
  label: string;
  /** Whether this tab can be closed (main chat tab is pinned) */
  closable: boolean;
  /** Data specific to the tab type. Plugin tabs use arbitrary keys. */
  data?: Record<string, unknown>;
}

// Constants for sidebar sizing
export const LEFT_SIDEBAR_MIN_WIDTH = 120;
export const LEFT_SIDEBAR_DEFAULT_WIDTH = 280;
export const LEFT_SIDEBAR_COLLAPSE_THRESHOLD = 90;
export const RIGHT_SIDEBAR_MIN_WIDTH = 120;
export const RIGHT_SIDEBAR_DEFAULT_WIDTH = 320;
export const RIGHT_SIDEBAR_COLLAPSE_THRESHOLD = 90;

interface UIState {
  // Current view
  view: View;
  
  // Active screen (for icon rail navigation)
  activeScreen: ActiveScreen;

  // Sidebar state
  leftSidebarCollapsed: boolean;
  leftSidebarWidth: number;
  rightSidebarCollapsed: boolean;
  rightSidebarWidth: number;
  rightSidebarTab: RightSidebarTab;

  // Collapsed project sections (Set doesn't persist well, use array)
  collapsedProjects: string[];

  // Recent sessions
  recentSessions: RecentSession[];

  // Theme
  themeMode: 'light' | 'dark' | 'system';

  // Toast notifications
  toasts: Toast[];

  // Selected server (for server settings navigation)
  selectedServer: RemoteServerConfig | null;

  // Remote servers that couldn't be reached during the last sync (transient, not persisted)
  unreachableServers: RemoteServerConfig[];

  // Middle panel tabs
  middleTabs: MiddleTab[];
  activeMiddleTabId: string;

  // Session-scoped tab storage: saves/restores tabs when switching sessions
  tabsBySession: Record<string, { tabs: MiddleTab[]; activeTabId: string }>;
  currentTabSessionId: string | null;

  // Actions
  setView: (view: View) => void;
  setActiveScreen: (screen: ActiveScreen) => void;
  toggleLeftSidebar: () => void;
  setLeftSidebarWidth: (width: number) => void;
  setLeftSidebarCollapsed: (collapsed: boolean) => void;
  toggleRightSidebar: () => void;
  setRightSidebarWidth: (width: number) => void;
  setRightSidebarCollapsed: (collapsed: boolean) => void;
  setRightSidebarTab: (tab: RightSidebarTab) => void;
  toggleProjectCollapsed: (projectId: string) => void;
  isProjectCollapsed: (projectId: string) => boolean;
  recordRecentSession: (session: Omit<RecentSession, 'accessedAt'>) => void;
  setThemeMode: (mode: 'light' | 'dark' | 'system') => void;
  setSelectedServer: (server: RemoteServerConfig | null) => void;
  setUnreachableServers: (servers: RemoteServerConfig[]) => void;
  addToast: (toast: Omit<Toast, 'id'> & { id?: string }) => string;
  updateToast: (id: string, updates: Partial<Omit<Toast, 'id'>>) => void;
  removeToast: (id: string) => void;

  // Middle panel tab actions
  addMiddleTab: (tab: Omit<MiddleTab, 'id'> & { id?: string }) => string;
  removeMiddleTab: (tabId: string) => void;
  setActiveMiddleTab: (tabId: string) => void;
  reorderMiddleTabs: (fromIndex: number, toIndex: number) => void;
  openFileTab: (filePath: string) => void;
  openSubagentTab: (subagentSessionId: string, description: string, focus?: boolean) => void;
  openTerminalTab: (terminalSessionId?: string) => void;
  openBrowserTab: (browserId: string, url?: string, focus?: boolean) => void;
  closeBrowserTab: (browserId: string) => void;
  /** Open a plugin-contributed tab by type. If a tab with the same id already exists, focus it. */
  openPluginTab: (type: string, label: string, data?: Record<string, unknown>, id?: string) => string;
  /** Save current tabs for the current session and load tabs for the given session. */
  switchTabSession: (sessionId: string) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      view: 'home',
      activeScreen: 'project',
      leftSidebarCollapsed: false,
      leftSidebarWidth: LEFT_SIDEBAR_DEFAULT_WIDTH,
      rightSidebarCollapsed: true,
      rightSidebarWidth: RIGHT_SIDEBAR_DEFAULT_WIDTH,
      rightSidebarTab: 'files',
      collapsedProjects: [],
      recentSessions: [],
      themeMode: 'system',
      toasts: [],
      selectedServer: null,
      unreachableServers: [],
      middleTabs: [{ id: 'main-chat', type: 'chat', label: 'Chat', closable: false }],
      activeMiddleTabId: 'main-chat',
      tabsBySession: {},
      currentTabSessionId: null,

      setView: (view) => set({ view }),
      
      setActiveScreen: (screen) => set({ activeScreen: screen }),

      toggleLeftSidebar: () =>
        set((state) => ({
          leftSidebarCollapsed: !state.leftSidebarCollapsed,
        })),

      setLeftSidebarWidth: (width) => set({ leftSidebarWidth: width }),
      
      setLeftSidebarCollapsed: (collapsed) => set({ leftSidebarCollapsed: collapsed }),

      toggleRightSidebar: () =>
        set((state) => ({
          rightSidebarCollapsed: !state.rightSidebarCollapsed,
        })),

      setRightSidebarWidth: (width) => set({ rightSidebarWidth: width }),
      
      setRightSidebarCollapsed: (collapsed) => set({ rightSidebarCollapsed: collapsed }),

      setRightSidebarTab: (tab) => set({ rightSidebarTab: tab }),

      toggleProjectCollapsed: (projectId) =>
        set((state) => {
          const isCollapsed = state.collapsedProjects.includes(projectId);
          return {
            collapsedProjects: isCollapsed
              ? state.collapsedProjects.filter((id) => id !== projectId)
              : [...state.collapsedProjects, projectId],
          };
        }),

      isProjectCollapsed: (projectId) => {
        return get().collapsedProjects.includes(projectId);
      },

      recordRecentSession: (session) =>
        set((state) => {
          // Remove existing entry for this session
          const filtered = state.recentSessions.filter(
            (s) =>
              !(
                s.projectId === session.projectId &&
                s.sessionId === session.sessionId
              )
          );
          // Add to front with timestamp
          return {
            recentSessions: [
              { ...session, accessedAt: Date.now() },
              ...filtered,
            ].slice(0, 10), // Keep only 10 most recent
          };
        }),

      setThemeMode: (mode) => set({ themeMode: mode }),

      setSelectedServer: (server) => set({ selectedServer: server }),
      setUnreachableServers: (servers) => set({ unreachableServers: servers }),

      addToast: (toast) => {
        const id = toast.id || generateId();
        set((state) => {
          // If a toast with this ID already exists, update it instead
          const existingIndex = state.toasts.findIndex((t) => t.id === id);
          if (existingIndex >= 0) {
            const updatedToasts = [...state.toasts];
            updatedToasts[existingIndex] = { ...updatedToasts[existingIndex], ...toast, id };
            return { toasts: updatedToasts };
          }
          return { toasts: [...state.toasts, { ...toast, id }] };
        });
        // Auto-remove after 5 seconds (only for toasts without custom ID)
        if (!toast.id) {
          setTimeout(() => {
            get().removeToast(id);
          }, 5000);
        }
        return id;
      },

      updateToast: (id, updates) =>
        set((state) => ({
          toasts: state.toasts.map((t) =>
            t.id === id ? { ...t, ...updates } : t
          ),
        })),

      removeToast: (id) =>
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        })),

      addMiddleTab: (tab) => {
        const id = tab.id || generateId();
        set((state) => {
          // Don't add duplicates
          if (state.middleTabs.some((t) => t.id === id)) {
            return { activeMiddleTabId: id };
          }
          return {
            middleTabs: [...state.middleTabs, { ...tab, id }],
            activeMiddleTabId: id,
          };
        });
        return id;
      },

      removeMiddleTab: (tabId) =>
        set((state) => {
          const tab = state.middleTabs.find((t) => t.id === tabId);
          if (!tab || !tab.closable) return state;
          const remaining = state.middleTabs.filter((t) => t.id !== tabId);
          const activeId = state.activeMiddleTabId === tabId
            ? (remaining[remaining.length - 1]?.id || 'main-chat')
            : state.activeMiddleTabId;
          return { middleTabs: remaining, activeMiddleTabId: activeId };
        }),

      setActiveMiddleTab: (tabId) => set({ activeMiddleTabId: tabId }),

      reorderMiddleTabs: (fromIndex, toIndex) =>
        set((state) => {
          // Don't allow moving the main chat tab (index 0)
          if (fromIndex === 0 || toIndex === 0) return state;
          const tabs = [...state.middleTabs];
          const [moved] = tabs.splice(fromIndex, 1);
          tabs.splice(toIndex, 0, moved);
          return { middleTabs: tabs };
        }),

      openFileTab: (filePath) => {
        const existingId = `file:${filePath}`;
        const state = get();
        const existing = state.middleTabs.find((t) => t.id === existingId);
        if (existing) {
          set({ activeMiddleTabId: existingId });
          return;
        }
        const fileName = filePath.split('/').pop() || filePath;
        set((s) => ({
          middleTabs: [...s.middleTabs, {
            id: existingId,
            type: 'file-editor' as const,
            label: fileName,
            closable: true,
            data: { filePath },
          }],
          activeMiddleTabId: existingId,
        }));
      },

      openSubagentTab: (subagentSessionId, description, focus = true) => {
        const existingId = `subagent:${subagentSessionId}`;
        const state = get();
        const existing = state.middleTabs.find((t) => t.id === existingId);
        if (existing) {
          if (focus) {
            set({ activeMiddleTabId: existingId });
          }
          return;
        }
        const label = description.length > 20 ? description.slice(0, 17) + '...' : description;
        set((s) => ({
          middleTabs: [...s.middleTabs, {
            id: existingId,
            type: 'subagent' as const,
            label,
            closable: true,
            data: { subagentSessionId },
          }],
          // Only switch focus if requested
          ...(focus ? { activeMiddleTabId: existingId } : {}),
        }));
      },

      openTerminalTab: (terminalSessionId) => {
        const sessionId = terminalSessionId || generateId();
        const existingId = `terminal:${sessionId}`;
        const state = get();
        const existing = state.middleTabs.find((t) => t.id === existingId);
        if (existing) {
          set({ activeMiddleTabId: existingId });
          return;
        }
        // Count existing terminal tabs for labeling
        const terminalCount = state.middleTabs.filter((t) => t.type === 'terminal').length;
        const label = terminalCount === 0 ? 'Terminal' : `Terminal ${terminalCount + 1}`;
        set((s) => ({
          middleTabs: [...s.middleTabs, {
            id: existingId,
            type: 'terminal' as const,
            label,
            closable: true,
            data: { terminalSessionId: sessionId },
          }],
          activeMiddleTabId: existingId,
        }));
      },

      openBrowserTab: (browserId, url, focus = true) => {
        const existingId = `browser:${browserId}`;
        const state = get();
        const existing = state.middleTabs.find((t) => t.id === existingId);
        if (existing) {
          if (focus) {
            set({ activeMiddleTabId: existingId });
          }
          return;
        }
        // Label shows the hostname if available, otherwise "Browser"
        let label = 'Browser';
        if (url) {
          try {
            label = new URL(url).hostname || 'Browser';
          } catch {
            label = 'Browser';
          }
        }
        set((s) => ({
          middleTabs: [...s.middleTabs, {
            id: existingId,
            type: 'browser' as const,
            label,
            closable: true,
            data: { browserId, browserUrl: url },
          }],
          ...(focus ? { activeMiddleTabId: existingId } : {}),
        }));
      },

      closeBrowserTab: (browserId) => {
        const tabId = `browser:${browserId}`;
        const state = get();
        const tab = state.middleTabs.find((t) => t.id === tabId);
        if (!tab) return;
        const remaining = state.middleTabs.filter((t) => t.id !== tabId);
        const activeId = state.activeMiddleTabId === tabId
          ? (remaining[remaining.length - 1]?.id || 'main-chat')
          : state.activeMiddleTabId;
        set({ middleTabs: remaining, activeMiddleTabId: activeId });
      },

      openPluginTab: (type, label, data, id) => {
        const tabId = id || `plugin:${type}:${generateId()}`;
        const state = get();
        const existing = state.middleTabs.find((t) => t.id === tabId);
        if (existing) {
          set({ activeMiddleTabId: tabId });
          return tabId;
        }
        set((s) => ({
          middleTabs: [...s.middleTabs, {
            id: tabId,
            type,
            label,
            closable: true,
            data,
          }],
          activeMiddleTabId: tabId,
        }));
        return tabId;
      },

      switchTabSession: (sessionId) => {
        const state = get();
        const defaultTabs = [{ id: 'main-chat', type: 'chat' as const, label: 'Chat', closable: false }];

        // Save current session's tabs (if we have a current session)
        const updatedTabsBySession = { ...state.tabsBySession };
        if (state.currentTabSessionId) {
          updatedTabsBySession[state.currentTabSessionId] = {
            tabs: state.middleTabs,
            activeTabId: state.activeMiddleTabId,
          };
        }

        // Load the target session's tabs (or defaults)
        const savedState = updatedTabsBySession[sessionId];
        const newTabs = savedState ? savedState.tabs : defaultTabs;
        const newActiveTabId = savedState ? savedState.activeTabId : 'main-chat';

        set({
          tabsBySession: updatedTabsBySession,
          currentTabSessionId: sessionId,
          middleTabs: newTabs,
          activeMiddleTabId: newActiveTabId,
        });
      },
    }),
    {
      name: 'openmgr-ui-store',
      version: 4, // Bump for session-scoped tab state
      storage: getPersistStorage(),
      partialize: (state) => ({
        activeScreen: state.activeScreen,
        leftSidebarCollapsed: state.leftSidebarCollapsed,
        leftSidebarWidth: state.leftSidebarWidth,
        rightSidebarCollapsed: state.rightSidebarCollapsed,
        rightSidebarWidth: state.rightSidebarWidth,
        rightSidebarTab: state.rightSidebarTab,
        collapsedProjects: state.collapsedProjects,
        recentSessions: state.recentSessions,
        themeMode: state.themeMode,
        middleTabs: state.middleTabs,
        activeMiddleTabId: state.activeMiddleTabId,
        tabsBySession: state.tabsBySession,
        currentTabSessionId: state.currentTabSessionId,
      }),
    }
  )
);

// Selectors
export const selectToasts = (state: UIState) => state.toasts;
export const selectThemeMode = (state: UIState) => state.themeMode;
export const selectRecentSessions = (state: UIState) => state.recentSessions;
