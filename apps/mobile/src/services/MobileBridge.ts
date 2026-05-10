/**
 * Mobile Agent Bridge
 * 
 * This bridge provides the AgentBridge interface for the mobile app.
 * It supports:
 * - Local on-device agent execution via @openmgr/agent-react-native
 * - Remote server connections via HTTP/SSE
 * - Persistent storage via SQLite database
 * 
 * For local projects, it uses BridgeCore from @openmgr/ui with:
 * - ReactNativeAgentFactory for agent creation
 * - ReactNativeStorage for API key storage (expo-secure-store)
 * - ReactNativeFilesystem for file operations (expo-file-system)
 */

import type { AgentBridge, AgentEvent, Project, RemoteServerConfig, PlatformSSEHandler, SSEEvent } from '@openmgr/ui';
import { createBridgeCore, createLogger } from '@openmgr/ui';
import { createReactNativeAgentFactory } from './ReactNativeAgentFactory';
import { createReactNativeStorage } from './ReactNativeStorage';
import { createReactNativeFilesystem } from './ReactNativeFilesystem';
import { getDatabase } from './database';
import {
  projects as projectsTable,
  remoteServers as remoteServersTable,
  type ProjectRow,
  type RemoteServerRow,
  eq,
  desc,
} from '@openmgr/agent-react-native';
import EventSource from 'react-native-sse';
import {
  Agent,
  providersPlugin,
  toolsPlugin,
  AnthropicOAuthProvider,
  SessionManager,
  createReactNativeDatabase,
  agentTypeRegistry,
  type AgentEvent as CoreAgentEvent,
  type OAuthTokens,
  type GenericAgentDatabase,
  type AgentDatabase,
  type ExpoSQLiteModule,
} from '@openmgr/agent-react-native';
import * as SQLite from 'expo-sqlite';
import {
  directorToolsPlugin,
  DIRECTOR_CONTEXT_KEY,
  DIRECTOR_SYSTEM_PROMPT,
  type DirectorContext,
} from '@openmgr/agent-tools-director';
import * as Crypto from 'expo-crypto';
import { Directory as ExpoDirectory } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';

const log = createLogger('MobileBridge');

// Event subscriptions for each project
const eventSubscriptions = new Map<string, Set<(event: AgentEvent) => void>>();

// Track project IDs loaded from storage to avoid saving duplicates during restoration
const restoredProjectIds = new Set<string>();
const restoredServerIds = new Set<string>();

// Map from old (DB) project ID to new (bridge-created) project ID
const projectIdMapping = new Map<string, string>();

/**
 * Create an SSE handler for React Native using react-native-sse.
 * This provides streaming support since React Native's fetch doesn't support ReadableStream.
 */
