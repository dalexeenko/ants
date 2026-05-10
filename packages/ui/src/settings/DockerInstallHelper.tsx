import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Pressable, Platform } from 'react-native';
import { Text } from '../primitives/Text';
import { Card } from '../primitives/Card';
import { Button } from '../primitives/Button';
import { Badge } from '../primitives/Badge';
import { Spinner } from '../primitives/Spinner';
import { useTheme } from '../styles/theme';
import { spacing } from '../styles/tokens';
import type { AgentBridge, DockerStatus } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('DockerInstallHelper');

interface DockerInstallHelperProps {
  bridge: AgentBridge;
  /** Remote server ID to check Docker status on */
  serverId?: string;
  /** Compact mode — show less detail */
  compact?: boolean;
}

/** Platform-specific Docker install instructions */
interface InstallInstructions {
  platform: string;
  method: string;
  steps: string[];
  command?: string;
  downloadUrl?: string;
}

function getInstallInstructions(serverPlatform?: string): InstallInstructions {
  // Detect the platform — for remote servers we might not know,
  // so we show multi-platform instructions
  const platform = serverPlatform || (
    Platform.OS === 'web'
      ? detectWebPlatform()
      : Platform.OS
  );

  switch (platform) {
    case 'macos':
    case 'darwin':
      return {
        platform: 'macOS',
        method: 'Docker Desktop',
        steps: [
          'Download Docker Desktop for Mac from the link below',
          'Open the .dmg file and drag Docker to Applications',
          'Open Docker from Applications and complete the setup',
          'Docker will start automatically and appear in the menu bar',
        ],
        downloadUrl: 'https://www.docker.com/products/docker-desktop/',
      };
    case 'linux':
      return {
        platform: 'Linux',
        method: 'Docker Engine (Official Install Script)',
        steps: [
          'Run the official Docker install script (shown below)',
          'Add your user to the docker group: sudo usermod -aG docker $USER',
          'Log out and log back in for group changes to take effect',
          'Verify: docker run hello-world',
        ],
        command: 'curl -fsSL https://get.docker.com | sh',
      };
    case 'windows':
    case 'win32':
      return {
        platform: 'Windows',
        method: 'Docker Desktop',
        steps: [
          'Download Docker Desktop for Windows from the link below',
          'Run the installer and follow the setup wizard',
          'Ensure WSL 2 is enabled (Docker will prompt you if needed)',
          'Restart your computer if prompted',
          'Open Docker Desktop and complete the onboarding',
        ],
        downloadUrl: 'https://www.docker.com/products/docker-desktop/',
      };
    default:
      return {
        platform: 'Unknown',
        method: 'Docker',
        steps: [
          'Visit https://docs.docker.com/get-docker/ for platform-specific instructions',
          'Install Docker and ensure the Docker daemon is running',
          'Verify with: docker info',
        ],
        downloadUrl: 'https://docs.docker.com/get-docker/',
      };
  }
}

function detectWebPlatform(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux')) return 'linux';
  return 'unknown';
}

/**
 * Docker install helper component.
 * Shows Docker status and provides platform-specific installation guidance.
 * For remote servers, also detects docker-in-docker scenarios.
 */
