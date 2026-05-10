// Agent Bridge Types - Interface between UI and agent backend

export type ProviderType = 'local' | 'remote';

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  providerType: ProviderType;
  remoteServerId?: string;
  /** Name of an agent type (tagged "root") to use as the project's base system prompt */
  rootAgentType?: string;
  /** Free-text custom instructions appended to the system prompt for this project */
  customInstructions?: string;
  /** Default agent mode for new sessions in this project */
  defaultMode?: AgentMode;
  /** Maximum number of auto-complete loops per session */
  maxAutoCompleteLoops?: number;
  /** Whether the project directory is a git repository (detected at load time) */
  isGitRepo?: boolean;
  /** Whether worktree support is enabled for this project (requires isGitRepo) */
  worktreeEnabled?: boolean;
}

export interface RemoteServerConfig {
  id: string;
  name: string;
  url: string;
  token?: string;
  /** Auth type identifier — 'bearer' (default) or a plugin-contributed type like 'cloudflare-access' */
  authType?: string;
  /** Auth-type-specific configuration (e.g., clientId/clientSecret for CF Access) */
  authConfig?: Record<string, unknown>;
  createdAt: number;
  /** Timestamp of last successful communication with this server */
  lastSeen?: number;
}

export type AgentMode = 'plan' | 'build';

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Provider override for this session (null = use project default) */
  provider?: string | null;
  /** Model override for this session (null = use project default) */
  model?: string | null;
  /** Agent mode for this session */
  mode?: AgentMode;
  /** Whether this session is running in a git worktree */
  worktree?: WorktreeInfo | null;
}

/** Information about a session's git worktree */
export interface WorktreeInfo {
  /** The branch name created for this worktree */
  branch: string;
  /** The base branch (usually main/master) the worktree was created from */
  baseBranch: string;
  /** Absolute path to the worktree directory */
  path: string;
  /** Current status of the worktree */
  status: 'active' | 'merged' | 'discarded';
}

/** Result of a git diff for a worktree */
export interface WorktreeDiffResult {
  /** Files changed in the worktree */
  files: WorktreeDiffFile[];
  /** Summary stats */
  additions: number;
  deletions: number;
  filesChanged: number;
}

export interface WorktreeDiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  /** Unified diff content */
  diff: string;
}

/** A block of content within a message - text, a tool call, or an inline image */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'image'; dataUrl: string; width: number; height: number; alt: string };

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  /**
   * Ordered content blocks preserving the sequence of text and tool calls
   * as they were streamed. When present, rendering should use this instead
   * of content + toolCalls separately.
   */
  contentBlocks?: ContentBlock[];
  /**
   * Database sequence number. Used as a cursor for paginated message loading.
   * Only present for messages loaded from persistence; streamed messages
   * added in real-time may not have a sequence yet.
   */
  sequence?: number;
  /** Whether this message is a compaction summary (conversation was summarized). */
  isCompactionSummary?: boolean;
  createdAt: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: 'pending' | 'running' | 'complete' | 'error';
  result?: unknown;
  /** Extra data (e.g. images) stored for display but not sent to the LLM. */
  metadata?: Record<string, unknown>;
  /** Timestamp when the tool call started running */
  startedAt?: number;
  /** Timestamp when the tool call completed */
  completedAt?: number;
  /** Set when this tool call originated from a subagent (for permission propagation) */
  subagentSessionId?: string;
  /** Description of the subagent that initiated this tool call */
  subagentDescription?: string;
}

export interface Attachment {
  id: string;
  name: string;
  type: string;
  uri: string;
  size?: number;
}

export interface SlashCommand {
  name: string;
  description: string;
  arguments?: CommandArgument[];
}

export interface CommandArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextLength?: number;
  description?: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  models: ModelInfo[];
}

export interface ModelConfig {
  provider: string;
  model: string;
}

// Terminal helper types (smart terminal / aish)
export interface TerminalHelperContext {
  /** The failed command or natural language input */
  input: string;
  /** Recent terminal output (last ~20 lines) */
  recentOutput: string;
  /** Current working directory */
  workingDirectory: string;
  /** Whether this was triggered by an error (true) or natural language (false) */
  isError: boolean;
}

