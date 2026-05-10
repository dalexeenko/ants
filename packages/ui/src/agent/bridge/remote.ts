/**
 * Remote server management, terminal, channel, and misc bridge methods.
 */

import type {
  RemoteServerConfig,
  SearchResult,
  AgentBridge,
} from '../types';
import type { BridgeDeps } from './types';
import { createLogger } from '../../utils/logger';

const log = createLogger('remote');

type RemoteMethods = Pick<
  AgentBridge,
  | 'listRemoteServers'
  | 'addRemoteServer'
  | 'updateRemoteServer'
  | 'removeRemoteServer'
  | 'testRemoteServer'
  | 'remoteServerFetch'
  | 'listTerminals'
  | 'createTerminal'
  | 'getTerminal'
  | 'deleteTerminal'
  | 'resizeTerminal'
  | 'getTerminalWebSocketUrl'
  | 'getCommands'
  | 'getProjectsDirectory'
  | 'setProjectsDirectory'
  | 'searchSessions'
  | 'getTokenUsage'
  | 'listChannels'
  | 'getChannel'
  | 'updateChannel'
  | 'listChannelBindings'
  | 'updateChannelBinding'
>;

export function createRemoteMethods(deps: BridgeDeps): RemoteMethods {
  const { config, state, helpers } = deps;
  const { projects, localAgents, remoteServers } = state;
  const { generateId, remoteFetch, getRemoteServerForProject, updateServerLastSeen } = helpers;
  const { storage } = config;

  return {
    // ============ Remote Server Management ============

    async listRemoteServers() {
      return Array.from(remoteServers.values());
    },

    async addRemoteServer(serverConfig) {
      const server: RemoteServerConfig = {
        ...serverConfig,
        id: generateId(),
        createdAt: Date.now(),
      };
      remoteServers.set(server.id, server);
      config.onRemoteServersChanged?.(Array.from(remoteServers.values()));
      return server;
    },

    async updateRemoteServer(id, updates) {
      const server = remoteServers.get(id);
      if (server) {
        remoteServers.set(id, { ...server, ...updates });
        config.onRemoteServersChanged?.(Array.from(remoteServers.values()));
      }
    },

    async removeRemoteServer(id) {
      remoteServers.delete(id);
      config.onRemoteServersChanged?.(Array.from(remoteServers.values()));
    },

    async testRemoteServer(serverConfig) {
      const url = `${serverConfig.url}/api/beta/health/auth`;
      log.debug('testRemoteServer: Testing connection to:', url);
      try {
        const headers: Record<string, string> = {};
        // Plugin auth headers take precedence over bearer token
        if (serverConfig.authType && serverConfig.authType !== 'bearer' && serverConfig.authConfig && config.getPluginAuthHeaders) {
          const pluginHeaders = config.getPluginAuthHeaders(serverConfig.authType, serverConfig.authConfig);
          if (pluginHeaders) {
            Object.assign(headers, pluginHeaders);
          }
        } else if (serverConfig.token) {
          headers['Authorization'] = `Bearer ${serverConfig.token}`;
        }
        log.debug('testRemoteServer: Request headers:', Object.keys(headers));

        const response = await fetch(url, { headers });
        log.debug('testRemoteServer: Response status:', response.status, response.statusText);

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          log.debug('testRemoteServer: Response body:', text);

          if (response.status === 401) {
            // Check if this server requires multi-user auth so callers can offer a sign-in redirect.
            try {
              const statusRes = await fetch(`${serverConfig.url}/api/beta/auth/status`);
              if (statusRes.ok) {
                const status = await statusRes.json() as { multiUser?: boolean; authMethods?: string[] };
                if (status.multiUser) {
                  const connectUrl = `${serverConfig.url}/api/beta/auth/connect?redirect_uri=${encodeURIComponent('openmgr://connect')}`;
                  return {
                    success: false,
                    error: 'This server requires authentication. Sign in to connect.',
                    requiresAuth: true,
                    connectUrl,
                  };
                }
              }
            } catch {
              // If the status check fails, fall through to the generic error.
            }
            return { success: false, error: 'Authentication failed. The bearer token is invalid or missing.' };
          }
          if (response.status === 403) {
            return { success: false, error: 'Access denied. The token does not have sufficient permissions.' };
          }
          if (response.status === 404) {
            return { success: false, error: 'Server responded but the endpoint was not found (404). Verify the URL points to an OpenMgr server.' };
          }
          if (response.status >= 500) {
            return { success: false, error: `Server error (${response.status}). The server may be misconfigured or experiencing issues.` };
          }
          return { success: false, error: `Unexpected response from server (HTTP ${response.status}).` };
        }

        if ('id' in serverConfig && serverConfig.id) {
          updateServerLastSeen(serverConfig.id as string);
        }

        return { success: true };
      } catch (e) {
        log.error('testRemoteServer: Fetch error:', e);

        const message = e instanceof Error ? e.message : String(e);
        const cause = e instanceof Error && e.cause ? String(e.cause) : '';
        const detail = `${message} ${cause}`.toLowerCase();

        let friendlyError: string;
        if (detail.includes('getaddrinfo') || detail.includes('enotfound')) {
          let hostname: string | null = null;
          try { hostname = new URL(serverConfig.url).hostname; } catch {}
          friendlyError = `Could not resolve hostname${hostname ? ` "${hostname}"` : ''}. Check that the server URL is correct.`;
        } else if (detail.includes('econnrefused')) {
          friendlyError = 'Connection refused. The server may not be running, or the port may be wrong.';
        } else if (detail.includes('econnreset') || detail.includes('socket hang up')) {
          friendlyError = 'Connection was reset. The server closed the connection unexpectedly.';
        } else if (detail.includes('etimedout') || detail.includes('timeout') || detail.includes('timed out')) {
          friendlyError = 'Connection timed out. The server may be unreachable or behind a firewall.';
        } else if (detail.includes('cert') || detail.includes('ssl') || detail.includes('tls')) {
          friendlyError = 'SSL/TLS error. There may be a certificate problem with the server.';
        } else if (detail.includes('fetch failed')) {
          friendlyError = 'Could not connect to the server. Verify the URL is correct and the server is running.';
        } else {
          friendlyError = message || 'An unknown connection error occurred.';
        }

        return { success: false, error: friendlyError };
      }
    },

    async remoteServerFetch(serverId, path, options) {
      const server = remoteServers.get(serverId);
      if (!server) {
        return { status: 0, ok: false, body: JSON.stringify({ error: 'Server not found' }) };
      }
      try {
        const response = await remoteFetch(server, path, {
          method: options?.method || 'GET',
          body: options?.body,
        });
        const body = await response.text();
        return { status: response.status, ok: response.ok, body };
      } catch (e) {
        return { status: 0, ok: false, body: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) };
      }
    },

    // ============ Terminal ============

    async listTerminals(projectId) {
      const server = getRemoteServerForProject(projectId);
      if (!server) return [];

      const response = await remoteFetch(server, `/projects/${projectId}/terminals`);
      if (!response.ok) {
        throw new Error(`Failed to list terminals: ${response.status}`);
      }

      const result = await response.json();
      return result.sessions || [];
    },

    async createTerminal(projectId, options = {}) {
      const server = getRemoteServerForProject(projectId);
      if (!server) {
        throw new Error('Terminal is only available for remote projects');
      }

      const response = await remoteFetch(server, `/projects/${projectId}/terminals`, {
        method: 'POST',
        body: JSON.stringify(options),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to create terminal' }));
        throw new Error(error.error || `Failed to create terminal: ${response.status}`);
      }

      const result = await response.json();
      return {
        id: result.sessionId,
        projectId: result.projectId,
        workingDirectory: result.workingDirectory,
        createdAt: result.createdAt,
        lastActivity: result.createdAt,
      };
    },

    async getTerminal(projectId, sessionId) {
      const server = getRemoteServerForProject(projectId);
      if (!server) return null;

      const response = await remoteFetch(server, `/projects/${projectId}/terminals/${sessionId}`);
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`Failed to get terminal: ${response.status}`);
      }

      return response.json();
    },

    async deleteTerminal(projectId, sessionId) {
      const server = getRemoteServerForProject(projectId);
      if (!server) return false;

      const response = await remoteFetch(server, `/projects/${projectId}/terminals/${sessionId}`, {
        method: 'DELETE',
      });

      return response.ok;
    },

    async resizeTerminal(projectId, sessionId, cols, rows) {
      const server = getRemoteServerForProject(projectId);
      if (!server) return false;

      const response = await remoteFetch(server, `/projects/${projectId}/terminals/${sessionId}/resize`, {
        method: 'POST',
        body: JSON.stringify({ cols, rows }),
      });

      return response.ok;
    },

    getTerminalWebSocketUrl(projectId, sessionId) {
      const server = getRemoteServerForProject(projectId);
      if (!server) return null;

      const wsUrl = server.url.replace(/^http/, 'ws');
      const baseUrl = `${wsUrl}/api/beta/projects/${projectId}/terminals/${sessionId}/ws`;

      if (server.token) {
        return `${baseUrl}?token=${encodeURIComponent(server.token)}`;
      }

      return baseUrl;
    },

    // ============ Commands ============

    async getCommands(_projectId) {
      return [
        { name: 'help', description: 'Show available commands' },
        { name: 'clear', description: 'Clear the conversation' },
        { name: 'model', description: 'Change the model', arguments: [{ name: 'model', required: true }] },
        { name: 'compact', description: 'Compact the conversation history' },
        { name: 'bug', description: 'Report a bug or issue' },
      ];
    },

    // ============ Settings ============

    async getProjectsDirectory() {
      return storage.getProjectsDirectory();
    },

    async setProjectsDirectory(path) {
      return storage.setProjectsDirectory(path);
    },

    // ============ Search ============

    async searchSessions(options) {
      const results: SearchResult[] = [];

      // Search local agents
      for (const [projectId, managed] of localAgents) {
        const project = projects.get(projectId);
        if (!project) continue;

        try {
          const searchResults = await managed.sessionManager.searchSessions({
            query: options.query,
            includeMessages: options.includeMessages ?? true,
            limit: options.limit ?? 20,
          });

          for (const result of searchResults) {
            results.push({
              projectId,
              projectName: project.name,
              session: {
                id: result.session.id,
                title: result.session.title,
                workingDirectory: result.session.workingDirectory,
                createdAt: result.session.createdAt.getTime(),
                updatedAt: result.session.updatedAt.getTime(),
                messageCount: result.session.messageCount,
              },
              matchingMessages: result.matchingMessages?.map(m => ({
                id: m.id,
                role: m.role,
                content: m.content,
                createdAt: m.createdAt.getTime(),
              })),
            });
          }
        } catch (e) {
          log.error(`Failed to search sessions for project ${projectId}:`, e);
        }
      }

      // Search remote servers — fan out to each unique remote server
      const searchedServerIds = new Set<string>();
      for (const [projectId, project] of projects) {
        if (project.providerType !== 'remote' || !project.remoteServerId) continue;
        if (searchedServerIds.has(project.remoteServerId)) continue;
        searchedServerIds.add(project.remoteServerId);

        const server = remoteServers.get(project.remoteServerId);
        if (!server) continue;

        try {
          const params = new URLSearchParams();
          params.set('q', options.query);
          if (options.includeMessages !== undefined) {
            params.set('includeMessages', String(options.includeMessages));
          }
          if (options.limit !== undefined) {
            params.set('limit', String(options.limit));
          }

          const response = await remoteFetch(server, `/search/sessions?${params.toString()}`);
          if (response.ok) {
            const data = await response.json() as {
              results: Array<{
                session?: Record<string, unknown>;
                id?: string;
                title?: string | null;
                workingDirectory?: string;
                createdAt?: string | number;
                updatedAt?: string | number;
                messageCount?: number;
                matchingMessages?: Array<{
                  id: string;
                  role: 'user' | 'assistant';
                  content: string;
                  createdAt: string | number;
                }>;
              }>;
            };

            for (const item of data.results || []) {
              // The server search results may be nested under .session or flat
              const session = (item.session || item) as Record<string, unknown>;
              const sessionId = String(session.id || '');
              const createdAt = typeof session.createdAt === 'number'
                ? session.createdAt
                : new Date(String(session.createdAt || 0)).getTime();
              const updatedAt = typeof session.updatedAt === 'number'
                ? session.updatedAt
                : new Date(String(session.updatedAt || 0)).getTime();

              results.push({
                projectId,
                projectName: project.name,
                session: {
                  id: sessionId,
                  title: (session.title as string | null) ?? null,
                  workingDirectory: String(session.workingDirectory || ''),
                  createdAt,
                  updatedAt,
                  messageCount: Number(session.messageCount || 0),
                },
                matchingMessages: item.matchingMessages?.map(m => ({
                  id: m.id,
                  role: m.role,
                  content: m.content,
                  createdAt: typeof m.createdAt === 'number'
                    ? m.createdAt
                    : new Date(String(m.createdAt)).getTime(),
                })),
              });
            }
          }
        } catch (e) {
          log.error(`Failed to search remote sessions on server ${server.url}:`, e);
        }
      }

      results.sort((a, b) => b.session.updatedAt - a.session.updatedAt);
      return results.slice(0, options.limit ?? 50);
    },

    // ============ Token Usage ============

    async getTokenUsage(projectId) {
      const managed = localAgents.get(projectId);
      if (!managed) return null;

      const agent = managed.agent as any;
      if (typeof agent.getUsageSummary === 'function') {
        const summary = agent.getUsageSummary();
        return {
          promptTokens: summary.total.promptTokens,
          completionTokens: summary.total.completionTokens,
          totalTokens: summary.total.totalTokens,
          cacheCreationInputTokens: summary.total.cacheCreationInputTokens,
          cacheReadInputTokens: summary.total.cacheReadInputTokens,
          estimatedCost: summary.total.estimatedCost,
          requestCount: summary.total.requestCount,
        };
      }
      return null;
    },

    // ============ Context Window Usage ============

    async getContextUsage(projectId) {
      const managed = localAgents.get(projectId);
      if (!managed) return null;

      const agent = managed.agent as any;
      if (typeof agent.getContextUsage === 'function') {
        return agent.getContextUsage();
      }
      return null;
    },

    // ============ Channels ============

    async listChannels(serverId) {
      const server = remoteServers.get(serverId);
      if (!server) {
        throw new Error(`Remote server not found: ${serverId}`);
      }

      const response = await remoteFetch(server, '/channels');
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to list channels' }));
        throw new Error(error.error || `Failed to list channels: ${response.status}`);
      }

      const data = await response.json();
      const channels = data.channels || data || [];

      return channels.map((c: any) => ({
        id: c.id,
        type: c.type,
        name: c.name,
        config: c.config || {},
        credentials: c.credentials || {},
        enabled: c.enabled,
        createdAt: c.createdAt ? new Date(c.createdAt).getTime() : Date.now(),
        updatedAt: c.updatedAt ? new Date(c.updatedAt).getTime() : Date.now(),
      }));
    },

    async getChannel(serverId, channelId) {
      const server = remoteServers.get(serverId);
      if (!server) {
        throw new Error(`Remote server not found: ${serverId}`);
      }

      const response = await remoteFetch(server, `/channels/${channelId}`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to get channel' }));
        throw new Error(error.error || `Failed to get channel: ${response.status}`);
      }

      const c = await response.json();
      return {
        id: c.id,
        type: c.type,
        name: c.name,
        config: c.config || {},
        credentials: c.credentials || {},
        enabled: c.enabled,
        createdAt: c.createdAt ? new Date(c.createdAt).getTime() : Date.now(),
        updatedAt: c.updatedAt ? new Date(c.updatedAt).getTime() : Date.now(),
      };
    },

    async updateChannel(serverId, channelId, updates) {
      const server = remoteServers.get(serverId);
      if (!server) {
        throw new Error(`Remote server not found: ${serverId}`);
      }

      const response = await remoteFetch(server, `/channels/${channelId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to update channel' }));
        throw new Error(error.error || `Failed to update channel: ${response.status}`);
      }

      const c = await response.json();
      return {
        id: c.id,
        type: c.type,
        name: c.name,
        config: c.config || {},
        credentials: c.credentials || {},
        enabled: c.enabled,
        createdAt: c.createdAt ? new Date(c.createdAt).getTime() : Date.now(),
        updatedAt: c.updatedAt ? new Date(c.updatedAt).getTime() : Date.now(),
      };
    },

    async listChannelBindings(serverId, channelId) {
      const server = remoteServers.get(serverId);
      if (!server) {
        throw new Error(`Remote server not found: ${serverId}`);
      }

      const response = await remoteFetch(server, `/channels/${channelId}/bindings`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to list channel bindings' }));
        throw new Error(error.error || `Failed to list channel bindings: ${response.status}`);
      }

      const data = await response.json();
      const bindings = data.bindings || data || [];

      return bindings.map((b: any) => ({
        id: b.id,
        channelId: b.channelId,
        projectId: b.projectId,
        triggerConfig: b.triggerConfig || { events: [] },
        responseConfig: b.responseConfig,
        enabled: b.enabled,
        priority: b.priority || 0,
        createdAt: b.createdAt ? new Date(b.createdAt).getTime() : Date.now(),
        updatedAt: b.updatedAt ? new Date(b.updatedAt).getTime() : Date.now(),
      }));
    },

    async updateChannelBinding(serverId, channelId, bindingId, updates) {
      const server = remoteServers.get(serverId);
      if (!server) {
        throw new Error(`Remote server not found: ${serverId}`);
      }

      const response = await remoteFetch(server, `/channels/${channelId}/bindings/${bindingId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to update channel binding' }));
        throw new Error(error.error || `Failed to update channel binding: ${response.status}`);
      }

      const b = await response.json();
      return {
        id: b.id,
        channelId: b.channelId,
        projectId: b.projectId,
        triggerConfig: b.triggerConfig || { events: [] },
        responseConfig: b.responseConfig,
        enabled: b.enabled,
        priority: b.priority || 0,
        createdAt: b.createdAt ? new Date(b.createdAt).getTime() : Date.now(),
        updatedAt: b.updatedAt ? new Date(b.updatedAt).getTime() : Date.now(),
      };
    },
  };
}
