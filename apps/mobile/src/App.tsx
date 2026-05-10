// Configure zustand persistence for React Native BEFORE any stores are imported
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setPersistStorage } from '@ants/ui';

setPersistStorage({
  getItem: async (name: string) => {
    const value = await AsyncStorage.getItem(name);
    return value ? JSON.parse(value) : null;
  },
  setItem: async (name: string, value: unknown) => {
    await AsyncStorage.setItem(name, JSON.stringify(value));
  },
  removeItem: async (name: string) => {
    await AsyncStorage.removeItem(name);
  },
});

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { StatusBar, StyleSheet, Linking, Alert, View, Keyboard } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  ThemeContext,
  resolveTheme,
  ErrorBoundary,
  parseDeeplink,
  useUIStore,
  type DeeplinkRoute,
  createLogger,
} from '@ants/ui';
import { HomeScreen, SessionScreen, SettingsScreen, SessionSettingsScreen, ProjectSettingsScreen, ServerSettingsScreen, NewProjectScreen, AgentsScreen, DirectorScreen, SearchScreen } from './screens';
import type { RemoteServerConfig } from '@ants/ui';
import { DrawerNavigation } from './components';

const log = createLogger('App');
import { createMobileBridge } from './services/MobileBridge';

// Navigation state type
type Screen =
  | { name: 'home' }
  | { name: 'search' }
  | { name: 'chat'; projectId: string; sessionId: string; sessionTitle?: string }
  | { name: 'agents' }
  | { name: 'director' }
  | { name: 'settings' }
  | { name: 'session-settings'; projectId: string; sessionId: string; sessionTitle?: string }
  | { name: 'project-settings'; projectId: string; projectName?: string; projectPath?: string }
  | { name: 'server-settings'; server: RemoteServerConfig }
  | { name: 'new-project' };

/**
 * Main mobile app component.
 * Uses drawer-based navigation with state-based screen rendering.
 */
