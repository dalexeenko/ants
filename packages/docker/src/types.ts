/**
 * Types for Docker container management.
 */

/** Docker config stored per-project */
export interface DockerConfig {
  /** Enable Docker for this project's agent sessions */
  enabled: boolean;
  /** Custom Docker image (overrides the resolved server image) */
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

/** Status of a Docker container running an agent */
export interface DockerContainerInfo {
  containerId: string;
  containerName: string;
  status: 'created' | 'running' | 'paused' | 'exited' | 'dead' | 'unknown';
  port: number;
  workingDirectory: string;
  image: string;
  createdAt?: string;
  /** Resource usage (if available) */
  stats?: {
    cpuPercent?: string;
    memoryUsage?: string;
    memoryLimit?: string;
  };
}

/** Docker availability status */
export interface DockerStatus {
  available: boolean;
  version?: string;
  error?: string;
  /** Whether we're running inside a Docker container ourselves */
  insideDocker: boolean;
  /** Whether docker-in-docker is available */
  dindAvailable: boolean;
}

/** How the agent image was resolved */
export type ImageSource = 'env' | 'introspection' | 'default';

/** Resolved agent image info */
export interface AgentImageInfo {
  image: string;
  source: ImageSource;
}

/** Progress callback for image pull operations */
export interface PullProgress {
  /** Overall status message */
  status: string;
  /** Progress percentage (0-100), or undefined if indeterminate */
  percent?: number;
  /** Whether the pull is complete */
  complete: boolean;
  /** Error message if pull failed */
  error?: string;
}

/** Logger interface — injectable so consumers can provide their own logger */
export interface DockerLogger {
  info(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}
