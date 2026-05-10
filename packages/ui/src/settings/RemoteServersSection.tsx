import React, { useEffect, useState } from 'react';
import { View, StyleSheet, TextInput, Pressable, Platform } from 'react-native';
import { Text } from '../primitives/Text';
import { Button } from '../primitives/Button';
import { Modal } from '../primitives/Modal';
import { Badge } from '../primitives/Badge';
import { IconButton } from '../primitives/IconButton';
import { ErrorBoundary } from '../primitives/ErrorBoundary';
import { SettingsSection } from './SettingsSection';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius } from '../styles/tokens';
import type { AgentBridge, RemoteServerConfig } from '../agent/types';
import { useProjectStore } from '../store/projectStore';
import { usePluginAuthProviders } from '../plugins/UIPluginContext';
import { createLogger } from '../utils/logger';

const log = createLogger('RemoteServersSection');

const openURL = (url: string) => {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window?.open(url, '_blank');
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Linking } = require('react-native');
    Linking.openURL(url);
  }
};

interface RemoteServersSectionProps {
  bridge: AgentBridge;
  onServerSettings?: (server: RemoteServerConfig) => void;
}

export function RemoteServersSection({ bridge, onServerSettings }: RemoteServersSectionProps) {
  const { colors } = useTheme();
  const [servers, setServers] = useState<RemoteServerConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    loadServers();
  }, []);

  const loadServers = async () => {
    try {
      const serverList = await bridge.listRemoteServers();
      setServers(serverList);
    } catch (e) {
      log.error('Failed to load remote servers:', e);
    } finally {
      setLoading(false);
    }
  };

  const syncProjects = async () => {
    try {
      await bridge.syncRemoteProjects();
      const projects = await bridge.listProjects();
      useProjectStore.getState().setProjects(projects);
    } catch (e) {
      log.error('Failed to sync remote projects:', e);
    }
  };

  const handleAddServer = async (config: Omit<RemoteServerConfig, 'id' | 'createdAt'>) => {
    try {
      await bridge.addRemoteServer(config);
      await loadServers();
      setShowAddModal(false);
      // Sync projects so the new server's projects appear immediately
      await syncProjects();
    } catch (e) {
      log.error('Failed to add remote server:', e);
    }
  };

  const handleRemoveServer = async (serverId: string) => {
    try {
      await bridge.removeRemoteServer(serverId);
      await loadServers();
      // Sync projects so the removed server's projects are cleaned up
      await syncProjects();
    } catch (e) {
      log.error('Failed to remove remote server:', e);
    }
  };

  if (loading) {
    return (
      <SettingsSection
        title="Remote Servers"
        description="Connect to remote @openmgr/server instances"
      >
        <View style={styles.loading}>
          <Text style={{ color: colors.text.muted }}>Loading...</Text>
        </View>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title="Remote Servers"
      description="Connect to remote @openmgr/server instances"
    >
      {servers.length === 0 ? (
        <View style={[styles.empty, { backgroundColor: colors.bg.secondary }]}>
          <Text style={{ color: colors.text.muted }}>No remote servers configured</Text>
        </View>
      ) : (
        servers.map((server) => (
          <RemoteServerRow
            key={server.id}
            server={server}
            bridge={bridge}
            onRemove={() => handleRemoveServer(server.id)}
            onSettings={onServerSettings ? () => onServerSettings(server) : undefined}
          />
        ))
      )}

      <View style={[styles.addButtonContainer, { backgroundColor: colors.bg.secondary }]}>
        <Button variant="secondary" onPress={() => setShowAddModal(true)}>
          Add Remote Server
        </Button>
      </View>

      <AddRemoteServerModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdd={handleAddServer}
        bridge={bridge}
      />
    </SettingsSection>
  );
}

// ============ Remote Server Row ============

interface RemoteServerRowProps {
  server: RemoteServerConfig;
  bridge: AgentBridge;
  onRemove: () => void;
  onSettings?: () => void;
}

