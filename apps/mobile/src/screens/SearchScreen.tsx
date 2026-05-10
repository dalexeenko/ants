import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
  ThemeContext,
  GlobalSearch,
  IconButton,
  spacing,
  type AgentBridge,
  type SearchResult,
} from '@openmgr/ui';

interface SearchScreenProps {
  bridge: AgentBridge;
  onNavigateBack: () => void;
  onSelectResult: (result: SearchResult) => void;
}

export function SearchScreen({ bridge, onNavigateBack, onSelectResult }: SearchScreenProps) {
  const { colors } = React.useContext(ThemeContext);

  const handleSelectResult = (result: SearchResult) => {
    onSelectResult(result);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg.primary }]}>
      <View style={[styles.header, { borderBottomColor: colors.border.light }]}>
        <IconButton icon="arrow-left" size="md" onPress={onNavigateBack} />
        <View style={styles.searchWrapper}>
          <GlobalSearch
            bridge={bridge}
            onSelectResult={handleSelectResult}
            placeholder="Search sessions..."
            autoFocus
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    gap: spacing[2],
  },
  searchWrapper: {
    flex: 1,
  },
});