function createReactNativeSSEHandler(): PlatformSSEHandler {
  // Track active connections to detect duplicate requests
  let activeConnectionId = 0;
  
  return {
    connect(
      url: string,
      options: { method: 'POST'; headers: Record<string, string>; body: string },
      onEvent: (event: SSEEvent) => void,
      onError: (error: Error) => void,
      onComplete: () => void
    ): () => void {
      const connectionId = ++activeConnectionId;
      log.debug(`#${connectionId} Connecting to: ${url}`);
      log.debug(`#${connectionId} Body: ${options.body}`);
      
      // Create EventSource with POST method support
      // IMPORTANT: Set timeoutBeforeConnection to 0 to prevent automatic delayed open()
      // since we call es.open() manually. Also disable polling (pollingInterval: 0)
      // to prevent automatic reconnection on errors.
      const es = new EventSource<'message.delta' | 'message.complete' | 'tool.start' | 'tool.complete' | 'done'>(url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        debug: false,
        timeoutBeforeConnection: 0,  // Don't delay - we call open() manually
        pollingInterval: 0,          // Don't auto-reconnect on errors
      });
      
      // Track state
      let completed = false;
      let receivedEvents = false;
      let errorOccurred = false;
      
      const handleComplete = (callOnComplete = true) => {
        if (!completed) {
          completed = true;
          log.debug(`#${connectionId} handleComplete called, callOnComplete: ${callOnComplete}, errorOccurred: ${errorOccurred}`);
          es.close();
          // Always call onComplete (even if no events) so the Promise resolves
          // The BridgeCore will handle whether to emit UI events based on content
          if (callOnComplete || !errorOccurred) {
            log.debug(`#${connectionId} Calling onComplete callback`);
            onComplete();
          }
        } else {
          log.debug(`#${connectionId} handleComplete called but already completed, ignoring`);
        }
      };
      
      // Handle open event
      es.addEventListener('open', () => {
        log.debug(`#${connectionId} Connection opened`);
      });
      
      // Handle custom events (agent events)
      const customEvents = ['message.delta', 'message.complete', 'tool.start', 'tool.complete', 'done'] as const;
      for (const eventType of customEvents) {
        es.addEventListener(eventType, (event) => {
          log.debug(`#${connectionId} Received event: ${eventType}`);
          receivedEvents = true;
          onEvent({
            type: eventType,
            data: event.data || '{}',
          });
          
          // 'done' event signals completion
          if (eventType === 'done') {
            log.debug(`#${connectionId} Got 'done' event, calling handleComplete`);
            handleComplete(true);
          }
        });
      }
      
      // Handle generic message events (fallback)
      es.addEventListener('message', (event) => {
        log.debug(`#${connectionId} Received message event`);
        receivedEvents = true;
        onEvent({
          type: 'message',
          data: event.data || '{}',
        });
      });
      
      // Handle errors (both protocol errors and SSE 'error' events from agent)
      es.addEventListener('error', (event) => {
        log.error(`#${connectionId} Error event:`, event);
        
        let errorMessage = 'SSE connection error';
        
        // Try to extract error from event.data first (SSE 'error' event from agent server)
        if ('data' in event && typeof event.data === 'string' && event.data) {
          try {
            const parsed = JSON.parse(event.data);
            if (parsed.error) {
              errorMessage = parsed.error;
              log.debug(`#${connectionId} Found error in event.data: ${errorMessage}`);
            }
          } catch {
            // Not JSON, continue to check event.message
          }
        }
        
        // Fallback to event.message (connection errors from react-native-sse)
        if (errorMessage === 'SSE connection error' && 'message' in event && event.message) {
          // Try to parse the error message as JSON (server error responses)
          try {
            const parsed = JSON.parse(event.message);
            if (parsed.error) {
              // Handle nested error JSON (from server proxy)
              if (typeof parsed.error === 'string') {
                try {
                  const nestedError = JSON.parse(parsed.error);
                  errorMessage = nestedError.error || parsed.error;
                } catch {
                  errorMessage = parsed.error;
                }
              } else {
                errorMessage = String(parsed.error);
              }
            } else {
              errorMessage = event.message;
            }
          } catch {
            errorMessage = event.message;
          }
        }
        
        // Check if this is a "session busy" error - complete silently
        if (errorMessage.includes('already processing')) {
          log.debug(`#${connectionId} Session busy error, closing silently`);
          errorOccurred = true;
          handleComplete(true); // Call onComplete so Promise resolves
          return;
        }
        
        log.debug(`#${connectionId} Calling onError with: ${errorMessage}`);
        errorOccurred = true;
        onError(new Error(errorMessage));
        handleComplete(false); // Don't call onComplete on error - onError already called
      });
      
      // Handle close - only call onComplete if we received events
      es.addEventListener('close', () => {
        log.debug(`#${connectionId} Connection closed, receivedEvents: ${receivedEvents}`);
        handleComplete(receivedEvents);
      });
      
      // Note: We do NOT call es.open() here because the constructor already handles it
      // with timeoutBeforeConnection: 0 (immediate). Calling open() twice would cause
      // duplicate requests.
      log.debug(`#${connectionId} EventSource created (auto-opens immediately)`);
      
      // Return abort function
      return () => {
        log.debug(`#${connectionId} Abort called`);
        es.close();
        completed = true;
      };
    },
  };
}

/**
 * Load projects from SQLite database.
 */
async function loadProjects(): Promise<Project[]> {
  try {
    const db = getDatabase();
    const rows = await db.select().from(projectsTable).orderBy(desc(projectsTable.createdAt));
    return rows.map((row: ProjectRow) => ({
      id: row.id,
      name: row.name,
      path: row.path,
      providerType: row.providerType as 'local' | 'remote',
      remoteServerId: row.remoteServerId ?? undefined,
      createdAt: row.createdAt.getTime(),
    }));
  } catch (e) {
    log.error('Failed to load projects:', e);
    return [];
  }
}

