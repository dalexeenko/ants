import React, { useEffect, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import {
  ThemeContext,
  useUIStore,
  useProjectStore,
  useSessionStore,
  Text,
  Button,
  IconButton,
  Divider,
  ConfirmDialog,
  ProjectSection,
  ProjectSetupModal,
  ResizablePanel,
  LEFT_SIDEBAR_MIN_WIDTH,
  LEFT_SIDEBAR_COLLAPSE_THRESHOLD,
  type Session,
  type Project,
  type RemoteServerConfig,
  createLogger,
} from '../index';
import { usePlatform } from '../platform/PlatformContext';

const log = createLogger('ProjectSidebar');

export function ProjectSidebar() {
  const { colors } = React.useContext(ThemeContext);
  const platform = usePlatform();
  const { projects, currentProjectId, setCurrentProject, addProject, removeProject } = useProjectStore();
  const { sessionsByProject, currentSessionId, setCurrentSession, addSession, removeSession } = useSessionStore();
  const { 
    collapsedProjects, 
    toggleProjectCollapsed, 
    isProjectCollapsed, 
    setView,
    leftSidebarCollapsed,
    leftSidebarWidth,
    setLeftSidebarWidth,
    setLeftSidebarCollapsed,
  } = useUIStore();

  // Servers that couldn't be reached during the last sync (from uiStore)
  const unreachableServers = useUIStore((state) => state.unreachableServers);

  // Pre-fetch the documents path so we can provide a sync getter to ProjectSetupForm
  const [documentsPath, setDocumentsPath] = useState<string | null>(null);
  useEffect(() => {
    platform.getDocumentsPath?.()
      .then((p: string) => setDocumentsPath(p))
      .catch(() => {});
  }, [platform]);

  // Confirm dialog state for session deletion
  const [deleteSessionConfirm, setDeleteSessionConfirm] = useState<{
    visible: boolean;
    projectId: string;
    session: Session | null;
  }>({ visible: false, projectId: '', session: null });

  // Confirm dialog state for project deletion
  const [deleteProjectConfirm, setDeleteProjectConfirm] = useState<{
    visible: boolean;
    project: Project | null;
  }>({ visible: false, project: null });

  const handleNewSession = async (projectId: string, useWorktree = false) => {
    try {
      const options = useWorktree ? { useWorktree: true } : undefined;
      const session = await window.agentBridge?.createSession(projectId, options);
      if (session) {
        addSession(projectId, session);
        setCurrentSession(session.id);
        setCurrentProject(projectId);
        // Navigate to the chat view and switch to the new session's tabs
        setView('home');
        useUIStore.getState().setActiveScreen('project');
        useUIStore.getState().switchTabSession(session.id);
        if (useWorktree) {
          useUIStore.getState().addToast({
            message: 'Session launched in git worktree',
            type: 'success',
          });
        }
      }
    } catch (e) {
      log.error('Failed to create session:', e);
      useUIStore.getState().addToast({ 
        message: `Failed to create session: ${e instanceof Error ? e.message : 'Unknown error'}`, 
        type: 'error' 
      });
    }
  };

  const handleSelectSession = (projectId: string, session: Session) => {
    setCurrentProject(projectId);
    setCurrentSession(session.id);
    useSessionStore.getState().setDone(session.id, false); // Clear done indicator on select
    // Navigate to the chat view and switch to this session's tabs
    setView('home');
    useUIStore.getState().setActiveScreen('project');
    useUIStore.getState().switchTabSession(session.id);
  };

  const handleDeleteSession = (projectId: string, session: Session) => {
    setDeleteSessionConfirm({ visible: true, projectId, session });
  };

  const confirmDeleteSession = async () => {
    const { projectId, session } = deleteSessionConfirm;
    if (!session) return;

    try {
      await window.agentBridge?.deleteSession(projectId, session.id);
      removeSession(projectId, session.id);
      if (currentSessionId === session.id) {
        setCurrentSession(null);
      }
      useUIStore.getState().addToast({ message: 'Session deleted', type: 'success' });
    } catch (e) {
      log.error('Failed to delete session:', e);
      useUIStore.getState().addToast({ 
        message: `Failed to delete session: ${e instanceof Error ? e.message : 'Unknown error'}`, 
        type: 'error' 
      });
    } finally {
      setDeleteSessionConfirm({ visible: false, projectId: '', session: null });
    }
  };

  const handleDeleteProject = (project: Project) => {
    setDeleteProjectConfirm({ visible: true, project });
  };

  const confirmDeleteProject = async () => {
    const { project } = deleteProjectConfirm;
    if (!project) return;

    try {
      await window.agentBridge?.removeProject(project.id);
      removeProject(project.id);
      if (currentProjectId === project.id) {
        setCurrentProject(null);
      }
      useUIStore.getState().addToast({ message: 'Project removed', type: 'success' });
    } catch (e) {
      log.error('Failed to remove project:', e);
      useUIStore.getState().addToast({ 
        message: `Failed to remove project: ${e instanceof Error ? e.message : 'Unknown error'}`, 
        type: 'error' 
      });
    } finally {
      setDeleteProjectConfirm({ visible: false, project: null });
    }
  };

  const handleProjectSettings = (project: Project) => {
    setCurrentProject(project.id);
    setView('projectSettings');
  };

  const [showProjectSetup, setShowProjectSetup] = useState(false);

  const handleProjectCreated = (project: Project) => {
    addProject(project);
    setCurrentProject(project.id);
    setShowProjectSetup(false);
  };

  if (leftSidebarCollapsed) {
    return null;
  }

  return (
    <ResizablePanel
      width={leftSidebarWidth}
      minWidth={LEFT_SIDEBAR_MIN_WIDTH}
      collapseThreshold={LEFT_SIDEBAR_COLLAPSE_THRESHOLD}
      collapsed={leftSidebarCollapsed}
      handleSide="right"
      onWidthChange={setLeftSidebarWidth}
      onCollapsedChange={setLeftSidebarCollapsed}
      style={[styles.sidebar, { backgroundColor: colors.bg.secondary }]}
    >
      <View testID="ants-project-sidebar" style={styles.sidebarHeader}>
        <Text style={[styles.brandWordmark, { color: colors.primary }]}>ants</Text>
        <View style={styles.sidebarHeaderActions}>
          <IconButton testID="ants-sidebar-refresh" icon="refresh" size="sm" variant="ghost" onPress={async () => {
            if (!window.agentBridge) return;
            try {
              const result = await window.agentBridge.syncRemoteProjects();
              useUIStore.getState().setUnreachableServers(result.unreachableServers);
              const updated = await window.agentBridge.listProjects();
              useProjectStore.getState().setProjects(updated);
              // Sync sessions for all remote projects
              for (const project of updated) {
                if (project.providerType === 'remote') {
                  try {
                    await window.agentBridge.syncRemoteSessions(project.id);
                    const sessions = await window.agentBridge.listSessions(project.id);
                    useSessionStore.getState().setSessions(project.id, sessions);
                  } catch (e) {
                    log.error(`Failed to sync sessions for ${project.name}:`, e);
                  }
                }
              }
            } catch (e) {
              log.error('Failed to refresh projects:', e);
            }
          }} />
          <IconButton testID="ants-sidebar-new-project" icon="plus" size="sm" variant="default" onPress={() => setShowProjectSetup(true)} />
        </View>
      </View>

      <Divider spacing="none" />

      <ScrollView style={styles.sidebarContent}>
        {projects.length === 0 && unreachableServers.length === 0 ? (
          <View style={styles.emptyProjects}>
            <Text color="muted" align="center">No projects yet</Text>
            <Button variant="secondary" size="sm" onPress={() => setShowProjectSetup(true)} style={styles.addProjectButton}>
              Add Project
            </Button>
          </View>
        ) : (
          <>
            {projects.map((project) => (
              <ProjectSection
                key={project.id}
                project={project}
                sessions={sessionsByProject[project.id] || []}
                selectedSessionId={currentProjectId === project.id ? currentSessionId || undefined : undefined}
                expanded={!isProjectCollapsed(project.id)}
                onToggleExpand={() => toggleProjectCollapsed(project.id)}
                onSelectSession={(session) => handleSelectSession(project.id, session)}
                onDeleteSession={(session) => handleDeleteSession(project.id, session)}
                onNewSession={() => handleNewSession(project.id)}
                onNewWorktreeSession={() => handleNewSession(project.id, true)}
                onProjectSettings={handleProjectSettings}
              />
            ))}
            {unreachableServers.map((server) => (
              <Pressable
                key={`unreachable-${server.id}`}
                style={[
                  styles.unreachableServer,
                  {
                    borderColor: colors.error,
                    backgroundColor: colors.error + '10',
                  },
                ]}
                onPress={() => {
                  useUIStore.getState().setSelectedServer(server);
                  setView('serverSettings');
                }}
              >
                <View style={styles.unreachableServerContent}>
                  <View style={[styles.unreachableServerDot, { backgroundColor: colors.error }]} />
                  <View style={styles.unreachableServerText}>
                    <Text weight="medium" numberOfLines={1}>{server.name}</Text>
                    <Text variant="caption" color="secondary">Unable to reach server</Text>
                  </View>
                </View>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>

      {/* Session delete confirmation */}
      <ConfirmDialog
        visible={deleteSessionConfirm.visible}
        title="Delete Session"
        message={`Are you sure you want to delete "${deleteSessionConfirm.session?.title || 'this session'}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        destructive
        onConfirm={confirmDeleteSession}
        onCancel={() => setDeleteSessionConfirm({ visible: false, projectId: '', session: null })}
      />

      {/* Project delete confirmation */}
      <ConfirmDialog
        visible={deleteProjectConfirm.visible}
        title="Remove Project"
        message={`Are you sure you want to remove "${deleteProjectConfirm.project?.name || 'this project'}" from Ants? The project files will not be deleted.`}
        confirmText="Remove"
        cancelText="Cancel"
        destructive
        onConfirm={confirmDeleteProject}
        onCancel={() => setDeleteProjectConfirm({ visible: false, project: null })}
      />

      {/* Project setup modal */}
      {window.agentBridge && (
        <ProjectSetupModal
          visible={showProjectSetup}
          onClose={() => setShowProjectSetup(false)}
          onProjectCreated={handleProjectCreated}
          bridge={window.agentBridge}
          openNativeDirectoryPicker={() =>
            platform.openDirectoryDialog?.() ?? Promise.resolve(null)
          }
          getDefaultProjectsDirectory={documentsPath ? () => `${documentsPath}/Ants Projects` : undefined}
          ensureDirectoryExists={async (p) => {
            await platform.ensureDirectoryExists?.(p);
          }}
          writeFile={async (filePath, content) => {
            await platform.writeFile?.(filePath, content);
          }}
        />
      )}
    </ResizablePanel>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    borderRightWidth: 1,
  },
  sidebarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  brandWordmark: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  sidebarHeaderActions: {
    flexDirection: 'row',
    gap: 4,
  },
  sidebarContent: {
    flex: 1,
  },
  emptyProjects: {
    padding: 24,
    alignItems: 'center',
  },
  addProjectButton: {
    marginTop: 12,
  },
  unreachableServer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 8,
    marginBottom: 4,
    borderWidth: 1,
    borderRadius: 6,
    cursor: 'pointer' as any,
  },
  unreachableServerContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    overflow: 'hidden',
  },
  unreachableServerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  unreachableServerText: {
    flex: 1,
    gap: 1,
  },
});