export interface TerminalHelperSuggestion {
  command: string;
  explanation: string;
}

// Terminal types for remote terminal sessions
export interface TerminalSession {
  id: string;
  projectId: string;
  workingDirectory: string;
  createdAt: string;
  lastActivity: string;
}

// Channel types for messaging platform integrations
export type ChannelType = 'slack' | 'discord' | 'twitter' | 'reddit' | 'telegram';

export interface ChannelConfig {
  [key: string]: unknown;
}

export interface ChannelCredentials {
  [key: string]: unknown;
}

export interface Channel {
  id: string;
  type: ChannelType;
  name: string;
  config: ChannelConfig;
  credentials: ChannelCredentials;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export type TriggerEvent =
  | 'mention'
  | 'direct_message'
  | 'reaction'
  | 'keyword'
  | 'channel_message';

export interface TriggerFilter {
  type: 'channel' | 'user' | 'keyword' | 'regex';
  include?: string[];
  exclude?: string[];
}

export interface TriggerConfig {
  events: TriggerEvent[];
  filters?: TriggerFilter[];
}

export type ResponseMode = 'reply' | 'thread' | 'dm' | 'channel';
export type ThreadBehavior = 'always' | 'if_exists' | 'never';

export interface ResponseConfig {
  mode?: ResponseMode;
  threadBehavior?: ThreadBehavior;
  typingIndicator?: boolean;
  maxResponseLength?: number;
}

export interface ChannelProjectBinding {
  id: string;
  channelId: string;
  projectId: string;
  triggerConfig: TriggerConfig;
  responseConfig?: ResponseConfig;
  enabled: boolean;
  priority: number;
  createdAt: number;
  updatedAt: number;
}

export interface TerminalCreateOptions {
  shell?: string;
  workingDirectory?: string;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modifiedAt?: number;
}

/** Directory entry for filesystem browsing (used in directory picker) */
export interface FilesystemEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  size?: number;
  modifiedAt?: string;
}

/** Result of listing a filesystem directory */
export interface FilesystemListResult {
  path: string;
  name: string;
  parent: string | null;
  isRoot: boolean;
  entries: FilesystemEntry[];
  count: {
    total: number;
    directories: number;
    files: number;
  };
}

/** Common paths returned by filesystem home endpoint */
export interface FilesystemHomePaths {
  home: string;
  workspaces: string;
  common: Array<{ name: string; path: string }>;
}

// API Key types
export interface ApiKeyInfo {
  provider: string;
  hasKey: boolean;
}

// Permission types
export type PermissionResponse = 'allow_once' | 'allow_always' | 'deny';

// Question types (for interactive user input via the question tool)
export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionRequest {
  questionId: string;
  question: string;
  options: QuestionOption[];
  multiple: boolean;
  allowFreeform: true;
}

export interface QuestionResponsePayload {
  selected: string[];
  freeformText?: string;
}

export interface ToolPermissionConfig {
  defaultMode: 'allow' | 'deny' | 'ask';
  alwaysAllow: string[];
  alwaysDeny: string[];
  allowAll: boolean;
}

// OAuth types
export interface OAuthInitResult {
  /** URL to open for user authorization */
  url: string;
  /** PKCE verifier - must be stored and passed to completeOAuth */
  verifier: string;
}

// Authentication types
export interface AuthStatus {
  anthropic: {
    authenticated: boolean;
    method: 'oauth' | 'apikey' | null;
  };
  openai: { hasApiKey: boolean };
  google: { hasApiKey: boolean };
  openrouter: { hasApiKey: boolean };
  groq: { hasApiKey: boolean };
  xai: { hasApiKey: boolean };
}

