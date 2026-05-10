import React, { useEffect, useState } from 'react';
import { View, StyleSheet, TextInput, Pressable } from 'react-native';
import { Text } from '../primitives/Text';
import { Button } from '../primitives/Button';
import { Modal } from '../primitives/Modal';
import { Badge } from '../primitives/Badge';
import { IconButton } from '../primitives/IconButton';
import { SettingsSection } from './SettingsSection';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius } from '../styles/tokens';
import type { AgentBridge, McpServerInfo, McpServerConfig } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('McpServersSection');

interface McpServersSectionProps {
  bridge: AgentBridge;
  projectId: string;
  /** If true, only SSE transport is available (e.g., React Native where stdio is not supported) */
  sseOnly?: boolean;
}

export function McpServersSection({ bridge, projectId, sseOnly = false }: McpServersSectionProps) {
  const { colors } = useTheme();
  const [mcpServers, setMcpServers] = useState<McpServerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    loadMcpServers();
  }, [projectId]);

  const loadMcpServers = async () => {
    try {
      const servers = await bridge.listMcpServers(projectId);
      setMcpServers(servers);
    } catch (e) {
      log.error('Failed to load MCP servers:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleAddServer = async (config: McpServerConfig) => {
    try {
      await bridge.addMcpServer(projectId, config);
      await loadMcpServers();
      setShowAddModal(false);
    } catch (e) {
      log.error('Failed to add MCP server:', e);
    }
  };

  const handleRemoveServer = async (serverName: string) => {
    try {
      await bridge.removeMcpServer(projectId, serverName);
      await loadMcpServers();
    } catch (e) {
      log.error('Failed to remove MCP server:', e);
    }
  };

  if (loading) {
    return (
      <SettingsSection
        title="MCP Servers"
        description="Connect to Model Context Protocol servers to extend agent capabilities"
      >
        <View style={styles.loading}>
          <Text style={{ color: colors.text.muted }}>Loading...</Text>
        </View>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title="MCP Servers"
      description="Connect to Model Context Protocol servers to extend agent capabilities"
    >
      {mcpServers.length === 0 ? (
        <View style={[styles.empty, { backgroundColor: colors.bg.secondary }]}>
          <Text style={{ color: colors.text.muted }}>No MCP servers configured</Text>
        </View>
      ) : (
        mcpServers.map((server) => (
          <McpServerRow
            key={server.name}
            server={server}
            onRemove={() => handleRemoveServer(server.name)}
          />
        ))
      )}

      <View style={[styles.addButtonContainer, { backgroundColor: colors.bg.secondary }]}>
        <Button variant="secondary" onPress={() => setShowAddModal(true)}>
          Add MCP Server
        </Button>
      </View>

      <AddMcpServerModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdd={handleAddServer}
        sseOnly={sseOnly}
      />
    </SettingsSection>
  );
}

// ============ MCP Server Row ============

interface McpServerRowProps {
  server: McpServerInfo;
  onRemove: () => void;
}

function McpServerRow({ server, onRemove }: McpServerRowProps) {
  const { colors } = useTheme();
  const status = server.status;

  return (
    <View
      style={[
        styles.serverRow,
        { backgroundColor: colors.bg.secondary, borderBottomColor: colors.border.light },
      ]}
    >
      <View style={styles.serverInfo}>
        <View style={styles.serverHeader}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: status?.connected ? colors.success : colors.error },
            ]}
          />
          <Text style={[styles.serverName, { color: colors.text.primary }]}>
            {server.name}
          </Text>
          <Badge variant="secondary" size="sm">
            {server.type.toUpperCase()}
          </Badge>
        </View>

        <Text style={[styles.serverDetails, { color: colors.text.muted }]}>
          {server.type === 'stdio'
            ? `${server.command || ''} ${(server.args || []).join(' ')}`
            : server.url || ''}
        </Text>

        {status?.connected && (
          <Text style={[styles.toolCount, { color: colors.text.secondary }]}>
            {status.toolCount} tool{status.toolCount !== 1 ? 's' : ''} available
          </Text>
        )}

        {status?.error && (
          <Text style={[styles.errorText, { color: colors.error }]}>{status.error}</Text>
        )}
      </View>

      <IconButton icon="trash" size="sm" onPress={onRemove} />
    </View>
  );
}

