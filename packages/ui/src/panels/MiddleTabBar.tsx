/**
 * MiddleTabBar - Tab bar for the middle panel.
 *
 * Shows tabs for the main chat, file editors, subagent views, and terminals.
 * The main chat tab is always pinned as the leftmost tab and cannot be closed.
 * Other tabs can be closed via the X button.
 * Includes a "+" button to create new terminal tabs.
 * Also hosts settings and sidebar toggle buttons at the right end.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Pressable, StyleSheet, Platform, ActivityIndicator, ScrollView } from 'react-native';
import { Text } from '../primitives/Text';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius, fontSize, colors as tokenColors } from '../styles/tokens';
import { useUIStore, type MiddleTab } from '../store/uiStore';
import { useSessionStore } from '../store/sessionStore';
import { getSessionStatus, type SessionStatus } from '../sidebar/SessionListItem';
import { usePluginMiddleTabs } from '../plugins/UIPluginContext';

export interface MiddleTabBarProps {
  /** Callback when the settings gear is pressed */
  onSettingsPress?: () => void;
  /** Whether session settings are currently shown */
  settingsActive?: boolean;
  /** Callback when the sidebar toggle is pressed */
  onSidebarToggle?: () => void;
  /** Whether the right sidebar is currently collapsed */
  sidebarCollapsed?: boolean;
}

const TAB_TYPE_ICONS: Record<string, string> = {
  chat: '\u2726',          // diamond
  'file-editor': '\u2630', // trigram
  subagent: '\u2699',      // gear
  terminal: '\u25B6',      // right-pointing triangle (play)
};

/** Maps SessionStatus to a color for the tab status dot */
const TAB_STATUS_COLORS: Record<SessionStatus, string | null> = {
  processing: tokenColors.primary,
  needsPermission: tokenColors.warning,
  needsAnswer: tokenColors.warning,
  error: tokenColors.error,
  done: tokenColors.info,
  idle: null,
};

/** Small status indicator shown on tabs with active sessions */
function TabStatusDot({ status }: { status: SessionStatus }) {
  const color = TAB_STATUS_COLORS[status];
  if (!color) return null;

  if (status === 'processing') {
    return (
      <ActivityIndicator
        size="small"
        color={color}
        style={styles.tabStatusSpinner}
      />
    );
  }

  const needsPulse = status === 'needsPermission' || status === 'needsAnswer';

  return (
    <PulsingDot color={color} pulse={needsPulse} />
  );
}

/** A small colored dot that can optionally pulse */
function PulsingDot({ color, pulse }: { color: string; pulse: boolean }) {
  const [dim, setDim] = useState(false);

  useEffect(() => {
    if (!pulse) return;
    const interval = setInterval(() => setDim((v) => !v), 800);
    return () => clearInterval(interval);
  }, [pulse]);

  return (
    <View style={[styles.tabStatusDot, { backgroundColor: color, opacity: pulse && dim ? 0.3 : 1 }]} />
  );
}

