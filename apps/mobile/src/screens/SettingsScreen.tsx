import React, { useEffect, useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import {
  ThemeContext,
  Text,
  Button,
  Card,
  IconButton,
  Input,
  Divider,
  AuthenticationSection,
  ThemeSettings,
  Spinner,
  spacing,
  type RemoteServerConfig,
  createLogger,
  type AgentBridge,
} from '@openmgr/ui';

const log = createLogger('SettingsScreen');

interface SettingsScreenProps {
  bridge: AgentBridge;
  onOpenDrawer: () => void;
  onNavigateToServerSettings?: (server: RemoteServerConfig) => void;
}

export function SettingsScreen({ bridge, onOpenDrawer, onNavigateToServerSettings }: SettingsScreenProps) {
  const { colors } = React.useContext(ThemeContext);
  const [servers, setServers] = useState<RemoteServerConfig[]>([]);
  const [_loading, setLoading] = useState(true);
  const [showAddServer, setShowAddServer] = useState(false);
  const [checkingServers, setCheckingServers] = useState<Set<string>>(new Set());

  // Check health of a single server
  const checkServerHealth = useCallback(async (server: RemoteServerConfig) => {
    setCheckingServers(prev => new Set(prev).add(server.id));
    
    try {
      // Pass the full server config including id so lastSeen gets updated
      await bridge.testRemoteServer(server);
      // Reload servers to get updated lastSeen
      const serverList = await bridge.listRemoteServers();
      setServers(serverList);
    } catch {
      // Error already handled in bridge
    } finally {
      setCheckingServers(prev => {
        const next = new Set(prev);
        next.delete(server.id);
        return next;
      });
    }
  }, [bridge]);

  // Load servers on mount
  useEffect(() => {
    loadServers();
  }, []);

  const loadServers = async () => {
    try {
      const serverList = await bridge.listRemoteServers();
      setServers(serverList);
    } catch (e) {
      log.error('Failed to load servers:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleAddServer = async (name: string, url: string, token?: string) => {
    try {
      const server = await bridge.addRemoteServer({ name, url, token });
      setServers((prev) => [...prev, server]);
      setShowAddServer(false);
    } catch (e) {
      log.error('Failed to add server:', e);
      Alert.alert('Error', 'Failed to add server');
    }
  };

  const handleRemoveServer = async (serverId: string) => {
    Alert.alert(
      'Remove Server',
      'Are you sure you want to remove this server?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await bridge.removeRemoteServer(serverId);
              setServers((prev) => prev.filter((s) => s.id !== serverId));
            } catch (e) {
              log.error('Failed to remove server:', e);
            }
          },
        },
      ]
    );
  };

  const handleTestServer = async (server: RemoteServerConfig) => {
    setCheckingServers(prev => new Set(prev).add(server.id));
    try {
      const result = await bridge.testRemoteServer({ url: server.url, token: server.token });
      // Reload servers to get updated lastSeen
      const serverList = await bridge.listRemoteServers();
      setServers(serverList);
      if (result.success) {
        Alert.alert('Connection Successful', 'Server is reachable');
      } else if (result.requiresAuth && result.connectUrl) {
        const { Linking } = require('react-native');
        Alert.alert(
          'Sign In Required',
          result.error || 'This server requires authentication.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign In', onPress: () => Linking.openURL(result.connectUrl!) },
          ]
        );
      } else {
        Alert.alert('Connection Failed', result.error || 'Could not connect to server');
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to test connection');
    } finally {
      setCheckingServers(prev => {
        const next = new Set(prev);
        next.delete(server.id);
        return next;
      });
    }
  };

  return (
    <View testID="openmgr-settings-screen" style={[styles.container, { backgroundColor: colors.bg.primary }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border.light }]}>
        <IconButton testID="openmgr-drawer-toggle" icon="menu" size="md" onPress={onOpenDrawer} />
        <Text variant="heading" style={styles.headerTitle}>
          Settings
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        {/* Appearance Section */}
        <View style={styles.section}>
          <ThemeSettings />
        </View>

        <Divider spacing="lg" />

        {/* Remote Servers Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text variant="heading">Remote Servers</Text>
            <Button size="sm" onPress={() => setShowAddServer(true)}>
              Add Server
            </Button>
          </View>
          <Text color="secondary" style={styles.sectionDescription}>
            Connect to OpenMgr servers to access your projects
          </Text>

          {servers.length === 0 ? (
            <Card variant="outlined" padding="md" style={styles.emptyCard}>
              <Text color="muted" align="center">
                No servers configured
              </Text>
            </Card>
          ) : (
            servers.map((server) => (
              <ServerCard
                key={server.id}
                server={server}
                isChecking={checkingServers.has(server.id)}
                onTest={() => handleTestServer(server)}
                onRefresh={() => checkServerHealth(server)}
                onRemove={() => handleRemoveServer(server.id)}
                onSettings={() => onNavigateToServerSettings?.(server)}
              />
            ))
          )}
        </View>

        <Divider spacing="lg" />

        {/* Authentication Section - uses shared component */}
        <View style={styles.section}>
          <AuthenticationSection bridge={bridge} />
        </View>

        <Divider spacing="lg" />

        {/* About Section */}
        <View style={styles.section}>
          <Text variant="heading">About</Text>
          <Card variant="outlined" padding="md" style={styles.aboutCard}>
            <View style={styles.aboutRow}>
              <Text color="secondary">Version</Text>
              <Text>0.1.0</Text>
            </View>
            <View style={styles.aboutRow}>
              <Text color="secondary">Build</Text>
              <Text>Development</Text>
            </View>
          </Card>
        </View>
      </ScrollView>

      {/* Add Server Modal */}
      {showAddServer && (
        <AddServerModal
          onAdd={handleAddServer}
          onCancel={() => setShowAddServer(false)}
        />
      )}
    </View>
  );
}