// MCP types
export interface McpServerConfig {
  name: string;
  type: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface McpServerInfo extends McpServerConfig {
  status: McpServerStatus;
}

export interface McpServerStatus {
  connected: boolean;
  toolCount: number;
  error?: string;
}

export interface McpTool {
  name: string;
  description?: string;
  serverName: string;
}

// Tool info types
export interface ToolInfo {
  name: string;
  description: string;
  /** Icon for this tool - can be an emoji or icon name (e.g., "wrench", "globe") */
  icon?: string;
  tags: string[];
  requires: string[];
  available: boolean;
  disabled: boolean;
}

// Search types
export interface SearchOptions {
  query: string;
  includeMessages?: boolean;
  limit?: number;
}

export interface SearchResult {
  projectId: string;
  projectName: string;
  session: {
    id: string;
    title: string | null;
    workingDirectory: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
  };
  matchingMessages?: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: number;
  }>;
}

// Plugin types for plugin management UI
export interface PluginPackageInfo {
  /** The npm package specifier used to install */
  packageSpec: string;
  /** The resolved package name (without version) */
  packageName: string;
  /** The installed version */
  version: string;
  /** Names of the AgentPlugin(s) from this package */
  pluginNames: string[];
  /** When this package was installed */
  installedAt: number;
}

export interface PluginListResult {
  installed: PluginPackageInfo[];
  registered: string[];
}

export interface PluginInstallResult {
  success: boolean;
  packageName?: string;
  version?: string;
  plugins?: string[];
  registered?: string[];
  errors?: Array<{ name: string; error: string }>;
  error?: string;
}

export interface PluginUninstallResult {
  success: boolean;
  packageName?: string;
  plugins?: string[];
  unregistered?: string[];
  error?: string;
}

// Agent type info for settings UI
export interface AgentTypeInfo {
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
}

/** A name conflict between two agent type definitions at the same precedence */
export interface AgentTypeConflictInfo {
  /** The agent type name that collided */
  name: string;
  /** Source of the definition that won */
  keptSource: AgentTypeInfo['source'];
  /** Source of the definition that was replaced */
  replacedSource: AgentTypeInfo['source'];
  /** Integrity hash of the kept definition */
  keptIntegrity?: string;
  /** Integrity hash of the replaced definition */
  replacedIntegrity?: string;
}

// Todo and Phase items (synced from agent via SSE events)
export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
}

export interface PhaseItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

// Subagent info for tracking in UI
export interface SubagentInfo {
  sessionId: string;
  parentSessionId: string;
  description: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
  async: boolean;
}

// Agent Events
export type AgentEvent =
  | { type: 'user.message'; sessionId: string; messageId: string; content: string }
  | { type: 'message.start'; sessionId: string; messageId: string }
  | { type: 'message.delta'; sessionId: string; messageId: string; delta: string }
  | { type: 'message.complete'; sessionId: string; messageId: string; content: string; contextUsage?: { currentTokens: number; maxTokens: number } }
  | { type: 'tool.start'; sessionId: string; messageId: string; toolCall: ToolCall }
  | { type: 'tool.complete'; sessionId: string; messageId: string; toolResult: { id: string; result: unknown; metadata?: Record<string, unknown> } }
  | { type: 'tool.permission.request'; sessionId: string; messageId: string; toolCall: ToolCall; subagentSessionId?: string; subagentDescription?: string }
  | { type: 'tool.permission.granted'; sessionId: string; messageId: string; toolName: string }
  | { type: 'tool.permission.denied'; sessionId: string; messageId: string; toolName: string }
  | { type: 'question.request'; sessionId: string; questionId: string; question: string; options: QuestionOption[]; multiple: boolean; allowFreeform: true }
  | { type: 'mcp.server.connected'; serverName: string; toolCount: number }
  | { type: 'mcp.server.disconnected'; serverName: string; reason?: string }
  | { type: 'compaction.start'; sessionId: string; stats: { currentTokens: number; threshold: number; messagesToCompact: number } }
  | { type: 'compaction.delta'; sessionId: string; delta: string }
  | { type: 'compaction.complete'; sessionId: string; compactionId: string; stats: { originalTokens: number; compactedTokens: number; messagesPruned: number; compressionRatio: number }; contextUsage?: { currentTokens: number; maxTokens: number } }
  | { type: 'compaction.error'; sessionId: string; error: string }
  | { type: 'subagent.start'; sessionId: string; parentSessionId: string; description: string; async: boolean }
  | { type: 'subagent.complete'; sessionId: string; parentSessionId: string; result: string }
  | { type: 'subagent.error'; sessionId: string; parentSessionId: string; error: string }
  | { type: 'setup.start'; sessionId: string; component: string; message: string }
  | { type: 'setup.progress'; sessionId: string; component: string; message: string; progress?: number }
  | { type: 'setup.complete'; sessionId: string; component: string; message: string }
  | { type: 'setup.error'; sessionId: string; component: string; error: string }
  | { type: 'session.title.updated'; sessionId: string; title: string }
  | { type: 'agent.mode.changed'; sessionId: string; mode: AgentMode }
  | { type: 'todos.updated'; sessionId: string; todos: TodoItem[] }
  | { type: 'phases.updated'; sessionId: string; phases: PhaseItem[] }
  | { type: 'done'; sessionId: string; hasOpenTodos?: boolean; hasOpenPhases?: boolean; openTodoCount?: number; openPhaseCount?: number; todos?: TodoItem[]; phases?: PhaseItem[] }
  | { type: 'file.changed'; filePath: string }
  | { type: 'error'; sessionId?: string; error: string };

