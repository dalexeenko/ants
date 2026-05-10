/**
 * DesktopBridge - Electron-specific bridge built on top of BridgeCore.
 *
 * This replaces ProviderRegistry by using the shared BridgeCore from @openmgr/ui
 * with Electron-specific platform adapters for agent creation, storage, and
 * filesystem. Desktop-only features (MCP, project discovery, sandbox browser,
 * subagents) are added via method overrides after the bridge is created,
 * following the same pattern used by MobileBridge.
 */

import { BrowserWindow, app } from 'electron';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

import {
  createBridgeCore,
  type PlatformAgent,
  type PlatformAgentFactory,
  type PlatformSessionManager,
  type PlatformStorage,
  type PlatformFilesystem,
  type OAuthTokens,
  type AgentBridge,
  type AgentEvent,
  type Project,
  type RemoteServerConfig,
  type McpServerConfig as UIMcpServerConfig,
  type McpServerInfo,
  type McpServerStatus as UIMcpServerStatus,
  type McpTool as UIMcpTool,
  type FileEntry,
  type ToolInfo,
  type AgentTypeInfo,
  type AgentTypeConflictInfo,
  type SlashCommand,
  type AuthStatus,
  type ApiKeyInfo,
  type OAuthInitResult,
  type TerminalHelperContext,
  type TerminalHelperSuggestion,
  type WorktreeDiffResult,
  type WorktreeInfo,
  type DockerStatus,
  type DockerContainerInfo,
  createLogger,
} from '@openmgr/ui';

const log = createLogger('DesktopBridge');

import { SecureStorage } from './secureStorage';
import { getAppDatabase, type AppDatabase } from './appDatabase';
import { LocalTerminalManager } from './localTerminalManager';
import { WorktreeManager } from './worktreeManager';
import { LocalDockerService } from './localDockerService';

// Agent imports
import {
  createNodeAgent,
  nodeMcpClientFactory,
  FilesystemSkillManager,
  Agent,
  toolRegistry,
  providerRegistry as agentProviderRegistry,
  type ToolPermissionConfig as CorePermissionConfig,
} from '@openmgr/agent-node';
import { AnthropicOAuthProvider } from '@openmgr/agent-providers';
import {
  storagePlugin,
  SessionManager,
} from '@openmgr/agent-storage';
import type { DatabaseConnection } from '@openmgr/agent-database-core';
import type {
  SandboxBrowserController,
} from '@openmgr/agent-browser-sandbox';
import {
  SubagentManager,
  capabilityRegistry,
  agentTypeRegistry,
} from '@openmgr/agent-core';
import {
  directorToolsPlugin,
  DIRECTOR_SYSTEM_PROMPT,
  DIRECTOR_CONTEXT_KEY,
  type DirectorContext,
  type DirectorProject,
  type DirectorSession,
  type DirectorServer,
  type DirectorAuthStatus,
  type DirectorDockerStatus,
  type DirectorSystemInfo,
  type DirectorAppSettings,
  type NavigationTarget,
} from '@openmgr/agent-tools-director';
// @openmgr/agent-memory is loaded via dynamic import() because it depends on
// @xenova/transformers → onnxruntime-node, which has platform-specific native
// .node binaries that Rollup cannot bundle. Dynamic import() lets Node resolve
// the ESM package and its native deps at runtime on any platform.
let _memoryPlugin: (() => any) | null = null;
const loadMemoryPlugin = async () => {
  if (_memoryPlugin) return _memoryPlugin;
  try {
    const mod = await import('@openmgr/agent-memory');
    _memoryPlugin = mod.memoryPlugin;
    return _memoryPlugin;
  } catch (e) {
    log.warn('Failed to load @openmgr/agent-memory (embeddings will be unavailable):', e);
    return null;
  }
};

// Debug logging
const LOG_FILE = '/tmp/openmgr-debug.log';
function debugLog(msg: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  fsSync.appendFileSync(LOG_FILE, line);
}

// =============================================================================
// Extended state tracked alongside BridgeCore's internal state.
// BridgeCore manages projects, servers, sessions, messages, and remote
// communication. We only need to track desktop-specific extras here.
// =============================================================================

/** Extra per-agent desktop state not represented in BridgeCore's ManagedAgent */
interface DesktopAgentExtras {
  agent: Agent;
  sessionManager: SessionManager;
  db: DatabaseConnection;
  mcpStatus: Map<string, UIMcpServerStatus>;
  sandboxBrowserController?: SandboxBrowserController;
}

// =============================================================================
// Platform Adapters
// =============================================================================

function createDesktopStorage(storage: SecureStorage): PlatformStorage {
  return {
    getAuthStatus: () => storage.getAuthStatus(),
    initiateOAuth: (provider) => storage.initiateOAuth(provider),
    completeOAuth: (provider, code, verifier) => storage.completeOAuth(provider, code, verifier),
    disconnectOAuth: (provider) => storage.disconnectOAuth(provider),
    listApiKeys: () => storage.listApiKeys(),
    getApiKey: (provider) => storage.getApiKey(provider),
    setApiKey: (provider, key) => storage.setApiKey(provider, key),
    deleteApiKey: (provider) => storage.deleteApiKey(provider),
    hasApiKey: (provider) => storage.hasApiKey(provider),
    getProjectsDirectory: () => storage.getProjectsDirectory(),
    setProjectsDirectory: (p) => storage.setProjectsDirectory(p),
    async getOAuthTokens() {
      const tokens = await storage.getAnthropicTokens();
      if (!tokens?.accessToken || !tokens?.refreshToken || !tokens?.expiresAt) return null;
      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      };
    },
    async saveOAuthTokens(tokens: OAuthTokens) {
      await storage.setAnthropicTokens(tokens);
    },
  };
}

function createDesktopFilesystem(): PlatformFilesystem {
  // Track active file watchers: filePath -> { watcher, debounceTimer }
  const fileWatchers = new Map<string, { watcher: fsSync.FSWatcher; debounceTimer?: ReturnType<typeof setTimeout> }>();

  return {
    async readDirectory(dirPath: string): Promise<FileEntry[]> {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const result: FileEntry[] = [];
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const entryPath = path.join(dirPath, entry.name);
          let stat;
          try { stat = await fs.stat(entryPath); } catch { continue; }
          result.push({
            name: entry.name,
            path: entryPath,
            isDirectory: entry.isDirectory(),
            size: stat.size,
            modifiedAt: stat.mtimeMs,
          });
        }
        return result.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      } catch {
        return [];
      }
    },
    async readFile(filePath: string): Promise<string> {
      try {
        return await fs.readFile(filePath, 'utf-8');
      } catch {
        return '';
      }
    },
    async writeFile(filePath: string, content: string): Promise<void> {
      const parentDir = path.dirname(filePath);
      await fs.mkdir(parentDir, { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');
    },
    async pathExists(p: string): Promise<boolean> {
      try { await fs.access(p); return true; } catch { return false; }
    },
    getDataDirectory(): string {
      return app.getPath('userData');
    },
    watchFile(filePath: string, onChange: () => void): void {
      // Already watching this file
      if (fileWatchers.has(filePath)) return;

      try {
        const watcher = fsSync.watch(filePath, () => {
          // Debounce: many editors write files in multiple steps (write temp, rename)
          const existing = fileWatchers.get(filePath);
          if (existing?.debounceTimer) {
            clearTimeout(existing.debounceTimer);
          }
          const timer = setTimeout(() => {
            onChange();
          }, 300);
          if (existing) {
            existing.debounceTimer = timer;
          }
        });

        watcher.on('error', () => {
          // File may have been deleted or become inaccessible; clean up
          fileWatchers.delete(filePath);
        });

        fileWatchers.set(filePath, { watcher });
      } catch {
        // File may not exist or be inaccessible; silently ignore
      }
    },
    unwatchFile(filePath: string): void {
      const entry = fileWatchers.get(filePath);
      if (entry) {
        if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
        entry.watcher.close();
        fileWatchers.delete(filePath);
      }
    },
  };
}