export function App() {
  // Get theme mode from store and resolve theme
  const themeMode = useUIStore((state) => state.themeMode);
  const theme = useMemo(() => resolveTheme(themeMode), [themeMode]);
  
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Create bridge instance (would be stored in context in production)
  const bridge = useMemo(() => createMobileBridge(), []);

  const navigateToHome = () => {
    setScreen({ name: 'home' });
    setDrawerOpen(false);
  };
  const navigateToSearch = () => {
    setScreen({ name: 'search' });
    setDrawerOpen(false);
  };
  const navigateToChat = (projectId: string, sessionId: string, sessionTitle?: string) => {
    setScreen({ name: 'chat', projectId, sessionId, sessionTitle });
    setDrawerOpen(false);
  };
  const navigateToDirector = () => {
    setScreen({ name: 'director' });
    setDrawerOpen(false);
  };
  const navigateToAgents = () => {
    setScreen({ name: 'agents' });
    setDrawerOpen(false);
  };
  const navigateToSettings = () => {
    setScreen({ name: 'settings' });
    setDrawerOpen(false);
  };
  const navigateToSessionSettings = (projectId: string, sessionId: string, sessionTitle?: string) => {
    setScreen({ name: 'session-settings', projectId, sessionId, sessionTitle });
    setDrawerOpen(false);
  };
  const navigateToProjectSettings = (projectId: string, projectName?: string, projectPath?: string) => {
    setScreen({ name: 'project-settings', projectId, projectName, projectPath });
    setDrawerOpen(false);
  };
  const navigateToServerSettings = (server: RemoteServerConfig) => {
    setScreen({ name: 'server-settings', server });
    setDrawerOpen(false);
  };
  const navigateToNewProject = () => {
    setScreen({ name: 'new-project' });
    setDrawerOpen(false);
  };

  const openDrawer = () => { Keyboard.dismiss(); setDrawerOpen(true); };
  const closeDrawer = () => setDrawerOpen(false);

  // Handle deeplinks
  const handleDeeplink = useCallback((route: DeeplinkRoute) => {
    switch (route.type) {
      case 'home':
        setScreen({ name: 'home' });
        break;

      case 'project':
        // On mobile, opening a project goes to home with that project selected
        // (project selection would need to be stored in state/context)
        setScreen({ name: 'home' });
        break;

      case 'session':
        setScreen({
          name: 'chat',
          projectId: route.projectId,
          sessionId: route.sessionId,
        });
        break;

      case 'settings':
      case 'project-settings':
        setScreen({ name: 'settings' });
        break;

      case 'connect':
        // Exchange auth code for token (if present), then confirm before adding
        (async () => {
          try {
            let token: string | undefined;
            let serverName: string;
            try {
              serverName = route.name || new URL(route.url).hostname;
            } catch {
              serverName = route.url;
            }

            // If a one-time auth code is provided, exchange it for a bearer token
            if (route.code) {
              const tokenRes = await fetch(`${route.url}/api/beta/auth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  code: route.code,
                  redirect_uri: 'ants://connect',
                }),
              });
              if (!tokenRes.ok) {
                const err = await tokenRes.json().catch(() => ({ error: 'Token exchange failed' }));
                throw new Error(err.error || `HTTP ${tokenRes.status}`);
              }
              const tokenData = await tokenRes.json() as {
                token: string;
                user: { id: string; username: string; displayName?: string; role: string };
              };
              token = tokenData.token;
              serverName = tokenData.user.displayName || tokenData.user.username || serverName;
            }

            // Ask the user to confirm before adding
            const confirmed = await new Promise<boolean>((resolve) => {
              Alert.alert(
                'Add Server',
                `Connect to "${serverName}" at ${route.url}?`,
                [
                  { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                  { text: 'Connect', onPress: () => resolve(true) },
                ],
                { cancelable: true, onDismiss: () => resolve(false) },
              );
            });

            if (!confirmed) return;

            const existingServers = await bridge.listRemoteServers();
            const existing = existingServers.find((s: { url: string }) => s.url === route.url);
            if (existing) {
              await bridge.updateRemoteServer(existing.id, {
                ...(token ? { token } : {}),
                name: serverName,
              });
            } else {
              await bridge.addRemoteServer({
                name: serverName,
                url: route.url,
                ...(token ? { token } : {}),
              });
            }

            setScreen({ name: 'settings' });
            Alert.alert('Server Added', `Connected to ${serverName}`);
          } catch (e) {
            log.error('Failed to add remote server:', e);
            Alert.alert('Error', e instanceof Error ? e.message : 'Failed to connect to server');
          }
        })();
        break;

      case 'auth-callback':
        // Exchange auth code for a bearer token and add/update the server
        if (route.server && route.code) {
          (async () => {
            try {
              const tokenRes = await fetch(`${route.server}/api/beta/auth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  code: route.code,
                  redirect_uri: 'ants://auth/callback',
                }),
              });
              if (!tokenRes.ok) {
                const err = await tokenRes.json().catch(() => ({ error: 'Token exchange failed' }));
                throw new Error(err.error || `HTTP ${tokenRes.status}`);
              }
              const tokenData = await tokenRes.json() as {
                token: string;
                user: { id: string; username: string; displayName?: string; role: string };
              };

              const serverName = tokenData.user.displayName || tokenData.user.username || 'Server';
              const existingServers = await bridge.listRemoteServers();
              const existing = existingServers.find((s) => s.url === route.server);
              if (existing) {
                await bridge.updateRemoteServer(existing.id, {
                  token: tokenData.token,
                  name: serverName,
                });
              } else {
                await bridge.addRemoteServer({
                  name: serverName,
                  url: route.server!,
                  token: tokenData.token,
                });
              }

              setScreen({ name: 'settings' });
              Alert.alert('Authenticated', `Signed in to ${serverName}`);
            } catch (e) {
              log.error('Auth code exchange failed:', e);
              Alert.alert('Error', e instanceof Error ? e.message : 'Authentication failed');
            }
          })();
        } else {
          log.warn('Auth callback missing server URL or code');
        }
        break;

      case 'open':
        // "open" is desktop-only (local file paths)
        Alert.alert(
          'Not Supported',
          'Opening local projects is only available on desktop.',
          [{ text: 'OK' }]
        );
        break;

      case 'unknown':
        log.warn('Unknown deeplink:', route.url);
        break;
    }
  }, []);

  // Subscribe to deeplinks
  useEffect(() => {
    // Handle deeplink that opened the app
    const handleInitialUrl = async () => {
      const initialUrl = await Linking.getInitialURL();
      if (initialUrl) {
        const route = parseDeeplink(initialUrl);
        handleDeeplink(route);
      }
    };

    handleInitialUrl();

    // Handle deeplinks while app is running
    const subscription = Linking.addEventListener('url', ({ url }) => {
      const route = parseDeeplink(url);
      handleDeeplink(route);
    });

    return () => {
      subscription.remove();
    };
  }, [handleDeeplink]);

  const renderScreen = () => {
    switch (screen.name) {
      case 'home':
        return (
          <HomeScreen
            bridge={bridge}
            onNavigateToChat={navigateToChat}
            onNavigateToProjectSettings={navigateToProjectSettings}
            onNavigateToServerSettings={navigateToServerSettings}
            onNavigateToNewProject={navigateToNewProject}
            onNavigateToSearch={navigateToSearch}
            onOpenDrawer={openDrawer}
          />
        );

      case 'search':
        return (
          <SearchScreen
            bridge={bridge}
            onNavigateBack={navigateToHome}
            onSelectResult={(result) => navigateToChat(result.projectId, result.session.id, result.session.title || undefined)}
          />
        );

      case 'chat':
        return (
          <SessionScreen
            bridge={bridge}
            projectId={screen.projectId}
            sessionId={screen.sessionId}
            sessionTitle={screen.sessionTitle}
            onNavigateBack={navigateToHome}
            onNavigateToSettings={() => navigateToSessionSettings(screen.projectId, screen.sessionId, screen.sessionTitle)}
          />
        );

      case 'session-settings':
        return (
          <SessionSettingsScreen
            bridge={bridge}
            projectId={screen.projectId}
            sessionTitle={screen.sessionTitle}
            onNavigateBack={() => navigateToChat(screen.projectId, screen.sessionId, screen.sessionTitle)}
          />
        );

      case 'director':
        return (
          <DirectorScreen
            bridge={bridge}
            onOpenDrawer={openDrawer}
          />
        );

      case 'agents':
        return (
          <AgentsScreen
            bridge={bridge}
            onNavigateBack={navigateToHome}
            onOpenDrawer={openDrawer}
          />
        );

      case 'settings':
        return (
          <SettingsScreen
            bridge={bridge}
            onOpenDrawer={openDrawer}
            onNavigateToServerSettings={navigateToServerSettings}
          />
        );

      case 'server-settings':
        return (
          <ServerSettingsScreen
            bridge={bridge}
            server={screen.server}
            onNavigateBack={navigateToSettings}
          />
        );

      case 'project-settings':
        return (
          <ProjectSettingsScreen
            bridge={bridge}
            projectId={screen.projectId}
            projectName={screen.projectName}
            projectPath={screen.projectPath}
            onNavigateBack={navigateToHome}
            onDeleteProject={async (projectId) => {
              await bridge.removeProject(projectId);
              navigateToHome();
            }}
            onNavigateToServerSettings={navigateToServerSettings}
          />
        );

      case 'new-project':
        return (
          <NewProjectScreen
            bridge={bridge}
            onNavigateBack={navigateToHome}
            onProjectCreated={() => {
              navigateToHome();
            }}
          />
        );

      default:
        return null;
    }
  };

  return (
    <ErrorBoundary
      onReset={() => setScreen({ name: 'home' })}
    >
      <ThemeContext.Provider value={theme}>
        <SafeAreaProvider>
          <SafeAreaView
            testID="ants-app"
            edges={['top', 'left', 'right']}
            style={[styles.container, { backgroundColor: theme.colors.bg.primary }]}
          >
            <StatusBar
              barStyle={theme.resolvedMode === 'dark' ? 'light-content' : 'dark-content'}
            />
            <View testID={`ants-screen-${screen.name}`} style={styles.content}>
              {renderScreen()}
            </View>

            {/* Drawer Navigation */}
            <DrawerNavigation
              currentScreen={screen.name}
              onNavigateToHome={navigateToHome}
              onNavigateToDirector={navigateToDirector}
              onNavigateToAgents={navigateToAgents}
              onNavigateToSettings={navigateToSettings}
              isOpen={drawerOpen}
              onClose={closeDrawer}
            />
          </SafeAreaView>
        </SafeAreaProvider>
      </ThemeContext.Provider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});