// Docker types
export interface DockerConfig {
  /** Enable Docker for this project's agent sessions */
  enabled: boolean;
  /** Custom Docker image (defaults to openmgr-agent:latest) */
  image?: string;
  /** Extra volume mounts (host:container) */
  volumes?: string[];
  /** Extra environment variables */
  env?: Record<string, string>;
  /** Docker network to attach to */
  network?: string;
  /** Resource limits */
  resources?: {
    cpus?: string;
    memory?: string;
  };
}

export interface DockerStatus {
  available: boolean;
  version?: string;
  error?: string;
  insideDocker: boolean;
  dindAvailable: boolean;
}

export interface DockerContainerInfo {
  containerId: string;
  containerName: string;
  status: 'created' | 'running' | 'paused' | 'exited' | 'dead' | 'unknown';
  port: number;
  workingDirectory: string;
  image: string;
  createdAt?: string;
  stats?: {
    cpuPercent?: string;
    memoryUsage?: string;
    memoryLimit?: string;
  };
}

// Options
export interface SendOptions {
  model?: string;
  attachments?: Attachment[];
}

export interface CreateSessionOptions {
  title?: string;
  /** Provider to use for this session (overrides project default) */
  provider?: string;
  /** Model to use for this session (overrides project default) */
  model?: string;
  /** Agent mode for this session (default: 'build') */
  mode?: AgentMode;
  /** Launch this session in a git worktree for isolated changes */
  useWorktree?: boolean;
  /** Custom branch name for the worktree (auto-generated if not provided) */
  worktreeBranch?: string;
}

/** Status of a session's streaming/processing state on the server */
export type SessionStreamStatus = 'idle' | 'active' | 'completed' | 'error';

/** Session stream status information from the server */
export interface SessionStatusInfo {
  sessionId: string;
  stream: {
    status: SessionStreamStatus;
    eventCount: number;
    startedAt: number | null;
    completedAt: number | null;
    finalMessage?: string;
    error?: string;
  };
}

// Agent Bridge Interface
export interface AgentBridge {
  // Project/Agent management
  createProject(
    path: string,
    providerType: ProviderType,
    remoteServerId?: string,
    name?: string
  ): Promise<Project>;
  listProjects(): Promise<Project[]>;
  syncRemoteProjects(): Promise<{ unreachableServers: RemoteServerConfig[] }>;
  updateProject(projectId: string, updates: Partial<Pick<Project, 'name' | 'rootAgentType' | 'customInstructions' | 'defaultMode' | 'maxAutoCompleteLoops' | 'worktreeEnabled'>>): Promise<void>;
  removeProject(projectId: string): Promise<void>;
  discoverProjects(directory: string): Promise<Project[]>;

