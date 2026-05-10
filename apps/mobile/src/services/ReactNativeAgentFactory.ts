/**
 * React Native Agent Factory
 * 
 * Creates agents using @openmgr/agent-react-native for on-device AI processing.
 * Sessions and messages are persisted to SQLite using expo-sqlite.
 */

import type { PlatformAgentFactory, PlatformAgent, PlatformSessionManager, AgentEvent, PermissionResponse, ToolPermissionConfig, ToolInfo } from '@openmgr/ui';
import { createLogger } from '@openmgr/ui';
import {
  Agent,
  providersPlugin,
  toolsPlugin,
  fileToolsPlugin,
  createReactNativeFilesystem,
  AnthropicOAuthProvider,
  SessionManager,
  SubagentManager,
  capabilityRegistry,
  generateTitle,
  isDefaultTitle,
  type AgentEvent as CoreAgentEvent,
  type OAuthTokens,
  type GenericAgentDatabase,
  type SessionRow,
  type MessageRow,
} from '@openmgr/agent-react-native';
import { fetch as expoFetch } from 'expo/fetch';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system';
import { getDatabase } from './database';

const log = createLogger('ReactNativeAgentFactory');

// UUID generator using expo-crypto
function generateUUID(): string {
  return Crypto.randomUUID();
}

/**
 * Adapts the core Agent to the PlatformAgent interface.
 */
class AgentAdapter implements PlatformAgent {
  private eventCallbacks: Array<(event: unknown) => void> = [];
  private permissionRequestCallback: ((toolCall: { id: string; name: string; arguments: Record<string, unknown> }) => Promise<PermissionResponse>) | null = null;
  private sessionAllowedTools: Set<string> = new Set();
  private disabledTools: Set<string> = new Set();
  private currentSessionId: string = '';
  private permissionConfig: ToolPermissionConfig = {
    defaultMode: 'ask',
    alwaysAllow: [],
    alwaysDeny: [],
    allowAll: false,
  };

  constructor(
    public readonly id: string,
    private agent: Agent,
    private onEvent: (event: AgentEvent) => void,
  ) {
    // Forward agent events
    this.agent.on('event', (event: CoreAgentEvent) => {
      this.handleCoreEvent(event);
    });
  }

  private handleCoreEvent(event: CoreAgentEvent): void {
    log.debug('handleCoreEvent received event:', event.type);
    
    // Forward to registered callbacks
    for (const callback of this.eventCallbacks) {
      callback(event);
    }

    // Map core events to UI events (core uses dot notation like 'message.start')
    switch (event.type) {
      case 'message.start':
        log.debug('Emitting message.start with sessionId:', this.currentSessionId);
        this.onEvent({
          type: 'message.start',
          sessionId: this.currentSessionId,
          messageId: event.messageId,
        });
        break;
      case 'message.delta':
        log.debug('Emitting message.delta:', event.delta?.substring(0, 20));
        this.onEvent({
          type: 'message.delta',
          sessionId: this.currentSessionId,
          messageId: event.messageId,
          delta: event.delta,
        });
        break;
      case 'message.complete':
        log.debug('Emitting message.complete');
        this.onEvent({
          type: 'message.complete',
          sessionId: this.currentSessionId,
          messageId: event.messageId,
          content: event.content,
        });
        break;
      case 'tool.start':
        this.onEvent({
          type: 'tool.start',
          sessionId: this.currentSessionId,
          messageId: event.messageId,
          toolCall: {
            id: event.toolCall.id,
            name: event.toolCall.name,
            arguments: event.toolCall.arguments,
            status: 'running',
          },
        });
        break;
      case 'tool.complete':
        this.onEvent({
          type: 'tool.complete',
          sessionId: this.currentSessionId,
          messageId: event.messageId,
          toolResult: {
            id: event.toolResult.id,
            result: event.toolResult.result,
          },
        });
        break;
      case 'tool.permission.request':
        // Forward permission request event to UI for showing the modal.
        // The actual permission callback is handled by the core Agent's
        // ToolPermissionManager via the callback set in setPermissionRequestCallback().
        this.onEvent({
          type: 'tool.permission.request',
          sessionId: this.currentSessionId,
          messageId: event.messageId,
          toolCall: {
            id: event.toolCall.id,
            name: event.toolCall.name,
            arguments: event.toolCall.arguments,
            status: 'pending',
          },
        });
        break;
      case 'error':
        this.onEvent({
          type: 'error',
          error: event.error,
        });
        break;
      case 'session.title.updated':
        this.onEvent({
          type: 'session.title.updated',
          sessionId: (event as any).sessionId || this.currentSessionId,
          title: (event as any).title || '',
        } as AgentEvent);
        break;
    }
  }

