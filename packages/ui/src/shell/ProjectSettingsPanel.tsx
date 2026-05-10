import React, { useEffect, useState } from 'react';
import { View, ScrollView, Pressable, TextInput, Switch, StyleSheet } from 'react-native';
import {
  ThemeContext,
  useUIStore,
  useProjectStore,
  useSessionStore,
  Text,
  Button,
  Card,
  EmptyState,
  ConfirmDialog,
  ErrorBoundary,
  ModelSettings,
  PromptSettings,
  McpServersSection,
  ToolSettings,
  ToolSettingsPage,
  PermissionSettings,
  SubagentSettings,
  SubagentSettingsPage,
  PluginSettings,
  DockerSettings,
  TasksDashboard,
  WebhooksDashboard,
  ApprovalsDashboard,
  KnowledgeBaseBrowser,
  type RemoteServerConfig,
  createLogger,
} from '../index';
import { usePluginSettingsSections } from '../plugins';
import { usePlatform } from '../platform/PlatformContext';
import { IconButton } from '../primitives/IconButton';

const log = createLogger('ProjectSettingsPanel');

type ProjectSettingsScreen = 'main' | 'tools' | 'subagents' | 'tasks' | 'webhooks' | 'approvals' | 'knowledge';

export function ProjectSettingsPanel({ projectId }: { projectId: string }) {
  const { colors } = React.useContext(ThemeContext);
  const platform = usePlatform();
  const { setView } = useUIStore();
  const { projects, updateProject: updateProjectInStore } = useProjectStore();
  const project = projects.find((p) => p.id === projectId);
  const [screen, setScreen] = useState<ProjectSettingsScreen>('main');
  const [name, setName] = useState(project?.name || '');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDeleteAllSessionsConfirm, setShowDeleteAllSessionsConfirm] = useState(false);
  const [remoteServer, setRemoteServer] = useState<RemoteServerConfig | null>(null);
  const pluginSettings = usePluginSettingsSections('project');

  // Load remote server info if this project uses one
  useEffect(() => {
    if (!project || project.providerType !== 'remote' || !project.remoteServerId || !window.agentBridge) {
      setRemoteServer(null);
      return;
    }
    window.agentBridge.listRemoteServers().then((servers) => {
      const server = servers.find((s) => s.id === project.remoteServerId);
      setRemoteServer(server || null);
    }).catch((e) => {
      log.error('Failed to load remote server:', e);
    });
  }, [project?.providerType, project?.remoteServerId]);

  const handleNameBlur = async () => {
    if (!project || !window.agentBridge) return;
    const trimmed = name.trim();
    if (trimmed && trimmed !== project.name) {
      try {
        await window.agentBridge.updateProject(projectId, { name: trimmed });
        updateProjectInStore(projectId, { name: trimmed });
      } catch (e) {
        log.error('Failed to update project name:', e);
        setName(project.name);
      }
    } else {
      setName(project.name);
    }
  };

  if (!project) {
    return (
      <View style={[styles.settingsContainer, { backgroundColor: colors.bg.primary }]}>
        <EmptyState
          icon="folder"
          title="Project Not Found"
          description="The selected project could not be found"
          actionLabel="Go Back"
          onAction={() => setView('home')}
        />
      </View>
    );
  }

  // Tools page
  if (screen === 'tools' && window.agentBridge) {
    return (
      <ToolSettingsPage
        bridge={window.agentBridge}
        projectId={projectId}
        onBack={() => setScreen('main')}
      />
    );
  }

  // Subagents page
  if (screen === 'subagents' && window.agentBridge) {
    return (
      <SubagentSettingsPage
        bridge={window.agentBridge}
        projectId={projectId}
        onBack={() => setScreen('main')}
      />
    );
  }

  // Tasks dashboard (remote projects only)
  if (screen === 'tasks' && window.agentBridge && project) {
    return (
      <View style={[styles.settingsContainer, { backgroundColor: colors.bg.primary }]}>
        <View style={[styles.settingsHeader, { borderBottomColor: colors.border.light }]}>
          <Pressable onPress={() => setScreen('main')} style={styles.backButton}>
            <Text style={{ color: colors.primary }}>← Back</Text>
          </Pressable>
          <Text variant="heading" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>Scheduled Tasks</Text>
          <View style={{ width: 60 }} />
        </View>
        <ScrollView style={styles.settingsContent} contentContainerStyle={styles.settingsContentInner}>
          <TasksDashboard bridge={window.agentBridge} project={project} />
        </ScrollView>
      </View>
    );
  }

  // Webhooks dashboard (remote projects only)
  if (screen === 'webhooks' && window.agentBridge && project) {
    return (
      <View style={[styles.settingsContainer, { backgroundColor: colors.bg.primary }]}>
        <View style={[styles.settingsHeader, { borderBottomColor: colors.border.light }]}>
          <Pressable onPress={() => setScreen('main')} style={styles.backButton}>
            <Text style={{ color: colors.primary }}>← Back</Text>
          </Pressable>
          <Text variant="heading" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>Webhooks</Text>
          <View style={{ width: 60 }} />
        </View>
        <ScrollView style={styles.settingsContent} contentContainerStyle={styles.settingsContentInner}>
          <WebhooksDashboard bridge={window.agentBridge} project={project} serverUrl={remoteServer?.url} />
        </ScrollView>
      </View>
    );
  }

  // Approvals dashboard (remote projects only)
  if (screen === 'approvals' && window.agentBridge && project) {
    return (
      <View style={[styles.settingsContainer, { backgroundColor: colors.bg.primary }]}>
        <View style={[styles.settingsHeader, { borderBottomColor: colors.border.light }]}>
          <Pressable onPress={() => setScreen('main')} style={styles.backButton}>
            <Text style={{ color: colors.primary }}>← Back</Text>
          </Pressable>
          <Text variant="heading" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>Approvals</Text>
          <View style={{ width: 60 }} />
        </View>
        <ScrollView style={styles.settingsContent} contentContainerStyle={styles.settingsContentInner}>
          <ApprovalsDashboard bridge={window.agentBridge} project={project} />
        </ScrollView>
      </View>
    );
  }

  // Knowledge base browser (remote projects only)
  if (screen === 'knowledge' && window.agentBridge && project) {
    return (
      <View style={[styles.settingsContainer, { backgroundColor: colors.bg.primary }]}>
        <View style={[styles.settingsHeader, { borderBottomColor: colors.border.light }]}>
          <Pressable onPress={() => setScreen('main')} style={styles.backButton}>
            <Text style={{ color: colors.primary }}>← Back</Text>
          </Pressable>
          <Text variant="heading" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>Knowledge Base</Text>
          <View style={{ width: 60 }} />
        </View>
        <ScrollView style={styles.settingsContent} contentContainerStyle={styles.settingsContentInner}>
          <KnowledgeBaseBrowser bridge={window.agentBridge} project={project} />
        </ScrollView>
      </View>
    );
  }

  // Main settings page
  return (
    <View style={[styles.settingsContainer, { backgroundColor: colors.bg.primary }]}>
      <View style={[styles.settingsHeader, { borderBottomColor: colors.border.light }]}>
        <Pressable onPress={() => setView('home')} style={styles.backButton}>
          <Text style={{ color: colors.primary }}>← Back</Text>
        </Pressable>
        <Text variant="heading" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>
          {project.name}
        </Text>
        <View style={{ width: 60 }} />
      </View>
      <ScrollView style={styles.settingsContent} contentContainerStyle={styles.settingsContentInner}>
        {/* Project Name */}
        <Card variant="outlined" padding="md" style={{ marginBottom: 16 }}>
          <Text variant="label" style={{ color: colors.text.secondary, marginBottom: 8 }}>
            Project Name
          </Text>
          <TextInput
            style={{
              backgroundColor: colors.bg.secondary,
              borderColor: colors.border.light,
              color: colors.text.primary,
              borderWidth: 1,
              borderRadius: 6,
              paddingHorizontal: 12,
              paddingVertical: 8,
              fontSize: 14,
            }}
            value={name}
            onChangeText={setName}
            onBlur={handleNameBlur}
            placeholder="Enter project name"
            placeholderTextColor={colors.text.muted}
          />
        </Card>

        {/* Working Directory */}
        <Card variant="outlined" padding="md" style={{ marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text variant="label" style={{ color: colors.text.secondary }}>
              Working Directory
            </Text>
            {platform.openInFileBrowser && (
              <IconButton
                icon="folderOpen"
                size="sm"
                variant="ghost"
                onPress={() => platform.openInFileBrowser!(project.path)}
                accessibilityLabel="Open in file browser"
              />
            )}
          </View>
          <Text style={{ color: colors.text.muted, fontSize: 13, fontFamily: 'monospace' }} selectable>
            {project.path}
          </Text>
        </Card>

        {/* Remote Server */}
        {remoteServer && (
          <Pressable onPress={() => { useUIStore.getState().setSelectedServer(remoteServer); setView('serverSettings'); }}>
            <Card variant="outlined" padding="md" style={{ marginBottom: 16 }}>
              <Text variant="label" style={{ color: colors.text.secondary, marginBottom: 8 }}>
                Remote Server
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text.primary, fontSize: 14, fontWeight: '500' }}>
                    {remoteServer.name}
                  </Text>
                  <Text style={{ color: colors.text.muted, fontSize: 12, marginTop: 2 }}>
                    {remoteServer.url}
                  </Text>
                </View>
                <Text style={{ color: colors.text.muted, fontSize: 16 }}>›</Text>
              </View>
            </Card>
          </Pressable>
        )}

        {window.agentBridge && (
          <>
            <ModelSettings bridge={window.agentBridge} projectId={projectId} />
            {project && (
              <PromptSettings bridge={window.agentBridge} project={project} />
            )}
            <McpServersSection bridge={window.agentBridge} projectId={projectId} />
            <ToolSettings 
              bridge={window.agentBridge} 
              projectId={projectId}
              onNavigateToTools={() => setScreen('tools')}
            />
            <PermissionSettings bridge={window.agentBridge} projectId={projectId} />
            <SubagentSettings
              bridge={window.agentBridge}
              projectId={projectId}
              onNavigateToSubagents={() => setScreen('subagents')}
            />
            <PluginSettings
              bridge={window.agentBridge}
              projectId={projectId}
            />
            <DockerSettings
              bridge={window.agentBridge}
              project={project}
            />

            {/* Plugin-contributed project settings sections */}
            {pluginSettings.map((section) => {
              const SectionComponent = section.component;
              return (
                <ErrorBoundary key={section.id} onError={(error) => log.error(`Plugin settings section "${section.id}" error:`, error)}>
                  <SectionComponent
                    bridge={window.agentBridge!}
                    projectId={projectId}
                    pluginName={section.pluginName}
                  />
                </ErrorBoundary>
              );
            })}

            {/* Advanced Session Settings */}
            <Card variant="outlined" padding="md" style={{ marginBottom: 16 }}>
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
                          if (!window.agentBridge) return;
                          try {
                            await window.agentBridge.updateProject(projectId, { defaultMode: mode });
                            updateProjectInStore(projectId, { defaultMode: mode });
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
                  style={{
                    backgroundColor: colors.bg.secondary,
                    borderColor: colors.border.light,
                    color: colors.text.primary,
                    borderWidth: 1,
                    borderRadius: 6,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    fontSize: 14,
                    width: 100,
                  }}
                  keyboardType="numeric"
                  defaultValue={String(project.maxAutoCompleteLoops || 25)}
                  placeholder="25"
                  placeholderTextColor={colors.text.muted}
                  onEndEditing={(e) => {
                    const val = parseInt(e.nativeEvent.text, 10);
                    if (!isNaN(val) && val > 0 && val <= 100 && window.agentBridge) {
                      window.agentBridge.updateProject(projectId, { maxAutoCompleteLoops: val }).then(() => {
                        updateProjectInStore(projectId, { maxAutoCompleteLoops: val });
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

            {/* Worktree Support (local git repos only) */}
            {project.providerType === 'local' && project.isGitRepo && (
              <Card variant="outlined" padding="md" style={{ marginBottom: 16 }}>
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
                      if (!window.agentBridge) return;
                      try {
                        await window.agentBridge.updateProject(projectId, { worktreeEnabled: value });
                        updateProjectInStore(projectId, { worktreeEnabled: value });
                      } catch (e) {
                        log.error('Failed to update worktreeEnabled:', e);
                      }
                    }}
                    trackColor={{ false: colors.bg.tertiary, true: colors.primary + '60' }}
                    thumbColor={project.worktreeEnabled ? colors.primary : colors.text.muted}
                  />
                </View>
              </Card>
            )}

            {/* Advanced features (remote projects only) */}
            {project.providerType === 'remote' && (
              <Card variant="outlined" padding="md" style={{ marginBottom: 16 }}>
                <Text variant="label" style={{ color: colors.text.primary, fontSize: 16, fontWeight: '600', marginBottom: 12 }}>
                  Advanced Features
                </Text>
                <View style={{ gap: 8 }}>
                  <Pressable onPress={() => setScreen('tasks')}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}>
                      <View>
                        <Text style={{ color: colors.text.primary, fontSize: 14, fontWeight: '500' }}>Scheduled Tasks</Text>
                        <Text style={{ color: colors.text.secondary, fontSize: 12 }}>Cron-based recurring agent sessions</Text>
                      </View>
                      <Text style={{ color: colors.text.muted, fontSize: 16 }}>›</Text>
                    </View>
                  </Pressable>
                  <View style={{ height: 1, backgroundColor: colors.border.light }} />
                  <Pressable onPress={() => setScreen('webhooks')}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}>
                      <View>
                        <Text style={{ color: colors.text.primary, fontSize: 14, fontWeight: '500' }}>Webhooks</Text>
                        <Text style={{ color: colors.text.secondary, fontSize: 12 }}>External event triggers and file watchers</Text>
                      </View>
                      <Text style={{ color: colors.text.muted, fontSize: 16 }}>›</Text>
                    </View>
                  </Pressable>
                  <View style={{ height: 1, backgroundColor: colors.border.light }} />
                  <Pressable onPress={() => setScreen('approvals')}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}>
                      <View>
                        <Text style={{ color: colors.text.primary, fontSize: 14, fontWeight: '500' }}>Approvals</Text>
                        <Text style={{ color: colors.text.secondary, fontSize: 12 }}>Tool execution approval rules and requests</Text>
                      </View>
                      <Text style={{ color: colors.text.muted, fontSize: 16 }}>›</Text>
                    </View>
                  </Pressable>
                  <View style={{ height: 1, backgroundColor: colors.border.light }} />
                  <Pressable onPress={() => setScreen('knowledge')}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}>
                      <View>
                        <Text style={{ color: colors.text.primary, fontSize: 14, fontWeight: '500' }}>Knowledge Base</Text>
                        <Text style={{ color: colors.text.secondary, fontSize: 12 }}>Agent memory across sessions</Text>
                      </View>
                      <Text style={{ color: colors.text.muted, fontSize: 16 }}>›</Text>
                    </View>
                  </Pressable>
                </View>
              </Card>
            )}
          </>
        )}

        {/* Danger Zone */}
        <Card variant="outlined" padding="md" style={{ marginTop: 24, borderColor: colors.error }}>
          <Text variant="heading" style={{ color: colors.error, marginBottom: 8 }}>
            Danger Zone
          </Text>
          <View style={{ gap: 12 }}>
            <View>
              <Text color="secondary" style={{ marginBottom: 8 }}>
                Delete all sessions and their message history for this project.
              </Text>
              <Button
                variant="danger"
                size="sm"
                onPress={() => setShowDeleteAllSessionsConfirm(true)}
              >
                Delete All Sessions
              </Button>
            </View>
            <View style={{ height: 1, backgroundColor: colors.border.light }} />
            <View>
              <Text color="secondary" style={{ marginBottom: 8 }}>
                Remove this project from Ants. Project files will not be deleted.
              </Text>
              <Button
                variant="danger"
                size="sm"
                onPress={() => setShowDeleteConfirm(true)}
              >
                Remove Project
              </Button>
            </View>
          </View>
        </Card>
      </ScrollView>

      <ConfirmDialog
        visible={showDeleteAllSessionsConfirm}
        title="Delete All Sessions"
        message={`Are you sure you want to delete all sessions for "${project.name}"? This will permanently remove all session history and cannot be undone.`}
        confirmText="Delete All"
        cancelText="Cancel"
        destructive
        onConfirm={async () => {
          if (!window.agentBridge || !project) return;
          try {
            const result = await window.agentBridge.deleteAllSessions(projectId);
            useSessionStore.getState().clearProjectData(projectId);
            useUIStore.getState().addToast({
              message: `Deleted ${result.deletedCount} session${result.deletedCount === 1 ? '' : 's'}`,
              type: 'success',
            });
          } catch (e) {
            useUIStore.getState().addToast({
              message: `Failed to delete sessions: ${e instanceof Error ? e.message : 'Unknown error'}`,
              type: 'error',
            });
          } finally {
            setShowDeleteAllSessionsConfirm(false);
          }
        }}
        onCancel={() => setShowDeleteAllSessionsConfirm(false)}
      />

      <ConfirmDialog
        visible={showDeleteConfirm}
        title="Remove Project"
        message={`Are you sure you want to remove "${project.name}" from Ants? The project files will not be deleted.`}
        confirmText="Remove"
        cancelText="Cancel"
        destructive
        onConfirm={async () => {
          if (!window.agentBridge || !project) return;
          try {
            await window.agentBridge.removeProject(projectId);
            useProjectStore.getState().removeProject(projectId);
            setView('home');
            useUIStore.getState().addToast({ message: 'Project removed', type: 'success' });
          } catch (e) {
            useUIStore.getState().addToast({
              message: `Failed to remove project: ${e instanceof Error ? e.message : 'Unknown error'}`,
              type: 'error',
            });
          } finally {
            setShowDeleteConfirm(false);
          }
        }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 60,
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