// ============ Add MCP Server Modal ============

interface AddMcpServerModalProps {
  visible: boolean;
  onClose: () => void;
  onAdd: (config: McpServerConfig) => void;
  /** If true, only SSE transport is available */
  sseOnly?: boolean;
}

function AddMcpServerModal({ visible, onClose, onAdd, sseOnly = false }: AddMcpServerModalProps) {
  const { colors } = useTheme();
  const [type, setType] = useState<'stdio' | 'sse'>(sseOnly ? 'sse' : 'stdio');
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    if (!name.trim()) {
      setError('Server name is required');
      return;
    }

    if (type === 'stdio' && !command.trim()) {
      setError('Command is required for stdio servers');
      return;
    }

    if (type === 'sse' && !url.trim()) {
      setError('URL is required for SSE servers');
      return;
    }

    const config: McpServerConfig = {
      name: name.trim(),
      type,
      ...(type === 'stdio'
        ? {
            command: command.trim(),
            args: args.trim() ? args.split(/\s+/) : undefined,
          }
        : {
            url: url.trim(),
          }),
    };

    onAdd(config);
    resetForm();
  };

  const resetForm = () => {
    setType(sseOnly ? 'sse' : 'stdio');
    setName('');
    setCommand('');
    setArgs('');
    setUrl('');
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      onClose={handleClose}
      title="Add MCP Server"
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
            placeholder="my-mcp-server"
            placeholderTextColor={colors.text.muted}
          />
        </View>

        {!sseOnly && (
          <View style={styles.formGroup}>
            <Text style={[styles.label, { color: colors.text.primary }]}>Transport Type</Text>
            <View style={styles.typeSelector}>
              <Pressable
                style={[
                  styles.typeOption,
                  type === 'stdio' && styles.typeOptionSelected,
                  { borderColor: colors.border.medium },
                  type === 'stdio' && { borderColor: colors.primary, backgroundColor: colors.bg.tertiary },
                ]}
                onPress={() => setType('stdio')}
              >
                <Text style={{ color: type === 'stdio' ? colors.primary : colors.text.secondary }}>
                  Stdio
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.typeOption,
                  type === 'sse' && styles.typeOptionSelected,
                  { borderColor: colors.border.medium },
                  type === 'sse' && { borderColor: colors.primary, backgroundColor: colors.bg.tertiary },
                ]}
                onPress={() => setType('sse')}
              >
                <Text style={{ color: type === 'sse' ? colors.primary : colors.text.secondary }}>
                  SSE
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {type === 'stdio' ? (
          <>
            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: colors.text.primary }]}>Command</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.bg.primary,
                    color: colors.text.primary,
                    borderColor: colors.border.medium,
                  },
                ]}
                value={command}
                onChangeText={setCommand}
                placeholder="npx"
                placeholderTextColor={colors.text.muted}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: colors.text.primary }]}>Arguments</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.bg.primary,
                    color: colors.text.primary,
                    borderColor: colors.border.medium,
                  },
                ]}
                value={args}
                onChangeText={setArgs}
                placeholder="-y @modelcontextprotocol/server-filesystem /path"
                placeholderTextColor={colors.text.muted}
              />
              <Text style={[styles.hint, { color: colors.text.muted }]}>
                Space-separated list of arguments
              </Text>
            </View>
          </>
        ) : (
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
              placeholder="https://example.com/mcp"
              placeholderTextColor={colors.text.muted}
            />
          </View>
        )}
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
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  serverName: {
    fontSize: 14,
    fontWeight: '500',
  },
  serverDetails: {
    fontSize: 12,
    marginTop: spacing[1],
  },
  toolCount: {
    fontSize: 12,
    marginTop: spacing[0.5],
  },
  errorText: {
    fontSize: 12,
    marginTop: spacing[0.5],
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
  hint: {
    fontSize: 12,
    marginTop: spacing[1],
  },
  typeSelector: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  typeOption: {
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[4],
    borderWidth: 1,
    borderRadius: borderRadius.md,
  },
  typeOptionSelected: {},
  errorBanner: {
    padding: spacing[3],
    borderRadius: borderRadius.md,
    marginBottom: spacing[4],
  },
});
