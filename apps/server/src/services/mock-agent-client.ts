import { randomUUID } from 'crypto';
import type { IAgentClient, ToolInfo, SearchSessionsParams, SearchMessagesParams, SearchResult } from './openmgr-agent-manager.js';

interface MockSession {
  id: string;
  title?: string;
  workingDirectory?: string;
  parentId?: string;
  createdAt: string;
  messages: Array<{ role: string; content: string; timestamp: string; toolCalls?: MockToolCall[] }>;
  isActive: boolean;
}

/**
 * A configurable mock response for testing.
 */
export interface MockResponse {
  /** Text content of the assistant response */
  content: string;
  /** Optional tool calls the assistant makes */
  toolCalls?: MockToolCall[];
  /** Optional tool results (paired with toolCalls) */
  toolResults?: Array<{ name: string; content: string }>;
  /** Optional delay in ms before responding (simulates LLM latency) */
  delay?: number;
  /** Optional error to simulate (returns error instead of response) */
  error?: string;
}

export interface MockToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Mock agent client for testing purposes.
 *
 * Stores sessions in memory and returns configurable mock responses.
 * Supports:
 * - Configurable response queue (FIFO, with fallback to default response)
 * - SSE streaming simulation via getPromptStreamUrl()
 * - Tool call simulation in responses
 * - Configurable response delays
 * - Error simulation
 *
 * Configure responses via:
 * - Constructor: `new MockAgentClient(responses)`
 * - Method: `client.setMockResponses(responses)`
 * - Environment: `OPENMGR_MOCK_RESPONSES` JSON env var
 */
export class MockAgentClient implements IAgentClient {
  private sessions: Map<string, MockSession> = new Map();
  private responseQueue: MockResponse[] = [];
  private responseIndex = 0;

  /** Port for the mock SSE streaming server (0 = no streaming) */
  private mockStreamPort = 0;

  constructor(responses?: MockResponse[]) {
    if (responses && responses.length > 0) {
      this.responseQueue = [...responses];
    } else {
      // Try loading from environment
      const envResponses = process.env.OPENMGR_MOCK_RESPONSES;
      if (envResponses) {
        try {
          this.responseQueue = JSON.parse(envResponses);
        } catch {
          // Invalid JSON, ignore
        }
      }
    }
  }

  /**
   * Set or replace the mock response queue.
   */
  setMockResponses(responses: MockResponse[]): void {
    this.responseQueue = [...responses];
    this.responseIndex = 0;
  }

  /**
   * Set the port for the mock SSE streaming server.
   * When set, getPromptStreamUrl() returns a URL pointing to this port.
   */
  setStreamPort(port: number): void {
    this.mockStreamPort = port;
  }

  /**
   * Get the next mock response from the queue.
   * Cycles through responses if the queue is exhausted.
   * Falls back to the default "Mock response to: {prompt}" if no queue.
   */
  private getNextResponse(prompt: string): MockResponse {
    if (this.responseQueue.length === 0) {
      return { content: `Mock response to: ${prompt}` };
    }
    const response = this.responseQueue[this.responseIndex % this.responseQueue.length];
    this.responseIndex++;
    return response;
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }

  async listSessions(limit = 50): Promise<unknown[]> {
    const sessions = Array.from(this.sessions.values())
      .filter(s => !s.parentId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit)
      .map(s => ({
        id: s.id,
        title: s.title,
        workingDirectory: s.workingDirectory,
        parentId: s.parentId,
        createdAt: s.createdAt,
      }));
    return sessions;
  }

  async createSession(options: { id?: string; workingDirectory?: string; title?: string; parentId?: string; mode?: string; userId?: string } = {}): Promise<unknown> {
    const id = options.id || randomUUID();
    const session: MockSession = {
      id,
      title: options.title,
      workingDirectory: options.workingDirectory,
      parentId: options.parentId,
      createdAt: new Date().toISOString(),
      messages: [],
      isActive: false,
    };
    this.sessions.set(id, session);
    return {
      id,
      title: session.title,
      workingDirectory: session.workingDirectory,
      parentId: session.parentId,
      createdAt: session.createdAt,
    };
  }

