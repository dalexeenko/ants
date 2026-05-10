import { IpcMain, app, dialog, shell } from 'electron';
import { SecureStorage } from './services/secureStorage';
import type { BrowserViewManager } from './services/browserViewManager';
import type {
  RemoteServerConfig,
  CreateSessionOptions,
  SendOptions,
  PermissionResponse,
  ToolPermissionConfig,
  McpServerConfig,
  AgentBridge,
  Project,
} from '@ants/ui';

export function setupIpcHandlers(
  ipcMain: IpcMain,
  bridge: AgentBridge,
  storage: SecureStorage,
  browserViewManager?: BrowserViewManager,
) {
  // ============ Project Management ============

  ipcMain.handle('project:create', async (_, path: string, providerType: 'local' | 'remote', remoteServerId?: string, customName?: string) => {
    return bridge.createProject(path, providerType, remoteServerId, customName);
  });

  ipcMain.handle('project:list', async () => {
    return bridge.listProjects();
  });

  ipcMain.handle('project:remove', async (_, projectId: string) => {
    return bridge.removeProject(projectId);
  });

  ipcMain.handle('project:discover', async (_, directory: string) => {
    return bridge.discoverProjects(directory);
  });

  ipcMain.handle('project:syncRemote', async () => {
    return bridge.syncRemoteProjects();
  });

  ipcMain.handle('project:update', async (_, projectId: string, updates: Partial<Pick<Project, 'name'>>) => {
    return bridge.updateProject(projectId, updates);
  });

  // ============ Remote Server Management ============

  ipcMain.handle('remote:list', async () => {
    return bridge.listRemoteServers();
  });

  ipcMain.handle('remote:add', async (_, config: Omit<RemoteServerConfig, 'id' | 'createdAt'>) => {
    return bridge.addRemoteServer(config);
  });

  ipcMain.handle('remote:update', async (_, id: string, config: Partial<RemoteServerConfig>) => {
    return bridge.updateRemoteServer(id, config);
  });

  ipcMain.handle('remote:remove', async (_, id: string) => {
    return bridge.removeRemoteServer(id);
  });

  ipcMain.handle('remote:test', async (_, config: { url: string; token?: string }) => {
    return bridge.testRemoteServer(config);
  });

  ipcMain.handle('remote:fetch', async (_, serverId: string, path: string, options?: { method?: string; body?: string }) => {
    return bridge.remoteServerFetch(serverId, path, options);
  });

  // ============ Session Management ============

  ipcMain.handle('session:list', async (_, projectId: string) => {
    return bridge.listSessions(projectId);
  });

  ipcMain.handle('session:create', async (_, projectId: string, options?: CreateSessionOptions) => {
    return bridge.createSession(projectId, options);
  });

  ipcMain.handle('session:delete', async (_, projectId: string, sessionId: string) => {
    return bridge.deleteSession(projectId, sessionId);
  });

  ipcMain.handle('session:deleteAll', async (_, projectId: string) => {
    return bridge.deleteAllSessions(projectId);
  });

  ipcMain.handle('session:get', async (_, projectId: string, sessionId: string) => {
    return bridge.getSession(projectId, sessionId);
  });

  ipcMain.handle('session:syncRemote', async (_, projectId: string) => {
    return bridge.syncRemoteSessions(projectId);
  });

  // ============ Messaging ============

  ipcMain.handle('message:list', async (_, projectId: string, sessionId: string) => {
    return bridge.getMessages(projectId, sessionId);
  });

  ipcMain.handle('message:listPaginated', async (_, projectId: string, sessionId: string, limit: number, beforeSequence?: number) => {
    return bridge.getMessagesPaginated(projectId, sessionId, limit, beforeSequence);
  });

  ipcMain.handle('message:send', async (_, projectId: string, sessionId: string, content: string, options?: SendOptions) => {
    return bridge.sendMessage(projectId, sessionId, content, options);
  });

  ipcMain.handle('message:cancel', async (_, projectId: string) => {
    return bridge.cancelMessage(projectId);
  });

  ipcMain.handle('message:syncRemote', async (_, projectId: string, sessionId: string) => {
    return bridge.syncRemoteMessages(projectId, sessionId);
  });

  // ============ Session Status & Reconnection ============

  ipcMain.handle('session:status', async (_, projectId: string, sessionId: string) => {
    return bridge.getSessionStatus(projectId, sessionId);
  });

  // subscribeToSessionEvents is special: it returns an unsubscribe function which
  // can't be serialized over IPC. Instead, events are forwarded through the existing
  // project event channel, and we return a subscription ID that can be used to unsubscribe.
  const sessionEventUnsubs = new Map<string, () => void>();

  ipcMain.handle('session:subscribeEvents', async (event, projectId: string, sessionId: string, lastEventIndex?: number) => {
    const subId = `${projectId}:${sessionId}:${Date.now()}`;
    const unsub = await bridge.subscribeToSessionEvents(projectId, sessionId, lastEventIndex);
    if (!unsub) return null;
    sessionEventUnsubs.set(subId, unsub);
    return subId;
  });

  ipcMain.handle('session:unsubscribeEvents', async (_, subId: string) => {
    const unsub = sessionEventUnsubs.get(subId);
    if (unsub) {
      unsub();
      sessionEventUnsubs.delete(subId);
    }
  });

  // ============ Permissions ============

  ipcMain.handle('permission:respond', async (_, projectId: string, sessionId: string, toolCallId: string, response: PermissionResponse) => {
    return bridge.respondToPermission(projectId, sessionId, toolCallId, response);
  });

  ipcMain.handle('permission:getConfig', async (_, projectId: string) => {
    return bridge.getPermissionConfig(projectId);
  });

  ipcMain.handle('permission:updateConfig', async (_, projectId: string, config: Partial<ToolPermissionConfig>) => {
    return bridge.updatePermissionConfig(projectId, config);
  });

  // ============ Questions ============

  ipcMain.handle('question:respond', async (_, projectId: string, sessionId: string, questionId: string, response: { selected: string[]; freeformText?: string }) => {
    return bridge.respondToQuestion(projectId, sessionId, questionId, response);
  });

  // ============ Tools ============

  ipcMain.handle('tools:list', async (_, projectId: string) => {
    return bridge.getToolsInfo(projectId);
  });

  ipcMain.handle('usage:get', async (_, projectId: string) => {
    return bridge.getTokenUsage(projectId);
  });

  ipcMain.handle('context-usage:get', async (_, projectId: string) => {
    return bridge.getContextUsage(projectId);
  });

  ipcMain.handle('tools:getDisabled', async (_, projectId: string) => {
    return bridge.getDisabledTools(projectId);
  });

  ipcMain.handle('tools:setDisabled', async (_, projectId: string, tools: string[]) => {
    return bridge.setDisabledTools(projectId, tools);
  });

  ipcMain.handle('tools:disable', async (_, projectId: string, toolName: string) => {
    return bridge.disableTool(projectId, toolName);
  });

  ipcMain.handle('tools:enable', async (_, projectId: string, toolName: string) => {
    return bridge.enableTool(projectId, toolName);
  });

  // ============ Agent Types ============

  ipcMain.handle('agentTypes:list', async (_, projectId: string) => {
    return bridge.getAgentTypes(projectId);
  });

  ipcMain.handle('agentTypes:conflicts', async (_, projectId: string) => {
    return bridge.getAgentTypeConflicts(projectId);
  });

  ipcMain.handle('agentTypes:setEnabled', async (_, projectId: string, name: string, enabled: boolean) => {
    return bridge.setAgentTypeEnabled(projectId, name, enabled);
  });

  // ============ Plugins ============

  ipcMain.handle('plugins:list', async (_, projectId: string) => {
    return bridge.getPlugins(projectId);
  });

  ipcMain.handle('plugins:install', async (_, projectId: string, packageSpec: string) => {
    return bridge.installPlugin(projectId, packageSpec);
  });

  ipcMain.handle('plugins:uninstall', async (_, projectId: string, packageName: string) => {
    return bridge.uninstallPlugin(projectId, packageName);
  });

  // ============ Authentication ============

  ipcMain.handle('auth:status', async () => {
    return bridge.getAuthStatus();
  });

  ipcMain.handle('auth:oauth:init', async (_, provider: 'anthropic') => {
    return bridge.initiateOAuth(provider);
  });

  ipcMain.handle('auth:oauth:complete', async (_, provider: 'anthropic', code: string, verifier: string) => {
    return bridge.completeOAuth(provider, code, verifier);
  });

  ipcMain.handle('auth:disconnect', async (_, provider: 'anthropic') => {
    return bridge.disconnectOAuth(provider);
  });

  // ============ API Keys ============

  ipcMain.handle('apikeys:list', async () => {
    return bridge.getApiKeys();
  });

  ipcMain.handle('apikeys:set', async (_, provider: string, key: string) => {
    return bridge.setApiKey(provider, key);
  });

  ipcMain.handle('apikeys:delete', async (_, provider: string) => {
    return bridge.deleteApiKey(provider);
  });

  // ============ MCP ============

  ipcMain.handle('mcp:list', async (_, projectId: string) => {
    return bridge.listMcpServers(projectId);
  });

  ipcMain.handle('mcp:add', async (_, projectId: string, config: McpServerConfig) => {
    return bridge.addMcpServer(projectId, config);
  });

  ipcMain.handle('mcp:remove', async (_, projectId: string, serverName: string) => {
    return bridge.removeMcpServer(projectId, serverName);
  });

  ipcMain.handle('mcp:tools', async (_, projectId: string) => {
    return bridge.getMcpTools(projectId);
  });

  ipcMain.handle('mcp:status', async (_, projectId: string) => {
    return bridge.getMcpStatus(projectId);
  });

  // ============ Models ============

  ipcMain.handle('models:list', async (_, projectId: string) => {
    return bridge.getModels(projectId);
  });

  ipcMain.handle('models:getCurrent', async (_, projectId: string) => {
    return bridge.getCurrentModel(projectId);
  });

  ipcMain.handle('models:set', async (_, projectId: string, provider: string, model: string) => {
    return bridge.setModel(projectId, provider, model);
  });

  // ============ Session Model Override ============

  ipcMain.handle('models:session:get', async (_, projectId: string, sessionId: string) => {
    return bridge.getSessionModel(projectId, sessionId);
  });

  ipcMain.handle('models:session:set', async (_, projectId: string, sessionId: string, provider: string, model: string) => {
    return bridge.setSessionModel(projectId, sessionId, provider, model);
  });

  ipcMain.handle('models:session:clear', async (_, projectId: string, sessionId: string) => {
    return bridge.clearSessionModel(projectId, sessionId);
  });

  // ============ Session Mode Override ============

  ipcMain.handle('mode:session:get', async (_, projectId: string, sessionId: string) => {
    return bridge.getSessionMode(projectId, sessionId);
  });

  ipcMain.handle('mode:session:set', async (_, projectId: string, sessionId: string, mode: string) => {
    return bridge.setSessionMode(projectId, sessionId, mode as any);
  });

  // ============ Commands ============

  ipcMain.handle('commands:list', async (_, projectId: string) => {
    return bridge.getCommands(projectId);
  });

  // ============ Filesystem (project-scoped) ============

  ipcMain.handle('fs:readdir', async (_, projectId: string, path: string) => {
    return bridge.readDirectory(projectId, path);
  });

  ipcMain.handle('fs:read', async (_, projectId: string, path: string) => {
    return bridge.readFile(projectId, path);
  });

  ipcMain.handle('fs:write', async (_, projectId: string, path: string, content: string) => {
    return bridge.writeFile(projectId, path, content);
  });

  ipcMain.handle('fs:watch', async (_, projectId: string, path: string) => {
    return bridge.watchFile(projectId, path);
  });

  ipcMain.handle('fs:unwatch', async (_, projectId: string, path: string) => {
    return bridge.unwatchFile(projectId, path);
  });

  // ============ Terminal ============

  ipcMain.handle('terminal:list', async (_, projectId: string) => {
    return bridge.listTerminals(projectId);
  });

  ipcMain.handle('terminal:create', async (_, projectId: string, options?: { shell?: string; workingDirectory?: string; rows?: number; cols?: number }) => {
    return bridge.createTerminal(projectId, options);
  });

  ipcMain.handle('terminal:get', async (_, projectId: string, sessionId: string) => {
    return bridge.getTerminal(projectId, sessionId);
  });

  ipcMain.handle('terminal:delete', async (_, projectId: string, sessionId: string) => {
    return bridge.deleteTerminal(projectId, sessionId);
  });

  ipcMain.handle('terminal:resize', async (_, projectId: string, sessionId: string, cols: number, rows: number) => {
    return bridge.resizeTerminal(projectId, sessionId, cols, rows);
  });

  ipcMain.handle('terminal:getWebSocketUrl', async (_, projectId: string, sessionId: string) => {
    return bridge.getTerminalWebSocketUrl(projectId, sessionId);
  });

  ipcMain.handle('terminal:askHelper', async (_, projectId: string, context: { input: string; recentOutput: string; workingDirectory: string; isError: boolean }) => {
    if (bridge.askTerminalHelper) {
      return bridge.askTerminalHelper(projectId, context);
    }
    return null;
  });

  // ============ Worktree ============

  ipcMain.handle('worktree:diff', async (_, projectId: string, sessionId: string) => {
    if (bridge.getWorktreeDiff) {
      return bridge.getWorktreeDiff(projectId, sessionId);
    }
    return null;
  });

  ipcMain.handle('worktree:merge', async (_, projectId: string, sessionId: string) => {
    if (bridge.mergeWorktree) {
      return bridge.mergeWorktree(projectId, sessionId);
    }
    return { success: false, message: 'Not supported' };
  });

  ipcMain.handle('worktree:discard', async (_, projectId: string, sessionId: string) => {
    if (bridge.discardWorktree) {
      return bridge.discardWorktree(projectId, sessionId);
    }
    return { success: false, message: 'Not supported' };
  });

  // ============ Docker ============

  ipcMain.handle('docker:status', async (_, serverId: string) => {
    if (bridge.getDockerStatus) {
      return bridge.getDockerStatus(serverId);
    }
    return { available: false, insideDocker: false, dindAvailable: false, error: 'Not supported' };
  });

  ipcMain.handle('docker:container', async (_, projectId: string) => {
    if (bridge.getDockerContainer) {
      return bridge.getDockerContainer(projectId);
    }
    return null;
  });

  ipcMain.handle('docker:buildImage', async (_, serverId: string) => {
    if (bridge.buildDockerImage) {
      return bridge.buildDockerImage(serverId);
    }
    return { success: false, error: 'Not supported' };
  });

  // ============ Remote Filesystem Browsing ============

  ipcMain.handle('fs:remote:home', async (_, serverId: string) => {
    return bridge.getRemoteFilesystemHome(serverId);
  });

  ipcMain.handle('fs:remote:list', async (_, serverId: string, path: string, showHidden?: boolean) => {
    return bridge.listRemoteFilesystem(serverId, path, showHidden);
  });

  ipcMain.handle('fs:remote:mkdir', async (_, serverId: string, parentPath: string, name: string) => {
    return bridge.createRemoteDirectory(serverId, parentPath, name);
  });

  // ============ Settings ============

  ipcMain.handle('settings:getProjectsDirectory', async () => {
    return bridge.getProjectsDirectory();
  });

  ipcMain.handle('settings:setProjectsDirectory', async (_, path: string) => {
    return bridge.setProjectsDirectory(path);
  });

  // ============ Search ============

  ipcMain.handle('search:sessions', async (_, options: { query: string; includeMessages?: boolean; limit?: number }) => {
    return bridge.searchSessions(options);
  });

  // ============ Channels ============

  ipcMain.handle('channels:list', async (_, serverId: string) => {
    return bridge.listChannels(serverId);
  });

  ipcMain.handle('channels:get', async (_, serverId: string, channelId: string) => {
    return bridge.getChannel(serverId, channelId);
  });

  ipcMain.handle('channels:update', async (_, serverId: string, channelId: string, updates: { name?: string; enabled?: boolean }) => {
    return bridge.updateChannel(serverId, channelId, updates);
  });

  ipcMain.handle('channels:bindings:list', async (_, serverId: string, channelId: string) => {
    return bridge.listChannelBindings(serverId, channelId);
  });

  ipcMain.handle('channels:bindings:update', async (_, serverId: string, channelId: string, bindingId: string, updates: Record<string, unknown>) => {
    return bridge.updateChannelBinding(serverId, channelId, bindingId, updates);
  });

  // ============ Director Agent ============

  ipcMain.handle('director:listSessions', async () => {
    return bridge.directorListSessions();
  });

  ipcMain.handle('director:createSession', async (_, title?: string) => {
    return bridge.directorCreateSession(title);
  });

  ipcMain.handle('director:deleteSession', async (_, sessionId: string) => {
    return bridge.directorDeleteSession(sessionId);
  });

  ipcMain.handle('director:getMessages', async (_, sessionId: string) => {
    return bridge.directorGetMessages(sessionId);
  });

  ipcMain.handle('director:getMessagesPaginated', async (_, sessionId: string, limit: number, beforeSequence?: number) => {
    return bridge.directorGetMessagesPaginated(sessionId, limit, beforeSequence);
  });

  ipcMain.handle('director:sendMessage', async (_, sessionId: string, content: string) => {
    return bridge.directorSendMessage(sessionId, content);
  });

  ipcMain.handle('director:cancelMessage', async (_, sessionId: string) => {
    return bridge.directorCancelMessage(sessionId);
  });

  ipcMain.handle('director:respondToPermission', async (_, sessionId: string, toolCallId: string, response: PermissionResponse) => {
    return bridge.directorRespondToPermission(sessionId, toolCallId, response);
  });

  ipcMain.handle('director:respondToQuestion', async (_, sessionId: string, questionId: string, response: { selected: string[]; freeformText?: string }) => {
    return bridge.directorRespondToQuestion(sessionId, questionId, response);
  });

  // ============ Dialog ============

  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('paths:documents', () => {
    return app.getPath('documents');
  });

  ipcMain.handle('shell:openPath', async (_, pathToOpen: string) => {
    await shell.openPath(pathToOpen);
  });

  ipcMain.handle('fs:ensureDir', async (_, dirPath: string) => {
    const fs = await import('fs/promises');
    await fs.mkdir(dirPath, { recursive: true });
  });

  ipcMain.handle('fs:writeFile', async (_, filePath: string, content: string) => {
    const fs = await import('fs/promises');
    await fs.writeFile(filePath, content, 'utf-8');
  });

  // ============ Browser View Management ============

  ipcMain.handle('browserView:show', (_, browserId: string) => {
    browserViewManager?.show(browserId);
  });

  ipcMain.handle('browserView:hide', (_, browserId: string) => {
    browserViewManager?.hide(browserId);
  });

  ipcMain.handle('browserView:hideAll', () => {
    browserViewManager?.hideAll();
  });

  ipcMain.handle('browserView:setBounds', (_, browserId: string, bounds: { x: number; y: number; width: number; height: number }) => {
    browserViewManager?.setBounds(browserId, bounds);
  });

  ipcMain.handle('browserView:destroy', (_, browserId: string) => {
    browserViewManager?.destroy(browserId);
  });
}
