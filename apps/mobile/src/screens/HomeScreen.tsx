import React, { useEffect, useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, Pressable, Alert } from 'react-native';
import {
  ThemeContext,
  Text,
  Button,
  Card,
  IconButton,
  EmptyState,
  Spinner,
  ProjectSection,
  AuthenticationSection,
  useProjectStore,
  useSessionStore,
  spacing,
  borderRadius,
  type Session,
  type AgentBridge,
  type AuthStatus,
  createLogger,
  type RemoteServerConfig,
} from '@ants/ui';

const log = createLogger('HomeScreen');

interface HomeScreenProps {
  bridge: AgentBridge;
  onNavigateToChat: (projectId: string, sessionId: string, sessionTitle?: string) => void;
  onNavigateToProjectSettings: (projectId: string, projectName?: string, projectPath?: string) => void;
  onNavigateToServerSettings: (server: RemoteServerConfig) => void;
  onNavigateToNewProject: () => void;
  onNavigateToSearch: () => void;
  onOpenDrawer: () => void;
}

export function HomeScreen({
  bridge,
  onNavigateToChat,
  onNavigateToProjectSettings,
  onNavigateToServerSettings,
  onNavigateToNewProject,
  onNavigateToSearch,
  onOpenDrawer,
}: HomeScreenProps) {
  const { colors } = React.useContext(ThemeContext);
  const { projects, setProjects } = useProjectStore();
  const { sessionsByProject, setSessions } = useSessionStore();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>();
  const [unreachableServers, setUnreachableServers] = useState<RemoteServerConfig[]>([]);
  const [hasRemoteServers, setHasRemoteServers] = useState(false);

  useEffect(() => {
    loadData(true); // Sync remote projects on initial load
  }, []);

  const loadData = async (syncRemote = false) => {
    try {
      // Phase 1: Load local data quickly so the UI can render
      const status = await bridge.getAuthStatus();
      setAuthStatus(status);

      // IMPORTANT: Load remote servers first (triggers lazy loading from storage)
      // This must happen before syncRemoteProjects() so it knows which servers to fetch from
      const servers = await bridge.listRemoteServers();
      setHasRemoteServers(servers.length > 0);

      // Load cached projects (includes any previously synced remote projects)
      const cachedProjects = await bridge.listProjects();
      setProjects(cachedProjects);

      if (cachedProjects.length === 1) {
        setExpandedProjects(new Set([cachedProjects[0].id]));
      }

      // Load cached sessions for local projects immediately
      for (const project of cachedProjects) {
        if (project.providerType !== 'remote') {
          try {
            const sessions = await bridge.listSessions(project.id);
            setSessions(project.id, sessions);
          } catch (e) {
            log.error(`Failed to load sessions for project ${project.id}:`, e);
          }
        }
      }
    } catch (e) {
      log.error('Failed to load local data:', e);
    } finally {
      // Clear the initial full-screen loading state so the UI renders
      setLoading(false);
    }

    // Phase 2: Sync remote data in the background
    if (syncRemote) {
      try {
        setSyncing(true);
        const result = await bridge.syncRemoteProjects();
        setUnreachableServers(result.unreachableServers);

        // Refresh the full project list now that remote projects are synced
        const projectList = await bridge.listProjects();
        setProjects(projectList);

        if (projectList.length === 1) {
          setExpandedProjects(new Set([projectList[0].id]));
        }

        // Sync and load sessions for remote projects
        for (const project of projectList) {
          if (project.providerType === 'remote') {
            try {
              await bridge.syncRemoteSessions(project.id);
              const sessions = await bridge.listSessions(project.id);
              setSessions(project.id, sessions);
            } catch (e) {
              log.error(`Failed to load sessions for project ${project.id}:`, e);
            }
          }
        }
      } catch (e) {
        log.error('Failed to sync remote data:', e);
      } finally {
        setSyncing(false);
        setRefreshing(false);
      }
    } else {
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadData(true); // Sync remote on pull-to-refresh
  };

  const handleToggleProject = useCallback((projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }, []);

  const createSession = async (projectId: string, useWorktree: boolean) => {
    try {
      const session = await bridge.createSession(projectId, useWorktree ? { useWorktree: true } : undefined);
      const currentSessions = sessionsByProject[projectId] || [];
      setSessions(projectId, [session, ...currentSessions]);
      setSelectedSessionId(session.id);
      onNavigateToChat(projectId, session.id, session.title || undefined);
    } catch (e) {
      log.error('Failed to create session:', e);
    }
  };

  const handleCreateSession = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (project?.isGitRepo && project?.worktreeEnabled) {
      Alert.alert(
        'New Session',
        'Would you like to launch this session in an isolated git worktree?',
        [
          { text: 'Normal', onPress: () => createSession(projectId, false) },
          { text: 'Worktree', onPress: () => createSession(projectId, true) },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
    } else {
      createSession(projectId, false);
    }
  };

  const handleSelectSession = useCallback((projectId: string, session: Session) => {
    setSelectedSessionId(session.id);
    onNavigateToChat(projectId, session.id, session.title || undefined);
  }, [onNavigateToChat]);

  const handleDeleteSession = useCallback(async (projectId: string, session: Session) => {
    try {
      await bridge.deleteSession(projectId, session.id);
      const currentSessions = sessionsByProject[projectId] || [];
      setSessions(projectId, currentSessions.filter((s) => s.id !== session.id));
      if (selectedSessionId === session.id) {
        setSelectedSessionId(undefined);
      }
    } catch (e) {
      log.error('Failed to delete session:', e);
    }
  }, [bridge, sessionsByProject, setSessions, selectedSessionId]);

  // Check if user is authenticated with any provider
  const isAuthenticated = authStatus?.anthropic.authenticated || 
    authStatus?.openai?.hasApiKey ||
    authStatus?.google?.hasApiKey ||
    authStatus?.openrouter?.hasApiKey ||
    authStatus?.groq?.hasApiKey ||
    authStatus?.xai?.hasApiKey;

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.bg.primary }]}>
        <Spinner size="large" />
        <Text color="secondary" style={styles.loadingText}>
          Loading...
        </Text>
      </View>
    );
  }

  return (
    <View testID="ants-home-screen" style={[styles.container, { backgroundColor: colors.bg.primary }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border.light }]}>
        <IconButton testID="ants-drawer-toggle" icon="menu" size="md" onPress={onOpenDrawer} />
        <Text variant="title">Ants</Text>
        <IconButton icon="search" size="md" onPress={onNavigateToSearch} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        {/* Auth Section - Show if not authenticated and no remote servers */}
        {!isAuthenticated && !hasRemoteServers && (
          <Card variant="outlined" padding="md" style={styles.authCard}>
            <Text variant="heading" style={styles.authTitle}>
              Get Started
            </Text>
            <Text color="secondary" style={styles.authDescription}>
              Sign in with Anthropic or add an API key to start chatting
            </Text>
            <AuthenticationSection bridge={bridge} />
          </Card>
        )}

        {/* Projects Section - show when authenticated OR remote servers are configured */}
        {(isAuthenticated || hasRemoteServers) && (
          <>
            {/* Compact auth hint when not locally authenticated but using remote servers */}
            {!isAuthenticated && hasRemoteServers && (
              <Card variant="outlined" padding="sm" style={styles.authCard}>
                <Text variant="caption" color="secondary">
                  Using remote server. Sign in locally for local projects.
                </Text>
              </Card>
            )}

            <View style={styles.sectionHeader}>
              <Text variant="heading">Projects</Text>
              <Button size="sm" variant="ghost" onPress={onNavigateToNewProject}>
                New Project
              </Button>
            </View>

            {projects.length === 0 && unreachableServers.length === 0 && !syncing ? (
              <EmptyState
                icon="📁"
                title="No Projects Yet"
                description="Create a project to start chatting"
                actionLabel="Create Project"
                onAction={onNavigateToNewProject}
              />
            ) : (
              <View style={styles.projectList}>
                {projects.map((project) => (
                  <ProjectSection
                    key={project.id}
                    project={project}
                    sessions={sessionsByProject[project.id] || []}
                    selectedSessionId={selectedSessionId}
                    expanded={expandedProjects.has(project.id)}
                    onToggleExpand={() => handleToggleProject(project.id)}
                    onSelectSession={(session) => handleSelectSession(project.id, session)}
                    onDeleteSession={(session) => handleDeleteSession(project.id, session)}
                    onNewSession={() => handleCreateSession(project.id)}
                    onProjectSettings={(p) => onNavigateToProjectSettings(p.id, p.name, p.path)}
                    loading={false}
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
                    onPress={() => onNavigateToServerSettings(server)}
                  >
                    <View style={styles.unreachableServerContent}>
                      <View style={[styles.unreachableServerDot, { backgroundColor: colors.error }]} />
                      <View style={styles.unreachableServerText}>
                        <Text weight="medium" numberOfLines={1}>
                          {server.name}
                        </Text>
                        <Text variant="caption" color="secondary">
                          Unable to reach server
                        </Text>
                      </View>
                    </View>
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() => onNavigateToServerSettings(server)}
                    >
                      Settings
                    </Button>
                  </Pressable>
                ))}
                {syncing && (
                  <View style={styles.syncingRow}>
                    <Spinner size="small" />
                    <Text color="secondary">Loading remote projects...</Text>
                  </View>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: spacing[4],
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
  },

  content: {
    flex: 1,
  },
  contentInner: {
    paddingVertical: spacing[4],
  },
  authCard: {
    marginHorizontal: spacing[4],
    marginBottom: spacing[4],
  },
  authTitle: {
    marginBottom: spacing[1],
  },
  authDescription: {
    marginBottom: spacing[4],
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    marginBottom: spacing[2],
  },
  projectList: {
    paddingHorizontal: spacing[2],
  },
  unreachableServer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    marginBottom: spacing[2],
    borderWidth: 1,
    borderRadius: borderRadius.md,
    marginHorizontal: spacing[1],
  },
  unreachableServerContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    overflow: 'hidden',
  },
  unreachableServerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  unreachableServerText: {
    flex: 1,
    gap: 2,
  },
  syncingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
  },
} as const);
