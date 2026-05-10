/**
 * ServerClient — Encapsulates all HTTP communication with an OpenMgr server.
 *
 * This class can be used by:
 * - BridgeCore (for remote project operations in desktop/mobile)
 * - Web app bridge (as the sole transport, since all projects are remote)
 *
 * It handles auth header resolution and provides typed methods for every
 * server API endpoint that the bridge needs.
 */

import { createLogger } from '../utils/logger';

const log = createLogger('ServerClient');

/** Auth configuration for a server connection */
export interface ServerAuthConfig {
  /** Bearer token for simple auth */
  token?: string;
  /** Auth type identifier — 'bearer' (default) or a plugin-contributed type */
  authType?: string;
  /** Auth-type-specific configuration (e.g., clientId/clientSecret for CF Access) */
  authConfig?: Record<string, unknown>;
  /** Optional callback to get plugin auth headers for custom auth types */
  getPluginAuthHeaders?: (authType: string, authConfig: Record<string, unknown>) => Record<string, string> | null;
  /** Use cookie-based auth (for same-origin web app) — skips Authorization header */
  useCookieAuth?: boolean;
}

/** The versioned API path prefix. All API calls go through this. */
export const API_PREFIX = '/api/beta';

/** Options for creating a ServerClient */
export interface ServerClientOptions {
  /** Base URL of the server (e.g., "https://my-server.example.com") */
  baseUrl: string;
  /** Auth configuration */
  auth: ServerAuthConfig;
  /** Optional callback when a successful request is made (for "last seen" tracking) */
  onSuccess?: () => void;
}

export class ServerClient {
  private baseUrl: string;
  private auth: ServerAuthConfig;
  private onSuccess?: () => void;

