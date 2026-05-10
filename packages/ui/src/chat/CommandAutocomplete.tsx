import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Text } from '../primitives/Text';
import { useTheme } from '../styles/theme';
import { borderRadius, spacing, fontSize, shadows } from '../styles/tokens';
import type { SlashCommand } from '../agent/types';

export interface CommandAutocompleteProps {
  /** The current input text (should start with /) */
  input: string;
  /** Available slash commands */
  commands: SlashCommand[];
  /** Called when a command is selected */
  onSelect: (command: SlashCommand) => void;
  /** Called when user dismisses the autocomplete */
  onDismiss: () => void;
  /** Currently highlighted index (for keyboard navigation) */
  highlightedIndex?: number;
  /** Maximum number of suggestions to show */
  maxSuggestions?: number;
}

export function CommandAutocomplete({
  input,
  commands,
  onSelect,
  onDismiss: _onDismiss,
  highlightedIndex = 0,
  maxSuggestions = 8,
}: CommandAutocompleteProps) {
  const { colors } = useTheme();

  // Filter commands based on input (after the /)
  const filteredCommands = useMemo(() => {
    const query = input.slice(1).toLowerCase(); // Remove leading /
    
    if (!query) {
      // Show all commands when just "/" is typed
      return commands.slice(0, maxSuggestions);
    }

    return commands
      .filter((cmd) => {
        const name = cmd.name.toLowerCase();
        const description = cmd.description?.toLowerCase() || '';
        return name.includes(query) || description.includes(query);
      })
      .slice(0, maxSuggestions);
  }, [input, commands, maxSuggestions]);

  if (filteredCommands.length === 0) {
    return null;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bg.elevated, ...shadows.md }]}>
      <ScrollView style={styles.scrollView} keyboardShouldPersistTaps="handled">
        {filteredCommands.map((command, index) => (
          <Pressable
            key={command.name}
            style={[
              styles.item,
              { borderBottomColor: colors.border.light },
              index === highlightedIndex && { backgroundColor: colors.bg.tertiary },
            ]}
            onPress={() => onSelect(command)}
          >
            <View style={styles.itemContent}>
              <View style={styles.itemHeader}>
                <Text style={[styles.commandName, { color: colors.primary }]}>
                  /{command.name}
                </Text>
                {command.arguments && (
                  <Text style={[styles.commandArgs, { color: colors.text.muted }]}>
                    {command.arguments.map((arg) => (
                      arg.required ? `<${arg.name}>` : `[${arg.name}]`
                    )).join(' ')}
                  </Text>
                )}
              </View>
              {command.description && (
                <Text
                  style={[styles.commandDescription, { color: colors.text.secondary }]}
                  numberOfLines={1}
                >
                  {command.description}
                </Text>
              )}
            </View>
          </Pressable>
        ))}
      </ScrollView>
      
      <View style={[styles.footer, { borderTopColor: colors.border.light }]}>
        <Text style={[styles.footerText, { color: colors.text.muted }]}>
          Press Tab or Enter to select, Esc to dismiss
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    right: 0,
    marginBottom: spacing[1],
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    maxHeight: 320,
  },
  scrollView: {
    maxHeight: 280,
  },
  item: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
  },
  itemContent: {
    gap: spacing[0.5],
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  commandName: {
    fontFamily: 'monospace',
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  commandArgs: {
    fontFamily: 'monospace',
    fontSize: fontSize.xs,
  },
  commandDescription: {
    fontSize: fontSize.sm,
  },
  footer: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderTopWidth: 1,
  },
  footerText: {
    fontSize: fontSize.xs,
    textAlign: 'center',
  },
});