  getMessages(): Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    toolResults?: Array<{ id: string; name: string; result: unknown; isError?: boolean }>;
  }> {
    return this.agent.getMessages().map(m => ({
      id: m.id ?? '',
      role: m.role as 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      toolCalls: m.toolCalls?.map((tc: { id: string; name: string; arguments?: Record<string, unknown> }) => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments || {},
      })),
      toolResults: m.toolResults?.map((tr: { id: string; name?: string; result: unknown; isError?: boolean }) => ({
        id: tr.id,
        name: tr.name ?? '',
        result: tr.result,
        isError: tr.isError,
      })),
    }));
  }

  async prompt(content: string): Promise<{ content: string; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }> {
    log.debug('Calling agent.prompt with:', content.substring(0, 50));
    log.debug('Agent instance:', this.agent.constructor.name);
    const response = await this.agent.prompt(content);
    log.debug('Got response, content length:', response.content?.length);
    return {
      content: response.content,
      toolCalls: response.toolCalls?.map((tc: { id: string; name: string; arguments?: Record<string, unknown> }) => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments || {},
      })),
    };
  }

  async *stream(content: string): AsyncIterable<{
    type: 'text' | 'tool_use' | 'tool_result';
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    toolUseId?: string;
    content?: unknown;
  }> {
    // Use the agent's streaming capability if available
    // For now, fall back to prompt
    const response = await this.prompt(content);
    yield {
      type: 'text',
      text: response.content,
    };
    if (response.toolCalls) {
      for (const tc of response.toolCalls) {
        const result: {
          type: 'text' | 'tool_use' | 'tool_result';
          id?: string;
          name?: string;
          input?: Record<string, unknown>;
        } = {
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        };
        yield result;
      }
    }
  }

  cancel(): void {
    // Core Agent exposes abort(), not cancel()
    this.agent.abort();
  }

  setSessionContext(context: { sessionId: string }): void {
    // Store session context for use in event emissions
    this.currentSessionId = context.sessionId;
    // Forward to core Agent so ctx.sessionId is set during tool execution
    // (required by the task tool to spawn subagents)
    this.agent.setSessionContext({ sessionId: context.sessionId, sessionManager: null });
    log.debug('Set sessionId to:', context.sessionId);
  }

  setMessages(messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    toolResults?: Array<{ id: string; name: string; result: unknown; isError?: boolean }>;
  }>): void {
    // Delegate to core Agent to load messages into conversation history
    this.agent.setMessages(messages as any);
  }

  on(event: 'event', callback: (event: unknown) => void): void {
    if (event === 'event') {
      this.eventCallbacks.push(callback);
    }
  }

  setPermissionRequestCallback(callback: (toolCall: { id: string; name: string; arguments: Record<string, unknown> }) => Promise<PermissionResponse>): void {
    this.permissionRequestCallback = callback;
    // Delegate to the core Agent so the ToolPermissionManager has the callback
    // and can properly await user responses during checkPermission()
    this.agent.setPermissionRequestCallback(callback as any);
  }

  allowToolForSession(toolName: string): void {
    this.sessionAllowedTools.add(toolName);
    this.agent.allowToolForSession(toolName);
  }

  clearToolPermissions(): void {
    this.sessionAllowedTools.clear();
    this.agent.clearToolPermissions();
  }

  getPermissionConfig(): ToolPermissionConfig {
    const config = this.agent.getPermissionManager().getConfig();
    return {
      defaultMode: config.defaultMode || 'ask',
      alwaysAllow: config.alwaysAllow || [],
      alwaysDeny: config.alwaysDeny || [],
      allowAll: config.allowAll || false,
    };
  }

  updatePermissionConfig(config: Partial<ToolPermissionConfig>): void {
    this.permissionConfig = { ...this.permissionConfig, ...config };
    this.agent.updatePermissionConfig(config as any);
  }

  getDisabledTools(): string[] {
    return Array.from(this.disabledTools);
  }

  setDisabledTools(tools: string[]): void {
    this.disabledTools = new Set(tools);
  }

  disableTool(toolName: string): void {
    this.disabledTools.add(toolName);
  }

  enableTool(toolName: string): void {
    this.disabledTools.delete(toolName);
  }

  getToolsInfo(): ToolInfo[] {
    // Get all registered tools from the agent's scoped tool registry
    const tools = this.agent.getToolRegistry().getAll();
    log.debug(`Found ${tools.length} tools in registry:`, tools.map(t => t.name));
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description || '',
      tags: [],
      requires: [],
      available: true,
      disabled: this.disabledTools.has(tool.name),
    }));
  }

  getModel(): { provider: string; model: string } {
    // Get current model from agent config
    const config = this.agent.getConfig();
    return {
      provider: config.provider || 'anthropic',
      model: config.model || 'claude-sonnet-4-20250514',
    };
  }

  setModel(provider: string, model: string): void {
    log.info('Setting model:', { provider, model });
    // Use the agent's setModel method
    const agentAny = this.agent as { setModel?: (provider: string, model: string) => void };
    if (agentAny.setModel) {
      agentAny.setModel(provider, model);
    } else {
      // Fallback: try to set provider and model separately
      log.warn('Agent does not have setModel method, trying setProvider');
      if (this.agent.hasProvider(provider)) {
        this.agent.setProvider(provider);
      }
    }
  }

  getAgentTypes(): Array<{
    name: string;
    version?: string;
    description: string;
    systemPrompt?: string;
    model?: string;
    provider?: string;
    allowedTools?: string[];
    deniedTools?: string[];
    maxIterations?: number;
    tokenBudget?: number;
    temperature?: number;
    tags?: string[];
    enabled: boolean;
    source: 'builtin' | 'plugin' | 'config';
    integrity?: string;
  }> {
    const registry = this.agent.getAgentTypeRegistry();
    return registry.getAllIncludingDisabled().map((def) => ({
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
      source: def.source ?? 'builtin',
      integrity: def.integrity,
    }));
  }

  getAgentTypeConflicts(): Array<{
    name: string;
    keptSource: 'builtin' | 'plugin' | 'config';
    replacedSource: 'builtin' | 'plugin' | 'config';
    keptIntegrity?: string;
    replacedIntegrity?: string;
  }> {
    const registry = this.agent.getAgentTypeRegistry();
    return registry.getConflicts().map((c) => ({
      name: c.name,
      keptSource: c.kept.source ?? 'builtin',
      replacedSource: c.replaced.source ?? 'builtin',
      keptIntegrity: c.kept.integrity,
      replacedIntegrity: c.replaced.integrity,
    }));
  }

  setAgentTypeEnabled(name: string, enabled: boolean): void {
    const registry = this.agent.getAgentTypeRegistry();
    registry.setEnabled(name, enabled);
  }

  async generateSessionTitle(messages: Array<{ role: string; content: string }>): Promise<string | null> {
    try {
      const provider = this.agent.getProvider();
      if (!provider) {
        log.warn('generateSessionTitle: No provider available');
        return null;
      }
      const config = this.agent.getConfig();
      // Use a fast model for title generation
      const titleModel = config.model || 'claude-sonnet-4-20250514';
      const title = await generateTitle(
        messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { provider, model: titleModel },
      );
      return title;
    } catch (e) {
      log.warn('generateSessionTitle: Failed:', e);
      return null;
    }
  }

  async shutdown(): Promise<void> {
    // Cleanup agent resources
    const agentAny = this.agent as { shutdown?: () => Promise<void> };
    if (agentAny.shutdown) {
      await agentAny.shutdown();
    }
  }
}