function TabItem({ tab, isActive, onPress, onClose, index, onDragReorder, status }: {
  tab: MiddleTab;
  isActive: boolean;
  onPress: () => void;
  onClose?: () => void;
  index: number;
  onDragReorder?: (fromIndex: number, toIndex: number) => void;
  status?: SessionStatus;
}) {
  const { colors } = useTheme();

  const dragProps = Platform.OS === 'web' && tab.closable && onDragReorder ? {
    draggable: true,
    onDragStart: (e: any) => {
      e.dataTransfer?.setData('text/plain', String(index));
      e.currentTarget.style.opacity = '0.5';
    },
    onDragEnd: (e: any) => {
      e.currentTarget.style.opacity = '1';
    },
    onDragOver: (e: any) => {
      e.preventDefault();
      e.currentTarget.style.borderLeftWidth = '2px';
      e.currentTarget.style.borderLeftColor = colors.primary;
    },
    onDragLeave: (e: any) => {
      e.currentTarget.style.borderLeftWidth = '0px';
    },
    onDrop: (e: any) => {
      e.preventDefault();
      e.currentTarget.style.borderLeftWidth = '0px';
      const fromIndex = parseInt(e.dataTransfer?.getData('text/plain') || '-1', 10);
      if (fromIndex >= 0 && fromIndex !== index) {
        onDragReorder(fromIndex, index);
      }
    },
  } : {};

  return (
    <Pressable
      style={[
        styles.tab,
        {
          backgroundColor: isActive ? colors.bg.primary : 'transparent',
          borderBottomColor: isActive ? colors.primary : 'transparent',
        },
        Platform.OS === 'web' && tab.closable && { cursor: 'grab' } as any,
      ]}
      onPress={onPress}
      testID={`ants-middle-tab-${tab.type}`}
      {...dragProps}
    >
      {status && status !== 'idle' ? (
        <TabStatusDot status={status} />
      ) : (
        <Text style={[styles.tabIcon, { color: isActive ? colors.primary : colors.text.muted }]}>
          {TAB_TYPE_ICONS[tab.type] || TAB_TYPE_ICONS.chat}
        </Text>
      )}
      <Text
        style={[
          styles.tabLabel,
          { color: isActive ? colors.text.primary : colors.text.muted },
        ]}
        numberOfLines={1}
      >
        {tab.label}
      </Text>
      {tab.closable && (
        <Pressable
          style={styles.closeButton}
          onPress={(e) => {
            e.stopPropagation?.();
            onClose?.();
          }}
        >
          <Text style={[styles.closeIcon, { color: colors.text.muted }]}>{'\u2715'}</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

function AddTabDropdown({ onClose }: { onClose: () => void }) {
  const { colors, palette } = useTheme();
  const { openTerminalTab, openPluginTab } = useUIStore();
  const pluginTabs = usePluginMiddleTabs();
  const menuPluginTabs = pluginTabs.filter((t) => t.showInNewTabMenu);
  const dropdownRef = useRef<View>(null);

  // Close on outside click (web only)
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handleClick = (e: MouseEvent) => {
      // Close if click is outside the dropdown
      const el = dropdownRef.current as unknown as HTMLElement | null;
      if (el && !el.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <View
      ref={dropdownRef}
      style={[
        styles.dropdown,
        {
          backgroundColor: colors.bg.elevated,
          borderColor: colors.border.light,
          ...(Platform.OS === 'web'
            ? ({ boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.15)' } as any)
            : { shadowColor: palette.black, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 8 }),
        },
      ]}
    >
      <Pressable
        style={({ hovered }: any) => [
          styles.dropdownItem,
          hovered && { backgroundColor: colors.bg.tertiary },
        ]}
        onPress={() => {
          openTerminalTab();
          onClose();
        }}
      >
        <Text style={[styles.dropdownIcon, { color: colors.text.muted }]}>{'\u25B6'}</Text>
        <Text style={[styles.dropdownLabel, { color: colors.text.primary }]}>New Terminal</Text>
      </Pressable>
      {/* Plugin-contributed tabs in the "+" menu */}
      {menuPluginTabs.map((pluginTab) => (
        <Pressable
          key={pluginTab.type}
          style={({ hovered }: any) => [
            styles.dropdownItem,
            hovered && { backgroundColor: colors.bg.tertiary },
          ]}
          onPress={() => {
            openPluginTab(pluginTab.type, pluginTab.label);
            onClose();
          }}
        >
          <Text style={[styles.dropdownIcon, { color: colors.text.muted }]}>
            {TAB_TYPE_ICONS[pluginTab.type] || pluginTab.icon || '\u2726'}
          </Text>
          <Text style={[styles.dropdownLabel, { color: colors.text.primary }]}>{pluginTab.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Derives a SessionStatus for a subagent tab from the subagent info in the session store.
 * Maps subagent lifecycle status to the same SessionStatus enum used for sessions.
 */
function useSubagentTabStatus(subagentSessionId: string | undefined): SessionStatus {
  return useSessionStore((state) => {
    if (!subagentSessionId) return 'idle';
    // Check if this subagent has a pending permission request propagated to it
    if (state.pendingPermissionsBySession[subagentSessionId]) return 'needsPermission';
    if (state.pendingQuestionsBySession[subagentSessionId]) return 'needsAnswer';
    // Find the subagent info across all parent sessions
    for (const subs of Object.values(state.subagentsBySession)) {
      const sub = subs.find((s) => s.sessionId === subagentSessionId);
      if (sub) {
        switch (sub.status) {
          case 'running': return 'processing';
          case 'completed': return 'done';
          case 'failed':
          case 'cancelled': return 'error';
        }
      }
    }
    return 'idle';
  });
}

/** Derives the status for the main chat tab from the current session */
function useChatTabStatus(): SessionStatus {
  return useSessionStore((state) => {
    const sessionId = state.currentSessionId;
    if (!sessionId) return 'idle';
    return getSessionStatus(
      sessionId,
      state.processingBySession,
      state.pendingPermissionsBySession,
      state.pendingQuestionsBySession,
      state.errorBySession,
      state.doneBySession,
    );
  });
}

/** Wrapper that resolves status for a tab and renders TabItem */
function TabItemWithStatus({ tab, isActive, onPress, onClose, index, onDragReorder }: {
  tab: MiddleTab;
  isActive: boolean;
  onPress: () => void;
  onClose?: () => void;
  index: number;
  onDragReorder?: (fromIndex: number, toIndex: number) => void;
}) {
  const chatStatus = useChatTabStatus();
  const subagentStatus = useSubagentTabStatus(tab.data?.subagentSessionId as string | undefined);

  let status: SessionStatus = 'idle';
  if (tab.type === 'chat') {
    status = chatStatus;
  } else if (tab.type === 'subagent') {
    status = subagentStatus;
  }

  return (
    <TabItem
      tab={tab}
      isActive={isActive}
      onPress={onPress}
      onClose={onClose}
      index={index}
      onDragReorder={onDragReorder}
      status={status}
    />
  );
}

/** Inject a <style> tag to hide the scrollbar inside the tab bar (web only). */
const scrollbarStyleId = 'ants-tab-scrollbar-hide';
function ensureScrollbarStyle() {
  if (Platform.OS !== 'web') return;
  if (document.getElementById(scrollbarStyleId)) return;
  const style = document.createElement('style');
  style.id = scrollbarStyleId;
  style.textContent = `
    [data-tab-scroll]::-webkit-scrollbar { display: none; }
    [data-tab-scroll] { -ms-overflow-style: none; scrollbar-width: none; }
  `;
  document.head.appendChild(style);
}

export function MiddleTabBar({
  onSettingsPress,
  settingsActive,
  onSidebarToggle,
  sidebarCollapsed,
}: MiddleTabBarProps = {}) {
  const { colors } = useTheme();
  const { middleTabs, activeMiddleTabId, setActiveMiddleTab, removeMiddleTab, reorderMiddleTabs } = useUIStore();
  const [showDropdown, setShowDropdown] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const tabRefs = useRef<Map<string, View>>(new Map());

  // Inject scrollbar-hiding CSS on mount (web only)
  useEffect(() => {
    ensureScrollbarStyle();
  }, []);

  // Mark the scroll container with a data attribute for CSS targeting (web only)
  const setScrollDataAttr = useCallback((ref: ScrollView | null) => {
    (scrollRef as React.MutableRefObject<ScrollView | null>).current = ref;
    if (Platform.OS === 'web' && ref) {
      const el = ref as unknown as HTMLElement;
      // React Native Web ScrollView renders a div with overflow set — mark it and its children
      el.setAttribute?.('data-tab-scroll', '');
      // Also mark any child divs that may have the actual overflow
      const children = el.querySelectorAll?.('div');
      children?.forEach((child: Element) => child.setAttribute('data-tab-scroll', ''));
    }
  }, []);

  // Scroll the active tab into view when it changes
  useEffect(() => {
    if (Platform.OS === 'web') {
      const tabEl = tabRefs.current.get(activeMiddleTabId);
      if (tabEl) {
        (tabEl as unknown as HTMLElement).scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    } else if (scrollRef.current) {
      // On native, we'd need layout measurements; for now ScrollView handles it
    }
  }, [activeMiddleTabId]);

  const setTabRef = useCallback((id: string, ref: View | null) => {
    if (ref) {
      tabRefs.current.set(id, ref);
    } else {
      tabRefs.current.delete(id);
    }
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg.secondary, borderBottomColor: colors.border.light, zIndex: 20 }, Platform.OS === 'web' && { overflow: 'visible' } as any]}>
      {/* Scrollable tabs area */}
      <ScrollView
        ref={setScrollDataAttr}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
      >
        {middleTabs.map((tab, index) => (
          <View key={tab.id} ref={(ref) => setTabRef(tab.id, ref)} collapsable={false}>
            <TabItemWithStatus
              tab={tab}
              isActive={tab.id === activeMiddleTabId}
              onPress={() => setActiveMiddleTab(tab.id)}
              onClose={tab.closable ? () => removeMiddleTab(tab.id) : undefined}
              index={index}
              onDragReorder={reorderMiddleTabs}
            />
          </View>
        ))}
      </ScrollView>

      {/* "+" button sits outside ScrollView so its dropdown isn't clipped */}
      <View style={[styles.addButtonWrapper, Platform.OS === 'web' && { zIndex: 100, overflow: 'visible' } as any]}>
        <Pressable
          style={({ hovered }: any) => [
            styles.addButton,
            hovered && { backgroundColor: colors.bg.tertiary },
          ]}
          onPress={() => setShowDropdown((v) => !v)}
        >
          <Text style={[styles.addIcon, { color: colors.text.muted }]}>{'\u002B'}</Text>
        </Pressable>
        {showDropdown && <AddTabDropdown onClose={() => setShowDropdown(false)} />}
      </View>

      {/* Fixed right-side buttons */}
      <View style={styles.rightButtons}>
        {onSettingsPress && (
          <Pressable
            style={({ hovered }: any) => [
              styles.rightButton,
              settingsActive && { backgroundColor: colors.bg.tertiary },
              hovered && !settingsActive && { backgroundColor: colors.bg.tertiary },
            ]}
            onPress={onSettingsPress}
          >
            <Text style={{ fontSize: 14, color: settingsActive ? colors.primary : colors.text.muted }}>{'\u2699'}</Text>
          </Pressable>
        )}
        {onSidebarToggle && (
          <Pressable
            style={({ hovered }: any) => [
              styles.rightButton,
              !sidebarCollapsed && { backgroundColor: colors.bg.tertiary },
              hovered && sidebarCollapsed && { backgroundColor: colors.bg.tertiary },
            ]}
            onPress={onSidebarToggle}
            testID="ants-toggle-right-sidebar"
          >
            <Text style={{ fontSize: 14, color: sidebarCollapsed ? colors.text.muted : colors.primary }}>{sidebarCollapsed ? '\u25E7' : '\u25E8'}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderBottomWidth: 1,
    paddingLeft: spacing[1],
    minHeight: 36,
  },
  scrollArea: {
    flex: 1,
    minWidth: 0,
  },
  scrollContent: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  rightButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderBottomWidth: 2,
    maxWidth: 180,
    gap: 4,
  },
  tabIcon: {
    fontSize: 12,
  },
  tabLabel: {
    fontSize: fontSize.xs,
    fontWeight: '500',
    flexShrink: 1,
  },
  closeButton: {
    padding: 2,
    marginLeft: 2,
    borderRadius: 4,
  },
  closeIcon: {
    fontSize: 10,
  },
  addButtonWrapper: {
    position: 'relative',
    justifyContent: 'center',
  },
  addButton: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.sm,
    marginLeft: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addIcon: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 20,
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    minWidth: 160,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingVertical: spacing[1],
    zIndex: 100,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    gap: spacing[2],
  },
  dropdownIcon: {
    fontSize: 12,
  },
  dropdownLabel: {
    fontSize: fontSize.sm,
  },
  rightButton: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 2,
  },
  tabStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  tabStatusSpinner: {
    width: 12,
    height: 12,
    transform: [{ scale: 0.6 }],
  },
});