// ============ Server Card ============

interface ServerCardProps {
  server: RemoteServerConfig;
  isChecking: boolean;
  onTest: () => void;
  onRefresh: () => void;
  onRemove: () => void;
  onSettings?: () => void;
}

function ServerCard({ server, isChecking, onTest, onRefresh, onRemove, onSettings }: ServerCardProps) {
  const { colors } = React.useContext(ThemeContext);
  
  // Format the lastSeen timestamp
  const formatLastSeen = (timestamp?: number) => {
    if (!timestamp) return 'Never connected';
    
    const now = Date.now();
    const diff = now - timestamp;
    
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'Last seen just now';
    
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `Last seen ${minutes}m ago`;
    
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Last seen ${hours}h ago`;
    
    const days = Math.floor(hours / 24);
    if (days === 1) return 'Last seen yesterday';
    if (days < 7) return `Last seen ${days} days ago`;
    
    // Format as date for older timestamps
    const date = new Date(timestamp);
    return `Last seen ${date.toLocaleDateString()}`;
  };
  
  // Determine status color based on lastSeen
  const getStatusInfo = () => {
    if (isChecking) {
      return { color: colors.text.muted, text: 'Checking...' };
    }
    
    if (!server.lastSeen) {
      return { color: colors.text.muted, text: 'Never connected' };
    }
    
    const hoursSinceLastSeen = (Date.now() - server.lastSeen) / (1000 * 60 * 60);
    
    if (hoursSinceLastSeen < 1) {
      return { color: colors.success, text: formatLastSeen(server.lastSeen) };
    } else if (hoursSinceLastSeen < 24) {
      return { color: colors.warning, text: formatLastSeen(server.lastSeen) };
    } else {
      return { color: colors.text.muted, text: formatLastSeen(server.lastSeen) };
    }
  };
  
  const statusInfo = getStatusInfo();

  return (
    <Card variant="outlined" padding="md" style={styles.serverCard}>
      <View style={styles.serverHeader}>
        <View style={styles.serverInfo}>
          <Text variant="heading">{server.name}</Text>
          <Text color="muted" style={styles.serverUrl} numberOfLines={1}>
            {server.url}
          </Text>
        </View>
        <Pressable onPress={onRefresh} style={styles.statusBadge}>
          {isChecking ? (
            <Spinner size="small" />
          ) : (
            <View style={[styles.statusDot, { backgroundColor: statusInfo.color }]} />
          )}
          <Text style={[styles.statusText, { color: statusInfo.color }]}>
            {isChecking ? 'Checking...' : statusInfo.text}
          </Text>
        </Pressable>
      </View>
      <View style={styles.serverActions}>
        <Button size="sm" variant="ghost" onPress={onTest}>
          Test
        </Button>
        {onSettings && (
          <Button size="sm" variant="ghost" onPress={onSettings}>
            Settings
          </Button>
        )}
        <Button size="sm" variant="ghost" onPress={onRemove}>
          Remove
        </Button>
      </View>
    </Card>
  );
}

// ============ Add Server Modal ============

interface AddServerModalProps {
  onAdd: (name: string, url: string, token?: string) => void;
  onCancel: () => void;
}

function AddServerModal({ onAdd, onCancel }: AddServerModalProps) {
  const { colors } = React.useContext(ThemeContext);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');

  const handleSubmit = () => {
    if (!name.trim() || !url.trim()) {
      Alert.alert('Error', 'Name and URL are required');
      return;
    }
    onAdd(name.trim(), url.trim(), token.trim() || undefined);
  };

  return (
    <View style={styles.modalOverlay}>
      <Pressable style={styles.modalBackdrop} onPress={onCancel} />
      <View style={[styles.modal, { backgroundColor: colors.bg.elevated }]}>
        <Text variant="heading" style={styles.modalTitle}>
          Add Server
        </Text>

        <Input
          label="Server Name"
          value={name}
          onChange={setName}
          placeholder="My Server"
          style={styles.modalInput}
        />

        <Input
          label="Server URL"
          value={url}
          onChange={setUrl}
          placeholder="https://server.example.com"
          autoCapitalize="none"
          keyboardType="url"
          style={styles.modalInput}
        />

        <Input
          label="API Token (optional)"
          value={token}
          onChange={setToken}
          placeholder="Enter token..."
          secureTextEntry
          style={styles.modalInput}
        />

        <View style={styles.modalActions}>
          <Button variant="ghost" onPress={onCancel}>
            Cancel
          </Button>
          <Button onPress={handleSubmit}>
            Add Server
          </Button>
        </View>
      </View>
    </View>
  );
}

// ============ Styles ============

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
  headerTitle: {
    flex: 1,
    textAlign: 'center',
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
  section: {
    marginBottom: spacing[4],
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[1],
  },
  sectionDescription: {
    marginBottom: spacing[3],
  },
  emptyCard: {
    alignItems: 'center',
  },
  serverCard: {
    marginBottom: spacing[3],
  },
  serverHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing[2],
  },
  serverInfo: {
    flex: 1,
    marginRight: spacing[2],
  },
  serverUrl: {
    fontSize: 12,
    marginTop: spacing[1],
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
  },
  serverActions: {
    flexDirection: 'row',
    gap: spacing[2],
    marginTop: spacing[3],
  },
  aboutCard: {
    marginTop: spacing[3],
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modal: {
    width: '90%',
    maxWidth: 400,
    borderRadius: 12,
    padding: spacing[4],
  },
  modalTitle: {
    marginBottom: spacing[4],
    textAlign: 'center',
  },
  modalInput: {
    marginBottom: spacing[3],
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[2],
    marginTop: spacing[2],
  },
});