/**
 * SQLite-backed session manager implementation using SessionManager from agent-storage.
 */
class SQLiteSessionManager implements PlatformSessionManager {
  private sessionManager: SessionManager;
  private workingDirectory: string;

  constructor(workingDirectory: string) {
    const db = getDatabase();
    this.sessionManager = new SessionManager(db as unknown as GenericAgentDatabase, {
      generateId: generateUUID,
    });
    this.workingDirectory = workingDirectory;
  }

  async createSession(options: { workingDirectory: string; title?: string; provider?: string; model?: string }): Promise<{
    id: string;
    title: string | null;
    createdAt: Date;
    updatedAt: Date;
  }> {
    const session = await this.sessionManager.createSession({
      workingDirectory: options.workingDirectory || this.workingDirectory,
      title: options.title,
      provider: options.provider || 'anthropic',
      model: options.model || 'claude-sonnet-4-20250514',
    });
    
    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  async getRootSessions(limit = 50): Promise<Array<{
    id: string;
    title: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>> {
    const sessions = await this.sessionManager.getRootSessions(limit);
    return sessions.map((s: SessionRow) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }

  async getSession(sessionId: string): Promise<{
    id: string;
    title: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null> {
    const session = await this.sessionManager.getSession(sessionId);
    if (!session) return null;
    
    return {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.sessionManager.deleteSession(sessionId);
  }

  async deleteAllSessions(): Promise<number> {
    return this.sessionManager.deleteAllSessions();
  }

  async updateSessionTitle(sessionId: string, title: string): Promise<void> {
    await this.sessionManager.updateSession(sessionId, { title });
  }

  async getSessionMessages(sessionId: string): Promise<Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    toolResults?: Array<{ toolCallId: string; content: unknown; isError?: boolean }>;
    createdAt: Date;
  }>> {
    const messages = await this.sessionManager.getSessionMessages(sessionId);
    return messages.map((m: MessageRow) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      toolCalls: m.toolCalls as Array<{ id: string; name: string; arguments: Record<string, unknown> }> | undefined,
      toolResults: m.toolResults?.map((tr: { toolCallId: string; content: unknown; isError?: boolean }) => ({
        toolCallId: tr.toolCallId,
        content: tr.content,
        isError: tr.isError,
      })),
      createdAt: m.createdAt,
    }));
  }

  async getSessionMessagesPaginated(sessionId: string, limit: number, beforeSequence?: number) {
    const result = await this.sessionManager.getSessionMessagesPaginated(sessionId, limit, beforeSequence);
    return {
      messages: result.messages.map((m: MessageRow) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        toolCalls: m.toolCalls as Array<{ id: string; name: string; arguments: Record<string, unknown> }> | undefined,
        toolResults: m.toolResults?.map((tr: { toolCallId: string; content: unknown; isError?: boolean }) => ({
          toolCallId: tr.toolCallId,
          content: tr.content,
          isError: tr.isError,
        })),
        sequence: m.sequence,
        createdAt: m.createdAt,
      })),
      hasMore: result.hasMore,
    };
  }

