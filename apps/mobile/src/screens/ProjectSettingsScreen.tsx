import React, { useState, useEffect } from 'react';
import { View, ScrollView, StyleSheet, Alert, TextInput, Pressable, Switch } from 'react-native';
import {
  ThemeContext,
  Text,
  Button,
  IconButton,
  Card,
  McpServersSection,
  ToolSettings,
  ToolSettingsPage,
  PermissionSettings,
  ModelSettings,
  SubagentSettings,
  SubagentSettingsPage,
  PromptSettings,
  TasksDashboard,
  ApprovalsDashboard,
  useProjectStore,
  useSessionStore,
  type AgentBridge,
  createLogger,
  type RemoteServerConfig,
} from '@openmgr/ui';

const log = createLogger('ProjectSettingsScreen');

type SettingsView = 'main' | 'tools' | 'subagents' | 'tasks' | 'approvals';

interface ProjectSettingsScreenProps {
  bridge: AgentBridge;
  projectId: string;
  projectName?: string;
  projectPath?: string;
  onNavigateBack: () => void;
  onDeleteProject?: (projectId: string) => void;
  onNavigateToServerSettings?: (server: RemoteServerConfig) => void;
}

export function ProjectSettingsScreen({
  bridge,
  projectId,
  projectName,
  projectPath,
  onNavigateBack,
  onDeleteProject,
  onNavigateToServerSettings,
}: ProjectSettingsScreenProps) {
  const { colors } = React.useContext(ThemeContext);
  const [view, setView] = useState<SettingsView>('main');
  const [name, setName] = useState(projectName || '');
  const [remoteServer, setRemoteServer] = useState<RemoteServerConfig | null>(null);

  // Look up the project to check if it uses a remote server
  const project = useProjectStore((state) => state.projects.find((p) => p.id === projectId));

  // Load remote server info if this project uses one
  useEffect(() => {
    if (project?.providerType !== 'remote' || !project.remoteServerId) {
      setRemoteServer(null);
      return;
    }
    bridge.listRemoteServers().then((servers) => {
      const server = servers.find((s) => s.id === project.remoteServerId);
      setRemoteServer(server || null);
    }).catch((e) => {
      log.error('Failed to load remote server:', e);
    });
  }, [project?.providerType, project?.remoteServerId, bridge]);

  // Sync local name with prop when it changes
  useEffect(() => {
    setName(projectName || '');
  }, [projectName]);

  const handleNameBlur = async () => {
    const trimmedName = name.trim();
    if (trimmedName && trimmedName !== projectName) {
      try {
        await bridge.updateProject(projectId, { name: trimmedName });
      } catch (e) {
        log.error('Failed to update project name:', e);
        // Revert to original name on error
        setName(projectName || '');
      }
    } else if (!trimmedName) {
      // Revert to original if empty
      setName(projectName || '');
    }
  };

  const handleDeleteAllSessions = () => {
    Alert.alert(
      'Delete All Sessions',
      `Are you sure you want to delete all sessions for "${projectName || 'this project'}"? This will permanently remove all session history and cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await bridge.deleteAllSessions(projectId);
              useSessionStore.getState().clearProjectData(projectId);
              Alert.alert('Done', `Deleted ${result.deletedCount} session${result.deletedCount === 1 ? '' : 's'}.`);
            } catch (e) {
              log.error('Failed to delete all sessions:', e);
              Alert.alert('Error', `Failed to delete sessions: ${e instanceof Error ? e.message : 'Unknown error'}`);
            }
          },
        },
      ]
    );
  };

  const handleDeleteProject = () => {
    Alert.alert(
      'Delete Project',
      `Are you sure you want to delete "${projectName || 'this project'}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            onDeleteProject?.(projectId);
            onNavigateBack();
          },
        },
      ]
    );
  };

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

  // Tasks dashboard (remote projects only)
  if (view === 'tasks' && project) {
    return (
      <View style={[styles.container, { backgroundColor: colors.bg.primary }]}>
        <View style={[styles.header, { borderBottomColor: colors.border.light }]}>
          <IconButton icon="arrow-left" size="md" onPress={() => setView('main')} />
          <View style={styles.headerTitle}>
            <Text variant="heading" numberOfLines={1}>Scheduled Tasks</Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>
        <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
          <TasksDashboard bridge={bridge} project={project} />
        </ScrollView>
      </View>
    );
  }

  // Approvals dashboard (remote projects only)
  if (view === 'approvals' && project) {
    return (
      <View style={[styles.container, { backgroundColor: colors.bg.primary }]}>
        <View style={[styles.header, { borderBottomColor: colors.border.light }]}>
          <IconButton icon="arrow-left" size="md" onPress={() => setView('main')} />
          <View style={styles.headerTitle}>
            <Text variant="heading" numberOfLines={1}>Approvals</Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>
        <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
          <ApprovalsDashboard bridge={bridge} project={project} />
        </ScrollView>
      </View>
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
            Project Settings
          </Text>
          <Text variant="caption" numberOfLines={1} style={{ color: colors.text.secondary }}>
            {name || 'Project'}
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {/* Settings Content */}
      <ScrollView 
        style={styles.content} 
        contentContainerStyle={styles.contentInner}
      >
        {/* Project Name */}
        <Card variant="outlined" padding="md">
          <Text variant="label" style={{ color: colors.text.secondary, marginBottom: 8 }}>
            Project Name
          </Text>
          <TextInput
            style={[
              styles.nameInput,
              {
                backgroundColor: colors.bg.secondary,
                borderColor: colors.border.light,
                color: colors.text.primary,
              },
            ]}
            value={name}
            onChangeText={setName}
            onBlur={handleNameBlur}
            placeholder="Enter project name"
            placeholderTextColor={colors.text.muted}
          />
        </Card>

        {/* Working Directory */}
        {projectPath ? (
          <Card variant="outlined" padding="md">
            <Text variant="label" style={{ color: colors.text.secondary, marginBottom: 8 }}>
              Working Directory
            </Text>
            <Text style={{ color: colors.text.muted, fontSize: 13, fontFamily: 'monospace' }} selectable>
              {projectPath}
            </Text>
          </Card>
        ) : null}

        {/* Remote Server */}
        {remoteServer && (
          <Pressable
            onPress={() => onNavigateToServerSettings?.(remoteServer)}
            disabled={!onNavigateToServerSettings}
          >
            <Card variant="outlined" padding="md">
              <Text variant="label" style={{ color: colors.text.secondary, marginBottom: 8 }}>
                Remote Server
              </Text>
              <View style={styles.remoteServerRow}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text.primary, fontSize: 15, fontWeight: '500' }}>
                    {remoteServer.name}
                  </Text>
                  <Text style={{ color: colors.text.muted, fontSize: 12, marginTop: 2 }}>
                    {remoteServer.url}
                  </Text>
                </View>
                {onNavigateToServerSettings && (
                  <Text style={{ color: colors.text.muted, fontSize: 18 }}>›</Text>
                )}
              </View>
            </Card>
          </Pressable>
        )}

        <ModelSettings bridge={bridge} projectId={projectId} />
        {project && (
          <PromptSettings bridge={bridge} project={project} />
        )}
        <McpServersSection bridge={bridge} projectId={projectId} sseOnly />
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

        {/* Session Defaults */}
        {project && (
          <Card variant="outlined" padding="md">
            <Text variant="label" style={{ color: colors.text.primary, fontSize: 16, fontWeight: '600', marginBottom: 12 }}>
              Session Defaults
            </Text>

            {/* Default Mode */}
            <View style={{ marginBottom: 16 }}>
              <Text variant="label" style={{ color: colors.text.secondary, marginBottom: 8 }}>
                Default Session Mode
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['plan', 'build'] as const).map((mode) => {
                  const isActive = (project.defaultMode || 'build') === mode;
                  return (
                    <Pressable
                      key={mode}
                      onPress={async () => {
                        try {
                          await bridge.updateProject(projectId, { defaultMode: mode });
                          useProjectStore.getState().updateProject(projectId, { defaultMode: mode });
                        } catch (e) {
                          log.error('Failed to update default mode:', e);
                        }
                      }}
                      style={{
                        flex: 1,
                        paddingVertical: 8,
                        paddingHorizontal: 12,
                        borderRadius: 6,
                        borderWidth: 1,
                        borderColor: isActive ? colors.primary : colors.border.light,
                        backgroundColor: isActive ? colors.primary + '15' : colors.bg.secondary,
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{
                        color: isActive ? colors.primary : colors.text.secondary,
                        fontWeight: isActive ? '600' : '400',
                        fontSize: 13,
                      }}>
                        {mode === 'plan' ? 'Plan' : 'Build'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={{ color: colors.text.muted, fontSize: 11, marginTop: 4 }}>
                New sessions will start in this mode by default
              </Text>
            </View>

            {/* Max Auto-Complete Loops */}
            <View>
              <Text variant="label" style={{ color: colors.text.secondary, marginBottom: 8 }}>
                Max Auto-Complete Loops
              </Text>
              <TextInput
                style={[
                  styles.nameInput,
                  {
                    backgroundColor: colors.bg.secondary,
                    borderColor: colors.border.light,
                    color: colors.text.primary,
                    width: 100,
                  },
                ]}
                keyboardType="numeric"
                defaultValue={String(project.maxAutoCompleteLoops || 25)}
                placeholder="25"
                placeholderTextColor={colors.text.muted}
                onEndEditing={(e) => {
                  const val = parseInt(e.nativeEvent.text, 10);
                  if (!isNaN(val) && val > 0 && val <= 100) {
                    bridge.updateProject(projectId, { maxAutoCompleteLoops: val }).then(() => {
                      useProjectStore.getState().updateProject(projectId, { maxAutoCompleteLoops: val });
                    }).catch((err) => {
                      log.error('Failed to update maxAutoCompleteLoops:', err);
                    });
                  }
                }}
              />
              <Text style={{ color: colors.text.muted, fontSize: 11, marginTop: 4 }}>
                Limits how many times the agent auto-continues when tasks remain (1-100)
              </Text>
            </View>
          </Card>
        )}

        {/* Worktree Support (remote git repos only — local mobile projects never have git) */}
        {project?.providerType === 'remote' && project.isGitRepo && (
          <Card variant="outlined" padding="md">
            <Text variant="label" style={{ color: colors.text.primary, fontSize: 16, fontWeight: '600', marginBottom: 12 }}>
              Git Worktree
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={{ color: colors.text.primary, fontSize: 14, fontWeight: '500' }}>
                  Enable Worktree Sessions
                </Text>
                <Text style={{ color: colors.text.muted, fontSize: 11, marginTop: 4 }}>
                  Launch sessions in isolated git worktrees so changes can be reviewed and merged separately
                </Text>
              </View>
              <Switch
                value={project.worktreeEnabled ?? false}
                onValueChange={async (value) => {
                  try {
                    await bridge.updateProject(projectId, { worktreeEnabled: value });
                    useProjectStore.getState().updateProject(projectId, { worktreeEnabled: value });
                  } catch (e) {
                    log.error('Failed to update worktreeEnabled:', e);
                  }
                }}
              />
            </View>
          </Card>
        )}

        {/* Advanced Features (remote projects only) */}
        {project?.providerType === 'remote' && (
          <Card variant="outlined" padding="md">
            <Text variant="label" style={{ color: colors.text.primary, fontSize: 16, fontWeight: '600', marginBottom: 12 }}>
              Advanced Features
            </Text>
            <View style={{ gap: 8 }}>
              <Pressable onPress={() => setView('tasks')}>
                <View style={styles.advancedFeatureRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text.primary, fontSize: 14, fontWeight: '500' }}>Scheduled Tasks</Text>
                    <Text style={{ color: colors.text.secondary, fontSize: 12 }}>Cron-based recurring agent sessions</Text>
                  </View>
                  <Text style={{ color: colors.text.muted, fontSize: 16 }}>›</Text>
                </View>
              </Pressable>
              <View style={{ height: 1, backgroundColor: colors.border.light }} />
              <Pressable onPress={() => setView('approvals')}>
                <View style={styles.advancedFeatureRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text.primary, fontSize: 14, fontWeight: '500' }}>Approvals</Text>
                    <Text style={{ color: colors.text.secondary, fontSize: 12 }}>Tool execution approval rules and requests</Text>
                  </View>
                  <Text style={{ color: colors.text.muted, fontSize: 16 }}>›</Text>
                </View>
              </Pressable>
            </View>
          </Card>
        )}

        {/* Danger Zone */}
        <View style={styles.dangerZone}>
          <Text variant="label" style={{ color: colors.text.secondary, marginBottom: 8 }}>
            Danger Zone
          </Text>
          <Text style={{ color: colors.text.muted, fontSize: 13, marginBottom: 8 }}>
            Delete all sessions and their message history for this project.
          </Text>
          <Button
            variant="danger"
            onPress={handleDeleteAllSessions}
          >
            Delete All Sessions
          </Button>
          {onDeleteProject && (
            <>
              <View style={{ height: 1, backgroundColor: 'rgba(239, 68, 68, 0.2)', marginVertical: 16 }} />
              <Text style={{ color: colors.text.muted, fontSize: 13, marginBottom: 8 }}>
                Remove this project from OpenMgr. Project files will not be deleted.
              </Text>
              <Button
                variant="danger"
                onPress={handleDeleteProject}
              >
                Delete Project
              </Button>
            </>
          )}
        </View>
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
  remoteServerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dangerZone: {
    marginTop: 32,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(239, 68, 68, 0.2)',
  },
  nameInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  advancedFeatureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
});
