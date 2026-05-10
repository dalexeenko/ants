/**
 * DirectorContext - The interface that platform layers (desktop/mobile bridge)
 * must implement to give the Director agent access to app configuration.
 *
 * Tools in this plugin retrieve the context from `ctx.extensions['director.context']`
 * and call these methods to interact with the app.
 */

// ============================================================================
// Shared Types
// ============================================================================

export interface DirectorProject {
  id: string;
  name: string;
  path: string;
  providerType: "local" | "remote";
  remoteServerId?: string;
  remoteServerName?: string;
  /** Current model config if available */
  provider?: string;
  model?: string;
  customInstructions?: string;
  rootAgentType?: string;
  dockerEnabled?: boolean;
}

export interface DirectorSession {
  id: string;
  title: string;
  projectId: string;
  projectName?: string;
  createdAt: number;
  updatedAt?: number;
  messageCount?: number;
}

export interface DirectorServer {
  id: string;
  name: string;
  url: string;
  authType?: string;
  connected: boolean;
  lastSeen?: number;
}

export interface DirectorAuthStatus {
  local: {
    anthropic: { authenticated: boolean; method: "oauth" | "api" | null };
    openai: { hasApiKey: boolean };
    google: { hasApiKey: boolean };
    openrouter: { hasApiKey: boolean };
    groq: { hasApiKey: boolean };
    xai: { hasApiKey: boolean };
  };
  servers: Array<{
    serverId: string;
    serverName: string;
    providers: Array<{
      id: string;
      name: string;
      configured: boolean;
    }>;
  }>;
}

export interface DirectorDockerStatus {
  available: boolean;
  version?: string;
  platform?: string;
  insideDocker?: boolean;
  agentImageBuilt?: boolean;
}

export interface DirectorSystemInfo {
  agentVersion?: string;
  uptime?: number;
  memoryUsage?: { rss: number; heapUsed: number; heapTotal: number };
  nodeVersion?: string;
  platform?: string;
  dockerStatus?: DirectorDockerStatus;
}

export interface DirectorAppSettings {
  theme: "light" | "dark" | "system";
}

export interface NavigationTarget {
  type:
    | "project"
    | "session"
    | "settings"
    | "projectSettings"
    | "serverSettings"
    | "agents"
    | "director";
  projectId?: string;
  sessionId?: string;
  serverId?: string;
}

export interface DirectorDirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface CreateProjectOptions {
  name: string;
  path: string;
  providerType: "local" | "remote";
  remoteServerId?: string;
}

export interface UpdateProjectOptions {
  name?: string;
  provider?: string;
  model?: string;
  customInstructions?: string;
  rootAgentType?: string;
}

export interface CreateSessionOptions {
  title?: string;
}

export interface AddServerOptions {
  name: string;
  url: string;
  token?: string;
  authType?: string;
}

export interface UpdateServerOptions {
  name?: string;
  url?: string;
  token?: string;
}

export interface DockerConfigOptions {
  enabled: boolean;
  image?: string;
  cpus?: string;
  memory?: string;
}

export interface TestServerResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}

export interface DirectorModelInfo {
  id: string;
  name: string;
  provider: string;
  providerName?: string;
  contextLength?: number;
  description?: string;
}

// ============================================================================
// Director Context Interface
// ============================================================================

export interface DirectorContext {
  // Projects
  listProjects(): Promise<DirectorProject[]>;
  createProject(opts: CreateProjectOptions): Promise<DirectorProject>;
  updateProject(projectId: string, updates: UpdateProjectOptions): Promise<void>;
  removeProject(projectId: string): Promise<void>;

  // Sessions
  listSessions(projectId: string): Promise<DirectorSession[]>;
  createSession(
    projectId: string,
    opts?: CreateSessionOptions
  ): Promise<DirectorSession>;
  deleteSession(projectId: string, sessionId: string): Promise<void>;

  // Remote Servers
  listServers(): Promise<DirectorServer[]>;
  addServer(opts: AddServerOptions): Promise<DirectorServer>;
  updateServer(serverId: string, updates: UpdateServerOptions): Promise<void>;
  removeServer(serverId: string): Promise<void>;
  testServer(
    serverIdOrConfig: string | { url: string; token?: string }
  ): Promise<TestServerResult>;

  // Auth
  getAuthStatus(): Promise<DirectorAuthStatus>;
  setApiKey(
    provider: string,
    key: string,
    serverId?: string
  ): Promise<void>;
  deleteApiKey(provider: string, serverId?: string): Promise<void>;

  // Models
  listModels(projectId?: string): Promise<DirectorModelInfo[]>;

  // Docker
  getDockerStatus(serverId: string): Promise<DirectorDockerStatus>;
  updateDockerConfig(
    projectId: string,
    config: DockerConfigOptions
  ): Promise<void>;

  // Settings
  getSettings(): Promise<DirectorAppSettings>;
  setTheme(mode: "light" | "dark" | "system"): Promise<void>;

  // Navigation
  navigate(target: NavigationTarget): Promise<void>;

  // System Info
  getSystemInfo(serverId?: string): Promise<DirectorSystemInfo>;

  // Filesystem browsing
  getDefaultProjectsDirectory(): Promise<string | null>;
  listDirectory(path: string): Promise<DirectorDirectoryEntry[]>;
  ensureDirectoryExists(path: string): Promise<void>;
}

/**
 * Extension key used to store the DirectorContext on the agent.
 * Usage: agent.setExtension(DIRECTOR_CONTEXT_KEY, myContext)
 */
export const DIRECTOR_CONTEXT_KEY = "director.context";

/**
 * Helper to retrieve the DirectorContext from a ToolContext.
 */
export function getDirectorContext(
  extensions: Record<string, unknown>
): DirectorContext | undefined {
  return extensions[DIRECTOR_CONTEXT_KEY] as DirectorContext | undefined;
}
