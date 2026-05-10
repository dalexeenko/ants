import React from 'react';
import { View, StyleSheet, ScrollView, Platform } from 'react-native';
import { Text } from './Text';
import { Modal } from './Modal';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius } from '../styles/tokens';

export interface ShortcutItem {
  keys: string[];
  description: string;
  category?: string;
}

export interface KeyboardShortcutsHelpProps {
  /** Whether the modal is visible */
  visible: boolean;
  /** Called when the modal is closed */
  onClose: () => void;
  /** Additional shortcuts to display */
  customShortcuts?: ShortcutItem[];
}

// Default shortcuts
const DEFAULT_SHORTCUTS: ShortcutItem[] = [
  // General
  { keys: ['⌘', ','], description: 'Open Settings', category: 'General' },
  { keys: ['⌘', 'B'], description: 'Toggle Sidebar', category: 'General' },
  
  // Projects & Sessions
  { keys: ['⌘', 'Shift', 'N'], description: 'Open Project', category: 'Projects' },
  { keys: ['⌘', 'N'], description: 'New Session', category: 'Sessions' },
  { keys: ['⌘', 'W'], description: 'Close Session', category: 'Sessions' },
  { keys: ['⌘', '['], description: 'Previous Session', category: 'Sessions' },
  { keys: ['⌘', ']'], description: 'Next Session', category: 'Sessions' },
  
  // Chat
  { keys: ['⌘', '.'], description: 'Stop Operation', category: 'Chat' },
  { keys: ['Enter'], description: 'Send Message', category: 'Chat' },
  { keys: ['Shift', 'Enter'], description: 'New Line', category: 'Chat' },
  { keys: ['/'], description: 'Slash Command', category: 'Chat' },
];

// Convert shortcuts for Windows/Linux
function convertShortcutForPlatform(keys: string[]): string[] {
  if (Platform.OS === 'web') {
    // Check if running on macOS via user agent
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = typeof globalThis !== 'undefined' ? (globalThis as any).navigator : undefined;
    const isMac = nav && /Mac/.test(nav.userAgent);
    if (!isMac) {
      return keys.map((key) => {
        if (key === '⌘') return 'Ctrl';
        return key;
      });
    }
  }
  return keys;
}

/**
 * Keyboard shortcuts help modal.
 * Shows all available keyboard shortcuts organized by category.
 */
export function KeyboardShortcutsHelp({
  visible,
  onClose,
  customShortcuts = [],
}: KeyboardShortcutsHelpProps) {
  const { colors } = useTheme();
  
  const allShortcuts = [...DEFAULT_SHORTCUTS, ...customShortcuts];
  
  // Group by category
  const shortcutsByCategory = allShortcuts.reduce((acc, shortcut) => {
    const category = shortcut.category || 'Other';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(shortcut);
    return acc;
  }, {} as Record<string, ShortcutItem[]>);

  return (
    <Modal visible={visible} onClose={onClose} title="Keyboard Shortcuts">
      <ScrollView style={styles.content}>
        {Object.entries(shortcutsByCategory).map(([category, shortcuts]) => (
          <View key={category} style={styles.category}>
            <Text
              style={[styles.categoryTitle, { color: colors.text.secondary }]}
            >
              {category}
            </Text>
            {shortcuts.map((shortcut, index) => (
              <View
                key={index}
                style={[
                  styles.shortcutRow,
                  { borderBottomColor: colors.border.light },
                ]}
              >
                <View style={styles.keys}>
                  {convertShortcutForPlatform(shortcut.keys).map((key, keyIndex) => (
                    <React.Fragment key={keyIndex}>
                      {keyIndex > 0 && (
                        <Text style={[styles.plus, { color: colors.text.muted }]}>
                          +
                        </Text>
                      )}
                      <View
                        style={[
                          styles.key,
                          { backgroundColor: colors.bg.tertiary },
                        ]}
                      >
                        <Text style={[styles.keyText, { color: colors.text.primary }]}>
                          {key}
                        </Text>
                      </View>
                    </React.Fragment>
                  ))}
                </View>
                <Text
                  style={[styles.description, { color: colors.text.secondary }]}
                >
                  {shortcut.description}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: {
    maxHeight: 400,
    padding: spacing[3],
  },
  category: {
    marginBottom: spacing[4],
  },
  categoryTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: spacing[2],
  },
  shortcutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
  },
  keys: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  key: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.sm,
    minWidth: 28,
    alignItems: 'center',
  },
  keyText: {
    fontSize: 12,
    fontWeight: '500',
    fontFamily: 'monospace',
  },
  plus: {
    fontSize: 12,
  },
  description: {
    fontSize: 13,
  },
});
