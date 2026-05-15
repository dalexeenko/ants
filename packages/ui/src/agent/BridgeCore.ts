/**
 * BridgeCore - Shared bridge logic for desktop and mobile
 *
 * This module defines the platform-specific interfaces and composes domain
 * modules from ./bridge/ into a complete AgentBridge implementation.
 */

import type {
  Project,
  Session,
  Message,
  RemoteServerConfig,
  PermissionResponse,
  ToolPermissionConfig,
  FileEntry,
  AgentEvent,
  AuthStatus,
  ApiKeyInfo,
  ToolInfo,
  OAuthInitResult,
  AgentBridge,
  QuestionResponsePayload,
} from './types';

import {
  createProjectMethods,
  createSessionMethods,
  createMessagingMethods,
  createAuthMethods,
  createPermissionMethods,
  createModelMethods,
  createFilesystemMethods,
  createMcpMethods,
  createPluginMethods,
  createRemoteMethods,
  createDirectorMethods,
} from './bridge';

import type { BridgeState, BridgeHelpers, BridgeDeps } from './bridge';

// ============================================================
// Platform-specific interfaces (re-exported for consumers)
// ============================================================

/**
 * Platform-specific agent interface.
 * Each platform implements this to provide agent capabilities.
 */
export interface PlatformAgent {
  /** Unique identifier for this agent */
  id: string;

  /** Send a message and get a response (may stream events) */
  prompt(content: string): Promise<{ content: string; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }>;

  /** Stream a message response */
  stream(content: string): AsyncIterable<{
    type: 'text' | 'tool_use' | 'tool_result';
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    toolUseId?: string;
    content?: unknown;
  }>;

  /** Cancel the current operation */
  cancel(): void;

  /** Set session context for message persistence */
  setSessionContext(context: { sessionId: string }): void;

  /** Set/load messages into the agent */
  setMessages(messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    toolResults?: Array<{ id: string; name: string; result: unknown; isError?: boolean }>;
  }>): void;

  /** Register event listener */
  on(event: 'event', callback: (event: unknown) => void): void;

  /** Set permission request callback */
  setPermissionRequestCallback(callback: (toolCall: { id: string; name: string; arguments: Record<string, unknown> }) => Promise<PermissionResponse>): void;

  /** Allow a tool for the current session */
  allowToolForSession(toolName: string): void;

  /** Clear tool permissions */
  clearToolPermissions(): void;

  /** Get permission manager config */
  getPermissionConfig(): ToolPermissionConfig;

  /** Update permission config */
  updatePermissionConfig(config: Partial<ToolPermissionConfig>): void;

  /** Get disabled tools */
  getDisabledTools(): string[];

  /** Set disabled tools */
  setDisabledTools(tools: string[]): void;

  /** Disable a single tool */
  disableTool(toolName: string): void;

  /** Enable a single tool */
  enableTool(toolName: string): void;

  /** Get tools info */
  getToolsInfo(): ToolInfo[];

  /** Get current model configuration */
  getModel(): { provider: string; model: string };

  /** Set the model to use */
  setModel(provider: string, model: string): void;

  /** Get current todo items (for auto-complete feature) */
  getTodos?(): Array<{ id: string; content: string; status: string; priority: string }>;

  /** Get current phase items (for auto-complete feature) */
  getPhases?(): Array<{ id: string; name: string; status: string }>;

  /** Get the agent's internal message array (all messages including tool calls/results) */
  getMessages(): Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    toolResults?: Array<{ id: string; name: string; result: unknown; isError?: boolean }>;
  }>;

  /** Get all registered agent types (for subagent management) */
  getAgentTypes?(): Array<{
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
  }>;

  /** Get agent type conflicts */
  getAgentTypeConflicts?(): Array<{
    name: string;
    keptSource: 'builtin' | 'plugin' | 'config';
    replacedSource: 'builtin' | 'plugin' | 'config';
    keptIntegrity?: string;
    replacedIntegrity?: string;
  }>;

  /** Enable or disable an agent type */
  setAgentTypeEnabled?(name: string, enabled: boolean): void;

  /** Generate a title for the current session based on messages */
  generateSessionTitle?(messages: Array<{ role: string; content: string }>): Promise<string | null>;

  /** Get the usage tracker for hydration (optional — available on local agents) */
  getUsageTracker?(): {
    hydrate(
      sessionId: string,
      model: string,
      provider: string,
      usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        cacheCreationInputTokens?: number;
        cacheReadInputTokens?: number;
        estimatedCost: number;
        requestCount: number;
      },
      parentSessionId?: string,
    ): void;
  };

  /** Shutdown the agent */
  shutdown(): Promise<void>;
}