  // Remote server management
  listRemoteServers(): Promise<RemoteServerConfig[]>;
  addRemoteServer(
    config: Omit<RemoteServerConfig, 'id' | 'createdAt'>
  ): Promise<RemoteServerConfig>;
  updateRemoteServer(
    id: string,
    config: Partial<RemoteServerConfig>
  ): Promise<void>;
  removeRemoteServer(id: string): Promise<void>;
  testRemoteServer(config: {
    url: string;
    token?: string;
    authType?: string;
    authConfig?: Record<string, unknown>;
  }): Promise<{
    success: boolean;
    error?: string;
    /** True when the server is in multi-user mode and returned a 401 (auth required). */
    requiresAuth?: boolean;
    /** URL to open in the browser to trigger the sign-in → deeplink flow. */
    connectUrl?: string;
  }>;
  /** Proxy an HTTP request to a remote server, avoiding CORS issues on desktop. */
  remoteServerFetch(
    serverId: string,
    path: string,
    options?: { method?: string; body?: string }
  ): Promise<{ status: number; ok: boolean; body: string }>;

  // Session management (scoped to project)
  listSessions(projectId: string): Promise<Session[]>;
  syncRemoteSessions(projectId: string): Promise<void>;
  createSession(
    projectId: string,
    options?: CreateSessionOptions
  ): Promise<Session>;
  deleteSession(projectId: string, sessionId: string): Promise<void>;
  deleteAllSessions(projectId: string): Promise<{ deletedCount: number }>;
  getSession(projectId: string, sessionId: string): Promise<Session>;

  // Messaging
  getMessages(projectId: string, sessionId: string): Promise<Message[]>;
  getMessagesPaginated(
    projectId: string,
    sessionId: string,
    limit: number,
    beforeSequence?: number,
  ): Promise<{ messages: Message[]; hasMore: boolean }>;
  syncRemoteMessages(projectId: string, sessionId: string): Promise<void>;
  sendMessage(
    projectId: string,
    sessionId: string,
    content: string,
    options?: SendOptions
  ): Promise<void>;
  cancelMessage(projectId: string): Promise<void>;

  // Session status and reconnection
  /** Get the streaming/processing status of a session from the server */
  getSessionStatus(projectId: string, sessionId: string): Promise<SessionStatusInfo | null>;
  /**
   * Subscribe to a session's event stream from the server.
   * If the session is actively processing, replays buffered events from lastEventIndex
   * and continues with live events. Enables reconnection after disconnect and
   * multiple clients watching the same session.
   * @returns Unsubscribe function, or null if session has no active/recent stream
   */
  subscribeToSessionEvents(
    projectId: string,
    sessionId: string,
    lastEventIndex?: number
  ): Promise<(() => void) | null>;

  // Real-time events
  subscribeToProject(
    projectId: string,
    callback: (event: AgentEvent) => void
  ): () => void;

  // Permissions
  respondToPermission(
    projectId: string,
    sessionId: string,
    toolCallId: string,
    response: PermissionResponse
  ): Promise<void>;
  getPermissionConfig(projectId: string): Promise<ToolPermissionConfig>;
  updatePermissionConfig(
    projectId: string,
    config: Partial<ToolPermissionConfig>
  ): Promise<void>;

  // Questions (interactive user input)
  respondToQuestion(
    projectId: string,
    sessionId: string,
    questionId: string,
    response: QuestionResponsePayload
  ): Promise<void>;

  // Authentication
  getAuthStatus(): Promise<AuthStatus>;
  /** 
   * Start OAuth flow - returns URL to open and verifier to store.
   * User should open URL, authorize, copy the code, then call completeOAuth.
   */
  initiateOAuth(provider: 'anthropic'): Promise<OAuthInitResult>;
  /** 
   * Complete OAuth flow - exchange code for tokens.
   * @param provider - OAuth provider
   * @param code - Authorization code from OAuth callback
   * @param verifier - PKCE verifier from initiateOAuth
   */
  completeOAuth(provider: 'anthropic', code: string, verifier: string): Promise<void>;
  disconnectOAuth(provider: 'anthropic'): Promise<void>;

  // API Keys
  getApiKeys(): Promise<ApiKeyInfo[]>;
  setApiKey(provider: string, key: string): Promise<void>;
  deleteApiKey(provider: string): Promise<void>;