  async addMessage(params: {
    sessionId: string;
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    sequence: number;
  }): Promise<void> {
    await this.sessionManager.addMessage({
      sessionId: params.sessionId,
      role: params.role,
      content: params.content,
      toolCalls: params.toolCalls,
      sequence: params.sequence,
    });
  }

  async getNextSequence(sessionId: string): Promise<number> {
    return this.sessionManager.getNextSequence(sessionId);
  }

  async searchSessions(options: {
    query: string;
    includeMessages?: boolean;
    limit?: number;
  }): Promise<Array<{
    session: {
      id: string;
      title: string | null;
      workingDirectory: string;
      createdAt: Date;
      updatedAt: Date;
      messageCount: number;
    };
    matchingMessages?: Array<{
      id: string;
      role: 'user' | 'assistant';
      content: string;
      createdAt: Date;
    }>;
  }>> {
    const results = await this.sessionManager.searchSessions({
      query: options.query,
      includeMessages: options.includeMessages,
      limit: options.limit,
    });
    
    return results.map(r => ({
      session: {
        id: r.session.id,
        title: r.session.title,
        workingDirectory: r.session.workingDirectory,
        createdAt: r.session.createdAt,
        updatedAt: r.session.updatedAt,
        messageCount: r.session.messageCount ?? 0,
      },
      matchingMessages: r.matchingMessages?.map((m: MessageRow) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        createdAt: m.createdAt,
      })),
    }));
  }
}

// Store agents per project
const agents = new Map<string, Agent>();

/**
 * React Native Agent Factory implementation.
 */