/**
 * Platform-specific session manager interface.
 */
export interface PlatformSessionManager {
  /** Create a new session */
  createSession(options: { workingDirectory: string; title?: string; provider?: string; model?: string }): Promise<{
    id: string;
    title: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;

  /** Get all root sessions */
  getRootSessions(limit?: number): Promise<Array<{
    id: string;
    title: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>>;

  /** Get a session by ID */
  getSession(sessionId: string): Promise<{
    id: string;
    title: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null>;

  /** Delete a session */
  deleteSession(sessionId: string): Promise<void>;

  /** Delete all sessions. Returns the number of sessions deleted. */
  deleteAllSessions(): Promise<number>;

  /** Get messages for a session */
  getSessionMessages(sessionId: string): Promise<Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    toolResults?: Array<{ toolCallId: string; content: unknown; isError?: boolean }>;
    createdAt: Date;
  }>>;

  /** Add a message to a session */
  addMessage(params: {
    sessionId: string;
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    toolResults?: Array<{ toolCallId: string; content: unknown; isError?: boolean }>;
    sequence: number;
  }): Promise<void>;

  /** Get the most recent messages for a session, paginated */
  getSessionMessagesPaginated(
    sessionId: string,
    limit: number,
    beforeSequence?: number,
  ): Promise<{
    messages: Array<{
      id: string;
      role: 'user' | 'assistant';
      content: string;
      toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
      toolResults?: Array<{ toolCallId: string; content: unknown; isError?: boolean }>;
      sequence: number;
      createdAt: Date;
    }>;
    hasMore: boolean;
  }>;

  /** Get next sequence number */
  getNextSequence(sessionId: string): Promise<number>;

  /** Update session title */
  updateSessionTitle?(sessionId: string, title: string): Promise<void>;

  /** Get stored token usage stats for a session */
  getTokenUsage?(sessionId: string): Promise<{
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    estimatedCost: number;
    requestCount: number;
  } | null>;

  /** Search sessions */
  searchSessions(options: {
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
  }>>;
}

/**
 * OAuth tokens structure (compatible with @ants/agent-auth-core).
 */
export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/**
 * Platform-specific storage interface for auth and API keys.
 */
export interface PlatformStorage {
  getAuthStatus(): Promise<AuthStatus>;
  initiateOAuth(provider: 'anthropic'): Promise<OAuthInitResult>;
  completeOAuth(provider: 'anthropic', code: string, verifier: string): Promise<void>;
  disconnectOAuth(provider: 'anthropic'): Promise<void>;
  listApiKeys(): Promise<ApiKeyInfo[]>;
  getApiKey(provider: string): Promise<string | null>;
  setApiKey(provider: string, key: string): Promise<void>;
  deleteApiKey(provider: string): Promise<void>;
  hasApiKey(provider: string): Promise<boolean>;
  getProjectsDirectory(): Promise<string | null>;
  setProjectsDirectory(path: string): Promise<void>;
  getOAuthTokens?(): Promise<OAuthTokens | null>;
  saveOAuthTokens?(tokens: OAuthTokens): Promise<void>;
}

/**
 * Platform-specific filesystem interface.
 */
export interface PlatformFilesystem {
  readDirectory(path: string): Promise<FileEntry[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  pathExists(path: string): Promise<boolean>;
  getDataDirectory(): string;
  /** Start watching a file for changes. Calls onChange when the file is modified externally. */
  watchFile?(path: string, onChange: () => void): void;
  /** Stop watching a file. */
  unwatchFile?(path: string): void;
}

/**
 * Factory for creating platform agents.
 */
export interface PlatformAgentFactory {
  createAgent(options: {
    projectId: string;
    workingDirectory: string;
    apiKey?: string;
    oauthTokens?: OAuthTokens;
    onTokenRefresh?: (tokens: OAuthTokens) => Promise<void>;
    onEvent: (event: AgentEvent) => void;
  }): Promise<{ agent: PlatformAgent; sessionManager: PlatformSessionManager; hasIncrementalPersistence?: boolean }>;
}

/**
 * Managed agent state.
 */
export interface ManagedAgent {
  id: string;
  workingDirectory: string;
  agent: PlatformAgent;
  sessionManager: PlatformSessionManager;
  currentSessionId: string | null;
  permissionResolvers: Map<string, (response: PermissionResponse) => void>;
  questionResolvers: Map<string, (response: QuestionResponsePayload) => void>;
  /**
   * When true, the agent's storage plugin persists messages incrementally
   * via the onMessageAdded hook, so the messaging layer should skip its
   * own batch save after prompt() completes.
   */
  hasIncrementalPersistence?: boolean;
}

/**
 * SSE Event from the server
 */
export interface SSEEvent {
  type: string;
  data: string;
}

/**
 * Platform-specific SSE handler for streaming responses.
 */
export interface PlatformSSEHandler {
  connect(
    url: string,
    options: {
      method: 'POST';
      headers: Record<string, string>;
      body: string;
    },
    onEvent: (event: SSEEvent) => void,
    onError: (error: Error) => void,
    onComplete: () => void,
  ): () => void;
}

/**
 * Configuration for BridgeCore.
 */
export interface BridgeCoreConfig {
  agentFactory: PlatformAgentFactory;
  storage: PlatformStorage;
  filesystem: PlatformFilesystem;
  onEvent: (projectId: string, event: AgentEvent) => void;
  onProjectsChanged?: (projects: Project[]) => void;
  onRemoteServersChanged?: (servers: RemoteServerConfig[]) => void;
  sseHandler?: PlatformSSEHandler;
  /**
   * Optional auth header resolver for plugin-contributed auth types.
   * Called when a server has an authType other than 'bearer'.
   * Returns additional headers to include in requests.
   */
  getPluginAuthHeaders?: (authType: string, authConfig: Record<string, unknown>) => Record<string, string> | undefined;

  /**
   * Optional resolver that turns a relative screenshot file path into a
   * displayable URL. Each platform provides its own implementation:
   * - Desktop: ants-screenshot://<projectId>/<path>
   * - Web: /api/beta/projects/<projectId>/<path>
   */
  resolveScreenshotUrl?: (projectId: string, path: string) => string;

  /**
   * Optional fallback to return globally-registered agent types when no
   * managed agent exists for a project.  Without this, `getAgentTypes`
   * returns `[]` for projects whose local agent failed to create or hasn't
   * been created yet.
   *
   * Desktop provides this via the global `agentTypeRegistry` singleton;
   * mobile should do the same.
   */
  getGlobalAgentTypes?: () => Array<{
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
  }>;

  /**
   * Optional fallback to return globally-registered agent type conflicts.
   */
  getGlobalAgentTypeConflicts?: () => Array<{
    name: string;
    keptSource: 'builtin' | 'plugin' | 'config';
    replacedSource: 'builtin' | 'plugin' | 'config';
    keptIntegrity?: string;
    replacedIntegrity?: string;
  }>;

  /**
   * Optional fallback to enable/disable agent types globally when no
   * managed agent exists for a project.
   */
  setGlobalAgentTypeEnabled?: (name: string, enabled: boolean) => void;
}

// ============================================================
// Composition
// ============================================================

/**
 * Create a BridgeCore instance.
 *
 * Constructs shared state and helpers, then delegates to domain-specific
 * modules in ./bridge/ to produce each group of AgentBridge methods.
 */
export function createBridgeCore(config: BridgeCoreConfig): AgentBridge {
  const { onEvent } = config;

  // ---- Shared mutable state ----
  const bridgeState: BridgeState = {
    projects: new Map(),
    localAgents: new Map(),
    remoteServers: new Map(),
    remoteSessions: new Map(),
    remoteMessages: new Map(),
    sessionModelOverrides: new Map(),
    remoteEventSubscribers: new Map(),
    remoteActiveSessionIds: new Map(),
    activeSSEStreams: new Set(),
  };

  // ---- Helpers ----
  const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const emitEvent = (projectId: string, event: AgentEvent) => {
    onEvent(projectId, event);
  };

  const emitRemoteEvent = (projectId: string, event: AgentEvent) => {
    onEvent(projectId, event);
    // Also fan out to any subscribeToProject() listeners. Desktop wires onEvent
    // to forward via IPC to the renderer's listener; web bridges leave onEvent
    // as a no-op and rely on this in-process dispatch instead.
    const subscribers = bridgeState.remoteEventSubscribers.get(projectId);
    if (subscribers) {
      for (const cb of subscribers) {
        try {
          cb(event);
        } catch {
          // ignore subscriber errors so one bad listener doesn't block the rest
        }
      }
    }
  };

  const getRemoteServerForProject = (projectId: string): RemoteServerConfig | null => {
    const project = bridgeState.projects.get(projectId);
    if (!project || project.providerType !== 'remote' || !project.remoteServerId) {
      return null;
    }
    return bridgeState.remoteServers.get(project.remoteServerId) || null;
  };

  const updateServerLastSeen = (serverId: string) => {
    const server = bridgeState.remoteServers.get(serverId);
    if (server) {
      const updated = { ...server, lastSeen: Date.now() };
      bridgeState.remoteServers.set(serverId, updated);
      config.onRemoteServersChanged?.(Array.from(bridgeState.remoteServers.values()));
    }
  };

  const remoteFetch = async (server: RemoteServerConfig, path: string, options: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    // Auth header resolution: plugin auth types first, then bearer token fallback
    if (server.authType && server.authType !== 'bearer' && server.authConfig && config.getPluginAuthHeaders) {
      const pluginHeaders = config.getPluginAuthHeaders(server.authType, server.authConfig);
      if (pluginHeaders) {
        Object.assign(headers, pluginHeaders);
      }
    } else if (server.token) {
      headers['Authorization'] = `Bearer ${server.token}`;
    }

    const response = await fetch(`${server.url}/api/beta${path}`, { ...options, headers });

    if (response.status < 500) {
      updateServerLastSeen(server.id);
    }

    return response;
  };

  const toUISession = (s: { id: string; title: string | null; createdAt: Date; updatedAt: Date }): Session => ({
    id: s.id,
    title: s.title || 'Untitled Session',
    createdAt: s.createdAt.getTime(),
    updatedAt: s.updatedAt.getTime(),
  });

  const toUIMessage = (m: {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    isCompactionSummary?: boolean | null;
    sequence?: number;
    createdAt: Date;
  }): Message => ({
    id: m.id,
    role: m.role,
    content: m.content,
    toolCalls: m.toolCalls?.map(tc => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments,
      status: 'complete' as const,
    })),
    isCompactionSummary: m.isCompactionSummary ?? undefined,
    sequence: m.sequence,
    createdAt: m.createdAt.getTime(),
  });

  const bridgeHelpers: BridgeHelpers = {
    generateId,
    emitEvent,
    emitRemoteEvent,
    getRemoteServerForProject,
    updateServerLastSeen,
    remoteFetch,
    toUISession,
    toUIMessage,
  };

  // ---- Build deps bundle ----
  const deps: BridgeDeps = { config, state: bridgeState, helpers: bridgeHelpers };

  // ---- Compose domain modules ----
  const projectMethods = createProjectMethods(deps);
  const sessionMethods = createSessionMethods(deps);
  const messagingMethods = createMessagingMethods(deps);
  const authMethods = createAuthMethods(deps);
  const permissionMethods = createPermissionMethods(deps);
  const modelMethods = createModelMethods(deps);
  const filesystemMethods = createFilesystemMethods(deps);
  const mcpMethods = createMcpMethods(deps);
  const pluginMethods = createPluginMethods(deps);
  const remoteMethods = createRemoteMethods(deps);
  const directorMethods = createDirectorMethods();

  // Wire up the self-reference for sendMessage's error-fallback sync
  if ('_setSelfSync' in messagingMethods) {
    (messagingMethods as any)._setSelfSync(messagingMethods.syncRemoteMessages);
  }

  // ---- Assemble final bridge ----
  const bridge: AgentBridge = {
    ...projectMethods,
    ...sessionMethods,
    ...messagingMethods,
    ...authMethods,
    ...permissionMethods,
    ...modelMethods,
    ...filesystemMethods,
    ...mcpMethods,
    ...pluginMethods,
    ...remoteMethods,
    ...directorMethods,
  };

  return bridge;
}
