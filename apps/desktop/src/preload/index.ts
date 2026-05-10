import { contextBridge, ipcRenderer } from 'electron';
import type {
  AgentBridge,
  AgentEvent,
  Project,
  Session,
  Message,
  RemoteServerConfig,
  CreateSessionOptions,
  SendOptions,
  PermissionResponse,
  ToolPermissionConfig,
  McpServerConfig,
  McpServerInfo,
  McpServerStatus,
  McpTool,
  ModelInfo,
  SlashCommand,
  FileEntry,
  ApiKeyInfo,
  AuthStatus,
  SearchOptions,
  SearchResult,
} from '@openmgr/ui';

const bridge: AgentBridge = {
  // ============ Project Management ============
  
  createProject: (path, providerType, remoteServerId, name) =>
    ipcRenderer.invoke('project:create', path, providerType, remoteServerId, name),
  
  listProjects: () =>
    ipcRenderer.invoke('project:list'),
  
  syncRemoteProjects: () =>
    ipcRenderer.invoke('project:syncRemote'),
  
  updateProject: (projectId, updates) =>
    ipcRenderer.invoke('project:update', projectId, updates),
  
  removeProject: (projectId) =>
    ipcRenderer.invoke('project:remove', projectId),
  
  discoverProjects: (directory) =>
    ipcRenderer.invoke('project:discover', directory),

  // ============ Remote Server Management ============
  
  listRemoteServers: () =>
    ipcRenderer.invoke('remote:list'),
  
  addRemoteServer: (config) =>
    ipcRenderer.invoke('remote:add', config),
  
  updateRemoteServer: (id, config) =>
    ipcRenderer.invoke('remote:update', id, config),
  
  removeRemoteServer: (id) =>
    ipcRenderer.invoke('remote:remove', id),
  
  testRemoteServer: (config) =>
    ipcRenderer.invoke('remote:test', config),

  remoteServerFetch: (serverId, path, options) =>
    ipcRenderer.invoke('remote:fetch', serverId, path, options),

  // ============ Session Management ============
  
  listSessions: (projectId) =>
    ipcRenderer.invoke('session:list', projectId),
  
  syncRemoteSessions: (projectId) =>
    ipcRenderer.invoke('session:syncRemote', projectId),
  
  createSession: (projectId, options) =>
    ipcRenderer.invoke('session:create', projectId, options),
  
  deleteSession: (projectId, sessionId) =>
    ipcRenderer.invoke('session:delete', projectId, sessionId),
  
  deleteAllSessions: (projectId) =>
    ipcRenderer.invoke('session:deleteAll', projectId),
  
  getSession: (projectId, sessionId) =>
    ipcRenderer.invoke('session:get', projectId, sessionId),

  // ============ Messaging ============
  
  getMessages: (projectId, sessionId) =>
    ipcRenderer.invoke('message:list', projectId, sessionId),
  
  getMessagesPaginated: (projectId, sessionId, limit, beforeSequence?) =>
    ipcRenderer.invoke('message:listPaginated', projectId, sessionId, limit, beforeSequence),
  
  syncRemoteMessages: (projectId, sessionId) =>
    ipcRenderer.invoke('message:syncRemote', projectId, sessionId),
  
  sendMessage: (projectId, sessionId, content, options) =>
    ipcRenderer.invoke('message:send', projectId, sessionId, content, options),
  
  cancelMessage: (projectId) =>
    ipcRenderer.invoke('message:cancel', projectId),

  // ============ Session Status & Reconnection ============

  getSessionStatus: (projectId, sessionId) =>
    ipcRenderer.invoke('session:status', projectId, sessionId),

  subscribeToSessionEvents: async (projectId, sessionId, lastEventIndex) => {
    // Subscribe via IPC - the main process handles the actual SSE connection.
    // Events are forwarded through the existing project event channel.
    // We get back a subscription ID to use for unsubscribing.
    const subId = await ipcRenderer.invoke('session:subscribeEvents', projectId, sessionId, lastEventIndex);
    if (!subId) return null;
    return () => {
      ipcRenderer.invoke('session:unsubscribeEvents', subId);
    };
  },

  // ============ Events ============
  
  subscribeToProject: (projectId, callback) => {
    const channel = `project:${projectId}:event`;
    const handler = (_: Electron.IpcRendererEvent, event: AgentEvent) => callback(event);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },

  // ============ Permissions ============
  
  respondToPermission: (projectId, sessionId, toolCallId, response) =>
    ipcRenderer.invoke('permission:respond', projectId, sessionId, toolCallId, response),
  
  getPermissionConfig: (projectId) =>
    ipcRenderer.invoke('permission:getConfig', projectId),
  
  updatePermissionConfig: (projectId, config) =>
    ipcRenderer.invoke('permission:updateConfig', projectId, config),

  // ============ Questions ============

  respondToQuestion: (projectId, sessionId, questionId, response) =>
    ipcRenderer.invoke('question:respond', projectId, sessionId, questionId, response),

  // ============ Tools ============
  
  getToolsInfo: (projectId) =>
    ipcRenderer.invoke('tools:list', projectId),
  
  getDisabledTools: (projectId) =>
    ipcRenderer.invoke('tools:getDisabled', projectId),
  
  setDisabledTools: (projectId, tools) =>
    ipcRenderer.invoke('tools:setDisabled', projectId, tools),
  
  disableTool: (projectId, toolName) =>
    ipcRenderer.invoke('tools:disable', projectId, toolName),
  
  enableTool: (projectId, toolName) =>
    ipcRenderer.invoke('tools:enable', projectId, toolName),

  // ============ Agent Types ============

  getAgentTypes: (projectId) =>
    ipcRenderer.invoke('agentTypes:list', projectId),

  getAgentTypeConflicts: (projectId) =>
    ipcRenderer.invoke('agentTypes:conflicts', projectId),

  setAgentTypeEnabled: (projectId, name, enabled) =>
    ipcRenderer.invoke('agentTypes:setEnabled', projectId, name, enabled),

  // ============ Plugins ============

  getPlugins: (projectId) =>
    ipcRenderer.invoke('plugins:list', projectId),

  installPlugin: (projectId, packageSpec) =>
    ipcRenderer.invoke('plugins:install', projectId, packageSpec),

  uninstallPlugin: (projectId, packageName) =>
    ipcRenderer.invoke('plugins:uninstall', projectId, packageName),

  // ============ Token Usage ============

  getTokenUsage: (projectId) =>
    ipcRenderer.invoke('usage:get', projectId),

  // ============ Context Window Usage ============

  getContextUsage: (projectId) =>
    ipcRenderer.invoke('context-usage:get', projectId),

  // ============ Authentication ============
  
  getAuthStatus: () =>
    ipcRenderer.invoke('auth:status'),
  
  initiateOAuth: (provider) =>
    ipcRenderer.invoke('auth:oauth:init', provider),
  
  completeOAuth: (provider, code, verifier) =>
    ipcRenderer.invoke('auth:oauth:complete', provider, code, verifier),
  
  disconnectOAuth: (provider) =>
    ipcRenderer.invoke('auth:disconnect', provider),

  // ============ API Keys ============
  
  getApiKeys: () =>
    ipcRenderer.invoke('apikeys:list'),
  
  setApiKey: (provider, key) =>
    ipcRenderer.invoke('apikeys:set', provider, key),
  
  deleteApiKey: (provider) =>
    ipcRenderer.invoke('apikeys:delete', provider),

  // ============ MCP ============
  
  listMcpServers: (projectId) =>
    ipcRenderer.invoke('mcp:list', projectId),
  
  addMcpServer: (projectId, config) =>
    ipcRenderer.invoke('mcp:add', projectId, config),
  
  removeMcpServer: (projectId, serverName) =>
    ipcRenderer.invoke('mcp:remove', projectId, serverName),
  
  getMcpTools: (projectId) =>
    ipcRenderer.invoke('mcp:tools', projectId),
  
  getMcpStatus: (projectId) =>
    ipcRenderer.invoke('mcp:status', projectId),

  // ============ Models ============
  
  getModels: (projectId) =>
    ipcRenderer.invoke('models:list', projectId),
  
  getCurrentModel: (projectId) =>
    ipcRenderer.invoke('models:getCurrent', projectId),
  
  setModel: (projectId, provider, model) =>
    ipcRenderer.invoke('models:set', projectId, provider, model),
  
  // ============ Session Model Override ============
  
  getSessionModel: (projectId, sessionId) =>
    ipcRenderer.invoke('models:session:get', projectId, sessionId),
  
  setSessionModel: (projectId, sessionId, provider, model) =>
    ipcRenderer.invoke('models:session:set', projectId, sessionId, provider, model),
  
  clearSessionModel: (projectId, sessionId) =>
    ipcRenderer.invoke('models:session:clear', projectId, sessionId),

  // ============ Session Mode ============
  
  getSessionMode: (projectId, sessionId) =>
    ipcRenderer.invoke('mode:session:get', projectId, sessionId),
  
  setSessionMode: (projectId, sessionId, mode) =>
    ipcRenderer.invoke('mode:session:set', projectId, sessionId, mode),

  // ============ Commands ============
  
  getCommands: (projectId) =>
    ipcRenderer.invoke('commands:list', projectId),

  // ============ Filesystem (project-scoped) ============
  
  readDirectory: (projectId, path) =>
    ipcRenderer.invoke('fs:readdir', projectId, path),
  
  readFile: (projectId, path) =>
    ipcRenderer.invoke('fs:read', projectId, path),
  
  writeFile: (projectId, path, content) =>
    ipcRenderer.invoke('fs:write', projectId, path, content),
  
  watchFile: (projectId, path) =>
    ipcRenderer.invoke('fs:watch', projectId, path),
  
  unwatchFile: (projectId, path) =>
    ipcRenderer.invoke('fs:unwatch', projectId, path),

  // ============ Terminal ============
  
  listTerminals: (projectId) =>
    ipcRenderer.invoke('terminal:list', projectId),
  
  createTerminal: (projectId, options) =>
    ipcRenderer.invoke('terminal:create', projectId, options),
  
  getTerminal: (projectId, sessionId) =>
    ipcRenderer.invoke('terminal:get', projectId, sessionId),
  
  deleteTerminal: (projectId, sessionId) =>
    ipcRenderer.invoke('terminal:delete', projectId, sessionId),
  
  resizeTerminal: (projectId, sessionId, cols, rows) =>
    ipcRenderer.invoke('terminal:resize', projectId, sessionId, cols, rows),
  
  getTerminalWebSocketUrl: (projectId, sessionId) =>
    ipcRenderer.invoke('terminal:getWebSocketUrl', projectId, sessionId),

  askTerminalHelper: (projectId, context) =>
    ipcRenderer.invoke('terminal:askHelper', projectId, context),

  // ============ Worktree ============

  getWorktreeDiff: (projectId, sessionId) =>
    ipcRenderer.invoke('worktree:diff', projectId, sessionId),

  mergeWorktree: (projectId, sessionId) =>
    ipcRenderer.invoke('worktree:merge', projectId, sessionId),

  discardWorktree: (projectId, sessionId) =>
    ipcRenderer.invoke('worktree:discard', projectId, sessionId),

  // ============ Docker ============

  getDockerStatus: (serverId) =>
    ipcRenderer.invoke('docker:status', serverId),

  getDockerContainer: (projectId) =>
    ipcRenderer.invoke('docker:container', projectId),

  buildDockerImage: (serverId) =>
    ipcRenderer.invoke('docker:buildImage', serverId),

  // ============ Remote Filesystem Browsing ============
  
  getRemoteFilesystemHome: (serverId) =>
    ipcRenderer.invoke('fs:remote:home', serverId),
  
  listRemoteFilesystem: (serverId, path, showHidden) =>
    ipcRenderer.invoke('fs:remote:list', serverId, path, showHidden),
  
  createRemoteDirectory: (serverId, parentPath, name) =>
    ipcRenderer.invoke('fs:remote:mkdir', serverId, parentPath, name),

  // ============ Channels ============
  
  listChannels: (serverId) =>
    ipcRenderer.invoke('channels:list', serverId),
  
  getChannel: (serverId, channelId) =>
    ipcRenderer.invoke('channels:get', serverId, channelId),
  
  updateChannel: (serverId, channelId, updates) =>
    ipcRenderer.invoke('channels:update', serverId, channelId, updates),
  
  listChannelBindings: (serverId, channelId) =>
    ipcRenderer.invoke('channels:bindings:list', serverId, channelId),
  
  updateChannelBinding: (serverId, channelId, bindingId, updates) =>
    ipcRenderer.invoke('channels:bindings:update', serverId, channelId, bindingId, updates),

  // ============ Settings ============
  
  getProjectsDirectory: () =>
    ipcRenderer.invoke('settings:getProjectsDirectory'),
  
  setProjectsDirectory: (path) =>
    ipcRenderer.invoke('settings:setProjectsDirectory', path),

  // ============ Search ============
  
  searchSessions: (options) =>
    ipcRenderer.invoke('search:sessions', options),

  // ============ Director Agent ============

  directorListSessions: () =>
    ipcRenderer.invoke('director:listSessions'),

  directorCreateSession: (title) =>
    ipcRenderer.invoke('director:createSession', title),

  directorDeleteSession: (sessionId) =>
    ipcRenderer.invoke('director:deleteSession', sessionId),

  directorGetMessages: (sessionId) =>
    ipcRenderer.invoke('director:getMessages', sessionId),

  directorGetMessagesPaginated: (sessionId, limit, beforeSequence) =>
    ipcRenderer.invoke('director:getMessagesPaginated', sessionId, limit, beforeSequence),

  directorSendMessage: (sessionId, content) =>
    ipcRenderer.invoke('director:sendMessage', sessionId, content),

  directorCancelMessage: (sessionId) =>
    ipcRenderer.invoke('director:cancelMessage', sessionId),

  directorSubscribeToEvents: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, event: AgentEvent) => callback(event);
    ipcRenderer.on('director:event', handler);
    return () => {
      ipcRenderer.removeListener('director:event', handler);
    };
  },

  directorRespondToPermission: (sessionId, toolCallId, response) =>
    ipcRenderer.invoke('director:respondToPermission', sessionId, toolCallId, response),

  directorRespondToQuestion: (sessionId, questionId, response) =>
    ipcRenderer.invoke('director:respondToQuestion', sessionId, questionId, response),
};