export function DockerInstallHelper({ bridge, serverId, compact }: DockerInstallHelperProps) {
  const { colors } = useTheme();
  const [status, setStatus] = useState<DockerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showInstructions, setShowInstructions] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    checkDocker();
  }, [serverId]);

  const checkDocker = async () => {
    setLoading(true);
    try {
      if (serverId && bridge.getDockerStatus) {
        const result = await bridge.getDockerStatus(serverId);
        setStatus(result);
      } else {
        setStatus({ available: false, insideDocker: false, dindAvailable: false, error: 'Docker check not available' });
      }
    } catch (e) {
      log.error('Failed to check Docker status:', e);
      setStatus({ available: false, insideDocker: false, dindAvailable: false, error: 'Failed to check' });
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Clipboard may not be available
    }
  };

  if (loading) {
    return (
      <Card variant="outlined" padding="md" style={{ marginBottom: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Spinner size="sm" />
          <Text color="secondary">Checking Docker status...</Text>
        </View>
      </Card>
    );
  }

  // Docker is available — show a green status
  if (status?.available) {
    if (compact) {
      return (
        <View style={[styles.compactRow, { borderColor: colors.border.light }]}>
          <Text style={{ color: colors.text.primary, fontSize: 14 }}>Docker</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Badge variant="success" size="sm">
              v{status.version}
            </Badge>
            {status.insideDocker && (
              <Badge variant="info" size="sm">In Docker</Badge>
            )}
          </View>
        </View>
      );
    }

    return (
      <Card variant="outlined" padding="md" style={{ marginBottom: 16 }}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text variant="label" style={{ color: colors.text.primary, fontSize: 16, fontWeight: '600' }}>
              Docker
            </Text>
          </View>
          <Badge variant="success" size="sm">
            Installed (v{status.version})
          </Badge>
        </View>
        {status.insideDocker && (
          <View style={[styles.dindSection, { borderTopColor: colors.border.light }]}>
            <Text style={{ color: colors.text.secondary, fontSize: 13 }}>
              This server is running inside a Docker container.
              {status.dindAvailable
                ? ' Docker-in-Docker is available — agent containers will work.'
                : ' Docker-in-Docker is not configured. To enable sandboxed agent sessions, mount the Docker socket or enable DinD.'}
            </Text>
            {!status.dindAvailable && (
              <View style={{ marginTop: 8 }}>
                <Text style={{ color: colors.text.muted, fontSize: 12, fontFamily: 'monospace' }}>
                  Mount the socket: -v /var/run/docker.sock:/var/run/docker.sock
                </Text>
              </View>
            )}
          </View>
        )}
      </Card>
    );
  }

  // Docker is NOT available — show install helper
  const instructions = getInstallInstructions();

  return (
    <Card variant="outlined" padding="md" style={{ marginBottom: 16 }}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text variant="label" style={{ color: colors.text.primary, fontSize: 16, fontWeight: '600' }}>
            Docker
          </Text>
          <Text style={{ color: colors.text.secondary, fontSize: 13, marginTop: 2 }}>
            Docker is required for sandboxed agent sessions
          </Text>
        </View>
        <Badge variant="warning" size="sm">Not Installed</Badge>
      </View>

      {/* Docker-in-Docker guidance for remote servers running inside Docker */}
      {status?.insideDocker && !status.dindAvailable && (
        <View style={[styles.dindSection, { borderTopColor: colors.border.light }]}>
          <Text style={{ color: colors.warning, fontSize: 13, fontWeight: '500' }}>
            Docker-in-Docker Required
          </Text>
          <Text style={{ color: colors.text.secondary, fontSize: 13, marginTop: 4 }}>
            This server is running inside Docker but docker-in-docker is not available.
            You need to either:
          </Text>
          <View style={{ marginTop: 8, gap: 6 }}>
            <Text style={{ color: colors.text.secondary, fontSize: 12 }}>
              1. Mount the Docker socket when starting this container:
            </Text>
            <Pressable onPress={() => copyToClipboard('-v /var/run/docker.sock:/var/run/docker.sock')}>
              <View style={[styles.codeBlock, { backgroundColor: colors.bg.tertiary || colors.bg.secondary }]}>
                <Text style={{ color: colors.text.primary, fontSize: 12, fontFamily: 'monospace' }}>
                  -v /var/run/docker.sock:/var/run/docker.sock
                </Text>
              </View>
            </Pressable>
            <Text style={{ color: colors.text.secondary, fontSize: 12, marginTop: 4 }}>
              2. Or use Docker-in-Docker (DinD) by running with --privileged flag
            </Text>
          </View>
        </View>
      )}

      {/* Install instructions */}
      <View style={[styles.installSection, { borderTopColor: colors.border.light }]}>
        <Pressable onPress={() => setShowInstructions(!showInstructions)}>
          <View style={styles.installHeader}>
            <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '500' }}>
              {showInstructions ? 'Hide' : 'Show'} Install Instructions ({instructions.platform})
            </Text>
            <Text style={{ color: colors.primary, fontSize: 16 }}>
              {showInstructions ? '−' : '+'}
            </Text>
          </View>
        </Pressable>

        {showInstructions && (
          <View style={{ marginTop: 12, gap: 8 }}>
            <Text style={{ color: colors.text.secondary, fontSize: 13, fontWeight: '500' }}>
              {instructions.method}
            </Text>

            {instructions.steps.map((step, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
                <Text style={{ color: colors.text.muted, fontSize: 13, width: 20 }}>{i + 1}.</Text>
                <Text style={{ color: colors.text.secondary, fontSize: 13, flex: 1 }}>{step}</Text>
              </View>
            ))}

            {instructions.command && (
              <View style={{ marginTop: 8 }}>
                <Text style={{ color: colors.text.secondary, fontSize: 12, marginBottom: 4 }}>
                  Install command:
                </Text>
                <Pressable onPress={() => copyToClipboard(instructions.command!)}>
                  <View style={[styles.codeBlock, { backgroundColor: colors.bg.tertiary || colors.bg.secondary }]}>
                    <Text style={{ color: colors.text.primary, fontSize: 12, fontFamily: 'monospace' }}>
                      {instructions.command}
                    </Text>
                    <Text style={{ color: colors.text.muted, fontSize: 10, marginLeft: 8 }}>
                      {copied ? 'Copied!' : 'Click to copy'}
                    </Text>
                  </View>
                </Pressable>
              </View>
            )}

            {instructions.downloadUrl && (
              <View style={{ marginTop: 8 }}>
                <Button
                  variant="secondary"
                  size="sm"
                  onPress={() => {
                    if (typeof window !== 'undefined' && window.open) {
                      window.open(instructions.downloadUrl!, '_blank');
                    }
                  }}
                >
                  Download Docker Desktop
                </Button>
              </View>
            )}

            <View style={{ marginTop: 12 }}>
              <Button
                variant="primary"
                size="sm"
                onPress={checkDocker}
              >
                Re-check Docker
              </Button>
            </View>
          </View>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dindSection: {
    borderTopWidth: 1,
    marginTop: 12,
    paddingTop: 12,
  },
  installSection: {
    borderTopWidth: 1,
    marginTop: 12,
    paddingTop: 12,
  },
  installHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  codeBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 6,
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 6,
    marginBottom: 8,
  },
});