export class ReactNativeAgentFactory implements PlatformAgentFactory {
  async createAgent(options: {
    projectId: string;
    workingDirectory: string;
    apiKey?: string;
    oauthTokens?: OAuthTokens;
    onTokenRefresh?: (tokens: OAuthTokens) => Promise<void>;
    onEvent: (event: AgentEvent) => void;
  }): Promise<{ agent: PlatformAgent; sessionManager: PlatformSessionManager }> {
    // Get or create agent for this project
    let agent = agents.get(options.projectId);
    
    if (!agent) {
      // Create the agent with proper config
      agent = new Agent({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        auth: {
          type: options.oauthTokens ? 'oauth' : 'api-key',
          apiKey: options.apiKey || '',
        },
        workingDirectory: options.workingDirectory,
      });

      // Set up filesystem extension for file tools
      const filesystem = createReactNativeFilesystem(FileSystem as Parameters<typeof createReactNativeFilesystem>[0]);
      agent.setExtension('filesystem', filesystem);
      log.debug('Set filesystem extension for agent');

      // Register platform-agnostic tools (todo, phase, web_fetch, web_search, skill)
      await agent.use(toolsPlugin);
      log.debug('Registered tools plugin with agent');
      log.debug('Tools in registry after toolsPlugin:', agent.getToolRegistry().getAll().map(t => t.name));
      
      // Register file tools (read, write, edit, ls)
      await agent.use(fileToolsPlugin);
      log.debug('Registered file tools plugin with agent');
      log.debug('Tools in registry after fileToolsPlugin:', agent.getToolRegistry().getAll().map(t => t.name));

      // Subagent support - enables the task, task_status, and task_cancel tools
      // Custom agent factory ensures child agents get the filesystem extension
      // so file tools work in subagents
      const parentFilesystem = filesystem;
      const subagentManager = new SubagentManager(agent, {
        agentFactory: async (factoryOptions) => {
          const parentConfig = factoryOptions.parentAgent.getConfig();
          const child = new Agent({
            provider: factoryOptions.provider,
            model: factoryOptions.model,
            auth: parentConfig.auth,
            systemPrompt: factoryOptions.systemPrompt ?? parentConfig.systemPrompt,
            workingDirectory: factoryOptions.workingDirectory,
            tools: factoryOptions.tools ?? parentConfig.tools,
            maxTokens: parentConfig.maxTokens,
            temperature: factoryOptions.temperature ?? parentConfig.temperature,
          });
          // Set up filesystem extension so file tools work in subagents
          child.setExtension('filesystem', parentFilesystem);
          return child;
        },
      });
      agent.setExtension('subagentManager', subagentManager);
      capabilityRegistry.register('subagent', {
        providedBy: '@openmgr/app-mobile',
        version: '0.1.0',
      });
      agent.getToolRegistry().reevaluateDeferred();
      log.debug('Registered subagent support, tools now:', agent.getToolRegistry().getAll().map(t => t.name));

      // Use OAuth auth plugin if we have OAuth tokens, otherwise use regular providers
      if (options.oauthTokens) {
        log.info('Have OAuth tokens, creating AnthropicOAuthProvider');
        log.debug('Token expires at:', options.oauthTokens.expiresAt);
        // Create an OAuth provider and register it in the provider registry
        // Pass expo/fetch for streaming support in API calls
        const oauthProvider = new AnthropicOAuthProvider({
          tokens: options.oauthTokens,
          onTokenRefresh: options.onTokenRefresh,
          fetch: expoFetch as unknown as typeof fetch,
        });
        log.debug('Created oauthProvider:', oauthProvider.constructor.name);
        // Register the OAuth provider instance in the agent's scoped registry
        agent.getProviderRegistry().register({
          name: 'anthropic-oauth',
          factory: () => {
            log.debug('Provider factory called, returning:', oauthProvider.constructor.name);
            return oauthProvider;
          },
        });
        log.debug('Registered provider in agent registry');
        // Set the agent to use this provider
        agent.setProvider('anthropic-oauth');
        log.debug('Called agent.setProvider("anthropic-oauth")');
        log.info('Using Anthropic OAuth authentication (React Native)');
      } else {
        // Use regular providers plugin for API key authentication
        await agent.use(providersPlugin);
        
        // Ensure the provider is set
        if (agent.hasProvider('anthropic')) {
          agent.setProvider('anthropic', { apiKey: options.apiKey || '' });
        } else {
          log.warn('Anthropic provider not available after registering providersPlugin');
        }
        log.info('Using Anthropic API key authentication');
      }
      
      agents.set(options.projectId, agent);
    }

    // Create adapters
    const agentAdapter = new AgentAdapter(options.projectId, agent, options.onEvent);
    const sessionManager = new SQLiteSessionManager(options.workingDirectory);

    return {
      agent: agentAdapter,
      sessionManager,
    };
  }
}

/**
 * Create a React Native agent factory instance.
 */
export function createReactNativeAgentFactory(): ReactNativeAgentFactory {
  return new ReactNativeAgentFactory();
}