/**
 * Save a project to SQLite database.
 */
async function saveProject(project: Project): Promise<void> {
  try {
    const db = getDatabase();
    const now = new Date();
    await db.insert(projectsTable).values({
      id: project.id,
      name: project.name,
      path: project.path,
      providerType: project.providerType,
      remoteServerId: project.remoteServerId ?? null,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: projectsTable.id,
      set: {
        name: project.name,
        path: project.path,
        providerType: project.providerType,
        remoteServerId: project.remoteServerId ?? null,
        updatedAt: now,
      },
    });
  } catch (e) {
    log.error('Failed to save project:', e);
  }
}

/**
 * Delete a project from SQLite database.
 * Exported for use by bridge when project deletion is implemented.
 */
export async function deleteProject(projectId: string): Promise<void> {
  try {
    const db = getDatabase();
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  } catch (e) {
    log.error('Failed to delete project:', e);
  }
}

/**
 * Load remote servers from SQLite database.
 */
async function loadRemoteServers(): Promise<RemoteServerConfig[]> {
  try {
    const db = getDatabase();
    const rows = await db.select().from(remoteServersTable).orderBy(desc(remoteServersTable.createdAt));
    return rows.map((row: RemoteServerRow) => ({
      id: row.id,
      name: row.name,
      url: row.url,
      token: row.apiKey ?? undefined,
      createdAt: row.createdAt.getTime(),
    }));
  } catch (e) {
    log.error('Failed to load remote servers:', e);
    return [];
  }
}

/**
 * Save a remote server to SQLite database.
 */
async function saveRemoteServer(server: RemoteServerConfig): Promise<void> {
  try {
    const db = getDatabase();
    const now = new Date();
    await db.insert(remoteServersTable).values({
      id: server.id,
      name: server.name,
      url: server.url,
      apiKey: server.token ?? null,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: remoteServersTable.id,
      set: {
        name: server.name,
        url: server.url,
        apiKey: server.token ?? null,
        updatedAt: now,
      },
    });
  } catch (e) {
    log.error('Failed to save remote server:', e);
  }
}

/**
 * Delete a remote server from SQLite database.
 * Exported for use by bridge when server deletion is implemented.
 */
export async function deleteRemoteServer(serverId: string): Promise<void> {
  try {
    const db = getDatabase();
    await db.delete(remoteServersTable).where(eq(remoteServersTable.id, serverId));
  } catch (e) {
    log.error('Failed to delete remote server:', e);
  }
}

/**
 * Create a mobile agent bridge instance.
 * 
 * This bridge supports both local and remote agent execution:
 * - Local projects use on-device AI processing via @openmgr/agent-react-native
 * - Remote projects connect to @openmgr/server instances via HTTP/SSE
 */