function createDesktopAgentFactory(
  mainWindow: BrowserWindow,
  storage: SecureStorage,
  desktopExtras: Map<string, DesktopAgentExtras>,
  browserViewManager?: import('./browserViewManager').BrowserViewManager,
): PlatformAgentFactory {
  return {
    async createAgent(options) {
      const { projectId, workingDirectory, apiKey, oauthTokens, onTokenRefresh, onEvent } = options;

      log.info(`createAgent projectId=${projectId} workingDirectory=${workingDirectory}`);

      // Ensure .openmgr directory exists
      const openmgrDir = path.join(workingDirectory, '.openmgr');
      await fs.mkdir(openmgrDir, { recursive: true });
      const dbPath = path.join(openmgrDir, 'agent.db');

      const skillManager = new FilesystemSkillManager(workingDirectory);

      // Track the current session so forwarded events carry the right sessionId.
      // Declared here (before agent creation) so browser controller callbacks can reference it.
      let currentSessionId = '';

      // Create agent
      log.info(`Creating agent for ${projectId} in ${workingDirectory}`);
      const agent = await createNodeAgent({
        workingDirectory,
        apiKey: apiKey || undefined,
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        skillManager,
        mcpClientFactory: nodeMcpClientFactory,
        permissions: {
          defaultMode: 'ask',
          alwaysAllow: ['mcp_read', 'mcp_glob', 'mcp_grep', 'mcp_todoread', 'mcp_todowrite'],
          alwaysDeny: [],
          allowAll: false,
        },
        skipConfigLoad: true,
        browser: {
          headless: false,
          controllerOptions: {
            onSetupEvent: (event) => {
              onEvent({ ...event, sessionId: '' } as AgentEvent);
            },
            onBrowserCreated: (instance) => {
              // Create a WebContentsView for the embedded browser tab
              if (browserViewManager) {
                browserViewManager.create(instance.id, instance.url);
              }
              setTimeout(() => mainWindow.focus(), 100);
            },
            onBrowserClosed: (browserId) => {
              // Destroy the WebContentsView when the browser closes
              if (browserViewManager) {
                browserViewManager.destroy(browserId);
              }
            },
            onEvent: (event) => {
              // Forward browser events (created, closed, navigated, etc.) to the renderer
              onEvent({ ...event, sessionId: currentSessionId } as AgentEvent);

              // Sync navigation to the WebContentsView
              if (event.type === 'browser.navigated' && browserViewManager) {
                const navEvent = event as { browserId: string; url: string };
                browserViewManager.navigate(navEvent.browserId, navEvent.url);
              }
            },
          },
        },
      });

      log.info(`Agent created. agent.getWorkingDirectory()=${agent.getWorkingDirectory()}`);

      // Register auth provider
      // Note: createNodeAgent() already registers nodeProvidersPlugin, toolsPlugin,
      // and toolsTerminalPlugin — we only need to handle OAuth override here.
      debugLog(`Agent factory auth check: oauthTokens=${JSON.stringify({
        hasTokens: !!oauthTokens,
        hasAccessToken: !!oauthTokens?.accessToken,
        hasRefreshToken: !!oauthTokens?.refreshToken,
        hasExpiresAt: !!oauthTokens?.expiresAt,
        expiresAt: oauthTokens?.expiresAt,
      })}, hasApiKey=${!!apiKey}`);
      if (oauthTokens?.accessToken && oauthTokens.refreshToken && oauthTokens.expiresAt) {
        const oauthProvider = new AnthropicOAuthProvider({
          tokens: {
            accessToken: oauthTokens.accessToken,
            refreshToken: oauthTokens.refreshToken,
            expiresAt: oauthTokens.expiresAt,
          },
          onTokenRefresh: async (newTokens) => {
            await onTokenRefresh?.(newTokens);
            debugLog('Refreshed OAuth tokens saved');
          },
        });
        agentProviderRegistry.register({
          name: 'anthropic-oauth',
          factory: () => oauthProvider,
        });
        agent.setProvider('anthropic-oauth');
        debugLog('Using AnthropicOAuthProvider');
      } else if (apiKey) {
        debugLog('Using nodeProvidersPlugin (API key, registered by createNodeAgent)');
      } else {
        debugLog('WARNING: No authentication configured');
      }

      // Register desktop-specific plugins (not included in createNodeAgent)
      await agent.use(storagePlugin({ path: dbPath }));

      // Memory plugin for semantic memory/knowledge base tools
      // Loaded dynamically due to native onnxruntime-node dependency
      const memoryPluginFn = await loadMemoryPlugin();
      if (memoryPluginFn) {
        await agent.use(memoryPluginFn());
      }

      // Browser sandbox controller is already registered by createNodeAgent
      // (with headless: false and the onSetupEvent/onBrowserCreated callbacks).
      // Retrieve it from the agent extension for extras tracking.
      const sandboxBrowserController = agent.getExtension<SandboxBrowserController>('sandboxBrowserController');

      // Subagent support
      const subagentManager = new SubagentManager(agent);
      agent.setExtension('subagentManager', subagentManager);
      capabilityRegistry.register('subagent', {
        providedBy: '@openmgr/app-electron',
        version: '0.1.0',
      });
      agent.getToolRegistry().reevaluateDeferred();

      // Get storage extensions
      const db = agent.getExtension<DatabaseConnection>('storage.db')!;
      const sessionManager = agent.getExtension<SessionManager>('storage.sessions')!;

      // Forward agent events
      agent.on('event', (event) => {
        onEvent({ ...event, sessionId: currentSessionId } as AgentEvent);
      });

      // Store desktop-specific extras
      desktopExtras.set(projectId, {
        agent,
        sessionManager,
        db,
        mcpStatus: new Map(),
        sandboxBrowserController,
      });

      // Create the PlatformAgent wrapper
      const platformAgent: PlatformAgent = {
        id: projectId,
        async prompt(content) {
          const response = await agent.prompt(content);
          return {
            content: response.content,
            toolCalls: response.toolCalls?.map((tc) => ({
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
            })),
          };
        },
        stream: (agent as any).stream?.bind(agent) ?? (async function* () {}),
        cancel: () => agent.abort(),
        getMessages: () => agent.getMessages().map(m => {
          const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
          return {
            id: m.id ?? '',
            role: m.role as 'user' | 'assistant',
            content,
            isCompactionSummary: content.startsWith('[Conversation Summary]'),
            toolCalls: m.toolCalls?.map(tc => ({
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments as Record<string, unknown>,
            })),
            toolResults: m.toolResults?.map(tr => ({
              id: tr.id,
              name: tr.name ?? '',
              result: tr.result,
              isError: tr.isError,
            })),
          };
        }),
        setSessionContext: (ctx) => {
          currentSessionId = ctx.sessionId;
          agent.setSessionContext({ sessionId: ctx.sessionId, sessionManager });
        },
        setMessages: (messages) => agent.setMessages(messages as any),
        on: (event, callback) => agent.on(event, callback),
        setPermissionRequestCallback: (callback) => agent.setPermissionRequestCallback(callback as any),
        allowToolForSession: (toolName) => agent.allowToolForSession(toolName),
        clearToolPermissions: () => agent.clearToolPermissions(),
        getPermissionConfig: () => {
          const config = agent.getPermissionManager().getConfig();
          return {
            defaultMode: config.defaultMode || 'ask',
            alwaysAllow: config.alwaysAllow || [],
            alwaysDeny: config.alwaysDeny || [],
            allowAll: config.allowAll || false,
          };
        },
        updatePermissionConfig: (config) => agent.updatePermissionConfig(config as Partial<CorePermissionConfig>),
        getDisabledTools: () => [],
        setDisabledTools: () => {},
        disableTool: () => {},
        enableTool: () => {},
        getToolsInfo: () => {
          const allTools = agent.getToolRegistry().getAll();
          return allTools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            icon: undefined,
            tags: tool.tags || [],
            requires: tool.requiredCapabilities || [],
            available: true,
            disabled: false,
          }));
        },
        getModel: () => {
          const config = (agent as any).getConfig?.() ?? {};
          // Normalize "anthropic-oauth" back to "anthropic" for the UI, which
          // matches models against the provider id from models.dev.
          const rawProvider = config.provider || 'anthropic';
          const provider = rawProvider === 'anthropic-oauth' ? 'anthropic' : rawProvider;
          return {
            provider,
            model: config.model || 'claude-sonnet-4-20250514',
          };
        },
        setModel: (provider, model) => {
          const a = agent as any;
          // When the agent is currently using anthropic-oauth and the caller
          // requests "anthropic", rewrite the provider name to "anthropic-oauth"
          // so that Agent.setModel() does NOT recreate the provider from the
          // registry.  The registry's "anthropic" entry creates a plain
          // API-key-based AnthropicProvider that lacks an access token, which
          // would cause "No valid authentication provided" errors.
          const currentProvider = a.getConfig?.()?.provider;
          const effectiveProvider =
            currentProvider === 'anthropic-oauth' && provider === 'anthropic'
              ? 'anthropic-oauth'
              : provider;
          if (a.setModel) {
            a.setModel(effectiveProvider, model);
          } else if (a.setProvider) {
            a.setProvider(effectiveProvider);
          }
        },
        getTodos: () => {
          return (agent as any).getTodos?.() ?? [];
        },
        getPhases: () => {
          return (agent as any).getPhases?.() ?? [];
        },
        shutdown: async () => {
          const extras = desktopExtras.get(projectId);
          if (extras?.sandboxBrowserController) {
            await extras.sandboxBrowserController.shutdown();
          }
          await agent.shutdown();
          desktopExtras.delete(projectId);
        },
      };

      // Create PlatformSessionManager wrapper
      const platformSessionManager: PlatformSessionManager = {
        createSession: (opts) => sessionManager.createSession({
          ...opts,
          provider: opts.provider ?? 'anthropic',
          model: opts.model ?? 'claude-sonnet-4-20250514',
        }),
        getRootSessions: (limit) => sessionManager.getRootSessions(limit),
        getSession: (id) => sessionManager.getSession(id),
        deleteSession: (id) => sessionManager.deleteSession(id).then(() => {}),
        deleteAllSessions: () => sessionManager.deleteAllSessions(),
        async getSessionMessages(id) {
          const messages = await sessionManager.getSessionMessages(id);
          return messages.map((m) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            isCompactionSummary: m.isCompactionSummary ?? false,
            toolCalls: m.toolCalls?.map((tc) => ({
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments as Record<string, unknown>,
            })) ?? undefined,
            toolResults: m.toolResults?.map((tr) => ({
              toolCallId: tr.toolCallId,
              content: tr.content,
              isError: tr.isError ?? undefined,
            })) ?? undefined,
            createdAt: m.createdAt,
          }));
        },
        addMessage: (params) => sessionManager.addMessage(params).then(() => {}),
        async getSessionMessagesPaginated(id, limit, beforeSequence?) {
          const result = await sessionManager.getSessionMessagesPaginated(id, limit, beforeSequence);
          return {
            messages: result.messages.map((m) => ({
              id: m.id,
              role: m.role as 'user' | 'assistant',
              content: m.content,
              isCompactionSummary: m.isCompactionSummary ?? false,
              toolCalls: m.toolCalls?.map((tc) => ({
                id: tc.id,
                name: tc.name,
                arguments: tc.arguments as Record<string, unknown>,
              })) ?? undefined,
              toolResults: m.toolResults?.map((tr) => ({
                toolCallId: tr.toolCallId,
                content: tr.content,
                isError: tr.isError ?? undefined,
              })) ?? undefined,
              sequence: m.sequence,
              createdAt: m.createdAt,
            })),
            hasMore: result.hasMore,
          };
        },
        getNextSequence: (id) => sessionManager.getNextSequence(id),
        async searchSessions(opts) {
          const results = await sessionManager.searchSessions(opts);
          return results.map((r) => ({
            session: {
              ...r.session,
              messageCount: r.session.messageCount ?? 0,
            },
            matchingMessages: r.matchingMessages?.map((m) => ({
              id: m.id,
              role: m.role as 'user' | 'assistant',
              content: typeof m.content === 'string' ? m.content : String(m.content),
              createdAt: m.createdAt,
            })),
          }));
        },
      };

      return { agent: platformAgent, sessionManager: platformSessionManager, hasIncrementalPersistence: true };
    },
  };
}

