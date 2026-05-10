import React from 'react';
import { View, StyleSheet } from 'react-native';
import {
  AgentsPanel,
  IconButton,
  Text,
  ThemeContext,
  type AgentBridge,
  spacing,
} from '@openmgr/ui';

interface AgentsScreenProps {
  bridge: AgentBridge;
  onNavigateBack: () => void;
  onOpenDrawer?: () => void;
}

export function AgentsScreen({ bridge, onNavigateBack, onOpenDrawer }: AgentsScreenProps) {
  const { colors } = React.useContext(ThemeContext);

  return (
    <View testID="openmgr-agents-screen" style={[styles.container, { backgroundColor: colors.bg.primary }]}>
      {/* Header with drawer toggle */}
      <View style={[styles.header, { borderBottomColor: colors.border.light }]}>
        {onOpenDrawer ? (
          <IconButton testID="openmgr-drawer-toggle" icon="menu" size="md" onPress={onOpenDrawer} />
        ) : (
          <IconButton icon="arrow-left" size="md" onPress={onNavigateBack} />
        )}
        <Text variant="heading" style={styles.headerTitle}>Agents</Text>
        <View style={styles.headerSpacer} />
      </View>
      <AgentsPanel
        bridge={bridge}
      />
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
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 32,
  },
});