  async getSession(sessionId: string): Promise<unknown> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`404 {"error":"Session not found"}`);
    }
    return {
      id: session.id,
      title: session.title,
      workingDirectory: session.workingDirectory,
      parentId: session.parentId,
      createdAt: session.createdAt,
    };
  }

  async sendPromptAsync(sessionId: string, prompt: string): Promise<unknown> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`404 {"error":"Session not found"}`);
    }

    const mockResponse = this.getNextResponse(prompt);

    // Simulate error responses
    if (mockResponse.error) {
      return {
        status: 'error',
        success: false,
        error: mockResponse.error,
      };
    }

    // Simulate delay
    if (mockResponse.delay && mockResponse.delay > 0) {
      await new Promise(r => setTimeout(r, mockResponse.delay));
    }

    // Mark session as active during prompt processing
    session.isActive = true;

    // Add user message
    session.messages.push({
      role: 'user',
      content: prompt,
      timestamp: new Date().toISOString(),
    });

    // Add tool call messages if present
    if (mockResponse.toolCalls && mockResponse.toolCalls.length > 0) {
      session.messages.push({
        role: 'assistant',
        content: mockResponse.content,
        timestamp: new Date().toISOString(),
        toolCalls: mockResponse.toolCalls,
      });

      // Add tool results
      if (mockResponse.toolResults) {
        for (const result of mockResponse.toolResults) {
          session.messages.push({
            role: 'tool',
            content: result.content,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    // Add final assistant response
    session.messages.push({
      role: 'assistant',
      content: mockResponse.content,
      timestamp: new Date().toISOString(),
    });

    // Mark session as completed
    session.isActive = false;

    return {
      status: 'completed',
      success: true,
      message: mockResponse.content,
    };
  }

  /**
   * Returns a streaming URL for SSE-based prompt responses.
   * Only available when a mock stream port is configured.
   */
  getPromptStreamUrl(sessionId: string): string | undefined {
    if (this.mockStreamPort > 0) {
      return `http://127.0.0.1:${this.mockStreamPort}/session/${sessionId}/prompt/stream`;
    }
    return undefined;
  }

  async getMessages(sessionId: string): Promise<unknown> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`404 {"error":"Session not found"}`);
    }
    return {
      messages: session.messages,
    };
  }

  async getMessagesPaginated(sessionId: string, limit: number, beforeSequence?: number): Promise<{ messages: unknown[]; hasMore: boolean }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`404 {"error":"Session not found"}`);
    }
    let msgs = session.messages;
    if (beforeSequence !== undefined) {
      msgs = msgs.slice(0, beforeSequence);
    }
    const hasMore = msgs.length > limit;
    const page = hasMore ? msgs.slice(msgs.length - limit) : msgs;
    return { messages: page, hasMore };
  }

  async getProviders(): Promise<unknown> {
    return {
      providers: [
        { id: 'mock', name: 'Mock Provider', models: ['mock-model'] },
      ],
    };
  }

  async abortSession(sessionId: string): Promise<unknown> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`404 {"error":"Session not found"}`);
    }
    session.isActive = false;
    return { success: true };
  }

  async deleteSession(sessionId: string): Promise<unknown> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`404 {"error":"Session not found"}`);
    }
    this.sessions.delete(sessionId);
    return { success: true };
  }

  async deleteAllSessions(): Promise<{ deletedCount: number }> {
    const count = this.sessions.size;
    this.sessions.clear();
    return { deletedCount: count };
  }

  async searchSessions(_params: SearchSessionsParams): Promise<SearchResult<unknown>> {
    return { results: [], pagination: { limit: 50, offset: 0, count: 0 } };
  }

  async searchMessages(_params: SearchMessagesParams): Promise<SearchResult<unknown>> {
    return { results: [], pagination: { limit: 100, offset: 0, count: 0 } };
  }

  async getTools(): Promise<ToolInfo[]> {
    return [
      { name: 'mock_read_file', description: 'Mock file read tool', available: true },
      { name: 'mock_write_file', description: 'Mock file write tool', available: true },
      { name: 'mock_bash', description: 'Mock bash execution tool', available: true },
    ];
  }

  async getBranches(_sessionId: string): Promise<unknown> {
    return [];
  }

  async createBranch(_sessionId: string, name: string, _messageId?: string): Promise<unknown> {
    return { id: `mock-branch-${Date.now()}`, name, created: true };
  }

  async switchBranch(_sessionId: string, branchId: string): Promise<unknown> {
    return { success: true, activeBranch: branchId };
  }

  async deleteBranch(_sessionId: string, _branchId: string): Promise<unknown> {
    return { success: true };
  }

  async rollback(_sessionId: string, _count: number): Promise<unknown> {
    return { success: true };
  }

  async respondToPermission(_sessionId: string, _toolCallId: string, _response: string): Promise<unknown> {
    return { success: true };
  }

  async respondToQuestion(_sessionId: string, _questionId: string, _response: { selected?: string[]; freeformText?: string }): Promise<unknown> {
    return { success: true };
  }

  // Plugin management (mock)
  async getPlugins(): Promise<{ installed: unknown[]; registered: string[] }> {
    return { installed: [], registered: [] };
  }

  async installPlugin(_packageSpec: string): Promise<unknown> {
    return { success: true, packageName: 'mock', version: '0.0.0', plugins: [], registered: [] };
  }

  async uninstallPlugin(_packageName: string): Promise<unknown> {
    return { success: true, packageName: 'mock', plugins: [], unregistered: [] };
  }

  // Agent mode (mock)
  async getSessionMode(_sessionId: string): Promise<{ mode: string }> {
    return { mode: 'build' };
  }

  async setSessionMode(_sessionId: string, mode: string): Promise<{ mode: string }> {
    return { mode };
  }

  // Agent types (mock)
  async getAgentTypes(): Promise<{ agentTypes: unknown[] }> {
    return { agentTypes: [] };
  }

  async getAgentTypeConflicts(): Promise<{ conflicts: unknown[] }> {
    return { conflicts: [] };
  }

  async setAgentTypeEnabled(_name: string, enabled: boolean): Promise<unknown> {
    return { enabled };
  }

  // Permission config (mock)
  async getPermissionConfig(): Promise<{ defaultMode?: string; alwaysAllow?: string[]; alwaysDeny?: string[]; allowAll?: boolean }> {
    return { defaultMode: 'ask', alwaysAllow: [], alwaysDeny: [], allowAll: false };
  }

  async updatePermissionConfig(config: { defaultMode?: string; alwaysAllow?: string[]; alwaysDeny?: string[]; allowAll?: boolean }): Promise<unknown> {
    return config;
  }

  // Disabled tools (mock)
  private disabledTools: string[] = [];

  async getDisabledTools(): Promise<{ disabledTools: string[] }> {
    return { disabledTools: [...this.disabledTools] };
  }

  async setDisabledTools(tools: string[]): Promise<{ disabledTools: string[] }> {
    this.disabledTools = [...tools];
    return { disabledTools: this.disabledTools };
  }

  async disableTool(name: string): Promise<unknown> {
    if (!this.disabledTools.includes(name)) {
      this.disabledTools.push(name);
    }
    return { success: true };
  }

  async enableTool(name: string): Promise<unknown> {
    this.disabledTools = this.disabledTools.filter(t => t !== name);
    return { success: true };
  }

  // Token usage (mock)
  async getUsage(): Promise<unknown> {
    return { totalTokens: 0, inputTokens: 0, outputTokens: 0, sessions: [] };
  }

  // MCP management (mock)
  async getMcpServers(): Promise<{ servers: unknown[] }> {
    return { servers: [] };
  }

  async addMcpServer(_name: string, _config: Record<string, unknown>): Promise<unknown> {
    return { success: true };
  }

  async removeMcpServer(_name: string): Promise<unknown> {
    return { success: true };
  }

  async getMcpTools(): Promise<{ tools: unknown[] }> {
    return { tools: [] };
  }

  // File watching (mock)
  async watchFile(_path: string): Promise<unknown> {
    return { success: true };
  }

  async unwatchFile(_path: string): Promise<unknown> {
    return { success: true };
  }
}
