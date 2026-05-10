/**
 * Project configuration model
 */

export interface McpServerConfig {
  name: string;
  type: 'local' | 'remote';
  command?: string[];
  url?: string;
  enabled?: boolean;
}

/** Docker configuration for running agent sessions in containers */
export interface ProjectDockerConfig {
  /** Enable Docker for this project's agent sessions */
  enabled: boolean;
  /** Custom Docker image (defaults to ants-agent:latest) */
  image?: string;
  /** Extra volume mounts (host:container) */
  volumes?: string[];
  /** Extra environment variables */
  env?: Record<string, string>;
  /** Docker network to attach to */
  network?: string;
  /** Resource limits */
  resources?: {
    /** CPU limit (e.g., "2.0" for 2 cores) */
    cpus?: string;
    /** Memory limit (e.g., "4g" for 4 GB) */
    memory?: string;
  };
}

export interface AgentConfig {
  provider?: string;
  model?: string;
  systemPrompt?: string;
  mcp?: Record<string, McpServerConfig>;
  /** Docker configuration for sandboxed execution */
  docker?: ProjectDockerConfig;
  /** Default session mode for new sessions */
  defaultMode?: 'plan' | 'build';
  /** Maximum number of auto-complete loops per session */
  maxAutoCompleteLoops?: number;
  [key: string]: unknown;
}

export interface ProjectConfig {
  id: string;
  name: string;
  workingDirectory: string;
  autoStart?: boolean;
  defaultModel?: string;
  /** Whether worktree support is enabled for this project */
  worktreeEnabled?: boolean;
  /** Whether the project directory is a git repository (computed, not stored) */
  isGitRepo?: boolean;
  createdAt: string;
  updatedAt?: string;
  
  // Agent server state (managed by server)
  serverPort?: number;
  serverPid?: number;
  
  // Agent config (written to workingDirectory/.ants.json)
  agentConfig?: AgentConfig;
}

export interface CreateProjectRequest {
  name: string;
  workingDirectory?: string;
  autoStart?: boolean;
  defaultModel?: string;
  defaultMode?: 'plan' | 'build';
  maxAutoCompleteLoops?: number;
  agentConfig?: AgentConfig;
}

export interface UpdateProjectRequest {
  name?: string;
  autoStart?: boolean;
  defaultModel?: string;
  defaultMode?: 'plan' | 'build';
  maxAutoCompleteLoops?: number;
  worktreeEnabled?: boolean;
  agentConfig?: AgentConfig;
}