  // MCP
  listMcpServers(projectId: string): Promise<McpServerInfo[]>;
  addMcpServer(projectId: string, config: McpServerConfig): Promise<void>;
  removeMcpServer(projectId: string, serverName: string): Promise<void>;
  getMcpTools(projectId: string): Promise<McpTool[]>;
  getMcpStatus(projectId: string): Promise<Record<string, McpServerStatus>>;

  // Models
  getModels(projectId: string): Promise<ModelInfo[]>;
  getCurrentModel(projectId: string): Promise<ModelConfig>;
  setModel(projectId: string, provider: string, model: string): Promise<void>;
  
  // Session-level model override
  getSessionModel(projectId: string, sessionId: string): Promise<ModelConfig | null>;
  setSessionModel(projectId: string, sessionId: string, provider: string, model: string): Promise<void>;
  clearSessionModel(projectId: string, sessionId: string): Promise<void>;

  // Agent Mode (Plan/Build)
  getSessionMode(projectId: string, sessionId: string): Promise<AgentMode>;
  setSessionMode(projectId: string, sessionId: string, mode: AgentMode): Promise<void>;

  // Commands
  getCommands(projectId: string): Promise<SlashCommand[]>;

  // Filesystem (project-scoped)
  readDirectory(projectId: string, path: string): Promise<FileEntry[]>;
  readFile(projectId: string, path: string): Promise<string>;
  writeFile(projectId: string, path: string, content: string): Promise<void>;
  /** Start watching a file for external changes. Emits file.changed events. */
  watchFile(projectId: string, path: string): Promise<void>;
  /** Stop watching a file for external changes. */
  unwatchFile(projectId: string, path: string): Promise<void>;

  // Filesystem browsing (for directory picker - remote servers only)
  /** Get home directory and common paths from a remote server */
  getRemoteFilesystemHome(serverId: string): Promise<FilesystemHomePaths>;
  /** List directory contents on a remote server */
  listRemoteFilesystem(serverId: string, path: string, showHidden?: boolean): Promise<FilesystemListResult>;
  /** Create a directory on a remote server */
  createRemoteDirectory(serverId: string, parentPath: string, name: string): Promise<string>;

  // Terminal (remote projects only)
  /** List terminal sessions for a project */
  listTerminals(projectId: string): Promise<TerminalSession[]>;
  /** Create a new terminal session */
  createTerminal(projectId: string, options?: TerminalCreateOptions): Promise<TerminalSession>;
  /** Get terminal session info */
  getTerminal(projectId: string, sessionId: string): Promise<TerminalSession | null>;
  /** Delete/kill a terminal session */
  deleteTerminal(projectId: string, sessionId: string): Promise<boolean>;
  /** Resize a terminal session */
  resizeTerminal(projectId: string, sessionId: string, cols: number, rows: number): Promise<boolean>;
  /** Get WebSocket URL for terminal session */
  getTerminalWebSocketUrl(projectId: string, sessionId: string): string | null | Promise<string | null>;

  /**
   * Ask the terminal helper agent to suggest a command.
   * Returns { command, explanation } or null if unavailable.
   */
  askTerminalHelper?(
    projectId: string,
    context: TerminalHelperContext,
  ): Promise<TerminalHelperSuggestion | null>;

  // Worktree operations
  /** Get the diff between a worktree branch and its base branch */
  getWorktreeDiff?(projectId: string, sessionId: string): Promise<WorktreeDiffResult | null>;
  /** Merge a worktree branch back into the base branch */
  mergeWorktree?(projectId: string, sessionId: string): Promise<{ success: boolean; message: string }>;
  /** Discard a worktree (remove the worktree and branch without merging) */
  discardWorktree?(projectId: string, sessionId: string): Promise<{ success: boolean; message: string }>;

  // Docker operations
  /** Get Docker availability status (for remote servers) */
  getDockerStatus?(serverId: string): Promise<DockerStatus>;
  /** Get Docker container info for a project */
  getDockerContainer?(projectId: string): Promise<DockerContainerInfo | null>;
  /** Build the agent Docker image on a remote server */
  buildDockerImage?(serverId: string): Promise<{ success: boolean; error?: string }>;