  constructor(options: ServerClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, ''); // strip trailing slash
    this.auth = options.auth;
    this.onSuccess = options.onSuccess;
  }

  /** Update the auth config (e.g., after token refresh) */
  updateAuth(auth: Partial<ServerAuthConfig>) {
    this.auth = { ...this.auth, ...auth };
  }

  // ============ Core Fetch ============

  /**
   * Authenticated fetch against the server.
   * All typed methods below delegate to this.
   */
  async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    if (this.auth.useCookieAuth) {
      // Cookie auth: don't set Authorization header, rely on credentials: 'include'
      // (caller must set credentials on the fetch options if needed)
    } else if (
      this.auth.authType &&
      this.auth.authType !== 'bearer' &&
      this.auth.authConfig &&
      this.auth.getPluginAuthHeaders
    ) {
      const pluginHeaders = this.auth.getPluginAuthHeaders(this.auth.authType, this.auth.authConfig);
      if (pluginHeaders) {
        Object.assign(headers, pluginHeaders);
      }
    } else if (this.auth.token) {
      headers['Authorization'] = `Bearer ${this.auth.token}`;
    }

    const fetchOptions: RequestInit = {
      ...options,
      headers,
    };

    if (this.auth.useCookieAuth) {
      fetchOptions.credentials = 'include';
    }

    const response = await globalThis.fetch(`${this.baseUrl}${API_PREFIX}${path}`, fetchOptions);

    if (response.status < 500) {
      this.onSuccess?.();
    }

    return response;
  }

  /**
   * Convenience: fetch + parse JSON response. Throws on non-ok status.
   */
  private async fetchJson<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await this.fetch(path, options);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`${response.status} ${text}`);
    }
    return response.json() as Promise<T>;
  }

  /**
   * Convenience: fetch, return ok status. Does not throw on non-ok.
   */
  private async fetchOk(path: string, options: RequestInit = {}): Promise<boolean> {
    const response = await this.fetch(path, options);
    return response.ok;
  }

  // ============ Health ============

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.fetch('/health/auth');
      if (response.ok) {
        return { success: true };
      }
      return { success: false, error: `Server returned ${response.status}` };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ============ Projects ============

  async listProjects(): Promise<unknown[]> {
    const data = await this.fetchJson<{ projects?: unknown[] } | unknown[]>('/projects');
    return Array.isArray(data) ? data : (data as { projects?: unknown[] }).projects || [];
  }

  async createProject(options: { name: string; workingDirectory?: string }): Promise<unknown> {
    return this.fetchJson('/projects', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async getProject(projectId: string): Promise<unknown> {
    return this.fetchJson(`/projects/${projectId}`);
  }

  async updateProject(projectId: string, updates: Record<string, unknown>): Promise<boolean> {
    return this.fetchOk(`/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async deleteProject(projectId: string): Promise<boolean> {
    return this.fetchOk(`/projects/${projectId}`, { method: 'DELETE' });
  }

  async getProjectConfig(projectId: string): Promise<{ config: Record<string, unknown> }> {
    return this.fetchJson(`/projects/${projectId}/config`);
  }

  async updateProjectConfig(projectId: string, config: Record<string, unknown>): Promise<boolean> {
    return this.fetchOk(`/projects/${projectId}/config`, {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }

  // ============ Sessions ============

  async listSessions(projectId: string): Promise<unknown[]> {
    const data = await this.fetchJson<unknown[] | { sessions: unknown[] }>(`/projects/${projectId}/sessions`);
    return Array.isArray(data) ? data : (data as { sessions: unknown[] }).sessions || [];
  }

  async createSession(projectId: string, options: {
    title?: string;
    provider?: string;
    model?: string;
    useWorktree?: boolean;
    worktreeBranch?: string;
  } = {}): Promise<unknown> {
    return this.fetchJson(`/projects/${projectId}/sessions`, {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async deleteSession(projectId: string, sessionId: string): Promise<boolean> {
    return this.fetchOk(`/projects/${projectId}/sessions/${sessionId}`, { method: 'DELETE' });
  }

  async deleteAllSessions(projectId: string): Promise<{ deletedCount: number }> {
    return this.fetchJson(`/projects/${projectId}/sessions`, { method: 'DELETE' });
  }

  async getSessionMode(projectId: string, sessionId: string): Promise<string> {
    const data = await this.fetchJson<{ mode: string }>(`/projects/${projectId}/sessions/${sessionId}/mode`);
    return data.mode || 'build';
  }

  async setSessionMode(projectId: string, sessionId: string, mode: string): Promise<void> {
    await this.fetch(`/projects/${projectId}/sessions/${sessionId}/mode`, {
      method: 'PUT',
      body: JSON.stringify({ mode }),
    });
  }

  // ============ Messages ============

  async getMessages(projectId: string, sessionId: string): Promise<unknown[]> {
    const data = await this.fetchJson<unknown[] | { messages: unknown[] }>(
      `/projects/${projectId}/sessions/${sessionId}/messages`
    );
    return Array.isArray(data) ? data : (data as { messages: unknown[] }).messages || [];
  }

  async getMessagesPaginated(
    projectId: string,
    sessionId: string,
    limit: number,
    beforeSequence?: number,
  ): Promise<{ messages: unknown[]; hasMore: boolean }> {
    let url = `/projects/${projectId}/sessions/${sessionId}/messages?limit=${limit}`;
    if (beforeSequence !== undefined) {
      url += `&beforeSequence=${beforeSequence}`;
    }
    return this.fetchJson(url);
  }

  async abortSession(projectId: string, sessionId: string): Promise<void> {
    await this.fetch(`/projects/${projectId}/sessions/${sessionId}/abort`, {
      method: 'POST',
    });
  }

  async getSessionStatus(projectId: string, sessionId: string): Promise<unknown | null> {
    try {
      const response = await this.fetch(`/projects/${projectId}/sessions/${sessionId}/status`);
      if (response.ok) {
        return response.json();
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Send a prompt and get the raw SSE response for streaming.
   * The caller is responsible for processing the ReadableStream.
   */
  async sendPromptStream(
    projectId: string,
    sessionId: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    return this.fetch(`/projects/${projectId}/sessions/${sessionId}/prompt/stream`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Subscribe to session events (SSE). Returns raw response for stream processing.
   */
  async subscribeToSessionEvents(
    projectId: string,
    sessionId: string,
    lastEventIndex?: number,
  ): Promise<Response> {
    let url = `/projects/${projectId}/sessions/${sessionId}/events`;
    if (lastEventIndex !== undefined) {
      url += `?lastEventIndex=${lastEventIndex}`;
    }
    return this.fetch(url);
  }

  // ============ Permissions ============

  async respondToPermission(
    projectId: string,
    sessionId: string,
    toolCallId: string,
    response: string,
  ): Promise<void> {
    await this.fetch(
      `/projects/${projectId}/sessions/${sessionId}/permission/${encodeURIComponent(toolCallId)}/respond`,
      { method: 'POST', body: JSON.stringify({ response }) },
    );
  }

  async respondToQuestion(
    projectId: string,
    sessionId: string,
    questionId: string,
    response: { selected?: string[]; freeformText?: string },
  ): Promise<void> {
    await this.fetch(
      `/projects/${projectId}/sessions/${sessionId}/question/${encodeURIComponent(questionId)}/respond`,
      { method: 'POST', body: JSON.stringify(response) },
    );
  }

  async getPermissionConfig(projectId: string): Promise<{
    defaultMode?: string;
    alwaysAllow?: string[];
    alwaysDeny?: string[];
    allowAll?: boolean;
  }> {
    return this.fetchJson(`/projects/${projectId}/permissions/config`);
  }

  async updatePermissionConfig(
    projectId: string,
    config: { defaultMode?: string; alwaysAllow?: string[]; alwaysDeny?: string[]; allowAll?: boolean },
  ): Promise<unknown> {
    return this.fetchJson(`/projects/${projectId}/permissions/config`, {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }

  // ============ Models ============

  async getModels(projectId: string): Promise<unknown[]> {
    const data = await this.fetchJson<{ models?: unknown[] } | unknown[]>(`/projects/${projectId}/models`);
    return Array.isArray(data) ? data : (data as { models?: unknown[] }).models || [];
  }

  async getCurrentModel(projectId: string): Promise<{ provider?: string; model?: string }> {
    const data = await this.fetchJson<{ config?: { provider?: string; model?: string } }>(
      `/projects/${projectId}/config`
    );
    return data.config || {};
  }

  async setModel(projectId: string, provider: string, model: string): Promise<boolean> {
    return this.fetchOk(`/projects/${projectId}/config`, {
      method: 'PUT',
      body: JSON.stringify({ provider, model }),
    });
  }

  // ============ Tools ============

  async getTools(projectId: string): Promise<unknown[]> {
    const data = await this.fetchJson<{ tools?: unknown[] }>(`/projects/${projectId}/tools`);
    return data.tools || [];
  }

  async getDisabledTools(projectId: string): Promise<{ disabledTools: string[] }> {
    return this.fetchJson(`/projects/${projectId}/tools/disabled`);
  }

  async setDisabledTools(projectId: string, tools: string[]): Promise<{ disabledTools: string[] }> {
    return this.fetchJson(`/projects/${projectId}/tools/disabled`, {
      method: 'PUT',
      body: JSON.stringify({ tools }),
    });
  }

  async disableTool(projectId: string, name: string): Promise<unknown> {
    return this.fetchJson(`/projects/${projectId}/tools/${encodeURIComponent(name)}/disable`, {
      method: 'POST',
    });
  }

  async enableTool(projectId: string, name: string): Promise<unknown> {
    return this.fetchJson(`/projects/${projectId}/tools/${encodeURIComponent(name)}/enable`, {
      method: 'POST',
    });
  }

  // ============ Plugins ============

  async getPlugins(projectId: string): Promise<{ installed: unknown[]; registered: string[] }> {
    return this.fetchJson(`/projects/${projectId}/plugins`);
  }

  async installPlugin(projectId: string, packageSpec: string): Promise<unknown> {
    return this.fetchJson(`/projects/${projectId}/plugins/install`, {
      method: 'POST',
      body: JSON.stringify({ packageSpec }),
    });
  }

  async uninstallPlugin(projectId: string, packageName: string): Promise<unknown> {
    return this.fetchJson(`/projects/${projectId}/plugins/uninstall`, {
      method: 'POST',
      body: JSON.stringify({ packageName }),
    });
  }

  // ============ Agent Types ============

  async getAgentTypes(projectId: string): Promise<{ agentTypes: unknown[] }> {
    return this.fetchJson(`/projects/${projectId}/agent-types`);
  }

  async getAgentTypeConflicts(projectId: string): Promise<{ conflicts: unknown[] }> {
    return this.fetchJson(`/projects/${projectId}/agent-types/conflicts`);
  }

  async setAgentTypeEnabled(projectId: string, name: string, enabled: boolean): Promise<boolean> {
    return this.fetchOk(`/projects/${projectId}/agent-types/${encodeURIComponent(name)}/enabled`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
  }

  // ============ Files ============

  async readDirectory(projectId: string, path: string): Promise<{ files: unknown[] }> {
    return this.fetchJson(`/projects/${projectId}/files?path=${encodeURIComponent(path)}`);
  }

  async readFile(projectId: string, path: string): Promise<string> {
    const data = await this.fetchJson<{ content: string }>(
      `/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`
    );
    return data.content || '';
  }

  async writeFile(projectId: string, path: string, content: string): Promise<boolean> {
    return this.fetchOk(`/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
  }

  // ============ Filesystem (server-level, not project-scoped) ============

  async getFilesystemHome(): Promise<unknown> {
    return this.fetchJson('/filesystem/home');
  }

  async listFilesystem(path: string, showHidden = false): Promise<unknown> {
    return this.fetchJson(`/filesystem/list?path=${encodeURIComponent(path)}&showHidden=${showHidden}`);
  }

  async createDirectory(parentPath: string, name: string): Promise<string> {
    const data = await this.fetchJson<{ path: string }>('/filesystem/mkdir', {
      method: 'POST',
      body: JSON.stringify({ parentPath, name }),
    });
    return data.path;
  }

  // ============ Terminals ============

  async listTerminals(projectId: string): Promise<unknown[]> {
    const data = await this.fetchJson<{ sessions?: unknown[] }>(`/projects/${projectId}/terminals`);
    return (data as { sessions?: unknown[] }).sessions || [];
  }

  async createTerminal(projectId: string, options?: Record<string, unknown>): Promise<unknown> {
    return this.fetchJson(`/projects/${projectId}/terminals`, {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  }

  async getTerminal(projectId: string, sessionId: string): Promise<unknown | null> {
    try {
      const response = await this.fetch(`/projects/${projectId}/terminals/${sessionId}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`${response.status}`);
      return response.json();
    } catch {
      return null;
    }
  }

  async deleteTerminal(projectId: string, sessionId: string): Promise<boolean> {
    return this.fetchOk(`/projects/${projectId}/terminals/${sessionId}`, { method: 'DELETE' });
  }

  async resizeTerminal(projectId: string, sessionId: string, cols: number, rows: number): Promise<boolean> {
    return this.fetchOk(`/projects/${projectId}/terminals/${sessionId}/resize`, {
      method: 'POST',
      body: JSON.stringify({ cols, rows }),
    });
  }

  getTerminalWebSocketUrl(projectId: string, sessionId: string): string {
    const wsUrl = this.baseUrl.replace(/^http/, 'ws');
    const token = this.auth.token ? `?token=${encodeURIComponent(this.auth.token)}` : '';
    return `${wsUrl}${API_PREFIX}/projects/${projectId}/terminals/${sessionId}/ws${token}`;
  }

  // ============ Search ============

  async searchSessions(options: {
    query: string;
    includeMessages?: boolean;
    limit?: number;
  }): Promise<{ results: unknown[]; pagination: { limit: number; offset: number; count: number } }> {
    const params = new URLSearchParams();
    params.set('q', options.query);
    if (options.includeMessages !== undefined) {
      params.set('includeMessages', String(options.includeMessages));
    }
    if (options.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    return this.fetchJson(`/search/sessions?${params.toString()}`);
  }

  // ============ Token Usage ============

  async getUsage(projectId: string): Promise<unknown> {
    return this.fetchJson(`/projects/${projectId}/usage`);
  }

  // ============ MCP Management ============

  async getMcpServers(projectId: string): Promise<{ servers: unknown[] }> {
    return this.fetchJson(`/projects/${projectId}/mcp/servers`);
  }

  async addMcpServer(projectId: string, name: string, config: Record<string, unknown>): Promise<unknown> {
    return this.fetchJson(`/projects/${projectId}/mcp/servers`, {
      method: 'POST',
      body: JSON.stringify({ name, config }),
    });
  }

  async removeMcpServer(projectId: string, name: string): Promise<unknown> {
    return this.fetchJson(`/projects/${projectId}/mcp/servers/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  }

  async getMcpTools(projectId: string): Promise<{ tools: unknown[] }> {
    return this.fetchJson(`/projects/${projectId}/mcp/tools`);
  }

  // ============ File Watching ============

  async watchFile(projectId: string, path: string): Promise<unknown> {
    return this.fetchJson(`/projects/${projectId}/files/watch`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
  }

  async unwatchFile(projectId: string, path: string): Promise<unknown> {
    return this.fetchJson(`/projects/${projectId}/files/watch`, {
      method: 'DELETE',
      body: JSON.stringify({ path }),
    });
  }

  // ============ Channels ============

  async listChannels(): Promise<unknown[]> {
    const data = await this.fetchJson<{ channels?: unknown[] }>('/channels');
    return (data as { channels?: unknown[] }).channels || [];
  }

  async getChannel(channelId: string): Promise<unknown> {
    return this.fetchJson(`/channels/${channelId}`);
  }

  async updateChannel(channelId: string, updates: Record<string, unknown>): Promise<unknown> {
    return this.fetchJson(`/channels/${channelId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async listChannelBindings(channelId: string): Promise<unknown[]> {
    const data = await this.fetchJson<{ bindings?: unknown[] }>(`/channels/${channelId}/bindings`);
    return (data as { bindings?: unknown[] }).bindings || [];
  }

  async updateChannelBinding(
    channelId: string,
    bindingId: string,
    updates: Record<string, unknown>,
  ): Promise<unknown> {
    return this.fetchJson(`/channels/${channelId}/bindings/${bindingId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  // ============ Branches ============

  async getBranches(projectId: string, sessionId: string): Promise<unknown[]> {
    const data = await this.fetchJson<unknown[] | { branches: unknown[] }>(
      `/projects/${projectId}/sessions/${sessionId}/branches`
    );
    return Array.isArray(data) ? data : (data as { branches: unknown[] }).branches || [];
  }

  async createBranch(projectId: string, sessionId: string, name: string, messageId?: string): Promise<unknown> {
    return this.fetchJson(`/projects/${projectId}/sessions/${sessionId}/branches`, {
      method: 'POST',
      body: JSON.stringify({ name, messageId }),
    });
  }

  async switchBranch(projectId: string, sessionId: string, branchId: string): Promise<unknown> {
    return this.fetchJson(`/projects/${projectId}/sessions/${sessionId}/branches/${branchId}/switch`, {
      method: 'POST',
    });
  }

  async deleteBranch(projectId: string, sessionId: string, branchId: string): Promise<boolean> {
    return this.fetchOk(`/projects/${projectId}/sessions/${sessionId}/branches/${branchId}`, {
      method: 'DELETE',
    });
  }

  async rollback(projectId: string, sessionId: string, count: number): Promise<unknown> {
    return this.fetchJson(`/projects/${projectId}/sessions/${sessionId}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ count }),
    });
  }

  // ============ Providers ============

  async getProviders(projectId: string): Promise<unknown> {
    return this.fetchJson(`/projects/${projectId}/providers`);
  }

  // ============ Generic Proxy ============

  /**
   * Generic fetch for arbitrary paths — used by `remoteServerFetch` in the bridge.
   * Returns a simplified response object.
   */
  async proxyFetch(path: string, options?: RequestInit): Promise<{
    status: number;
    ok: boolean;
    body: string;
  }> {
    const response = await this.fetch(path, options);
    const body = await response.text();
    return { status: response.status, ok: response.ok, body };
  }

  // ============ Auth ============

  async getAuthStatus(): Promise<unknown> {
    return this.fetchJson('/auth/status');
  }

  async login(password: string): Promise<unknown> {
    return this.fetchJson('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  }

  async logout(): Promise<void> {
    await this.fetch('/auth/logout', { method: 'POST' });
  }
}
