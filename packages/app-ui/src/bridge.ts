/**
 * Web app bridge — creates an AgentBridge backed by BridgeCore + ServerClient.
 *
 * For the web app, all projects are remote (hosted on the same server).
 * We use BridgeCore with a pre-configured remote server pointing to the
 * same origin (cookie auth, no bearer token needed).
 *
 * The bridge is initialized by:
 * 1. Creating a ServerClient with cookie auth
 * 2. Creating BridgeCore with platform adapters for the web
 * 3. Auto-adding the server as a remote server
 * 4. Syncing remote projects on startup
 */

import { createBridgeCore, ServerClient } from '@openmgr/ui';
import type { AgentBridge, RemoteServerConfig } from '@openmgr/ui';

/** Create the web app bridge backed by the same-origin server */
export function createWebBridge(): {
  bridge: AgentBridge;
  client: ServerClient;
} {
  // ServerClient for same-origin requests (cookie auth)
  const client = new ServerClient({
    baseUrl: '',  // same origin
    auth: { useCookieAuth: true },
  });

  // Create BridgeCore with web platform adapters
  const bridge = createBridgeCore({
    // Platform agent factory — web app doesn't create local agents
    agentFactory: {
      createAgent: async () => {
        throw new Error('Local agents not supported in web app');
      },
    } as any,

    // Storage adapter — use localStorage
    storage: {
      getRemoteServers: async () => {
        try {
          const stored = localStorage.getItem('openmgr-web-remote-servers');
          return stored ? JSON.parse(stored) : [];
        } catch {
          return [];
        }
      },
      saveRemoteServers: async (servers: RemoteServerConfig[]) => {
        localStorage.setItem('openmgr-web-remote-servers', JSON.stringify(servers));
      },
      getProjectsDirectory: async () => '',
      setProjectsDirectory: async () => {},
    },

    // Filesystem adapter — not used in web app (use server's filesystem API)
    filesystem: {
      readDirectory: async () => [],
      readFile: async () => '',
      writeFile: async () => {},
      fileExists: async () => false,
      isDirectory: async () => false,
      getHomePath: () => '',
    } as any,

    // Resolve screenshot file paths to HTTP URLs served by the server
    resolveScreenshotUrl: (projectId: string, path: string) =>
      `/api/beta/projects/${projectId}/${path}`,

    // Event handler — the UI stores listen to events via useUIStore
    onEvent: () => {},

    // Remote servers changed callback
    onRemoteServersChanged: (servers: RemoteServerConfig[]) => {
      localStorage.setItem('openmgr-web-remote-servers', JSON.stringify(servers));
    },
  });

  return { bridge, client };
}

/**
 * Initialize the web bridge by adding the server and syncing projects.
 * Call this after creating the bridge and checking auth.
 */
export async function initializeWebBridge(bridge: AgentBridge): Promise<void> {
  // Check if we already have the local server configured
  const servers = await bridge.listRemoteServers();
  const hasLocalServer = servers.some((s: RemoteServerConfig) => s.url === window.location.origin || s.url === '');

  if (!hasLocalServer) {
    // Add the same-origin server as a remote server
    await bridge.addRemoteServer({
      name: 'Local Server',
      url: '', // same origin — remoteFetch will prepend this to paths
      // No token needed — cookie auth handles authentication
    } as any);
  }

  // Sync projects from the server
  await bridge.syncRemoteProjects();
}