export function createMobileBridge(): AgentBridge {
  // Eagerly register built-in agent types on the global registry so they're
  // available in the Agents panel even before any project agent is created.
  // On Desktop this happens implicitly via createNodeAgent -> agent.use(toolsPlugin),
  // but on mobile the registry stays empty until the first project is created.
  if (toolsPlugin.agentTypes) {
    for (const agentType of toolsPlugin.agentTypes) {
      try {
        agentTypeRegistry.register({
          ...agentType,
          source: agentType.source ?? 'plugin',
        });
      } catch {
        // Ignore duplicate registration errors (may already be registered
        // if an agent was created before this bridge was initialized)
      }
    }
    log.info(`Registered ${toolsPlugin.agentTypes.length} built-in agent types on global registry`);
  }

  // Create platform-specific implementations
  const agentFactory = createReactNativeAgentFactory();
  const storage = createReactNativeStorage();
  const filesystem = createReactNativeFilesystem();
  const sseHandler = createReactNativeSSEHandler();

  // Create the bridge using BridgeCore
  const bridge = createBridgeCore({
    agentFactory,
    storage,
    filesystem,
    sseHandler,
    // Provide global agent type registry as fallback so the Agents panel
    // shows all registered agent types even when the local agent for a
    // project hasn't been created yet (e.g. fresh install, auth not
    // configured, or agent creation failure).
    getGlobalAgentTypes: () =>
      agentTypeRegistry.getAllIncludingDisabled().map((def) => ({
        name: def.name,
        version: def.version,
        description: def.description,
        systemPrompt: def.systemPrompt,
        model: def.model,
        provider: def.provider,
        allowedTools: def.allowedTools,
        deniedTools: def.deniedTools,
        maxIterations: def.maxIterations,
        tokenBudget: def.tokenBudget,
        temperature: def.temperature,
        tags: def.tags,
        enabled: def.enabled !== false,
        source: (def.source ?? 'builtin') as 'builtin' | 'plugin' | 'config',
        integrity: def.integrity,
      })),
    getGlobalAgentTypeConflicts: () =>
      agentTypeRegistry.getConflicts().map((c) => ({
        name: c.name,
        keptSource: (c.kept.source ?? 'builtin') as 'builtin' | 'plugin' | 'config',
        replacedSource: (c.replaced.source ?? 'builtin') as 'builtin' | 'plugin' | 'config',
        keptIntegrity: c.kept.integrity,
        replacedIntegrity: c.replaced.integrity,
      })),
    setGlobalAgentTypeEnabled: (name, enabled) => {
      agentTypeRegistry.setEnabled(name, enabled);
    },
    onEvent: (projectId, event) => {
      // Forward events to subscribed listeners
      log.debug('Received event:', event.type, 'for project:', projectId);
      const subscribers = eventSubscriptions.get(projectId);
      log.debug('Subscribers count:', subscribers?.size ?? 0);
      if (subscribers) {
        for (const callback of subscribers) {
          try {
            log.debug('Calling subscriber callback');
            callback(event);
          } catch (err) {
            log.error('Error in event callback:', err);
          }
        }
      }
    },
    onProjectsChanged: async (projects) => {
      // Get current project IDs from the bridge
      const currentIds = new Set(projects.map(p => p.id));
      
      // Load existing projects from DB to find which ones were deleted
      const existingProjects = await loadProjects();
      for (const existing of existingProjects) {
        if (!currentIds.has(existing.id)) {
          // Project was deleted, remove from DB
          await deleteProject(existing.id);
          log.info('Project deleted from DB:', existing.id);
        }
      }
      
      // Save all current projects to database
      for (const project of projects) {
        await saveProject(project);
      }
      log.info('Projects saved:', projects.length);
    },
    onRemoteServersChanged: async (servers) => {
      // Get current server IDs from the bridge
      const currentIds = new Set(servers.map(s => s.id));
      
      // Load existing servers from DB to find which ones were deleted
      const existingServers = await loadRemoteServers();
      for (const existing of existingServers) {
        if (!currentIds.has(existing.id)) {
          // Server was deleted, remove from DB
          await deleteRemoteServer(existing.id);
          log.info('Remote server deleted from DB:', existing.id);
        }
      }
      
      // Save all current servers to database
      for (const server of servers) {
        await saveRemoteServer(server);
      }
      log.info('Remote servers saved:', servers.length);
    },
  });

  // Override listRemoteServers to load from storage first
  // NOTE: This must be declared before listProjects because projects depend on servers
  const originalListRemoteServers = bridge.listRemoteServers.bind(bridge);
  let serversLoadingPromise: Promise<void> | null = null;
  
  bridge.listRemoteServers = async () => {
    // On first call, load servers from storage and recreate them in the bridge
    // Use a Promise to prevent race conditions - all callers wait for the same load operation
    if (!serversLoadingPromise) {
      serversLoadingPromise = (async () => {
        log.info('Loading remote servers from storage...');
        const savedServers = await loadRemoteServers();
        log.info(`Found ${savedServers.length} saved servers`);
        
        // Mark all existing server IDs as "restored" so we don't re-save them
        for (const server of savedServers) {
          restoredServerIds.add(server.id);
        }
        
        // Recreate each server in the bridge
        for (const server of savedServers) {
          try {
            const newServer = await bridge.addRemoteServer({
              name: server.name,
              url: server.url,
              token: server.token,
            });
            // Delete the old server entry from DB since a new one will be created with a new ID
            if (newServer.id !== server.id) {
              await deleteRemoteServer(server.id);
            }
          } catch (e) {
            log.error(`Failed to restore server ${server.name}:`, e);
          }
        }
        
        // Clear restored IDs - future saves are legitimate new servers
        restoredServerIds.clear();
        log.info('Remote servers loaded');
      })();
    }
    
    // Wait for loading to complete (all callers wait on the same promise)
    await serversLoadingPromise;
    
    return originalListRemoteServers();
  };

  // Override listProjects to load from storage first
  const originalListProjects = bridge.listProjects.bind(bridge);
  let projectsLoadingPromise: Promise<void> | null = null;
  
  bridge.listProjects = async () => {
    // On first call, load projects from storage and recreate them in the bridge
    // Use a Promise to prevent race conditions - all callers wait for the same load operation
    if (!projectsLoadingPromise) {
      projectsLoadingPromise = (async () => {
        // IMPORTANT: Load remote servers first, because remote projects need them
        // This will wait if servers are already being loaded
        await bridge.listRemoteServers();
        
        log.info('Loading projects from storage...');
        const savedProjects = await loadProjects();
        log.info(`Found ${savedProjects.length} saved projects`);
        
        // Only restore LOCAL projects from storage
        // Remote projects will be synced from their servers via syncRemoteProjects()
        const localProjects = savedProjects.filter(p => p.providerType === 'local');
        const remoteProjects = savedProjects.filter(p => p.providerType === 'remote');
        
        log.info(`Restoring ${localProjects.length} local projects, skipping ${remoteProjects.length} remote projects`);
        
        // Clean up remote project entries from local DB - they'll be re-synced from server
        for (const project of remoteProjects) {
          await deleteProject(project.id);
        }
        
        // Mark local project IDs as "restored" so we don't re-save them
        for (const project of localProjects) {
          restoredProjectIds.add(project.id);
        }
        
        // Recreate each LOCAL project in the bridge
        // This will also create the agents for local projects
        for (const project of localProjects) {
          try {
            const newProject = await bridge.createProject(
              project.path,
              project.providerType,
              project.remoteServerId
            );
            // Map old ID to new ID so we can clean up the old DB entry
            if (newProject.id !== project.id) {
              projectIdMapping.set(project.id, newProject.id);
              // Delete the old project entry from DB since a new one will be created
              await deleteProject(project.id);
            }
          } catch (e) {
            log.error(`Failed to restore project ${project.name}:`, e);
          }
        }
        
        // Clear restored IDs - future saves are legitimate new projects
        restoredProjectIds.clear();
        log.info('Projects loaded');
      })();
    }
    
    // Wait for loading to complete (all callers wait on the same promise)
    await projectsLoadingPromise;
    
    return originalListProjects();
  };

  // Override subscribeToProject to manage our event subscriptions
  const originalSubscribe = bridge.subscribeToProject.bind(bridge);
  bridge.subscribeToProject = (projectId: string, callback: (event: AgentEvent) => void) => {
    // Add to our local subscription map
    if (!eventSubscriptions.has(projectId)) {
      eventSubscriptions.set(projectId, new Set());
    }
    eventSubscriptions.get(projectId)!.add(callback);

    // Call original subscribe (which may set up other listeners)
    const originalUnsubscribe = originalSubscribe(projectId, callback);

    // Return unsubscribe function
    return () => {
      eventSubscriptions.get(projectId)?.delete(callback);
      originalUnsubscribe();
    };
  };

  // =========================================================================
  // Director Agent
  // =========================================================================

  let directorAgent: Agent | null = null;
  let directorSessionManager: SessionManager | null = null;
  let directorDbConnection: { db: AgentDatabase; close: () => void } | null = null;
  let directorCurrentSessionId = '';
  const directorEventSubscribers = new Set<(event: AgentEvent) => void>();

  const getDirectorAgent = async (): Promise<{ agent: Agent; sessionManager: SessionManager }> => {
    if (directorAgent && directorSessionManager) {
      return { agent: directorAgent, sessionManager: directorSessionManager };
    }

    // Create Director-specific directory
    const directorDir = filesystem.getDataDirectory() + '/director';

    // Create Agent with Director system prompt
    const agent = new Agent({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      auth: { type: 'api-key', apiKey: '' },
      systemPrompt: DIRECTOR_SYSTEM_PROMPT,
      workingDirectory: directorDir,
    });

    // Use an isolated tool registry so Director tools don't leak to project agents
    agent.useIsolatedToolRegistry();

    // Register providers (uses app's current auth — API key or OAuth)
    const oauthTokens = await storage.getOAuthTokens?.().catch(() => null);
    const anthropicApiKey = await storage.getApiKey('anthropic').catch(() => null);

    if (oauthTokens) {
      const oauthProvider = new AnthropicOAuthProvider({
        tokens: oauthTokens,
        onTokenRefresh: async (tokens: OAuthTokens) => {
          await storage.saveOAuthTokens?.(tokens);
        },
        fetch: expoFetch as unknown as typeof fetch,
      });
      agent.getProviderRegistry().register({
        name: 'anthropic-oauth',
        factory: () => oauthProvider,
      });
      agent.setProvider('anthropic-oauth');
    } else {
      await agent.use(providersPlugin);
      if (agent.hasProvider('anthropic') && anthropicApiKey) {
        agent.setProvider('anthropic', { apiKey: anthropicApiKey });
      }
    }

    // Register Director tools plugin
    await agent.use(directorToolsPlugin);

    // Create DirectorContext
    const directorContext: DirectorContext = {
      async listProjects() {
        const projects = await bridge.listProjects();
        return projects.map(p => ({
          id: p.id,
          name: p.name,
          path: p.path,
          providerType: p.providerType,
          remoteServerId: p.remoteServerId,
        }));
      },
      async createProject(opts) {
        const p = await bridge.createProject(opts.path, opts.providerType, opts.remoteServerId, opts.name);
        return {
          id: p.id,
          name: p.name,
          path: p.path,
          providerType: p.providerType,
          remoteServerId: p.remoteServerId,
        };
      },
      async updateProject(projectId, updates) {
        await bridge.updateProject(projectId, updates);
      },
      async removeProject(projectId) {
        await bridge.removeProject(projectId);
      },
      async listSessions(projectId) {
        const sessions = await bridge.listSessions(projectId);
        return sessions.map(s => ({
          id: s.id,
          title: s.title,
          projectId,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        }));
      },
      async createSession(projectId, opts) {
        const s = await bridge.createSession(projectId, { title: opts?.title });
        return {
          id: s.id,
          title: s.title,
          projectId,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        };
      },
      async deleteSession(projectId, sessionId) {
        await bridge.deleteSession(projectId, sessionId);
      },
      async listServers() {
        const servers = await bridge.listRemoteServers();
        return servers.map(s => ({
          id: s.id,
          name: s.name,
          url: s.url,
          authType: s.authType,
          connected: true, // Assume connected on mobile
          lastSeen: s.lastSeen,
        }));
      },
      async addServer(opts) {
        const s = await bridge.addRemoteServer(opts);
        return {
          id: s.id,
          name: s.name,
          url: s.url,
          authType: s.authType,
          connected: true,
          lastSeen: s.lastSeen,
        };
      },
      async updateServer(serverId, updates) {
        await bridge.updateRemoteServer(serverId, updates);
      },
      async removeServer(serverId) {
        await bridge.removeRemoteServer(serverId);
      },
      async testServer(serverIdOrConfig) {
        if (typeof serverIdOrConfig === 'string') {
          // Server ID — we don't support testing by ID on mobile yet
          return { success: false, message: 'Testing by server ID is not supported' };
        }
        const result = await bridge.testRemoteServer(serverIdOrConfig);
        return { success: result.success, message: result.error || 'OK' };
      },
      async listModels(projectId) {
        try {
          const models = await bridge.getModels(projectId || '');
          return models.map(m => ({
            id: m.id,
            name: m.name,
            provider: m.provider,
            contextLength: m.contextLength,
            description: m.description,
          }));
        } catch {
          return [];
        }
      },
      async getAuthStatus() {
        const status = await bridge.getAuthStatus();
        return {
          local: {
            anthropic: {
              authenticated: status.anthropic?.authenticated ?? false,
              method: status.anthropic?.method === 'apikey' ? 'api' : (status.anthropic?.method ?? null) as 'oauth' | 'api' | null,
            },
            openai: { hasApiKey: status.openai?.hasApiKey ?? false },
            google: { hasApiKey: status.google?.hasApiKey ?? false },
            openrouter: { hasApiKey: status.openrouter?.hasApiKey ?? false },
            groq: { hasApiKey: status.groq?.hasApiKey ?? false },
            xai: { hasApiKey: status.xai?.hasApiKey ?? false },
          },
          servers: [],
        };
      },
      async setApiKey(provider, key) {
        await bridge.setApiKey(provider, key);
      },
      async deleteApiKey(provider) {
        await bridge.deleteApiKey(provider);
      },
      async getDockerStatus() {
        return { available: false };
      },
      async updateDockerConfig() {
        throw new Error('Docker is not available on mobile');
      },
      async getSettings() {
        return { theme: 'system' as const };
      },
      async setTheme(mode) {
        for (const subscriber of directorEventSubscribers) {
          subscriber({ type: 'director:set-theme', mode } as any);
        }
      },
      async navigate(target) {
        for (const subscriber of directorEventSubscribers) {
          subscriber({ type: 'director:navigate', target } as any);
        }
      },
      async getSystemInfo() {
        return {
          platform: 'react-native',
        };
      },
      async getDefaultProjectsDirectory() {
        try {
          const dataDir = filesystem.getDataDirectory();
          return `${dataDir}/OpenMgr Projects`;
        } catch {
          return null;
        }
      },
      async listDirectory(dirPath) {
        try {
          const entries = await filesystem.readDirectory(dirPath);
          return entries
            .filter(e => !e.name.startsWith('.'))
            .map(e => ({
              name: e.name,
              path: e.path,
              isDirectory: e.isDirectory,
            }))
            .sort((a, b) => {
              if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
              return a.name.localeCompare(b.name);
            });
        } catch {
          return [];
        }
      },
      async ensureDirectoryExists(dirPath) {
        const uri = dirPath.startsWith('file://') ? dirPath : `file://${dirPath}`;
        try {
          const dir = new ExpoDirectory(uri);
          if (!dir.exists) {
            dir.create();
          }
        } catch (error) {
          throw new Error(`Failed to create directory: ${error}`);
        }
      },
    };

    agent.setExtension(DIRECTOR_CONTEXT_KEY, directorContext);

    // Set up permission callback so Director tools can request user approval.
    const directorPermissionResolvers = new Map<string, (response: any) => void>();
    agent.setPermissionRequestCallback(async (toolCall) => {
      return new Promise((resolve) => {
        directorPermissionResolvers.set(toolCall.id, resolve);
        const agentEvent = {
          type: 'tool.permission.request',
          sessionId: directorCurrentSessionId,
          messageId: '',
          toolCall: {
            id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.arguments,
            status: 'pending',
          },
        } as AgentEvent;
        for (const subscriber of directorEventSubscribers) {
          subscriber(agentEvent);
        }
      });
    });

    // Forward Director agent events
    agent.on('event', (event: CoreAgentEvent) => {
      const agentEvent = { ...event, sessionId: directorCurrentSessionId } as AgentEvent;
      for (const subscriber of directorEventSubscribers) {
        subscriber(agentEvent);
      }
    });

    // Create a dedicated Director database (separate from project sessions)
    const directorDb = createReactNativeDatabase(
      SQLite as unknown as ExpoSQLiteModule,
      { path: 'director.db' }
    );
    directorDbConnection = directorDb;
    const sm = new SessionManager(directorDb.db as unknown as GenericAgentDatabase, {
      generateId: () => Crypto.randomUUID(),
    });

    directorAgent = agent;
    directorSessionManager = sm;
    // Expose permission resolvers for directorRespondToPermission
    (directorAgent as any)._permissionResolvers = directorPermissionResolvers;
    return { agent, sessionManager: sm };
  };

  // Wire up Director bridge methods
  bridge.directorListSessions = async () => {
    const { sessionManager: sm } = await getDirectorAgent();
    const sessions = await sm.getRootSessions(100);
    return sessions.map(s => ({
      id: s.id,
      title: s.title || 'Untitled',
      createdAt: s.createdAt.getTime(),
      updatedAt: s.updatedAt.getTime(),
    }));
  };

  bridge.directorCreateSession = async (title) => {
    const { sessionManager: sm } = await getDirectorAgent();
    const directorDir = filesystem.getDataDirectory() + '/director';
    const session = await sm.createSession({
      workingDirectory: directorDir,
      title: title || undefined,
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    });
    return {
      id: session.id,
      title: session.title || 'Untitled',
      createdAt: session.createdAt.getTime(),
      updatedAt: session.updatedAt.getTime(),
    };
  };

  bridge.directorDeleteSession = async (sessionId) => {
    const { sessionManager: sm } = await getDirectorAgent();
    await sm.deleteSession(sessionId);
  };

  bridge.directorGetMessages = async (sessionId) => {
    const { sessionManager: sm } = await getDirectorAgent();
    const messages = await sm.getSessionMessages(sessionId);
    return messages.map(m => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      toolCalls: m.toolCalls?.map((tc: any) => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments as Record<string, unknown>,
        status: 'complete' as const,
      })),
      sequence: m.sequence,
      createdAt: m.createdAt.getTime(),
    }));
  };

  bridge.directorGetMessagesPaginated = async (sessionId, limit, beforeSequence) => {
    const { sessionManager: sm } = await getDirectorAgent();
    const result = await sm.getSessionMessagesPaginated(sessionId, limit, beforeSequence);
    return {
      messages: result.messages.map(m => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        toolCalls: m.toolCalls?.map((tc: any) => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments as Record<string, unknown>,
          status: 'complete' as const,
        })),
        sequence: m.sequence,
        createdAt: m.createdAt.getTime(),
      })),
      hasMore: result.hasMore,
    };
  };

  bridge.directorSendMessage = async (sessionId, content) => {
    const { agent: da, sessionManager: sm } = await getDirectorAgent();
    directorCurrentSessionId = sessionId;
    da.setSessionContext({ sessionId, sessionManager: sm });

    // Load messages from storage into the agent, converting from storage
    // format (toolCallId/content) to core Agent format (id/result).
    const existingMessages = await sm.getSessionMessages(sessionId);
    const priorMessageCount = existingMessages.length;
    da.setMessages(existingMessages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls?.map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      })),
      toolResults: m.toolResults?.map(tr => ({
        id: tr.toolCallId,
        name: '',
        result: tr.content,
        isError: tr.isError,
      })),
    })) as any);

    da.clearToolPermissions();

    const emitDirectorEvent = (event: AgentEvent) => {
      for (const subscriber of directorEventSubscribers) {
        subscriber(event);
      }
    };

    try {
      // Run the prompt
      await da.prompt(content);

      // Save new messages to storage
      const allAgentMessages = da.getMessages();
      const newMessages = allAgentMessages.slice(priorMessageCount);
      let seq = await sm.getNextSequence(sessionId);
      for (const msg of newMessages) {
        const msgContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        await sm.addMessage({
          sessionId,
          role: msg.role,
          content: msgContent,
          toolCalls: msg.toolCalls?.map(tc => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          })),
          toolResults: msg.toolResults?.map(tr => ({
            toolCallId: tr.id,
            content: tr.result,
            isError: tr.isError,
          })),
          sequence: seq++,
        });
      }

      // Emit done event so the UI stops showing the thinking indicator
      emitDirectorEvent({
        type: 'done',
        sessionId,
      } as AgentEvent);
    } catch (error) {
      emitDirectorEvent({
        type: 'error',
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      } as AgentEvent);
    }
  };

  bridge.directorCancelMessage = async () => {
    if (directorAgent) {
      directorAgent.abort();
    }
  };

  bridge.directorSubscribeToEvents = (callback) => {
    directorEventSubscribers.add(callback);
    return () => {
      directorEventSubscribers.delete(callback);
    };
  };

  bridge.directorRespondToPermission = async (_sessionId, toolCallId, response) => {
    if (directorAgent) {
      const resolvers = (directorAgent as any)._permissionResolvers as Map<string, (response: any) => void> | undefined;
      const resolver = resolvers?.get(toolCallId);
      if (resolver) {
        resolver(response);
        resolvers!.delete(toolCallId);
      } else {
        // Fallback to agent's built-in resolver
        directorAgent.respondToPermission(toolCallId, response as any);
      }
    }
  };

  bridge.directorRespondToQuestion = async (_sessionId, questionId, response) => {
    if (directorAgent) {
      directorAgent.respondToQuestion(questionId, response);
    }
  };

  return bridge;
}

// Export a singleton instance for use throughout the app
let bridgeInstance: AgentBridge | null = null;

export function getMobileBridge(): AgentBridge {
  if (!bridgeInstance) {
    bridgeInstance = createMobileBridge();
  }
  return bridgeInstance;
}
