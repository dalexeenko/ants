import type { IAgentClient, ToolInfo, SearchSessionsParams, SearchMessagesParams, SearchResult } from './ants-agent-manager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('AgentClient');

/**
 * HTTP client for communicating with a real Ants Agent server.
 */
export class AntsAgentClient implements IAgentClient {
  private baseUrl: string;
  private jsonHeaders = { 'Accept': 'application/json', 'Content-Type': 'application/json' };

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Make an HTTP request to the agent server with standard error handling.
   */
  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.jsonHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      log.error(`Ants Agent ${method} ${path} failed: ${response.status}`, text);
      throw new Error(`Failed ${method} ${path}: ${response.status} - ${text}`);
    }

    return response.json() as T;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: this.jsonHeaders,
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listSessions(limit = 50): Promise<unknown[]> {
    const data = await this.request<{ data?: unknown[]; count?: number }>('GET', '/beta/conversations');
    const sessions = data.data || [];
    // The agent-server endpoint has a hardcoded limit of 50; apply client-side limit if smaller
    return sessions.slice(0, limit);
  }

  async createSession(options: { id?: string; workingDirectory?: string; title?: string; parentId?: string; mode?: string; userId?: string } = {}): Promise<unknown> {
    return this.request('POST', '/session', options);
  }

  async getSession(sessionId: string): Promise<unknown> {
    return this.request('GET', `/session/${sessionId}`);
  }

  async sendPromptAsync(sessionId: string, prompt: string): Promise<unknown> {
    return this.request('POST', `/session/${sessionId}/prompt_async`, { prompt });
  }

  /**
   * Get the URL for SSE prompt streaming.
   */
  getPromptStreamUrl(sessionId: string): string {
    return `${this.baseUrl}/session/${sessionId}/prompt_stream`;
  }

  async getMessages(sessionId: string): Promise<unknown> {
    return this.request('GET', `/session/${sessionId}/message`);
  }

  async getMessagesPaginated(sessionId: string, limit: number, beforeSequence?: number): Promise<{ messages: unknown[]; hasMore: boolean }> {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (beforeSequence !== undefined) {
      qs.set('beforeSequence', String(beforeSequence));
    }
    return this.request('GET', `/session/${sessionId}/message?${qs.toString()}`);
  }

  async getProviders(): Promise<unknown> {
    return this.request('GET', '/provider');
  }

  async abortSession(sessionId: string): Promise<unknown> {
    return this.request('POST', `/session/${sessionId}/abort`);
  }

  async deleteSession(sessionId: string): Promise<unknown> {
    return this.request('DELETE', `/session/${sessionId}`);
  }

  async deleteAllSessions(): Promise<{ deletedCount: number }> {
    return this.request('DELETE', '/session');
  }

  async searchSessions(params: SearchSessionsParams): Promise<SearchResult<unknown>> {
    const qs = new URLSearchParams();
    if (params.query) qs.set('q', params.query);
    if (params.provider) qs.set('provider', params.provider);
    if (params.model) qs.set('model', params.model);
    if (params.workingDirectory) qs.set('workingDirectory', params.workingDirectory);
    if (params.includeMessages) qs.set('includeMessages', 'true');
    if (params.rootOnly) qs.set('rootOnly', 'true');
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.offset !== undefined) qs.set('offset', String(params.offset));
    if (params.orderBy) qs.set('orderBy', params.orderBy);
    if (params.orderDirection) qs.set('orderDirection', params.orderDirection);
    return this.request('GET', `/search/sessions?${qs.toString()}`);
  }

  async searchMessages(params: SearchMessagesParams): Promise<SearchResult<unknown>> {
    const qs = new URLSearchParams();
    qs.set('q', params.query);
    if (params.sessionId) qs.set('sessionId', params.sessionId);
    if (params.role) qs.set('role', params.role);
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.offset !== undefined) qs.set('offset', String(params.offset));
    return this.request('GET', `/search/messages?${qs.toString()}`);
  }

  async getTools(): Promise<ToolInfo[]> {
    const data = await this.request<{ tools?: ToolInfo[] }>('GET', '/tools');
    return data.tools || [];
  }

  async getBranches(sessionId: string): Promise<unknown> {
    const data = await this.request<{ branches: unknown[] }>('GET', `/session/${sessionId}/branches`);
    return data.branches;
  }

  async createBranch(sessionId: string, name: string, messageId?: string): Promise<unknown> {
    return this.request('POST', `/session/${sessionId}/branches`, { name, messageId });
  }

  async switchBranch(sessionId: string, branchId: string): Promise<unknown> {
    return this.request('POST', `/session/${sessionId}/branches/${encodeURIComponent(branchId)}/switch`);
  }

  async deleteBranch(sessionId: string, branchId: string): Promise<unknown> {
    return this.request('DELETE', `/session/${sessionId}/branches/${encodeURIComponent(branchId)}`);
  }

  async rollback(sessionId: string, count: number): Promise<unknown> {
    return this.request('POST', `/session/${sessionId}/rollback`, { count });
  }

  async respondToPermission(sessionId: string, toolCallId: string, response: string): Promise<unknown> {
    return this.request('POST', `/session/${sessionId}/permission/${encodeURIComponent(toolCallId)}/respond`, { response });
  }

  async respondToQuestion(sessionId: string, questionId: string, response: { selected?: string[]; freeformText?: string }): Promise<unknown> {
    return this.request('POST', `/session/${sessionId}/question/${encodeURIComponent(questionId)}/respond`, response);
  }

  // Plugin management
  async getPlugins(): Promise<{ installed: unknown[]; registered: string[] }> {
    return this.request('GET', '/plugins');
  }

  async installPlugin(packageSpec: string): Promise<unknown> {
    return this.request('POST', '/plugins/install', { packageSpec });
  }

  async uninstallPlugin(packageName: string): Promise<unknown> {
    return this.request('POST', '/plugins/uninstall', { packageName });
  }

  // Agent mode
  async getSessionMode(sessionId: string): Promise<{ mode: string }> {
    return this.request('GET', `/session/${sessionId}/mode`);
  }

  async setSessionMode(sessionId: string, mode: string): Promise<{ mode: string }> {
    return this.request('PUT', `/session/${sessionId}/mode`, { mode });
  }

  // Agent types
  async getAgentTypes(): Promise<{ agentTypes: unknown[] }> {
    return this.request('GET', '/agent-types');
  }

  async getAgentTypeConflicts(): Promise<{ conflicts: unknown[] }> {
    return this.request('GET', '/agent-types/conflicts');
  }

  async setAgentTypeEnabled(name: string, enabled: boolean): Promise<unknown> {
    return this.request('PUT', `/agent-types/${encodeURIComponent(name)}/enabled`, { enabled });
  }

  // Permission config
  async getPermissionConfig(): Promise<{ defaultMode?: string; alwaysAllow?: string[]; alwaysDeny?: string[]; allowAll?: boolean }> {
    return this.request('GET', '/permissions/config');
  }

  async updatePermissionConfig(config: { defaultMode?: string; alwaysAllow?: string[]; alwaysDeny?: string[]; allowAll?: boolean }): Promise<unknown> {
    return this.request('PUT', '/permissions/config', config);
  }

  // Disabled tools
  async getDisabledTools(): Promise<{ disabledTools: string[] }> {
    return this.request('GET', '/tools/disabled');
  }

  async setDisabledTools(tools: string[]): Promise<{ disabledTools: string[] }> {
    return this.request('PUT', '/tools/disabled', { tools });
  }

  async disableTool(name: string): Promise<unknown> {
    return this.request('POST', `/tools/${encodeURIComponent(name)}/disable`);
  }

  async enableTool(name: string): Promise<unknown> {
    return this.request('POST', `/tools/${encodeURIComponent(name)}/enable`);
  }

  // Token usage
  async getUsage(): Promise<unknown> {
    return this.request('GET', '/usage');
  }

  // MCP management
  async getMcpServers(): Promise<{ servers: unknown[] }> {
    return this.request('GET', '/mcp/servers');
  }

  async addMcpServer(name: string, config: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', '/mcp/servers', { name, config });
  }

  async removeMcpServer(name: string): Promise<unknown> {
    return this.request('DELETE', `/mcp/servers/${encodeURIComponent(name)}`);
  }

  async getMcpTools(): Promise<{ tools: unknown[] }> {
    return this.request('GET', '/mcp/tools');
  }

  // File watching
  async watchFile(path: string): Promise<unknown> {
    return this.request('POST', '/files/watch', { path });
  }

  async unwatchFile(path: string): Promise<unknown> {
    return this.request('DELETE', '/files/watch', { path });
  }
}
