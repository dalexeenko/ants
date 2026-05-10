import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, Platform } from 'react-native';
import { Text } from '../primitives/Text';
import { Button } from '../primitives/Button';
import { IconButton } from '../primitives/IconButton';
import { Input } from '../primitives/Input';
import { Spinner } from '../primitives/Spinner';
import { Card } from '../primitives/Card';
import { Divider } from '../primitives/Divider';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { ErrorBoundary } from '../primitives/ErrorBoundary';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius } from '../styles/tokens';
import type { RemoteServerConfig, AgentBridge } from '../agent/types';
import { usePluginAuthProvider } from '../plugins/UIPluginContext';
import { createLogger } from '../utils/logger';

const log = createLogger('ServerSettings');

// Helper to open URL in browser
const openURL = (url: string) => {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window?.open(url, '_blank');
  } else {
    // For React Native, dynamically import Linking
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Linking } = require('react-native');
    Linking.openURL(url);
  }
};

export interface ServerSettingsProps {
  bridge: AgentBridge;
  server: RemoteServerConfig;
  onNavigateBack: () => void;
}

export function ServerSettings({
  bridge,
  server,
  onNavigateBack,
}: ServerSettingsProps) {
  const { colors } = useTheme();

  // Local config state (available immediately)
  const [serverName, setServerName] = useState(server.name);
  const [serverUrl, setServerUrl] = useState(server.url);
  const [serverToken, setServerToken] = useState(server.token || '');
  const [serverAuthConfig, setServerAuthConfig] = useState<Record<string, unknown>>(server.authConfig || {});
  const [localDirty, setLocalDirty] = useState(false);
  const pluginAuthProvider = usePluginAuthProvider(server.authType || '');
  const [localSaving, setLocalSaving] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string; requiresAuth?: boolean; connectUrl?: string } | null>(null);
  const [lastSeen, setLastSeen] = useState<number | undefined>(server.lastSeen);

  // Confirm dialog state
  const [confirmState, setConfirmState] = useState<{
    visible: boolean;
    title: string;
    message: string;
    confirmText: string;
    onConfirm: () => void;
  }>({ visible: false, title: '', message: '', confirmText: '', onConfirm: () => {} });

  // Status message (replaces Alert.alert for success/error messages)
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Auto-clear status messages
  React.useEffect(() => {
    if (statusMessage) {
      const timer = setTimeout(() => setStatusMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [statusMessage]);

  const showConfirm = (options: {
    title: string;
    message: string;
    confirmText: string;
    onConfirm: () => void;
  }) => {
    setConfirmState({ visible: true, ...options });
  };

  // Track local config changes
  const handleNameChange = (value: string) => {
    setServerName(value);
    setLocalDirty(true);
  };

  const handleUrlChange = (value: string) => {
    setServerUrl(value);
    setLocalDirty(true);
  };

  const handleTokenChange = (value: string) => {
    setServerToken(value);
    setLocalDirty(true);
  };

  const handleAuthConfigChange = (config: Record<string, unknown>) => {
    setServerAuthConfig(config);
    setLocalDirty(true);
  };

  const handleSaveLocalConfig = async () => {
    setLocalSaving(true);
    try {
      await bridge.updateRemoteServer(server.id, {
        name: serverName,
        url: serverUrl,
        token: serverToken || undefined,
        authType: server.authType,
        authConfig: pluginAuthProvider ? serverAuthConfig : undefined,
      });
      setLocalDirty(false);
      setTestResult(null);
    } catch (e) {
      log.error('Failed to save server config:', e);
      setStatusMessage({ text: 'Failed to save server configuration', type: 'error' });
    } finally {
      setLocalSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setTestResult(null);
    try {
      const result = await bridge.testRemoteServer({
        url: serverUrl,
        token: serverToken || undefined,
        authType: server.authType,
        authConfig: pluginAuthProvider ? serverAuthConfig : undefined,
      });
      setTestResult(result);
      if (result.success) {
        setLastSeen(Date.now());
      }
    } catch (e) {
      setTestResult({ success: false, error: 'Connection test failed' });
    } finally {
      setTestingConnection(false);
    }
  };

  const handleRemoveServer = () => {
    showConfirm({
      title: 'Remove Server',
      message: `Are you sure you want to remove "${server.name}"? This will also remove all associated remote projects.`,
      confirmText: 'Remove',
      onConfirm: async () => {
        try {
          await bridge.removeRemoteServer(server.id);
          onNavigateBack();
        } catch (e) {
          log.error('Failed to remove server:', e);
          setStatusMessage({ text: 'Failed to remove server', type: 'error' });
        }
      },
    });
  };

  const buildServerUIUrl = (path: string) => {
    const baseUrl = serverUrl.replace(/\/+$/, '');
    const token = serverToken || server.token || '';
    const redirect = `/ui/#${path}`;
    return token
      ? `${baseUrl}/api/beta/auth/session?token=${encodeURIComponent(token)}&redirect=${encodeURIComponent(redirect)}`
      : `${baseUrl}${redirect}`;
  };

  const handleOpenServerSettings = () => {
    openURL(buildServerUIUrl('/settings'));
  };

  const handleOpenChannels = () => {
    openURL(buildServerUIUrl('/channels'));
  };

  const getStatusInfo = () => {
    if (testingConnection) {
      return { color: colors.text.muted, text: 'Checking...' };
    }
    if (testResult) {
      if (testResult.success) {
        return { color: colors.success, text: 'Connected' };
      }
      return { color: colors.error, text: 'Unreachable' };
    }
    if (!lastSeen) {
      return { color: colors.text.muted, text: 'Never connected' };
    }
    const hoursSinceLastSeen = (Date.now() - lastSeen) / (1000 * 60 * 60);
    if (hoursSinceLastSeen < 1) {
      return { color: colors.success, text: 'Connected' };
    } else if (hoursSinceLastSeen < 24) {
      return { color: colors.warning, text: 'Last seen recently' };
    }
    return { color: colors.text.muted, text: 'Last seen over a day ago' };
  };

  const statusInfo = getStatusInfo();

  return (
    <View style={[styles.container, { backgroundColor: colors.bg.primary }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border.light }]}>
        <IconButton icon="arrow-left" size="md" onPress={onNavigateBack} />
        <View style={styles.headerTitleContainer}>
          <Text variant="heading" numberOfLines={1}>
            {server.name}
          </Text>
          <View style={styles.statusBadge}>
            {testingConnection ? (
              <Spinner size="small" />
            ) : (
              <View style={[styles.statusDot, { backgroundColor: statusInfo.color }]} />
            )}
            <Text style={[styles.statusText, { color: statusInfo.color }]}>
              {statusInfo.text}
            </Text>
          </View>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        {/* Status message banner */}
        {statusMessage && (
          <View
            style={[
              styles.statusBanner,
              {
                backgroundColor:
                  (statusMessage.type === 'success' ? colors.success : colors.error) + '15',
                borderColor:
                  statusMessage.type === 'success' ? colors.success : colors.error,
              },
            ]}
          >
            <Text
              style={{
                color: statusMessage.type === 'success' ? colors.success : colors.error,
                fontSize: 13,
              }}
            >
              {statusMessage.text}
            </Text>
          </View>
        )}

        {/* Connection Section - always available, no network needed */}
        <View style={styles.section}>
          <Text variant="heading">Connection</Text>
          <Text color="secondary" style={styles.sectionDescription}>
            Server connection details
            {pluginAuthProvider ? ` \u2022 ${pluginAuthProvider.label}` : ''}
          </Text>

          <Input
            label="Name"
            value={serverName}
            onChange={handleNameChange}
            placeholder="My Server"
            style={styles.input}
          />
          <Input
            label="Host"
            value={serverUrl}
            onChange={handleUrlChange}
            placeholder="https://example.com"
            style={styles.input}
          />
          {pluginAuthProvider ? (
            <ErrorBoundary>
              <pluginAuthProvider.settingsComponent
                server={server}
                authConfig={serverAuthConfig}
                onAuthConfigChange={handleAuthConfigChange}
              />
            </ErrorBoundary>
          ) : (
            <Input
              label="Auth Token"
              value={serverToken}
              onChange={handleTokenChange}
              placeholder="Optional authentication token"
              secureTextEntry
              style={styles.input}
            />
          )}

          <View style={styles.connectionActions}>
            {localDirty && (
              <Button size="sm" onPress={handleSaveLocalConfig} disabled={localSaving}>
                {localSaving ? 'Saving...' : 'Save'}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onPress={handleTestConnection}
              disabled={testingConnection}
            >
              {testingConnection ? 'Testing...' : 'Test Connection'}
            </Button>
          </View>

          {testResult && (
            <View
              style={[
                styles.testResult,
                {
                  borderColor: testResult.success ? colors.success : colors.error,
                  backgroundColor: (testResult.success ? colors.success : colors.error) + '10',
                },
              ]}
            >
              <Text
                weight="medium"
                style={{ color: testResult.success ? colors.success : colors.error }}
              >
                {testResult.success
                  ? 'Connection successful'
                  : testResult.error || 'Connection failed'}
              </Text>
              {testResult.requiresAuth && testResult.connectUrl && (
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => openURL(testResult!.connectUrl!)}
                  style={{ marginTop: spacing[2], alignSelf: 'flex-start' }}
                >
                  Sign In
                </Button>
              )}
            </View>
          )}
        </View>

        <Divider spacing="lg" />

        {/* Server Settings - opens web UI */}
        <View style={styles.section}>
          <Text variant="heading">Server Settings</Text>
          <Text color="secondary" style={styles.sectionDescription}>
            Manage API keys, plugins, and other server configuration
          </Text>
          <Button
            size="sm"
            onPress={handleOpenServerSettings}
            style={styles.openSettingsButton}
          >
            Open Server Settings
          </Button>
          <Text color="muted" style={styles.openSettingsHint}>
            Opens in your browser
          </Text>
        </View>

        <Divider spacing="lg" />

        {/* Channels - opens web UI */}
        <View style={styles.section}>
          <Text variant="heading">Channels</Text>
          <Text color="secondary" style={styles.sectionDescription}>
            Manage Slack, Discord, Telegram, and other messaging integrations
          </Text>
          <Button
            size="sm"
            onPress={handleOpenChannels}
            style={styles.openSettingsButton}
          >
            Manage Channels
          </Button>
          <Text color="muted" style={styles.openSettingsHint}>
            Opens in your browser
          </Text>
        </View>

        {/* Danger Zone - always available */}
        <Card variant="outlined" padding="md" style={{ marginTop: 24, borderColor: colors.error }}>
          <Text variant="heading" style={{ color: colors.error, marginBottom: 8 }}>
            Danger Zone
          </Text>
          <Text color="secondary" style={{ marginBottom: 12 }}>
            Irreversible actions
          </Text>
          <Button size="sm" variant="danger" onPress={handleRemoveServer}>
            Remove Server
          </Button>
        </Card>
      </ScrollView>

      {/* Confirm Dialog */}
      <ConfirmDialog
        visible={confirmState.visible}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        cancelText="Cancel"
        destructive
        onConfirm={() => {
          confirmState.onConfirm();
          setConfirmState((s) => ({ ...s, visible: false }));
        }}
        onCancel={() => setConfirmState((s) => ({ ...s, visible: false }))}
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
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    marginTop: 2,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
  },
  headerSpacer: {
    width: 40,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    padding: spacing[4],
  },
  statusBanner: {
    padding: spacing[3],
    borderWidth: 1,
    borderRadius: borderRadius.md,
    marginBottom: spacing[4],
  },
  section: {
    marginBottom: spacing[6],
  },
  sectionDescription: {
    marginTop: spacing[1],
    marginBottom: spacing[3],
  },
  connectionActions: {
    flexDirection: 'row',
    gap: spacing[2],
    marginTop: spacing[1],
  },
  testResult: {
    marginTop: spacing[3],
    padding: spacing[3],
    borderWidth: 1,
    borderRadius: borderRadius.md,
  },
  input: {
    marginBottom: spacing[3],
  },
  openSettingsButton: {
    alignSelf: 'flex-start',
  },
  openSettingsHint: {
    marginTop: spacing[2],
    fontSize: 12,
  },
});
