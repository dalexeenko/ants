import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from '../primitives/Text';
import { Button } from '../primitives/Button';
import { Modal } from '../primitives/Modal';
import { Badge } from '../primitives/Badge';
import { IconButton } from '../primitives/IconButton';
import { Input } from '../primitives/Input';
import { Spinner } from '../primitives/Spinner';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { useTheme } from '../styles/theme';
import { spacing, borderRadius } from '../styles/tokens';
import type { AgentBridge, PluginPackageInfo } from '../agent/types';
import { createLogger } from '../utils/logger';

const log = createLogger('PluginSettings');

interface PluginSettingsProps {
  bridge: AgentBridge;
  projectId: string;
}

export function PluginSettings({ bridge, projectId }: PluginSettingsProps) {
  const { colors } = useTheme();
  const [installed, setInstalled] = useState<PluginPackageInfo[]>([]);
  const [registered, setRegistered] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [installPackage, setInstallPackage] = useState('');
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [uninstallConfirm, setUninstallConfirm] = useState<PluginPackageInfo | null>(null);
  const [uninstalling, setUninstalling] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    loadPlugins();
  }, [projectId]);

  // Auto-clear status messages
  useEffect(() => {
    if (statusMessage) {
      const timer = setTimeout(() => setStatusMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [statusMessage]);

  const loadPlugins = async () => {
    try {
      const result = await bridge.getPlugins(projectId);
      setInstalled(result.installed || []);
      setRegistered(result.registered || []);
    } catch (e) {
      log.error('Failed to load plugins:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleInstall = async () => {
    if (!installPackage.trim()) return;

    setInstalling(true);
    setInstallError(null);

    try {
      const result = await bridge.installPlugin(projectId, installPackage.trim());

      if (result.success) {
        setShowInstallModal(false);
        setInstallPackage('');
        setStatusMessage({
          text: `Installed ${result.packageName}@${result.version} (${result.plugins?.length ?? 0} plugin${(result.plugins?.length ?? 0) !== 1 ? 's' : ''})`,
          type: 'success',
        });
        await loadPlugins();
      } else {
        setInstallError(result.error || 'Installation failed');
      }
    } catch (e) {
      setInstallError(e instanceof Error ? e.message : 'Installation failed');
    } finally {
      setInstalling(false);
    }
  };

  const handleUninstall = async (pkg: PluginPackageInfo) => {
    setUninstalling(true);

    try {
      const result = await bridge.uninstallPlugin(projectId, pkg.packageName);

      if (result.success) {
        setStatusMessage({
          text: `Uninstalled ${pkg.packageName}`,
          type: 'success',
        });
        await loadPlugins();
      } else {
        setStatusMessage({
          text: result.error || 'Uninstall failed',
          type: 'error',
        });
      }
    } catch (e) {
      setStatusMessage({
        text: e instanceof Error ? e.message : 'Uninstall failed',
        type: 'error',
      });
    } finally {
      setUninstalling(false);
      setUninstallConfirm(null);
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (loading) {
    return (
      <View style={styles.sectionContainer}>
        <Text variant="heading">Plugins</Text>
        <Text color="secondary" style={styles.sectionDescription}>
          Install npm packages to add tools, providers, and commands
        </Text>
        <View style={styles.loadingRow}>
          <Spinner size="small" />
          <Text color="secondary">Loading plugins...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.sectionContainer}>
      {/* Header with install button */}
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderLeft}>
          <Text variant="heading">Plugins</Text>
          <Text color="secondary" style={styles.sectionDescription}>
            Install npm packages to add tools, providers, and commands
          </Text>
        </View>
        <Button size="sm" onPress={() => setShowInstallModal(true)}>
          Install Plugin
        </Button>
      </View>
      {/* Status message */}
      {statusMessage && (
        <View
          style={[
            styles.statusBanner,
            {
              backgroundColor: (statusMessage.type === 'success' ? colors.success : colors.error) + '15',
              borderColor: statusMessage.type === 'success' ? colors.success : colors.error,
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

      {/* Installed plugins list */}
      {installed.length === 0 ? (
        <View style={[styles.emptyState, { borderColor: colors.border.light }]}>
          <Text color="muted" align="center">
            No plugins installed
          </Text>
          <Text variant="caption" color="muted" align="center" style={styles.emptyHint}>
            Install an npm package to extend the agent with new tools and capabilities
          </Text>
        </View>
      ) : (
        installed.map((pkg) => (
          <View
            key={pkg.packageName}
            style={[styles.pluginCard, { borderColor: colors.border.light }]}
          >
            <View style={styles.pluginHeader}>
              <View style={styles.pluginInfo}>
                <View style={styles.pluginNameRow}>
                  <Text weight="medium">{pkg.packageName}</Text>
                  <Badge variant="primary" size="sm">{`v${pkg.version}`}</Badge>
                </View>
                <Text variant="caption" color="muted">
                  Installed {formatDate(pkg.installedAt)}
                </Text>
              </View>
              <IconButton
                icon="trash-2"
                size="sm"
                onPress={() => setUninstallConfirm(pkg)}
              />
            </View>

            {/* Plugin names */}
            {pkg.pluginNames.length > 0 && (
              <View style={styles.pluginNames}>
                {pkg.pluginNames.map((name) => (
                  <Badge
                    key={name}
                    variant={registered.includes(name) ? 'success' : 'default'}
                    size="sm"
                  >
                    {name}
                  </Badge>
                ))}
              </View>
            )}
          </View>
        ))
      )}

      {/* Install Modal */}
      <Modal
        visible={showInstallModal}
        onClose={() => {
          setShowInstallModal(false);
          setInstallPackage('');
          setInstallError(null);
        }}
        title="Install Plugin"
      >
        <View style={styles.modalContent}>
          <Text style={[styles.modalDescription, { color: colors.text.secondary }]}>
            Enter an npm package name to install. The package should export one or more
            AgentPlugin objects.
          </Text>

          <Input
            label="Package"
            value={installPackage}
            onChange={setInstallPackage}
            placeholder="e.g. my-agent-plugin or @scope/plugin@1.0.0"
            error={installError || undefined}
            autoFocus
          />

          <View style={styles.modalActions}>
            <Button
              variant="ghost"
              onPress={() => {
                setShowInstallModal(false);
                setInstallPackage('');
                setInstallError(null);
              }}
              disabled={installing}
            >
              Cancel
            </Button>
            <Button
              onPress={handleInstall}
              disabled={!installPackage.trim() || installing}
            >
              {installing ? 'Installing...' : 'Install'}
            </Button>
          </View>
        </View>
      </Modal>

      {/* Uninstall Confirm */}
      <ConfirmDialog
        visible={!!uninstallConfirm}
        title="Uninstall Plugin"
        message={`Are you sure you want to uninstall "${uninstallConfirm?.packageName}"? Its tools and capabilities will be removed.`}
        confirmText={uninstalling ? 'Uninstalling...' : 'Uninstall'}
        cancelText="Cancel"
        destructive
        onConfirm={() => uninstallConfirm && handleUninstall(uninstallConfirm)}
        onCancel={() => setUninstallConfirm(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sectionContainer: {
    marginBottom: spacing[6],
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing[3],
  },
  sectionHeaderLeft: {
    flex: 1,
  },
  sectionDescription: {
    marginTop: spacing[1],
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[4],
  },
  statusBanner: {
    padding: spacing[3],
    borderWidth: 1,
    borderRadius: borderRadius.md,
    marginBottom: spacing[3],
  },
  emptyState: {
    padding: spacing[4],
    borderWidth: 1,
    borderRadius: borderRadius.md,
    borderStyle: 'dashed',
  },
  emptyHint: {
    marginTop: spacing[1],
  },
  pluginCard: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing[3],
    marginBottom: spacing[2],
  },
  pluginHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  pluginInfo: {
    flex: 1,
  },
  pluginNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[0.5],
  },
  pluginNames: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[1],
    marginTop: spacing[2],
  },
  modalContent: {
    padding: spacing[4],
    gap: spacing[4],
  },
  modalDescription: {
    fontSize: 14,
    lineHeight: 20,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[2],
    marginTop: spacing[2],
  },
});
