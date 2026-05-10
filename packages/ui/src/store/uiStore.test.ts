import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from './uiStore';

describe('useUIStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useUIStore.setState({
      view: 'home',
      activeScreen: 'project',
      toasts: [],
      themeMode: 'system',
      leftSidebarCollapsed: false,
      leftSidebarWidth: 280,
      rightSidebarCollapsed: true,
      rightSidebarWidth: 320,
      rightSidebarTab: 'files',
      recentSessions: [],
    });
  });

  describe('view management', () => {
    it('should set the view', () => {
      useUIStore.getState().setView('settings');
      expect(useUIStore.getState().view).toBe('settings');
    });

    it('should set the active screen', () => {
      useUIStore.getState().setActiveScreen('settings');
      expect(useUIStore.getState().activeScreen).toBe('settings');
    });
  });

  describe('toast management', () => {
    it('should add a toast', () => {
      const id = useUIStore.getState().addToast({
        message: 'Test toast',
        type: 'info',
      });

      const toasts = useUIStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].message).toBe('Test toast');
      expect(toasts[0].type).toBe('info');
      expect(toasts[0].id).toBe(id);
    });

    it('should add a toast with custom id', () => {
      useUIStore.getState().addToast({
        id: 'custom-id',
        message: 'Custom toast',
        type: 'success',
      });

      const toasts = useUIStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].id).toBe('custom-id');
    });

    it('should update an existing toast by id', () => {
      useUIStore.getState().addToast({
        id: 'update-test',
        message: 'Original message',
        type: 'info',
      });

      useUIStore.getState().updateToast('update-test', {
        message: 'Updated message',
      });

      const toast = useUIStore.getState().toasts.find((t) => t.id === 'update-test');
      expect(toast?.message).toBe('Updated message');
    });

    it('should remove a toast', () => {
      const id = useUIStore.getState().addToast({
        message: 'To be removed',
        type: 'warning',
      });

      useUIStore.getState().removeToast(id);
      expect(useUIStore.getState().toasts).toHaveLength(0);
    });
  });

  describe('sidebar management', () => {
    it('should toggle left sidebar', () => {
      expect(useUIStore.getState().leftSidebarCollapsed).toBe(false);
      useUIStore.getState().toggleLeftSidebar();
      expect(useUIStore.getState().leftSidebarCollapsed).toBe(true);
    });

    it('should set left sidebar width', () => {
      useUIStore.getState().setLeftSidebarWidth(350);
      expect(useUIStore.getState().leftSidebarWidth).toBe(350);
    });

    it('should toggle right sidebar', () => {
      expect(useUIStore.getState().rightSidebarCollapsed).toBe(true);
      useUIStore.getState().toggleRightSidebar();
      expect(useUIStore.getState().rightSidebarCollapsed).toBe(false);
    });
  });

  describe('theme management', () => {
    it('should set theme mode', () => {
      useUIStore.getState().setThemeMode('dark');
      expect(useUIStore.getState().themeMode).toBe('dark');
    });
  });

  describe('middle tab management', () => {
    beforeEach(() => {
      // Reset middle tabs to default state
      useUIStore.setState({
        middleTabs: [{ id: 'main-chat', type: 'chat', label: 'Chat', closable: false }],
        activeMiddleTabId: 'main-chat',
        tabsBySession: {},
        currentTabSessionId: null,
      });
    });

    describe('addMiddleTab', () => {
      it('should add a tab and make it active', () => {
        const id = useUIStore.getState().addMiddleTab({
          type: 'file-editor',
          label: 'test.ts',
          closable: true,
        });

        const state = useUIStore.getState();
        expect(state.middleTabs).toHaveLength(2);
        expect(state.activeMiddleTabId).toBe(id);
        expect(state.middleTabs[1].type).toBe('file-editor');
        expect(state.middleTabs[1].label).toBe('test.ts');
      });

      it('should not add duplicates, just activate existing', () => {
        useUIStore.getState().addMiddleTab({
          id: 'custom-tab',
          type: 'terminal',
          label: 'Terminal',
          closable: true,
        });

        // Try to add same id again
        useUIStore.getState().addMiddleTab({
          id: 'custom-tab',
          type: 'terminal',
          label: 'Terminal 2',
          closable: true,
        });

        const state = useUIStore.getState();
        expect(state.middleTabs).toHaveLength(2); // Not 3
        expect(state.activeMiddleTabId).toBe('custom-tab');
      });
    });

    describe('removeMiddleTab', () => {
      it('should remove a closable tab', () => {
        const id = useUIStore.getState().addMiddleTab({
          type: 'terminal',
          label: 'Terminal',
          closable: true,
        });

        useUIStore.getState().removeMiddleTab(id);
        expect(useUIStore.getState().middleTabs).toHaveLength(1);
        expect(useUIStore.getState().activeMiddleTabId).toBe('main-chat');
      });

      it('should not remove the main chat tab (not closable)', () => {
        useUIStore.getState().removeMiddleTab('main-chat');
        expect(useUIStore.getState().middleTabs).toHaveLength(1);
        expect(useUIStore.getState().middleTabs[0].id).toBe('main-chat');
      });

      it('should activate previous tab when active tab is removed', () => {
        useUIStore.getState().addMiddleTab({
          id: 'tab-a',
          type: 'terminal',
          label: 'A',
          closable: true,
        });
        useUIStore.getState().addMiddleTab({
          id: 'tab-b',
          type: 'terminal',
          label: 'B',
          closable: true,
        });

        // tab-b is active; remove it
        useUIStore.getState().removeMiddleTab('tab-b');
        expect(useUIStore.getState().activeMiddleTabId).toBe('tab-a');
      });
    });

    describe('setActiveMiddleTab', () => {
      it('should switch the active tab', () => {
        useUIStore.getState().addMiddleTab({
          id: 'tab-x',
          type: 'terminal',
          label: 'X',
          closable: true,
        });

        useUIStore.getState().setActiveMiddleTab('main-chat');
        expect(useUIStore.getState().activeMiddleTabId).toBe('main-chat');

        useUIStore.getState().setActiveMiddleTab('tab-x');
        expect(useUIStore.getState().activeMiddleTabId).toBe('tab-x');
      });
    });

    describe('reorderMiddleTabs', () => {
      it('should reorder non-chat tabs', () => {
        useUIStore.getState().addMiddleTab({
          id: 'tab-1',
          type: 'terminal',
          label: '1',
          closable: true,
        });
        useUIStore.getState().addMiddleTab({
          id: 'tab-2',
          type: 'file-editor',
          label: '2',
          closable: true,
        });

        // Move tab-2 (index 2) to position of tab-1 (index 1)
        useUIStore.getState().reorderMiddleTabs(2, 1);
        const tabs = useUIStore.getState().middleTabs;
        expect(tabs[1].id).toBe('tab-2');
        expect(tabs[2].id).toBe('tab-1');
      });

      it('should not allow moving the main chat tab', () => {
        useUIStore.getState().addMiddleTab({
          id: 'tab-1',
          type: 'terminal',
          label: '1',
          closable: true,
        });

        useUIStore.getState().reorderMiddleTabs(0, 1);
        expect(useUIStore.getState().middleTabs[0].id).toBe('main-chat');
      });
    });

    describe('openFileTab', () => {
      it('should open a file tab with correct id and label', () => {
        useUIStore.getState().openFileTab('/src/index.ts');

        const state = useUIStore.getState();
        expect(state.middleTabs).toHaveLength(2);
        expect(state.activeMiddleTabId).toBe('file:/src/index.ts');
        const tab = state.middleTabs[1];
        expect(tab.type).toBe('file-editor');
        expect(tab.label).toBe('index.ts');
        expect(tab.data?.filePath).toBe('/src/index.ts');
        expect(tab.closable).toBe(true);
      });

      it('should activate existing file tab instead of duplicating', () => {
        useUIStore.getState().openFileTab('/src/index.ts');
        useUIStore.getState().setActiveMiddleTab('main-chat');
        useUIStore.getState().openFileTab('/src/index.ts');

        expect(useUIStore.getState().middleTabs).toHaveLength(2); // Not 3
        expect(useUIStore.getState().activeMiddleTabId).toBe('file:/src/index.ts');
      });
    });

    describe('openSubagentTab', () => {
      it('should open a subagent tab', () => {
        useUIStore.getState().openSubagentTab('sub-123', 'Search codebase');

        const state = useUIStore.getState();
        expect(state.middleTabs).toHaveLength(2);
        expect(state.activeMiddleTabId).toBe('subagent:sub-123');
        const tab = state.middleTabs[1];
        expect(tab.type).toBe('subagent');
        expect(tab.label).toBe('Search codebase');
        expect(tab.data?.subagentSessionId).toBe('sub-123');
      });

      it('should truncate long descriptions', () => {
        useUIStore.getState().openSubagentTab('sub-456', 'A very long description that exceeds the maximum');

        const tab = useUIStore.getState().middleTabs[1];
        expect(tab.label).toBe('A very long descr...');
      });

      it('should not switch focus when focus=false', () => {
        useUIStore.getState().openSubagentTab('sub-789', 'Background task', false);

        expect(useUIStore.getState().activeMiddleTabId).toBe('main-chat');
        expect(useUIStore.getState().middleTabs).toHaveLength(2);
      });
    });

    describe('openTerminalTab', () => {
      it('should open a terminal tab', () => {
        useUIStore.getState().openTerminalTab('term-1');

        const state = useUIStore.getState();
        expect(state.middleTabs).toHaveLength(2);
        expect(state.activeMiddleTabId).toBe('terminal:term-1');
        const tab = state.middleTabs[1];
        expect(tab.type).toBe('terminal');
        expect(tab.label).toBe('Terminal');
        expect(tab.data?.terminalSessionId).toBe('term-1');
      });

      it('should number subsequent terminal tabs', () => {
        useUIStore.getState().openTerminalTab('term-1');
        useUIStore.getState().openTerminalTab('term-2');

        const tabs = useUIStore.getState().middleTabs;
        expect(tabs[1].label).toBe('Terminal');
        expect(tabs[2].label).toBe('Terminal 2');
      });

      it('should generate an id when none provided', () => {
        useUIStore.getState().openTerminalTab();

        const state = useUIStore.getState();
        expect(state.middleTabs).toHaveLength(2);
        expect(state.middleTabs[1].type).toBe('terminal');
        expect(state.middleTabs[1].data?.terminalSessionId).toBeTruthy();
      });
    });

    describe('openBrowserTab', () => {
      it('should open a browser tab with browserId', () => {
        useUIStore.getState().openBrowserTab('browser-abc');

        const state = useUIStore.getState();
        expect(state.middleTabs).toHaveLength(2);
        expect(state.activeMiddleTabId).toBe('browser:browser-abc');
        const tab = state.middleTabs[1];
        expect(tab.type).toBe('browser');
        expect(tab.label).toBe('Browser');
        expect(tab.data?.browserId).toBe('browser-abc');
        expect(tab.closable).toBe(true);
      });

      it('should use hostname as label when URL is provided', () => {
        useUIStore.getState().openBrowserTab('browser-def', 'https://example.com/page');

        const tab = useUIStore.getState().middleTabs[1];
        expect(tab.label).toBe('example.com');
        expect(tab.data?.browserUrl).toBe('https://example.com/page');
      });

      it('should fallback to "Browser" for invalid URLs', () => {
        useUIStore.getState().openBrowserTab('browser-ghi', 'not-a-url');

        const tab = useUIStore.getState().middleTabs[1];
        expect(tab.label).toBe('Browser');
      });

      it('should not switch focus when focus=false', () => {
        useUIStore.getState().openBrowserTab('browser-jkl', undefined, false);

        expect(useUIStore.getState().activeMiddleTabId).toBe('main-chat');
        expect(useUIStore.getState().middleTabs).toHaveLength(2);
      });

      it('should activate existing browser tab instead of duplicating', () => {
        useUIStore.getState().openBrowserTab('browser-xyz');
        useUIStore.getState().setActiveMiddleTab('main-chat');
        useUIStore.getState().openBrowserTab('browser-xyz');

        expect(useUIStore.getState().middleTabs).toHaveLength(2); // Not 3
        expect(useUIStore.getState().activeMiddleTabId).toBe('browser:browser-xyz');
      });
    });

    describe('closeBrowserTab', () => {
      it('should close a browser tab by browserId', () => {
        useUIStore.getState().openBrowserTab('browser-close-test');
        expect(useUIStore.getState().middleTabs).toHaveLength(2);

        useUIStore.getState().closeBrowserTab('browser-close-test');
        expect(useUIStore.getState().middleTabs).toHaveLength(1);
        expect(useUIStore.getState().activeMiddleTabId).toBe('main-chat');
      });

      it('should activate fallback tab when active browser tab is closed', () => {
        useUIStore.getState().addMiddleTab({
          id: 'tab-other',
          type: 'terminal',
          label: 'Term',
          closable: true,
        });
        useUIStore.getState().openBrowserTab('browser-active');
        expect(useUIStore.getState().activeMiddleTabId).toBe('browser:browser-active');

        useUIStore.getState().closeBrowserTab('browser-active');
        expect(useUIStore.getState().activeMiddleTabId).toBe('tab-other');
      });

      it('should do nothing for non-existent browserId', () => {
        useUIStore.getState().openBrowserTab('browser-exists');
        useUIStore.getState().closeBrowserTab('browser-nonexistent');

        expect(useUIStore.getState().middleTabs).toHaveLength(2);
      });
    });

    describe('switchTabSession', () => {
      it('should save current tabs and load defaults for a new session', () => {
        // Open a file tab in session-A
        useUIStore.getState().switchTabSession('session-A');
        useUIStore.getState().openFileTab('/src/foo.ts');
        expect(useUIStore.getState().middleTabs).toHaveLength(2);

        // Switch to session-B (no saved state yet)
        useUIStore.getState().switchTabSession('session-B');

        // session-B should have only the default chat tab
        expect(useUIStore.getState().middleTabs).toHaveLength(1);
        expect(useUIStore.getState().middleTabs[0].id).toBe('main-chat');
        expect(useUIStore.getState().activeMiddleTabId).toBe('main-chat');
      });

      it('should restore tabs when switching back to a previous session', () => {
        // Set up session-A with a file tab
        useUIStore.getState().switchTabSession('session-A');
        useUIStore.getState().openFileTab('/src/foo.ts');
        useUIStore.getState().openTerminalTab('term-1');
        expect(useUIStore.getState().middleTabs).toHaveLength(3);

        // Switch to session-B
        useUIStore.getState().switchTabSession('session-B');
        expect(useUIStore.getState().middleTabs).toHaveLength(1);

        // Switch back to session-A
        useUIStore.getState().switchTabSession('session-A');
        expect(useUIStore.getState().middleTabs).toHaveLength(3);
        expect(useUIStore.getState().middleTabs.map(t => t.id)).toEqual([
          'main-chat',
          'file:/src/foo.ts',
          'terminal:term-1',
        ]);
      });

      it('should restore the active tab when switching back', () => {
        useUIStore.getState().switchTabSession('session-A');
        useUIStore.getState().openFileTab('/src/foo.ts');
        useUIStore.getState().setActiveMiddleTab('file:/src/foo.ts');

        useUIStore.getState().switchTabSession('session-B');
        expect(useUIStore.getState().activeMiddleTabId).toBe('main-chat');

        useUIStore.getState().switchTabSession('session-A');
        expect(useUIStore.getState().activeMiddleTabId).toBe('file:/src/foo.ts');
      });

      it('should keep separate tabs per session', () => {
        useUIStore.getState().switchTabSession('session-A');
        useUIStore.getState().openFileTab('/src/a.ts');

        useUIStore.getState().switchTabSession('session-B');
        useUIStore.getState().openBrowserTab('browser-1', 'https://example.com');

        // session-B should have chat + browser
        expect(useUIStore.getState().middleTabs).toHaveLength(2);
        expect(useUIStore.getState().middleTabs[1].type).toBe('browser');

        // session-A should have chat + file
        useUIStore.getState().switchTabSession('session-A');
        expect(useUIStore.getState().middleTabs).toHaveLength(2);
        expect(useUIStore.getState().middleTabs[1].type).toBe('file-editor');
      });

      it('should update currentTabSessionId', () => {
        expect(useUIStore.getState().currentTabSessionId).toBeNull();

        useUIStore.getState().switchTabSession('session-A');
        expect(useUIStore.getState().currentTabSessionId).toBe('session-A');

        useUIStore.getState().switchTabSession('session-B');
        expect(useUIStore.getState().currentTabSessionId).toBe('session-B');
      });
    });
  });
});
