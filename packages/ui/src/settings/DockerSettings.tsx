import React, { useEffect, useState } from 'react';
import { View, StyleSheet, TextInput } from 'react-native';
import { Text } from '../primitives/Text';
import { Card } from '../primitives/Card';
import { Button } from '../primitives/Button';
import { Switch } from '../primitives/Switch';
import { Badge } from '../primitives/Badge';
import { Spinner } from '../primitives/Spinner';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius } from '../styles/tokens';
import type { AgentBridge, DockerStatus, DockerContainerInfo, DockerConfig, Project } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('DockerSettings');

interface DockerSettingsProps {
  bridge: AgentBridge;
  project: Project;
}

/**
 * Docker settings section for project settings.
 * Shows Docker availability, enables/disables Docker mode for sessions,
 * and displays container status.
 */
export function DockerSettings({ bridge, project }: DockerSettingsProps) {
  const { colors } = useTheme();
  const [dockerStatus, setDockerStatus] = useState<DockerStatus | null>(null);
  const [containerInfo, setContainerInfo] = useState<DockerContainerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [dockerEnabled, setDockerEnabled] = useState(false);
  const [customImage, setCustomImage] = useState('');
  const [cpuLimit, setCpuLimit] = useState('');
  const [memoryLimit, setMemoryLimit] = useState('');
  const [building, setBuilding] = useState(false);
  const [buildMessage, setBuildMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    loadDockerStatus();
  }, [project.id]);

  // Auto-clear messages
  useEffect(() => {
    if (buildMessage) {
      const timer = setTimeout(() => setBuildMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [buildMessage]);

  const loadDockerStatus = async () => {
    setLoading(true);
    try {
      // For remote projects, fetch Docker status from the server
      if (project.providerType === 'remote' && project.remoteServerId && bridge.getDockerStatus) {
        const status = await bridge.getDockerStatus(project.remoteServerId);
        setDockerStatus(status);
      } else {
        // For local projects, Docker isn't supported directly (no server to manage containers)
        // The desktop app doesn't manage Docker — only the server does
        setDockerStatus({ available: false, insideDocker: false, dindAvailable: false, error: 'Docker is only available for remote server projects' });
      }

      // Load container info if Docker operations are available
      if (bridge.getDockerContainer) {
        try {
          const info = await bridge.getDockerContainer(project.id);
          setContainerInfo(info);
        } catch {
          // No container running
        }
      }
    } catch (e) {
      log.error('Failed to load Docker status:', e);
      setDockerStatus({ available: false, insideDocker: false, dindAvailable: false, error: 'Failed to check Docker status' });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleDocker = async (enabled: boolean) => {
    setDockerEnabled(enabled);
    try {
      // Update project agent config with Docker settings
      const dockerConfig: DockerConfig = {
        enabled,
        ...(customImage ? { image: customImage } : {}),
        ...(cpuLimit || memoryLimit ? {
          resources: {
            ...(cpuLimit ? { cpus: cpuLimit } : {}),
            ...(memoryLimit ? { memory: memoryLimit } : {}),
          },
        } : {}),
      };

      // Use remoteServerFetch to update the project's agent config
      if (project.providerType === 'remote' && project.remoteServerId) {
        await bridge.remoteServerFetch(
          project.remoteServerId,
          `/projects/${project.id}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              agentConfig: { docker: dockerConfig },
            }),
          },
        );
      }
    } catch (e) {
      log.error('Failed to update Docker config:', e);
      setDockerEnabled(!enabled); // Revert
    }
  };

  const handleBuildImage = async () => {
    if (!bridge.buildDockerImage || !project.remoteServerId) return;
    setBuilding(true);
    setBuildMessage(null);
    try {
      const result = await bridge.buildDockerImage(project.remoteServerId);
      if (result.success) {
        setBuildMessage({ text: 'Agent Docker image built successfully', type: 'success' });
      } else {
        setBuildMessage({ text: result.error || 'Build failed', type: 'error' });
      }
    } catch (e) {
      setBuildMessage({
        text: e instanceof Error ? e.message : 'Failed to build Docker image',
        type: 'error',
      });
    } finally {
      setBuilding(false);
    }
  };

  if (loading) {
    return (
      <Card variant="outlined" padding="md" style={{ marginBottom: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Spinner size="sm" />
          <Text color="secondary">Checking Docker availability...</Text>
        </View>
      </Card>
    );
  }

  const isAvailable = dockerStatus?.available ?? false;

  return (
    <Card variant="outlined" padding="md" style={{ marginBottom: 16 }}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text variant="label" style={{ color: colors.text.primary, fontSize: 16, fontWeight: '600' }}>
            Docker
          </Text>
          <Text style={{ color: colors.text.secondary, fontSize: 13, marginTop: 2 }}>
            Run agent sessions in sandboxed Docker containers
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {isAvailable ? (
            <Badge variant="success" size="sm">Available</Badge>
          ) : (
            <Badge variant="default" size="sm">Unavailable</Badge>
          )}
        </View>
      </View>

      {/* Docker status details */}
      {dockerStatus && (
        <View style={[styles.statusRow, { borderTopColor: colors.border.light }]}>
          {isAvailable && dockerStatus.version && (
            <Text style={{ color: colors.text.muted, fontSize: 12 }}>
              Docker {dockerStatus.version}
              {dockerStatus.insideDocker ? ' (running inside Docker)' : ''}
              {dockerStatus.dindAvailable ? ' - DinD available' : ''}
            </Text>
          )}
          {!isAvailable && dockerStatus.error && (
            <Text style={{ color: colors.text.muted, fontSize: 12 }}>
              {dockerStatus.error}
            </Text>
          )}
        </View>
      )}

      {/* Enable/disable toggle */}
      {isAvailable && (
        <View style={[styles.toggleRow, { borderTopColor: colors.border.light }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text.primary, fontSize: 14, fontWeight: '500' }}>
              Enable Docker Sessions
            </Text>
            <Text style={{ color: colors.text.secondary, fontSize: 12, marginTop: 2 }}>
              New sessions will run inside Docker containers
            </Text>
          </View>
          <Switch
            value={dockerEnabled}
            onValueChange={handleToggleDocker}
          />
        </View>
      )}

      {/* Container status */}
      {containerInfo && (
        <View style={[styles.containerStatus, { borderTopColor: colors.border.light }]}>
          <Text style={{ color: colors.text.primary, fontSize: 13, fontWeight: '500', marginBottom: 4 }}>
            Running Container
          </Text>
          <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
            <Text style={{ color: colors.text.muted, fontSize: 12, fontFamily: 'monospace' }}>
              {containerInfo.containerId}
            </Text>
            <Badge
              variant={containerInfo.status === 'running' ? 'success' : 'warning'}
              size="sm"
            >
              {containerInfo.status}
            </Badge>
            {containerInfo.stats?.cpuPercent && (
              <Text style={{ color: colors.text.muted, fontSize: 12 }}>
                CPU: {containerInfo.stats.cpuPercent}
              </Text>
            )}
            {containerInfo.stats?.memoryUsage && (
              <Text style={{ color: colors.text.muted, fontSize: 12 }}>
                Mem: {containerInfo.stats.memoryUsage} / {containerInfo.stats.memoryLimit}
              </Text>
            )}
          </View>
        </View>
      )}

      {/* Advanced Docker settings (collapsible) */}
      {isAvailable && dockerEnabled && (
        <View style={[styles.advancedSection, { borderTopColor: colors.border.light }]}>
          <Button
            variant="ghost"
            size="sm"
            onPress={() => setExpanded(!expanded)}
          >
            {expanded ? 'Hide Advanced Settings' : 'Show Advanced Settings'}
          </Button>

          {expanded && (
            <View style={{ marginTop: 12, gap: 12 }}>
              {/* Custom image */}
              <View>
                <Text style={{ color: colors.text.secondary, fontSize: 12, marginBottom: 4 }}>
                  Custom Image (leave empty for default)
                </Text>
                <TextInput
                  style={[styles.input, {
                    backgroundColor: colors.bg.secondary,
                    borderColor: colors.border.light,
                    color: colors.text.primary,
                  }]}
                  value={customImage}
                  onChangeText={setCustomImage}
                  placeholder="ants-agent:latest"
                  placeholderTextColor={colors.text.muted}
                />
              </View>

              {/* CPU limit */}
              <View>
                <Text style={{ color: colors.text.secondary, fontSize: 12, marginBottom: 4 }}>
                  CPU Limit (e.g., "2.0" for 2 cores)
                </Text>
                <TextInput
                  style={[styles.input, {
                    backgroundColor: colors.bg.secondary,
                    borderColor: colors.border.light,
                    color: colors.text.primary,
                  }]}
                  value={cpuLimit}
                  onChangeText={setCpuLimit}
                  placeholder="No limit"
                  placeholderTextColor={colors.text.muted}
                />
              </View>

              {/* Memory limit */}
              <View>
                <Text style={{ color: colors.text.secondary, fontSize: 12, marginBottom: 4 }}>
                  Memory Limit (e.g., "4g" for 4GB)
                </Text>
                <TextInput
                  style={[styles.input, {
                    backgroundColor: colors.bg.secondary,
                    borderColor: colors.border.light,
                    color: colors.text.primary,
                  }]}
                  value={memoryLimit}
                  onChangeText={setMemoryLimit}
                  placeholder="No limit"
                  placeholderTextColor={colors.text.muted}
                />
              </View>

              {/* Build image button */}
              <View>
                <Button
                  variant="secondary"
                  size="sm"
                  onPress={handleBuildImage}
                  disabled={building}
                >
                  {building ? 'Building Image...' : 'Build Agent Image'}
                </Button>
                {buildMessage && (
                  <Text style={{
                    color: buildMessage.type === 'success' ? colors.success : colors.error,
                    fontSize: 12,
                    marginTop: 4,
                  }}>
                    {buildMessage.text}
                  </Text>
                )}
              </View>
            </View>
          )}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusRow: {
    borderTopWidth: 1,
    marginTop: 12,
    paddingTop: 8,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    marginTop: 12,
    paddingTop: 12,
  },
  containerStatus: {
    borderTopWidth: 1,
    marginTop: 12,
    paddingTop: 12,
  },
  advancedSection: {
    borderTopWidth: 1,
    marginTop: 12,
    paddingTop: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    fontFamily: 'monospace',
  },
});
