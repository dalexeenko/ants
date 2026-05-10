import React, { useState, useMemo, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { SearchInput } from '../primitives/SearchInput';
import { Text } from '../primitives/Text';
import { SessionList } from './SessionList';
import { useTheme } from '../styles/theme';
import { spacing } from '../styles/tokens';
import type { Session } from '../agent/types';

export interface SessionSearchProps {
  /** All sessions to search through */
  sessions: Session[];
  /** Currently selected session ID */
  selectedSessionId?: string;
  /** Called when a session is selected */
  onSelectSession: (session: Session) => void;
  /** Called when a session is deleted */
  onDeleteSession?: (session: Session) => void;
  /** Whether sessions are loading */
  loading?: boolean;
  /** Placeholder text for search input */
  placeholder?: string;
}

/**
 * Session list with search/filter functionality.
 * Filters sessions by title as user types.
 */
export function SessionSearch({
  sessions,
  selectedSessionId,
  onSelectSession,
  onDeleteSession,
  loading,
  placeholder = 'Search sessions...',
}: SessionSearchProps) {
  useTheme(); // Theme context needed for child components
  const [searchQuery, setSearchQuery] = useState('');

  // Filter sessions based on search query
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) {
      return sessions;
    }
    
    const query = searchQuery.toLowerCase().trim();
    return sessions.filter((session) => {
      // Search by title
      if (session.title?.toLowerCase().includes(query)) {
        return true;
      }
      // Search by ID (for sessions without titles)
      if (session.id.toLowerCase().includes(query)) {
        return true;
      }
      return false;
    });
  }, [sessions, searchQuery]);

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
  }, []);

  const hasSearch = searchQuery.trim().length > 0;
  const noResults = hasSearch && filteredSessions.length === 0 && sessions.length > 0;

  return (
    <View style={styles.container}>
      {/* Search Input */}
      <View style={styles.searchWrapper}>
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={placeholder}
          size="sm"
        />
      </View>

      {/* Results count when searching */}
      {hasSearch && !noResults && (
        <View style={styles.resultsCount}>
          <Text variant="caption" color="muted">
            {filteredSessions.length} of {sessions.length} sessions
          </Text>
        </View>
      )}

      {/* No results message */}
      {noResults ? (
        <View style={styles.noResults}>
          <Text variant="caption" color="muted" align="center">
            No sessions matching "{searchQuery}"
          </Text>
          <Text
            variant="caption"
            color="primary"
            align="center"
            style={styles.clearLink}
            onPress={handleClearSearch}
          >
            Clear search
          </Text>
        </View>
      ) : (
        <SessionList
          sessions={filteredSessions}
          selectedSessionId={selectedSessionId}
          onSelectSession={onSelectSession}
          onDeleteSession={onDeleteSession}
          loading={loading}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchWrapper: {
    paddingHorizontal: spacing[2],
    paddingTop: spacing[2],
    paddingBottom: spacing[1],
  },
  resultsCount: {
    paddingHorizontal: spacing[3],
    paddingBottom: spacing[1],
  },
  noResults: {
    padding: spacing[4],
    gap: spacing[2],
  },
  clearLink: {
    textDecorationLine: 'underline',
  },
});
