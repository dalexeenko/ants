import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, TextInput, StyleSheet, Pressable, ScrollView, Platform } from 'react-native';
import { Text } from '../primitives/Text';
import { Spinner } from '../primitives/Spinner';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius, fontSize, palette } from '../styles/tokens';
import type { AgentBridge, SearchResult } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('GlobalSearch');

export interface GlobalSearchProps {
  bridge: AgentBridge;
  onSelectResult: (result: SearchResult) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

/**
 * Global search component that searches across all projects.
 * Features debounced input, async results, and keyboard navigation.
 */
export function GlobalSearch({
  bridge,
  onSelectResult,
  placeholder = 'Search sessions...',
  autoFocus = false,
}: GlobalSearchProps) {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inputRef = useRef<any>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressingResultRef = useRef(false);

  // Debounced search
  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    try {
      const searchResults = await bridge.searchSessions({
        query: searchQuery,
        includeMessages: true,
        limit: 20,
      });
      setResults(searchResults);
      setSelectedIndex(0);
    } catch (e) {
      log.error('Search failed:', e);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [bridge]);

  // Handle input change with debounce
  const handleChange = useCallback((text: string) => {
    setQuery(text);
    
    // Clear previous timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new timer
    debounceTimerRef.current = setTimeout(() => {
      performSearch(text);
    }, 300); // 300ms debounce
  }, [performSearch]);

  // Handle keyboard navigation
  const handleKeyPress = useCallback((e: { nativeEvent: { key: string } }) => {
    const key = e.nativeEvent.key;
    
    if (key === 'ArrowDown') {
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (key === 'ArrowUp') {
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (key === 'Enter' && results[selectedIndex]) {
      handleSelectResult(results[selectedIndex]);
    } else if (key === 'Escape') {
      setIsOpen(false);
      setQuery('');
      inputRef.current?.blur();
    }
  }, [results, selectedIndex]);

  const handleSelectResult = useCallback((result: SearchResult) => {
    onSelectResult(result);
    setIsOpen(false);
    setQuery('');
    setResults([]);
  }, [onSelectResult]);

  const handleFocus = useCallback(() => {
    setIsOpen(true);
  }, []);

  const handleBlur = useCallback(() => {
    // Don't close if the user is pressing a result row
    if (pressingResultRef.current) return;
    // Delay closing to allow click on results
    setTimeout(() => {
      if (!pressingResultRef.current) {
        setIsOpen(false);
      }
    }, 200);
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Format the snippet with highlighting
  const formatSnippet = (content: string, maxLength = 100) => {
    if (content.length > maxLength) {
      return content.substring(0, maxLength) + '...';
    }
    return content;
  };

  const showResults = isOpen && (results.length > 0 || isSearching || query.length > 0);

  return (
    <View style={[styles.container, showResults && styles.containerElevated]}>
      {/* Search Input */}
      <View
        style={[
          styles.inputContainer,
          {
            backgroundColor: colors.bg.tertiary,
            borderColor: isOpen ? colors.primary : 'transparent',
          },
        ]}
      >
        <Text style={[styles.searchIcon, { color: colors.text.muted }]}>
          {isSearching ? '' : '\u{1F50D}'}
        </Text>
        {isSearching && (
          <View style={styles.spinnerContainer}>
            <Spinner size="small" />
          </View>
        )}
        <TextInput
          ref={inputRef}
          style={[styles.input, { color: colors.text.primary }]}
          value={query}
          onChangeText={handleChange}
          placeholder={placeholder}
          placeholderTextColor={colors.text.muted}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyPress={handleKeyPress}
          autoFocus={autoFocus}
          testID="openmgr-global-search"
        />
        {query.length > 0 && (
          <Pressable
            onPress={() => {
              setQuery('');
              setResults([]);
            }}
            style={styles.clearButton}
          >
            <Text style={[styles.clearIcon, { color: colors.text.muted }]}>×</Text>
          </Pressable>
        )}
      </View>

      {/* Results Dropdown */}
      {showResults && (
        <View
          style={[
            styles.resultsContainer,
            {
              backgroundColor: colors.bg.elevated,
              borderColor: colors.border.light,
            },
          ]}
        >
          <ScrollView style={styles.resultsList} keyboardShouldPersistTaps="handled">
            {results.length === 0 && !isSearching && query.length > 0 && (
              <View style={styles.noResults}>
                <Text color="muted">No results found</Text>
              </View>
            )}
            {results.map((result, index) => (
              <Pressable
                key={`${result.projectId}-${result.session.id}`}
                style={[
                  styles.resultItem,
                  {
                    backgroundColor:
                      index === selectedIndex
                        ? colors.bg.tertiary
                        : 'transparent',
                  },
                ]}
                onPressIn={() => { pressingResultRef.current = true; }}
                onPressOut={() => { pressingResultRef.current = false; }}
                onPress={() => handleSelectResult(result)}
              >
                <View style={styles.resultHeader}>
                  <Text
                    style={[styles.resultTitle, { color: colors.text.primary }]}
                    numberOfLines={1}
                  >
                    {result.session.title || 'Untitled Session'}
                  </Text>
                  <Text
                    style={[styles.resultProject, { color: colors.text.muted }]}
                  >
                    {result.projectName}
                  </Text>
                </View>
                {result.matchingMessages && result.matchingMessages.length > 0 && (
                  <Text
                    style={[styles.resultSnippet, { color: colors.text.secondary }]}
                    numberOfLines={2}
                  >
                    {formatSnippet(result.matchingMessages[0]?.content ?? '')}
                  </Text>
                )}
                <Text style={[styles.resultMeta, { color: colors.text.muted }]}>
                  {result.session.messageCount} messages •{' '}
                  {formatRelativeTime(result.session.updatedAt)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  return new Date(timestamp).toLocaleDateString();
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    width: '100%',
    maxWidth: 520,
  },
  containerElevated: {
    zIndex: 1000,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    gap: spacing[1.5],
    height: 26,
  },
  searchIcon: {
    fontSize: 12,
  },
  spinnerContainer: {
    position: 'absolute',
    left: spacing[2],
  },
  input: {
    flex: 1,
    fontSize: 12,
    padding: 0,
    margin: 0,
  },
  clearButton: {
    padding: spacing[0.5],
    marginRight: -spacing[0.5],
  },
  clearIcon: {
    fontSize: 14,
    fontWeight: '600',
  },
  resultsContainer: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: spacing[1],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    maxHeight: 400,
    overflow: 'hidden',
    // Shadow
    ...Platform.select({
      web: { boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.15)' } as any,
      default: {
        shadowColor: palette.black,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 8,
      },
    }),
  },
  resultsList: {
    maxHeight: 400,
  },
  noResults: {
    padding: spacing[4],
    alignItems: 'center',
  },
  resultItem: {
    padding: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[1],
  },
  resultTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    flex: 1,
  },
  resultProject: {
    fontSize: fontSize.xs,
  },
  resultSnippet: {
    fontSize: fontSize.xs,
    lineHeight: 18,
    marginBottom: spacing[1],
  },
  resultMeta: {
    fontSize: 11,
  },
});