  // Settings
  getProjectsDirectory(): Promise<string | null>;
  setProjectsDirectory(path: string): Promise<void>;

  // Tools
  getToolsInfo(projectId: string): Promise<ToolInfo[]>;
  getDisabledTools(projectId: string): Promise<string[]>;
  setDisabledTools(projectId: string, tools: string[]): Promise<void>;
  disableTool(projectId: string, toolName: string): Promise<void>;
  enableTool(projectId: string, toolName: string): Promise<void>;

  // Agent Types (subagent presets)
  getAgentTypes(projectId: string): Promise<AgentTypeInfo[]>;
  getAgentTypeConflicts(projectId: string): Promise<AgentTypeConflictInfo[]>;
  setAgentTypeEnabled(projectId: string, name: string, enabled: boolean): Promise<void>;

  // Plugins
  /** List installed plugins for a project (or local agent) */
  getPlugins(projectId: string): Promise<PluginListResult>;
  /** Install a plugin from npm */
  installPlugin(projectId: string, packageSpec: string): Promise<PluginInstallResult>;
  /** Uninstall a plugin package */
  uninstallPlugin(projectId: string, packageName: string): Promise<PluginUninstallResult>;

  // Token usage
  getTokenUsage(projectId: string): Promise<{
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    estimatedCost: number;
    requestCount: number;
  } | null>;

  // Context window usage
  getContextUsage(projectId: string): Promise<{
    currentTokens: number;
    maxTokens: number;
    model: string;
  } | null>;

  // Search (across all projects)
  searchSessions(options: SearchOptions): Promise<SearchResult[]>;

  // Director agent
  /** List Director sessions */
  directorListSessions(): Promise<Session[]>;
  /** Create a new Director session */
  directorCreateSession(title?: string): Promise<Session>;
  /** Delete a Director session */
  directorDeleteSession(sessionId: string): Promise<void>;
  /** Get messages for a Director session */
  directorGetMessages(sessionId: string): Promise<Message[]>;
  /** Get paginated messages for a Director session */
  directorGetMessagesPaginated(
    sessionId: string,
    limit: number,
    beforeSequence?: number
  ): Promise<{ messages: Message[]; hasMore: boolean }>;
  /** Send a message in a Director session */
  directorSendMessage(sessionId: string, content: string): Promise<void>;
  /** Cancel the current Director message */
  directorCancelMessage(sessionId: string): Promise<void>;
  /** Subscribe to Director agent events */
  directorSubscribeToEvents(
    callback: (event: AgentEvent) => void
  ): () => void;
  /** Respond to a permission request from the Director agent */
  directorRespondToPermission(
    sessionId: string,
    toolCallId: string,
    response: PermissionResponse
  ): Promise<void>;
  /** Respond to a question from the Director agent */
  directorRespondToQuestion(
    sessionId: string,
    questionId: string,
    response: { selected: string[]; freeformText?: string }
  ): Promise<void>;

  // Channels (remote servers only)
  /** List all channels for a remote server */
  listChannels(serverId: string): Promise<Channel[]>;
  /** Get a specific channel */
  getChannel(serverId: string, channelId: string): Promise<Channel>;
  /** Update channel settings (name, enabled) */
  updateChannel(
    serverId: string,
    channelId: string,
    updates: { name?: string; enabled?: boolean }
  ): Promise<Channel>;
  /** List bindings for a channel */
  listChannelBindings(serverId: string, channelId: string): Promise<ChannelProjectBinding[]>;
  /** Update a binding */
  updateChannelBinding(
    serverId: string,
    channelId: string,
    bindingId: string,
    updates: { enabled?: boolean; priority?: number; triggerConfig?: TriggerConfig; responseConfig?: ResponseConfig }
  ): Promise<ChannelProjectBinding>;
}

// Declare global window type for Electron preload
declare global {
  interface Window {
    agentBridge?: AgentBridge;
  }
}
