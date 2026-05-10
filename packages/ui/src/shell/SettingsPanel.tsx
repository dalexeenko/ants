import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import {
  ThemeContext,
  useUIStore,
  useProjectStore,
  Text,
  ThemeSettings,
  AuthenticationSection,
  RemoteServersSection,
  ErrorBoundary,
  createLogger,
} from '../index';
import { usePluginSettingsSections } from '../plugins';
import { usePlatform } from '../platform/PlatformContext';

const log = createLogger('SettingsPanel');

export function SettingsPanel() {
  const { colors } = React.useContext(ThemeContext);
  const platform = usePlatform();
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const pluginSettings = usePluginSettingsSections('global');

  return (
    <View testID="openmgr-settings-panel" style={[styles.settingsContainer, { backgroundColor: colors.bg.primary }]}>
      <View style={[styles.settingsHeader, { borderBottomColor: colors.border.light }]}>
        <Text variant="heading">Settings</Text>
      </View>
      <ScrollView style={styles.settingsContent} contentContainerStyle={styles.settingsContentInner}>
        {/* Theme Settings (always available) */}
        <ThemeSettings />

        {window.agentBridge && (
          <>
            {/* Global Settings — AuthenticationSection only for non-web platforms */}
            {platform.platform !== 'web' && (
              <AuthenticationSection bridge={window.agentBridge} />
            )}
            <RemoteServersSection
              bridge={window.agentBridge}
              onServerSettings={(server) => {
                useUIStore.getState().setSelectedServer(server);
                useUIStore.getState().setView('serverSettings');
                useUIStore.getState().setActiveScreen('project');
              }}
            />

            {/* Plugin-contributed global settings sections */}
            {pluginSettings.map((section) => {
              const SectionComponent = section.component;
              return (
                <ErrorBoundary key={section.id} onError={(error) => log.error(`Plugin settings section "${section.id}" error:`, error)}>
                  <SectionComponent
                    bridge={window.agentBridge!}
                    projectId={currentProjectId || ''}
                    pluginName={section.pluginName}
                  />
                </ErrorBoundary>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  settingsContainer: {
    flex: 1,
  },
  settingsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  settingsContent: {
    flex: 1,
  },
  settingsContentInner: {
    padding: 24,
    maxWidth: 600,
    width: '100%',
    alignSelf: 'center',
  },
});