// =============================================================================
// Public API
// =============================================================================

export interface DesktopBridge extends AgentBridge {
  /** Graceful shutdown of all agents */
  shutdown(): Promise<void>;
}

/**
 * Create the DesktopBridge.
 *
 * Returns an AgentBridge backed by BridgeCore with Electron-specific
 * platform adapters plus overrides for MCP, project discovery, and tools.
 */
export function createDesktopBridge(
  mainWindow: BrowserWindow,
  secureStorage: SecureStorage,
  browserViewManager?: import('./browserViewManager').BrowserViewManager,
): DesktopBridge {
  const appDb: AppDatabase = getAppDatabase();
  const desktopExtras = new Map<string, DesktopAgentExtras>();

  const platformStorage = createDesktopStorage(secureStorage);
  const platformFilesystem = createDesktopFilesystem();
  const agentFactory = createDesktopAgentFactory(mainWindow, secureStorage, desktopExtras, browserViewManager);

  // Built-in plugin auth header resolvers.
  // Maps authType → function that produces headers from authConfig.
  // This runs in the main process so we can't use the React plugin registry directly.
  // Built-in plugins register their getAuthHeaders here; future dynamic plugins
  // could extend this via IPC from the renderer.
  const pluginAuthHeaderResolvers: Record<string, (authConfig: Record<string, unknown>) => Record<string, string>> = {
    'cloudflare-access': (authConfig) => ({
      'CF-Access-Client-Id': String(authConfig.clientId ?? ''),
      'CF-Access-Client-Secret': String(authConfig.clientSecret ?? ''),
    }),
  };

  // Create the bridge
  const bridge = createBridgeCore({
    agentFactory,
    storage: platformStorage,
    filesystem: platformFilesystem,
    getPluginAuthHeaders: (authType, authConfig) => {
      const resolver = pluginAuthHeaderResolvers[authType];
      return resolver ? resolver(authConfig) : undefined;
    },
    resolveScreenshotUrl: (projectId, path) =>
      `openmgr-screenshot://${projectId}/${path}`,
    onEvent: (projectId, event) => {
      mainWindow.webContents.send(`project:${projectId}:event`, event);
    },
    onProjectsChanged: async (projects) => {
      // Diff with DB and persist changes
      const existingRows = await appDb.getAllProjects();
      const currentIds = new Set(projects.map((p) => p.id));
      // Delete removed projects from DB
      for (const row of existingRows) {
        if (!currentIds.has(row.id)) {
          await appDb.deleteProject(row.id);
        }
      }
      // Upsert current projects
      const existingIds = new Set(existingRows.map((r) => r.id));
      for (const project of projects) {
        if (existingIds.has(project.id)) {
          await appDb.updateProject(project.id, {
            name: project.name,
            path: project.path,
            providerType: project.providerType,
            remoteServerId: project.remoteServerId ?? null,
            worktreeEnabled: project.worktreeEnabled ?? null,
          });
        } else {
          await appDb.createProject({
            id: project.id,
            name: project.name,
            path: project.path,
            providerType: project.providerType,
            remoteServerId: project.remoteServerId ?? null,
            worktreeEnabled: project.worktreeEnabled ?? null,
          });
        }
      }
    },
    onRemoteServersChanged: async (servers) => {
      const existingRows = await appDb.getAllRemoteServers();
      const currentIds = new Set(servers.map((s) => s.id));
      for (const row of existingRows) {
        if (!currentIds.has(row.id)) {
          await appDb.deleteRemoteServer(row.id);
        }
      }
      const existingIds = new Set(existingRows.map((r) => r.id));
      for (const server of servers) {
        if (existingIds.has(server.id)) {
          await appDb.updateRemoteServer(server.id, {
            name: server.name,
            url: server.url,
            apiKey: server.token,
            authType: server.authType ?? null,
            authConfig: server.authConfig ? JSON.stringify(server.authConfig) : null,
          });
        } else {
          await appDb.createRemoteServer({
            id: server.id,
            name: server.name,
            url: server.url,
            apiKey: server.token ?? null,
            authType: server.authType ?? null,
            authConfig: server.authConfig ? JSON.stringify(server.authConfig) : null,
          });
        }
      }
    },
  });

  // =========================================================================
  // Lazy-load persisted data (same pattern as MobileBridge).
  // The first call to listProjects() or listRemoteServers() triggers loading,
  // and all concurrent callers await the same promise. This prevents race
  // conditions where the renderer requests data before it's loaded.
  // =========================================================================

  let serversLoadingPromise: Promise<void> | null = null;
  let projectsLoadingPromise: Promise<void> | null = null;

  const originalListRemoteServers = bridge.listRemoteServers.bind(bridge);
  bridge.listRemoteServers = async () => {
    if (!serversLoadingPromise) {
      serversLoadingPromise = (async () => {
        try {
          const serverRows = await appDb.getAllRemoteServers();
          for (const s of serverRows) {
            try {
              await bridge.addRemoteServer({
                name: s.name,
                url: s.url,
                token: s.apiKey ?? undefined,
                authType: s.authType ?? undefined,
                authConfig: s.authConfig ? JSON.parse(s.authConfig) : undefined,
              });
            } catch (e) {
              log.error(`Failed to restore server ${s.name}:`, e);
            }
          }
        } catch (e) {
          log.error('Failed to load remote servers:', e);
        }
      })();
    }
    await serversLoadingPromise;
    return originalListRemoteServers();
  };

  const originalListProjects = bridge.listProjects.bind(bridge);
  bridge.listProjects = async () => {
    if (!projectsLoadingPromise) {
      projectsLoadingPromise = (async () => {
        // Load remote servers first — remote projects depend on them
        await bridge.listRemoteServers();

        try {
          const projectRows = await appDb.getAllProjects();
          for (const p of projectRows) {
            if (p.providerType === 'local') {
              try {
                await bridge.createProject(p.path, 'local', undefined, p.name);
              } catch (e) {
                log.error(`Failed to restore project ${p.name}:`, e);
              }
            }
            // Remote projects will be synced via syncRemoteProjects
          }

          // Restore worktreeEnabled from DB and detect isGitRepo for local projects
          const projects = await originalListProjects();
          for (const project of projects) {
            if (project.providerType === 'local') {
              // Restore worktreeEnabled from DB
              const row = projectRows.find((r) => r.path === project.path);
              if (row?.worktreeEnabled != null) {
                project.worktreeEnabled = row.worktreeEnabled;
              }
              // Detect git repo status
              try {
                project.isGitRepo = await worktreeManager.isGitRepo(project.path);
              } catch {
                project.isGitRepo = false;
              }
            }
          }
        } catch (e) {
          log.error('Failed to load projects:', e);
        }
      })();
    }
    await projectsLoadingPromise;
    const projects = await originalListProjects();
    // Enrich with isGitRepo for any projects not yet checked
    // (e.g. newly created projects after initial load)
    for (const project of projects) {
      if (project.providerType === 'local' && project.isGitRepo === undefined) {
        try {
          project.isGitRepo = await worktreeManager.isGitRepo(project.path);
        } catch {
          project.isGitRepo = false;
        }
      }
    }
    return projects;
  };

  // =========================================================================
  // Desktop-only method overrides
  // =========================================================================

  // --- Local Terminal ---

  const localTerminalManager = new LocalTerminalManager();
  // Start the local terminal WebSocket server eagerly
  localTerminalManager.start().catch((err) => {
    log.error('Failed to start local terminal manager:', err);
  });

  const worktreeManager = new WorktreeManager();
  const localDocker = new LocalDockerService();
  // Initialize Docker availability check in the background
  localDocker.initialize().catch((e) => {
    log.warn('Failed to initialize local Docker:', e);
  });

  /**
   * Check if a project is local (has a desktopExtras entry meaning it's running
   * in-process rather than via a remote server).
   */
  const isLocalProject = (projectId: string): boolean => {
    return desktopExtras.has(projectId);
  };

  const originalListTerminals = bridge.listTerminals.bind(bridge);
  bridge.listTerminals = async (projectId: string) => {
    if (!isLocalProject(projectId)) return originalListTerminals(projectId);
    const sessions = localTerminalManager.getSessionsByProject(projectId);
    return sessions.map((s) => ({
      id: s.id,
      projectId: s.projectId,
      workingDirectory: s.workingDirectory,
      createdAt: s.createdAt,
      lastActivity: s.lastActivity,
    }));
  };

  const originalCreateTerminal = bridge.createTerminal.bind(bridge);
  bridge.createTerminal = async (projectId: string, options?: { shell?: string; workingDirectory?: string; rows?: number; cols?: number }) => {
    if (!isLocalProject(projectId)) return originalCreateTerminal(projectId, options);
    
    // Get the project's working directory
    const projects = await bridge.listProjects();
    const project = projects.find((p) => p.id === projectId);
    const workDir = options?.workingDirectory || project?.path || process.cwd();

    const sessionId = localTerminalManager.createSession(projectId, workDir, options?.shell);
    const session = localTerminalManager.getSession(sessionId)!;
    return {
      id: session.id,
      projectId: session.projectId,
      workingDirectory: session.workingDirectory,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
    };
  };

  const originalGetTerminal = bridge.getTerminal.bind(bridge);
  bridge.getTerminal = async (projectId: string, sessionId: string) => {
    if (!isLocalProject(projectId)) return originalGetTerminal(projectId, sessionId);
    const session = localTerminalManager.getSession(sessionId);
    if (!session) return null;
    return {
      id: session.id,
      projectId: session.projectId,
      workingDirectory: session.workingDirectory,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
    };
  };

  const originalDeleteTerminal = bridge.deleteTerminal.bind(bridge);
  bridge.deleteTerminal = async (projectId: string, sessionId: string) => {
    if (!isLocalProject(projectId)) return originalDeleteTerminal(projectId, sessionId);
    return localTerminalManager.killSession(sessionId);
  };

  const originalResizeTerminal = bridge.resizeTerminal.bind(bridge);
  bridge.resizeTerminal = async (projectId: string, sessionId: string, cols: number, rows: number) => {
    if (!isLocalProject(projectId)) return originalResizeTerminal(projectId, sessionId, cols, rows);
    return localTerminalManager.resizeSession(sessionId, cols, rows);
  };

  const originalGetTerminalWebSocketUrl = bridge.getTerminalWebSocketUrl.bind(bridge);
  bridge.getTerminalWebSocketUrl = (projectId: string, sessionId: string) => {
    if (!isLocalProject(projectId)) return originalGetTerminalWebSocketUrl(projectId, sessionId);
    return localTerminalManager.getWebSocketUrl(sessionId);
  };

  // --- Terminal Helper (Smart Terminal / aish) ---

  bridge.askTerminalHelper = async (projectId: string, context: TerminalHelperContext): Promise<TerminalHelperSuggestion | null> => {
    const extras = desktopExtras.get(projectId);
    if (!extras) return null;

    // Get the terminal-helper agent type for its system prompt
    const typeRegistry = extras.agent.getAgentTypeRegistry();
    const helperType = typeRegistry.get('terminal-helper');
    if (!helperType?.systemPrompt) {
      log.warn('terminal-helper agent type not found');
      return null;
    }

    // Build the one-shot prompt
    const userMessage = context.isError
      ? `A command failed. Here's the context:\n\nFailed command output:\n\`\`\`\n${context.recentOutput}\n\`\`\`\n\nWorking directory: ${context.workingDirectory}\nOS: ${process.platform}\nShell: ${process.env.SHELL || 'unknown'}`
      : `Translate this to a shell command:\n\n"${context.input}"\n\nWorking directory: ${context.workingDirectory}\nOS: ${process.platform}\nShell: ${process.env.SHELL || 'unknown'}\n\nRecent terminal output:\n\`\`\`\n${context.recentOutput}\n\`\`\``;

    try {
      // Save and restore the agent's system prompt
      const originalPrompt = (extras.agent as any).getSystemPrompt?.() ?? '';
      extras.agent.setSystemPrompt(helperType.systemPrompt);

      const response = await extras.agent.prompt(userMessage);

      // Restore original system prompt
      if (originalPrompt) {
        extras.agent.setSystemPrompt(originalPrompt);
      }

      // Parse JSON from the response
      const content = response.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.command && typeof parsed.command === 'string') {
        return {
          command: parsed.command,
          explanation: parsed.explanation || '',
        };
      }
      return null;
    } catch (e) {
      log.error('Terminal helper error:', e);
      return null;
    }
  };

  // --- Worktree Sessions ---

  // Wrap createSession to handle worktree creation for local projects
  const originalCreateSession = bridge.createSession.bind(bridge);
  bridge.createSession = async (projectId, options) => {
    const session = await originalCreateSession(projectId, options);

    if (options?.useWorktree && isLocalProject(projectId)) {
      const projects = await bridge.listProjects();
      const project = projects.find((p) => p.id === projectId);
      if (project && project.worktreeEnabled) {
        try {
          const record = await worktreeManager.createWorktree(
            session.id,
            projectId,
            project.path,
            options.worktreeBranch,
          );

          // Update the agent's working directory to the worktree
          const extras = desktopExtras.get(projectId);
          if (extras) {
            // Append worktree instructions to the current system prompt
            const currentPrompt = (extras.agent as any).getSystemPrompt?.() ?? '';
            const worktreePrompt = worktreeManager.getWorktreeSystemPrompt(record);
            extras.agent.setSystemPrompt(currentPrompt + '\n' + worktreePrompt);
          }

          // Attach worktree info to the session
          (session as any).worktree = {
            branch: record.branch,
            baseBranch: record.baseBranch,
            path: record.worktreePath,
            status: record.status,
          } satisfies WorktreeInfo;
        } catch (e) {
          log.error('Failed to create worktree for session:', e);
          // Session was created but worktree failed — return session without worktree
        }
      }
    }

    return session;
  };

  // Wrap deleteSession to clean up worktrees
  const originalDeleteSession = bridge.deleteSession.bind(bridge);
  bridge.deleteSession = async (projectId, sessionId) => {
    // Clean up worktree if exists
    const record = worktreeManager.getWorktree(sessionId);
    if (record && record.status === 'active') {
      const projects = await bridge.listProjects();
      const project = projects.find((p) => p.id === projectId);
      if (project) {
        await worktreeManager.discard(sessionId, project.path);
      }
    }
    return originalDeleteSession(projectId, sessionId);
  };

  // Wrap deleteAllSessions to clean up worktrees
  const originalDeleteAllSessions = bridge.deleteAllSessions.bind(bridge);
  bridge.deleteAllSessions = async (projectId) => {
    // Clean up any active worktrees for this project's sessions
    const sessions = await bridge.listSessions(projectId);
    const projects = await bridge.listProjects();
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      for (const session of sessions) {
        const record = worktreeManager.getWorktree(session.id);
        if (record && record.status === 'active') {
          try {
            await worktreeManager.discard(session.id, project.path);
          } catch (e) {
            log.warn('Failed to clean up worktree for session', session.id, e);
          }
        }
      }
    }
    return originalDeleteAllSessions(projectId);
  };

  // Worktree diff/merge/discard operations
  bridge.getWorktreeDiff = async (projectId: string, sessionId: string): Promise<WorktreeDiffResult | null> => {
    const diff = await worktreeManager.getDiff(sessionId);
    if (!diff) return null;
    return {
      files: diff.files.map((f) => ({
        path: f.path,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        diff: f.diff,
      })),
      additions: diff.additions,
      deletions: diff.deletions,
      filesChanged: diff.filesChanged,
    };
  };

  bridge.mergeWorktree = async (projectId: string, sessionId: string) => {
    const projects = await bridge.listProjects();
    const project = projects.find((p) => p.id === projectId);
    if (!project) return { success: false, message: 'Project not found' };
    return worktreeManager.merge(sessionId, project.path);
  };

  bridge.discardWorktree = async (projectId: string, sessionId: string) => {
    const projects = await bridge.listProjects();
    const project = projects.find((p) => p.id === projectId);
    if (!project) return { success: false, message: 'Project not found' };
    return worktreeManager.discard(sessionId, project.path);
  };

  // --- Docker ---
  // Docker operations support both local projects (via LocalDockerService)
  // and remote projects (proxied to the server).

  bridge.getDockerStatus = async (serverId: string) => {
    // For local projects (serverId === 'local'), use the local Docker service
    if (serverId === 'local') {
      try {
        const status = await localDocker.getStatus();
        return status;
      } catch (e) {
        return { available: false, insideDocker: false, dindAvailable: false, error: e instanceof Error ? e.message : 'Unknown error' };
      }
    }

    // Remote server
    try {
      const resp = await bridge.remoteServerFetch(serverId, '/docker/status');
      if (resp.ok) {
        return JSON.parse(resp.body);
      }
      return { available: false, insideDocker: false, dindAvailable: false, error: 'Failed to check Docker status' };
    } catch (e) {
      return { available: false, insideDocker: false, dindAvailable: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  };

  bridge.getDockerContainer = async (projectId: string) => {
    const projects = await bridge.listProjects();
    const project = projects.find((p) => p.id === projectId);
    if (!project) return null;

    // Local project — check local Docker
    if (isLocalProject(projectId)) {
      try {
        return await localDocker.getContainerStats(project.path);
      } catch {
        return null;
      }
    }

    // Remote project
    if (project.providerType !== 'remote' || !project.remoteServerId) return null;
    try {
      const resp = await bridge.remoteServerFetch(project.remoteServerId, `/docker/containers/${projectId}`);
      if (resp.ok) {
        return JSON.parse(resp.body);
      }
      return null;
    } catch {
      return null;
    }
  };

  bridge.buildDockerImage = async (serverId: string) => {
    // Dead code — no buildDockerImage server endpoint exists.
    // Kept for interface compatibility; will be removed in Phase 8 cleanup.
    try {
      const resp = await bridge.remoteServerFetch(serverId, '/docker/build-image', { method: 'POST' });
      if (resp.ok) {
        return JSON.parse(resp.body);
      }
      return { success: false, error: 'Build request failed' };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  };

  // --- MCP ---

  const originalListMcpServers = bridge.listMcpServers.bind(bridge);
  bridge.listMcpServers = async (projectId: string): Promise<McpServerInfo[]> => {
    const extras = desktopExtras.get(projectId);
    if (!extras) return originalListMcpServers(projectId);

    const mcpManager = extras.agent.getMcpManager();
    if (!mcpManager) return [];

    const servers = mcpManager.getServers();
    return servers.map((s) => ({
      name: s.name,
      type: s.transport as 'stdio' | 'sse',
      status: {
        connected: s.connected,
        toolCount: s.toolCount,
        error: s.error,
      },
    }));
  };

  const originalAddMcpServer = bridge.addMcpServer.bind(bridge);
  bridge.addMcpServer = async (projectId: string, config: UIMcpServerConfig): Promise<void> => {
    const extras = desktopExtras.get(projectId);
    if (!extras) return originalAddMcpServer(projectId, config);

    const agentConfig = config.type === 'stdio'
      ? { transport: 'stdio' as const, command: config.command || '', args: config.args || [], env: config.env, enabled: true, timeout: 30000 }
      : { transport: 'sse' as const, url: config.url || '', enabled: true, timeout: 30000 };

    const mcpManager = extras.agent.getMcpManager();
    if (!mcpManager) {
      await extras.agent.initMcp({ [config.name]: agentConfig });
    } else {
      await mcpManager.addServer(config.name, agentConfig);
    }

    // Persist to project config
    const project = (await bridge.listProjects()).find((p) => p.id === projectId);
    if (project) {
      const configPath = path.join(project.path, '.openmgr', 'config.json');
      let existingConfig: Record<string, unknown> = {};
      try { existingConfig = JSON.parse(await fs.readFile(configPath, 'utf-8')); } catch {}
      if (!existingConfig.mcp) existingConfig.mcp = { servers: {} };
      (existingConfig.mcp as { servers: Record<string, UIMcpServerConfig> }).servers[config.name] = config;
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, JSON.stringify(existingConfig, null, 2));
    }
  };

  const originalRemoveMcpServer = bridge.removeMcpServer.bind(bridge);
  bridge.removeMcpServer = async (projectId: string, serverName: string): Promise<void> => {
    const extras = desktopExtras.get(projectId);
    if (!extras) return originalRemoveMcpServer(projectId, serverName);

    const mcpManager = extras.agent.getMcpManager();
    if (mcpManager) await mcpManager.removeServer(serverName);
  };

  const originalGetMcpTools = bridge.getMcpTools.bind(bridge);
  bridge.getMcpTools = async (projectId: string): Promise<UIMcpTool[]> => {
    const extras = desktopExtras.get(projectId);
    if (!extras) return originalGetMcpTools(projectId);

    const mcpManager = extras.agent.getMcpManager();
    if (!mcpManager) return [];

    const tools = mcpManager.getTools();
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      serverName: t.serverName,
      inputSchema: t.inputSchema,
    }));
  };

  const originalGetMcpStatus = bridge.getMcpStatus.bind(bridge);
  bridge.getMcpStatus = async (projectId: string): Promise<Record<string, UIMcpServerStatus>> => {
    const extras = desktopExtras.get(projectId);
    if (!extras) return originalGetMcpStatus(projectId);
    return Object.fromEntries(extras.mcpStatus);
  };

  // --- Tools info (uses agent-scoped registry when available, global fallback) ---

  bridge.getToolsInfo = async (projectId: string): Promise<ToolInfo[]> => {
    const disabledTools = await bridge.getDisabledTools(projectId);
    const disabledSet = new Set(disabledTools);
    const extras = desktopExtras.get(projectId);
    const registry = extras ? extras.agent.getToolRegistry() : toolRegistry;
    const allTools = registry.getAll();
    return allTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      tags: tool.tags || [],
      requires: tool.requiredCapabilities || [],
      available: true,
      disabled: disabledSet.has(tool.name),
    }));
  };

  // --- Project prompt configuration ---

  /**
   * Compose a system prompt from a root agent type and optional custom instructions.
   * Returns undefined if no root agent type is set (falls back to DEFAULT_SYSTEM_PROMPT).
   * When an agent is available, uses its scoped AgentTypeRegistry; otherwise falls back to the global.
   */
  const composeProjectSystemPrompt = (rootAgentType?: string, customInstructions?: string, agent?: Agent): string | undefined => {
    if (!rootAgentType) {
      // No root agent selected — use custom instructions alone if present
      if (customInstructions) {
        return undefined; // Let the caller append to the default
      }
      return undefined;
    }
    const typeRegistry = agent ? agent.getAgentTypeRegistry() : agentTypeRegistry;
    const agentType = typeRegistry.get(rootAgentType);
    if (!agentType?.systemPrompt) return undefined;

    let prompt = agentType.systemPrompt;
    if (customInstructions) {
      prompt += '\n\n# Project-Specific Instructions\n\n' + customInstructions;
    }
    return prompt;
  };

  // Wrap updateProject to apply prompt changes to running agents
  const originalUpdateProject = bridge.updateProject.bind(bridge);
  bridge.updateProject = async (projectId, updates) => {
    await originalUpdateProject(projectId, updates);

    // If prompt-related fields changed, update the running agent's system prompt
    if (updates.rootAgentType !== undefined || updates.customInstructions !== undefined) {
      const extras = desktopExtras.get(projectId);
      if (extras) {
        // Re-read the project to get the full current state
        const projects = await bridge.listProjects();
        const project = projects.find((p) => p.id === projectId);
        if (project) {
          const composed = composeProjectSystemPrompt(
            updates.rootAgentType ?? project.rootAgentType,
            updates.customInstructions ?? project.customInstructions,
            extras.agent,
          );
          if (composed) {
            extras.agent.setSystemPrompt(composed);
          }
        }
      }
    }
  };

  // --- Agent types (subagent presets) ---

  bridge.getAgentTypes = async (projectId: string): Promise<AgentTypeInfo[]> => {
    const extras = desktopExtras.get(projectId);
    const typeRegistry = extras ? extras.agent.getAgentTypeRegistry() : agentTypeRegistry;
    return typeRegistry.getAllIncludingDisabled().map((def) => ({
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
      source: (def.source ?? 'builtin') as AgentTypeInfo['source'],
      integrity: def.integrity,
    }));
  };

  bridge.getAgentTypeConflicts = async (projectId: string): Promise<AgentTypeConflictInfo[]> => {
    const extras = desktopExtras.get(projectId);
    const typeRegistry = extras ? extras.agent.getAgentTypeRegistry() : agentTypeRegistry;
    return typeRegistry.getConflicts().map((c) => ({
      name: c.name,
      keptSource: (c.kept.source ?? 'builtin') as AgentTypeConflictInfo['keptSource'],
      replacedSource: (c.replaced.source ?? 'builtin') as AgentTypeConflictInfo['replacedSource'],
      keptIntegrity: c.kept.integrity,
      replacedIntegrity: c.replaced.integrity,
    }));
  };

  bridge.setAgentTypeEnabled = async (projectId: string, name: string, enabled: boolean): Promise<void> => {
    const extras = desktopExtras.get(projectId);
    const typeRegistry = extras ? extras.agent.getAgentTypeRegistry() : agentTypeRegistry;
    typeRegistry.setEnabled(name, enabled);
  };

  // --- Token usage (needs access to real Agent) ---

  bridge.getTokenUsage = async (projectId: string) => {
    const extras = desktopExtras.get(projectId);
    if (!extras) return null;
    const summary = extras.agent.getUsageSummary();
    return {
      promptTokens: summary.total.promptTokens,
      completionTokens: summary.total.completionTokens,
      totalTokens: summary.total.totalTokens,
      cacheCreationInputTokens: summary.total.cacheCreationInputTokens,
      cacheReadInputTokens: summary.total.cacheReadInputTokens,
      estimatedCost: summary.total.estimatedCost,
      requestCount: summary.total.requestCount,
    };
  };

  // --- Context window usage (needs access to real Agent) ---

  bridge.getContextUsage = async (projectId: string) => {
    const extras = desktopExtras.get(projectId);
    if (!extras) return null;
    const agent = extras.agent as any;
    if (typeof agent.getContextUsage === 'function') {
      return agent.getContextUsage();
    }
    return null;
  };

  // --- Commands ---

  const originalGetCommands = bridge.getCommands.bind(bridge);
  bridge.getCommands = async (projectId: string): Promise<SlashCommand[]> => {
    // For remote projects, delegate to BridgeCore
    const projects = await bridge.listProjects();
    const project = projects.find((p) => p.id === projectId);
    if (project?.providerType === 'remote') return originalGetCommands(projectId);

    return [
      { name: 'help', description: 'Show available commands' },
      { name: 'clear', description: 'Clear the conversation' },
      { name: 'model', description: 'Change the model', arguments: [{ name: 'model', required: true }] },
      { name: 'compact', description: 'Compact the conversation history' },
      { name: 'bug', description: 'Report a bug or issue' },
    ];
  };

  // --- Project discovery (Electron-only, needs Node.js fs) ---

  bridge.discoverProjects = async (directory: string): Promise<Project[]> => {
    const discovered: Project[] = [];
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      const existingProjects = await bridge.listProjects();
      const existingPaths = new Set(existingProjects.map((p) => p.path));

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const projectPath = path.join(directory, entry.name);

        let hasGit = false;
        let hasOpenMgr = false;
        try { await fs.access(path.join(projectPath, '.git')); hasGit = true; } catch {}
        try { await fs.access(path.join(projectPath, '.openmgr')); hasOpenMgr = true; } catch {}

        if ((hasGit || hasOpenMgr) && !existingPaths.has(projectPath)) {
          discovered.push({
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: entry.name,
            path: projectPath,
            createdAt: Date.now(),
            providerType: 'local',
          });
        }
      }
    } catch (e) {
      log.error('Failed to discover projects:', e);
    }
    return discovered;
  };

  // --- Question forwarding (needs access to real Agent) ---

  const originalRespondToQuestion = bridge.respondToQuestion.bind(bridge);
  bridge.respondToQuestion = async (
    projectId: string,
    sessionId: string,
    questionId: string,
    response: { selected: string[]; freeformText?: string },
  ) => {
    const extras = desktopExtras.get(projectId);
    if (extras) {
      extras.agent.respondToQuestion(questionId, response);
      return;
    }
    return originalRespondToQuestion(projectId, sessionId, questionId, response);
  };

  // =========================================================================
  // Director Agent
  // =========================================================================

  let directorAgent: Agent | null = null;
  let directorSessionManager: SessionManager | null = null;
  let directorCurrentSessionId = '';
  const directorEventSubscribers = new Set<(event: AgentEvent) => void>();

  /**
   * Lazily initialize the Director agent on first use.
   * Uses the app's default auth (same as project agents).
   */
  const getDirectorAgent = async (): Promise<{ agent: Agent; sessionManager: SessionManager }> => {
    if (directorAgent && directorSessionManager) {
      return { agent: directorAgent, sessionManager: directorSessionManager };
    }

    log.info('Initializing Director agent');

    const dataDir = app.getPath('userData');
    const directorDir = path.join(dataDir, 'director');
    await fs.mkdir(directorDir, { recursive: true });
    const directorDbPath = path.join(directorDir, 'director.db');

    // Get current auth
    const oauthTokens = platformStorage.getOAuthTokens ? await platformStorage.getOAuthTokens() : null;
    const apiKeys = await platformStorage.listApiKeys();
    const anthropicKey = apiKeys.find(k => k.provider === 'anthropic' && k.hasKey);
    const apiKey = anthropicKey ? await secureStorage.getApiKey('anthropic') : undefined;

    // Create a lightweight agent — no terminal tools, no MCP, no browser
    const agent = new Agent({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      auth: {
        type: oauthTokens ? 'oauth' : 'api-key',
        apiKey: apiKey || '',
      },
      systemPrompt: DIRECTOR_SYSTEM_PROMPT,
      workingDirectory: directorDir,
    });

    // Register providers
    if (oauthTokens?.accessToken && oauthTokens.refreshToken && oauthTokens.expiresAt) {
      const oauthProvider = new AnthropicOAuthProvider({
        tokens: {
          accessToken: oauthTokens.accessToken,
          refreshToken: oauthTokens.refreshToken,
          expiresAt: oauthTokens.expiresAt,
        },
        onTokenRefresh: async (newTokens) => {
          await platformStorage.saveOAuthTokens?.(newTokens);
        },
      });
      agent.getProviderRegistry().register({
        name: 'anthropic-oauth',
        factory: () => oauthProvider,
      });
      agent.setProvider('anthropic-oauth');
    } else {
      // Register the providers plugin for API-key-based auth
      const { providersPlugin } = await import('@openmgr/agent-providers');
      await agent.use(providersPlugin);
    }

    // Use an isolated tool registry so Director tools don't leak to project agents
    agent.useIsolatedToolRegistry();

    // Register storage plugin
    await agent.use(storagePlugin({ path: directorDbPath }));

    // Register Director tools plugin
    await agent.use(directorToolsPlugin);

    // Set up DirectorContext — the implementation that connects tools to bridge methods
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
        const project = await bridge.createProject(opts.path, opts.providerType, opts.remoteServerId, opts.name);
        return {
          id: project.id,
          name: project.name,
          path: project.path,
          providerType: project.providerType,
          remoteServerId: project.remoteServerId,
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
        const session = await bridge.createSession(projectId, { title: opts?.title });
        return {
          id: session.id,
          title: session.title,
          projectId,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
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
          connected: !!s.lastSeen && (Date.now() - s.lastSeen) < 5 * 60 * 1000,
          lastSeen: s.lastSeen,
        }));
      },
      async addServer(opts) {
        const server = await bridge.addRemoteServer({
          name: opts.name,
          url: opts.url,
          token: opts.token,
          authType: opts.authType,
        });
        return {
          id: server.id,
          name: server.name,
          url: server.url,
          authType: server.authType,
          connected: false,
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
          const servers = await bridge.listRemoteServers();
          const server = servers.find(s => s.id === serverIdOrConfig);
          if (!server) return { success: false, message: 'Server not found' };
          const start = Date.now();
          const result = await bridge.testRemoteServer({ url: server.url, token: server.token });
          return {
            success: result.success,
            message: result.success ? 'Connection successful' : (result.error || 'Connection failed'),
            latencyMs: Date.now() - start,
          };
        } else {
          const start = Date.now();
          const result = await bridge.testRemoteServer({ url: serverIdOrConfig.url, token: serverIdOrConfig.token });
          return {
            success: result.success,
            message: result.success ? 'Connection successful' : (result.error || 'Connection failed'),
            latencyMs: Date.now() - start,
          };
        }
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
        const localStatus = await bridge.getAuthStatus();
        const servers = await bridge.listRemoteServers();
        const serverStatuses: DirectorAuthStatus['servers'] = [];

        for (const server of servers) {
          try {
            const resp = await bridge.remoteServerFetch(server.id, '/system/api-keys');
            if (resp.ok) {
              const data = JSON.parse(resp.body);
              serverStatuses.push({
                serverId: server.id,
                serverName: server.name,
                providers: (data.providers || []).map((p: any) => ({
                  id: p.id,
                  name: p.name,
                  configured: p.configured || p.hasKey || false,
                })),
              });
            }
          } catch {
            // Server unreachable, skip
          }
        }

        return {
          local: {
            anthropic: { authenticated: localStatus.anthropic.authenticated, method: localStatus.anthropic.method === 'apikey' ? 'api' : localStatus.anthropic.method },
            openai: localStatus.openai,
            google: localStatus.google,
            openrouter: localStatus.openrouter,
            groq: localStatus.groq,
            xai: localStatus.xai,
          },
          servers: serverStatuses,
        };
      },
      async setApiKey(provider, key, serverId) {
        if (serverId) {
          await bridge.remoteServerFetch(serverId, `/system/api-keys/${provider}`, {
            method: 'PUT',
            body: JSON.stringify({ values: { [`${provider.toUpperCase()}_API_KEY`]: key } }),
          });
        } else {
          await bridge.setApiKey(provider, key);
        }
      },
      async deleteApiKey(provider, serverId) {
        if (serverId) {
          await bridge.remoteServerFetch(serverId, `/system/api-keys/${provider}`, { method: 'DELETE' });
        } else {
          await bridge.deleteApiKey(provider);
        }
      },
      async getDockerStatus(serverId) {
        if (bridge.getDockerStatus) {
          const status = await bridge.getDockerStatus(serverId);
          return {
            available: status.available,
            version: status.version,
            platform: undefined,
            insideDocker: status.insideDocker,
            agentImageBuilt: undefined,
          };
        }
        return { available: false };
      },
      async updateDockerConfig(projectId, config) {
        const projects = await bridge.listProjects();
        const project = projects.find(p => p.id === projectId);
        if (!project || project.providerType !== 'remote' || !project.remoteServerId) {
          throw new Error('Docker is only available for remote projects');
        }
        await bridge.remoteServerFetch(project.remoteServerId, `/projects/${projectId}/config`, {
          method: 'PUT',
          body: JSON.stringify({
            docker: {
              enabled: config.enabled,
              image: config.image,
              resources: {
                cpus: config.cpus,
                memory: config.memory,
              },
            },
          }),
        });
      },
      async getSettings() {
        return { theme: 'system' as const };
      },
      async setTheme(mode) {
        mainWindow.webContents.send('director:set-theme', mode);
      },
      async navigate(target) {
        mainWindow.webContents.send('director:navigate', target);
      },
      async getSystemInfo(serverId) {
        if (serverId) {
          try {
            const resp = await bridge.remoteServerFetch(serverId, '/info');
            if (resp.ok) {
              const info = JSON.parse(resp.body);
              return {
                agentVersion: info.agentVersion,
                uptime: info.uptime,
                memoryUsage: info.memoryUsage,
                nodeVersion: info.nodeVersion,
                platform: info.platform,
                dockerStatus: info.dockerStatus,
              };
            }
          } catch {
            // Server unreachable
          }
          return {};
        }
        return {
          platform: process.platform,
          nodeVersion: process.version,
          memoryUsage: process.memoryUsage(),
        };
      },
      async getDefaultProjectsDirectory() {
        try {
          const documentsPath = app.getPath('documents');
          return `${documentsPath}/OpenMgr Projects`;
        } catch {
          return null;
        }
      },
      async listDirectory(dirPath) {
        try {
          const entries = await fs.readdir(dirPath, { withFileTypes: true });
          const result: { name: string; path: string; isDirectory: boolean }[] = [];
          for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            result.push({
              name: entry.name,
              path: path.join(dirPath, entry.name),
              isDirectory: entry.isDirectory(),
            });
          }
          return result.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
        } catch {
          return [];
        }
      },
      async ensureDirectoryExists(dirPath) {
        await fs.mkdir(dirPath, { recursive: true });
      },
    };

    agent.setExtension(DIRECTOR_CONTEXT_KEY, directorContext);

    // Set up permission callback so Director tools can request user approval.
    // Uses the same pattern as project agents (see bridge/projects.ts).
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
        mainWindow.webContents.send('director:event', agentEvent);
        for (const subscriber of directorEventSubscribers) {
          subscriber(agentEvent);
        }
      });
    });

    // Forward Director agent events
    agent.on('event', (event) => {
      const agentEvent = { ...event, sessionId: directorCurrentSessionId } as AgentEvent;
      mainWindow.webContents.send('director:event', agentEvent);
      for (const subscriber of directorEventSubscribers) {
        subscriber(agentEvent);
      }
    });

    // Extract session manager
    const sm = agent.getExtension<SessionManager>('storage.sessions')!;

    directorAgent = agent;
    directorSessionManager = sm;
    // Expose permission resolvers so directorRespondToPermission can use them
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
    const session = await sm.createSession({
      workingDirectory: app.getPath('userData'),
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
      toolCalls: m.toolCalls?.map(tc => ({
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
        toolCalls: m.toolCalls?.map(tc => ({
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
      mainWindow.webContents.send('director:event', event);
      for (const subscriber of directorEventSubscribers) {
        subscriber(event);
      }
    };

    try {
      // Run the prompt.
      // Message persistence is handled incrementally by the storage
      // plugin's onMessageAdded hook — no batch save needed here.
      await da.prompt(content);

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

  bridge.directorRespondToPermission = async (sessionId, toolCallId, response) => {
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

  bridge.directorRespondToQuestion = async (sessionId, questionId, response) => {
    if (directorAgent) {
      directorAgent.respondToQuestion(questionId, response);
    }
  };

  // =========================================================================
  // Expose shutdown for graceful cleanup
  // =========================================================================

  const desktopBridge = bridge as DesktopBridge;
  desktopBridge.shutdown = async () => {
    await localTerminalManager.shutdown();
    await worktreeManager.shutdown();
    await localDocker.shutdown();
    if (directorAgent) {
      await directorAgent.shutdown();
      directorAgent = null;
      directorSessionManager = null;
    }
    for (const extras of desktopExtras.values()) {
      await extras.sandboxBrowserController?.shutdown();
      await extras.agent.shutdown();
    }
    desktopExtras.clear();
  };

  return desktopBridge;
}