// Expose the bridge to the renderer process
contextBridge.exposeInMainWorld('agentBridge', bridge);

// Also expose a dialog helper and shortcut listeners
contextBridge.exposeInMainWorld('electron', {
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
  getDocumentsPath: () => ipcRenderer.invoke('paths:documents'),
  ensureDirectoryExists: (path: string) => ipcRenderer.invoke('fs:ensureDir', path),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),
  openInFileBrowser: (path: string) => ipcRenderer.invoke('shell:openPath', path),
  
  // Keyboard shortcut event listeners
  onShortcut: (shortcut: string, callback: (...args: unknown[]) => void) => {
    const channel = `shortcut:${shortcut}`;
    const handler = (_: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
  
  // Auth callback listener (legacy, kept for backwards compatibility)
  onAuthCallback: (callback: (url: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, url: string) => callback(url);
    ipcRenderer.on('auth:callback', handler);
    return () => {
      ipcRenderer.removeListener('auth:callback', handler);
    };
  },

  // Deeplink listener.
  // Registers for push-based IPC and also signals the main process that the
  // renderer is ready, retrieving any deeplink that arrived before this point.
  onDeeplink: (callback: (url: string) => void) => {
    console.log('[preload] onDeeplink: registering IPC listener');
    const handler = (_: Electron.IpcRendererEvent, url: string) => {
      console.log('[preload] onDeeplink: received IPC deeplink:', url);
      callback(url);
    };
    ipcRenderer.on('deeplink', handler);

    // Signal readiness and flush any pending deeplink
    ipcRenderer.invoke('deeplink:ready').then((pendingUrl: string | null) => {
      if (pendingUrl) {
        console.log('[preload] onDeeplink: flushing pending deeplink:', pendingUrl);
        callback(pendingUrl);
      }
    });

    return () => {
      console.log('[preload] onDeeplink: removing IPC listener');
      ipcRenderer.removeListener('deeplink', handler);
    };
  },

  // Director events (from main process)
  onDirectorNavigate: (callback: (target: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, target: string) => callback(target);
    ipcRenderer.on('director:navigate', handler);
    return () => {
      ipcRenderer.removeListener('director:navigate', handler);
    };
  },

  onDirectorSetTheme: (callback: (mode: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, mode: string) => callback(mode);
    ipcRenderer.on('director:set-theme', handler);
    return () => {
      ipcRenderer.removeListener('director:set-theme', handler);
    };
  },

  // Auto-update
  update: {
    checkForUpdate: () => ipcRenderer.invoke('update:check'),
    installUpdate: () => ipcRenderer.invoke('update:install'),
    getStatus: () => ipcRenderer.invoke('update:getStatus'),
    onStatusChange: (callback: (status: { state: string; info?: { version: string; releaseDate?: string; releaseNotes?: string }; progress?: number; error?: string }) => void) => {
      const handler = (_: Electron.IpcRendererEvent, status: any) => callback(status);
      ipcRenderer.on('update:status', handler);
      return () => {
        ipcRenderer.removeListener('update:status', handler);
      };
    },
  },

  // Browser view management (WebContentsView embedded in tabs)
  browserView: {
    show: (browserId: string) => ipcRenderer.invoke('browserView:show', browserId),
    hide: (browserId: string) => ipcRenderer.invoke('browserView:hide', browserId),
    hideAll: () => ipcRenderer.invoke('browserView:hideAll'),
    setBounds: (browserId: string, bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke('browserView:setBounds', browserId, bounds),
    destroy: (browserId: string) => ipcRenderer.invoke('browserView:destroy', browserId),
    onNavigated: (callback: (browserId: string, url: string) => void) => {
      const handler = (_: Electron.IpcRendererEvent, browserId: string, url: string) =>
        callback(browserId, url);
      ipcRenderer.on('browser-view:navigated', handler);
      return () => {
        ipcRenderer.removeListener('browser-view:navigated', handler);
      };
    },
  },
});
