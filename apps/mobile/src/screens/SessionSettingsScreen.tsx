import React, { useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import {
  ThemeContext,
  Text,
  IconButton,
  ToolSettings,
  ToolSettingsPage,
  PermissionSettings,
  SubagentSettings,
  SubagentSettingsPage,
  type AgentBridge,
} from '@openmgr/ui';

type SettingsView = 'main' | 'tools' | 'subagents';

interface SessionSettingsScreenProps {
  bridge: AgentBridge;
  projectId: string;
  sessionTitle?: string;
  onNavigateBack: () => void;
}

export function SessionSettingsScreen({
  bridge,
  projectId,
  sessionTitle,
  onNavigateBack,
}: SessionSettingsScreenProps) {
  const { colors } = React.useContext(ThemeContext);
  const [view, setView] = useState<SettingsView>('main');

  // Tools detail page
  if (view === 'tools') {
    return (
      <ToolSettingsPage
        bridge={bridge}
        projectId={projectId}
        onBack={() => setView('main')}
      />
    );
  }

  // Subagents detail page
  if (view === 'subagents') {
    return (
      <SubagentSettingsPage
        bridge={bridge}
        projectId={projectId}
        onBack={() => setView('main')}
      />
    );
  }

  // Main settings page
  return (
    <View style={[styles.container, { backgroundColor: colors.bg.primary }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border.light }]}>
        <IconButton icon="arrow-left" size="md" onPress={onNavigateBack} />
        <View style={styles.headerTitle}>
          <Text variant="heading" numberOfLines={1}>
            Session Settings
          </Text>
          {sessionTitle && (
            <Text variant="caption" numberOfLines={1} style={{ color: colors.text.secondary }}>
              {sessionTitle}
            </Text>
          )}
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {/* Settings Content */}
      <ScrollView 
        style={styles.content} 
        contentContainerStyle={styles.contentInner}
      >
        <ToolSettings
          bridge={bridge}
          projectId={projectId}
          onNavigateToTools={() => setView('tools')}
        />
        <SubagentSettings
          bridge={bridge}
          projectId={projectId}
          onNavigateToSubagents={() => setView('subagents')}
        />
        <PermissionSettings bridge={bridge} projectId={projectId} />
      </ScrollView>
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
    padding: 12,
    borderBottomWidth: 1,
  },
  headerTitle: {
    flex: 1,
    alignItems: 'center',
  },
  headerSpacer: {
    width: 40,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    padding: 16,
    gap: 16,
  },
});