function RemoteServerRow({ server, bridge, onRemove, onSettings }: RemoteServerRowProps) {
  const { colors } = useTheme();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string; requiresAuth?: boolean; connectUrl?: string } | null>(null);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await bridge.testRemoteServer({ url: server.url, token: server.token });
      setTestResult(result);
    } catch (e) {
      setTestResult({ success: false, error: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const content = (
    <View
      style={[
        styles.serverRow,
        { backgroundColor: colors.bg.secondary, borderBottomColor: colors.border.light },
      ]}
    >
      <View style={styles.serverInfo}>
        <View style={styles.serverHeader}>
          <Text style={[styles.serverName, { color: colors.text.primary }]}>
            {server.name}
          </Text>
          {server.token && (
            <Badge variant="secondary" size="sm">
              Auth
            </Badge>
          )}
        </View>

        <Text style={[styles.serverUrl, { color: colors.text.muted }]}>{server.url}</Text>

        {testResult && (
          <View style={{ marginTop: spacing[0.5], gap: spacing[1] }}>
            <Text
              style={[
                styles.testResult,
                { color: testResult.success ? colors.success : colors.error },
              ]}
            >
              {testResult.success ? 'Connection successful' : testResult.error}
            </Text>
            {testResult.requiresAuth && testResult.connectUrl && (
              <Button
                size="sm"
                variant="secondary"
                onPress={() => openURL(testResult.connectUrl!)}
              >
                Sign In
              </Button>
            )}
          </View>
        )}
      </View>

      <View style={styles.serverActions}>
        {onSettings && (
          <IconButton icon="settings" size="sm" onPress={onSettings} />
        )}
        <Button variant="ghost" size="sm" onPress={handleTest} loading={testing}>
          Test
        </Button>
        <IconButton icon="trash" size="sm" onPress={onRemove} />
      </View>
    </View>
  );

  return content;
}

// ============ Add Remote Server Modal ============

interface AddRemoteServerModalProps {
  visible: boolean;
  onClose: () => void;
  onAdd: (config: Omit<RemoteServerConfig, 'id' | 'createdAt'>) => void;
  bridge: AgentBridge;
}

function AddRemoteServerModal({ visible, onClose, onAdd, bridge }: AddRemoteServerModalProps) {
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [authType, setAuthType] = useState<string>('bearer');
  const [authConfig, setAuthConfig] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string; requiresAuth?: boolean; connectUrl?: string } | null>(null);
  const pluginAuthProviders = usePluginAuthProviders();

  const handleTest = async () => {
    if (!url.trim()) {
      setError('URL is required');
      return;
    }

    setTesting(true);
    setTestResult(null);
    setError(null);

    try {
      const result = await bridge.testRemoteServer({
        url: url.trim(),
        token: authType === 'bearer' ? (token.trim() || undefined) : undefined,
      });
      setTestResult(result);
    } catch (e) {
      setTestResult({ success: false, error: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = () => {
    if (!name.trim()) {
      setError('Server name is required');
      return;
    }

    if (!url.trim()) {
      setError('URL is required');
      return;
    }

    const config: Omit<RemoteServerConfig, 'id' | 'createdAt'> = {
      name: name.trim(),
      url: url.trim(),
    };

    if (authType === 'bearer') {
      config.token = token.trim() || undefined;
    } else {
      config.authType = authType;
      config.authConfig = authConfig;
    }

    onAdd(config);
    resetForm();
  };

  const resetForm = () => {
    setName('');
    setUrl('');
    setToken('');
    setAuthType('bearer');
    setAuthConfig({});
    setError(null);
    setTestResult(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const activePluginAuth = pluginAuthProviders.find((p) => p.id === authType);

  return (
    <Modal
      visible={visible}
      onClose={handleClose}
      title="Add Remote Server"
      footer={
        <View style={styles.modalFooter}>
          <Button variant="ghost" onPress={handleClose}>
            Cancel
          </Button>
          <Button onPress={handleSubmit}>Add Server</Button>
        </View>
      }
    >
      <View style={styles.modalContent}>
        {error && (
          <View style={[styles.errorBanner, { backgroundColor: colors.error }]}>
            <Text style={{ color: colors.text.inverse }}>{error}</Text>
          </View>
        )}

        <View style={styles.formGroup}>
          <Text style={[styles.label, { color: colors.text.primary }]}>Server Name</Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.bg.primary,
                color: colors.text.primary,
                borderColor: colors.border.medium,
              },
            ]}
            value={name}
            onChangeText={setName}
            placeholder="My Remote Server"
            placeholderTextColor={colors.text.muted}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={[styles.label, { color: colors.text.primary }]}>URL</Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.bg.primary,
                color: colors.text.primary,
                borderColor: colors.border.medium,
              },
            ]}
            value={url}
            onChangeText={setUrl}
            placeholder="https://example.com/api"
            placeholderTextColor={colors.text.muted}
          />
        </View>

        {/* Auth Type Selection */}
        {pluginAuthProviders.length > 0 && (
          <View style={styles.formGroup}>
            <Text style={[styles.label, { color: colors.text.primary }]}>Authentication Type</Text>
            <View style={{ flexDirection: 'row', gap: spacing[2], flexWrap: 'wrap' }}>
              <Pressable
                onPress={() => { setAuthType('bearer'); setAuthConfig({}); }}
                style={[
                  styles.authTypeOption,
                  {
                    borderColor: authType === 'bearer' ? colors.primary : colors.border.medium,
                    backgroundColor: authType === 'bearer' ? colors.primary + '15' : colors.bg.primary,
                  },
                ]}
              >
                <Text style={{ color: authType === 'bearer' ? colors.primary : colors.text.secondary, fontSize: 13 }}>
                  Bearer Token
                </Text>
              </Pressable>
              {pluginAuthProviders.map((provider) => (
                <Pressable
                  key={provider.id}
                  onPress={() => { setAuthType(provider.id); setAuthConfig({}); }}
                  style={[
                    styles.authTypeOption,
                    {
                      borderColor: authType === provider.id ? colors.primary : colors.border.medium,
                      backgroundColor: authType === provider.id ? colors.primary + '15' : colors.bg.primary,
                    },
                  ]}
                >
                  <Text style={{ color: authType === provider.id ? colors.primary : colors.text.secondary, fontSize: 13 }}>
                    {provider.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* Bearer token input */}
        {authType === 'bearer' && (
          <View style={styles.formGroup}>
            <Text style={[styles.label, { color: colors.text.primary }]}>
              Authentication Token (Optional)
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.bg.primary,
                  color: colors.text.primary,
                  borderColor: colors.border.medium,
                },
              ]}
              value={token}
              onChangeText={setToken}
              placeholder="Bearer token"
              placeholderTextColor={colors.text.muted}
              secureTextEntry
            />
          </View>
        )}

        {/* Plugin auth connection form */}
        {activePluginAuth && (
          <ErrorBoundary onError={(error) => log.error(`Plugin auth "${authType}" error:`, error)}>
            <activePluginAuth.connectionComponent
              authConfig={authConfig}
              onAuthConfigChange={setAuthConfig}
            />
          </ErrorBoundary>
        )}

        <View style={styles.testSection}>
          <Button variant="secondary" onPress={handleTest} loading={testing}>
            Test Connection
          </Button>
          {testResult && (
            <>
              <Text
                style={[
                  styles.testResultText,
                  { color: testResult.success ? colors.success : colors.error },
                ]}
              >
                {testResult.success ? 'Connection successful' : testResult.error}
              </Text>
              {testResult.requiresAuth && testResult.connectUrl && (
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => openURL(testResult!.connectUrl!)}
                >
                  Sign In
                </Button>
              )}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  loading: {
    padding: spacing[4],
    alignItems: 'center',
  },
  empty: {
    padding: spacing[4],
    alignItems: 'center',
  },
  serverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderBottomWidth: 1,
  },
  serverInfo: {
    flex: 1,
    marginRight: spacing[3],
  },
  serverHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  serverName: {
    fontSize: 14,
    fontWeight: '500',
  },
  serverUrl: {
    fontSize: 12,
    marginTop: spacing[1],
  },
  testResult: {
    fontSize: 12,
    marginTop: spacing[0.5],
  },
  serverActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  addButtonContainer: {
    padding: spacing[4],
    alignItems: 'flex-start',
  },
  modalContent: {
    padding: spacing[4],
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[2],
  },
  formGroup: {
    marginBottom: spacing[4],
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: spacing[2],
  },
  input: {
    height: 40,
    paddingHorizontal: spacing[3],
    borderWidth: 1,
    borderRadius: borderRadius.md,
    fontSize: 14,
  },
  testSection: {
    alignItems: 'flex-start',
    gap: spacing[2],
  },
  testResultText: {
    fontSize: 12,
  },
  errorBanner: {
    padding: spacing[3],
    borderRadius: borderRadius.md,
    marginBottom: spacing[4],
  },
  authTypeOption: {
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderWidth: 1,
    borderRadius: borderRadius.md,
  },
});
