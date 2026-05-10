/**
 * DockerManager — manages Docker containers for sandboxed agent sessions.
 *
 * Handles Docker availability detection, agent image resolution, container
 * lifecycle (create/start/stop/remove), volume mounting, and port forwarding.
 *
 * The server Docker image includes the ants-agent CLI, so agent containers
 * run the same image with a different entrypoint (`ants-agent serve`).
 * No separate agent image build step is needed.
 *
 * Image resolution order:
 *   1. ANTS_IMAGE env var (set via Dockerfile IMAGE_TAG build arg)
 *   2. Docker socket self-introspection (when running inside Docker)
 *   3. Fallback to "ants/server:latest" (bare-metal / local dev)
 *      TODO: in the future, default to the matching release version
 */

import { execFile, type ChildProcess } from 'child_process';
import { readFile, access } from 'fs/promises';
import { hostname } from 'os';
import { promisify } from 'util';

import type {
  DockerConfig,
  DockerContainerInfo,
  DockerStatus,
  AgentImageInfo,
  DockerLogger,
  PullProgress,
} from './types.js';

const execFileAsync = promisify(execFile);

/** No-op logger used when no logger is provided */
const nullLogger: DockerLogger = {
  info() {},
  debug() {},
  warn() {},
  error() {},
};

/** Async check if a path exists */
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export const DEFAULT_AGENT_IMAGE = 'ants/server:latest';
export const CONTAINER_WORKSPACE_PATH = '/workspace';
export const CONTAINER_AGENT_PORT = 3000;

export class DockerManager {
  private containers: Map<string, DockerContainerInfo> = new Map();
  private dockerAvailable: boolean | null = null;
  private dockerVersion: string | null = null;
  private resolvedImage: AgentImageInfo | null = null;
  private log: DockerLogger;

  constructor(logger?: DockerLogger) {
    this.log = logger ?? nullLogger;
  }

  /**
   * Check if Docker is available on this system.
   */
  async checkAvailability(): Promise<DockerStatus> {
    const insideDocker = await this.isRunningInsideDocker();
    let dindAvailable = false;

    try {
      const { stdout } = await execFileAsync('docker', ['version', '--format', '{{.Server.Version}}'], {
        timeout: 10_000,
      });
      const version = stdout.trim();

      this.dockerAvailable = true;
      this.dockerVersion = version;

      // If we're inside Docker, check for DinD
      if (insideDocker) {
        dindAvailable = await this.checkDindAvailable();
      }

      return {
        available: true,
        version,
        insideDocker,
        dindAvailable,
      };
    } catch (error) {
      this.dockerAvailable = false;
      this.dockerVersion = null;

      return {
        available: false,
        error: error instanceof Error ? error.message : 'Docker not found',
        insideDocker,
        dindAvailable: false,
      };
    }
  }

  /**
   * Check if we're running inside a Docker container.
   */
  async isRunningInsideDocker(): Promise<boolean> {
    // Check for .dockerenv file
    if (await pathExists('/.dockerenv')) {
      return true;
    }

    // Check cgroup for docker/containerd references (cgroup v1 and v2)

    // cgroup v1: /proc/1/cgroup contains docker/containerd references
    try {
      const cgroup = await readFile('/proc/1/cgroup', 'utf-8');
      if (cgroup.includes('docker') || cgroup.includes('containerd')) {
        return true;
      }
    } catch {
      // /proc/1/cgroup may not exist (cgroup v2 only systems)
    }

    // cgroup v2: /proc/self/mountinfo may reference docker overlay
    try {
      const mountinfo = await readFile('/proc/self/mountinfo', 'utf-8');
      if (mountinfo.includes('/docker/') || mountinfo.includes('/containerd/')) {
        return true;
      }
    } catch {
      // /proc/self/mountinfo may not exist
    }

    return false;
  }

  /**
   * Check if docker-in-docker is available (socket mount or DinD sidecar).
   */
  private async checkDindAvailable(): Promise<boolean> {
    // Check for Docker socket mount
    if (await pathExists('/var/run/docker.sock')) {
      try {
        await execFileAsync('docker', ['info'], { timeout: 5_000 });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * Get cached Docker availability status.
   */
  isAvailable(): boolean {
    return this.dockerAvailable === true;
  }

  /**
   * Resolve the Docker image to use for agent containers.
   *
   * Resolution order:
   *   1. ANTS_IMAGE env var (set by Dockerfile IMAGE_TAG build arg, or at runtime)
   *   2. Docker self-introspection (when running inside Docker with socket access)
   *   3. Fallback to "ants/server:latest" (bare-metal / local dev)
   *
   * Results are cached after the first call.
   */
  async resolveAgentImage(): Promise<AgentImageInfo> {
    if (this.resolvedImage) {
      return this.resolvedImage;
    }

    // 1. Check ANTS_IMAGE env var
    const envImage = process.env.ANTS_IMAGE;
    if (envImage) {
      this.log.info(`Agent image resolved from ANTS_IMAGE env var: ${envImage}`);
      this.resolvedImage = { image: envImage, source: 'env' };
      return this.resolvedImage;
    }

    // 2. Try Docker self-introspection (only if we're inside Docker)
    if (await this.isRunningInsideDocker()) {
      const introspected = await this.introspectOwnImage();
      if (introspected) {
        this.log.info(`Agent image resolved via Docker introspection: ${introspected}`);
        this.resolvedImage = { image: introspected, source: 'introspection' };
        return this.resolvedImage;
      }
    }

    // 3. Fallback to default
    // TODO: In the future, default to the matching release version (e.g. ants/server:v0.1.0)
    this.log.info(`Agent image using default: ${DEFAULT_AGENT_IMAGE}`);
    this.resolvedImage = { image: DEFAULT_AGENT_IMAGE, source: 'default' };
    return this.resolvedImage;
  }

  /**
   * Introspect the Docker image we're running in by querying the Docker socket.
   *
   * Reads our container ID from /proc/self/cgroup (v1) or /proc/self/mountinfo (v2),
   * then uses `docker inspect` to get the image name.
   *
   * Returns the image name/tag/digest, or null if introspection fails.
   */
  private async introspectOwnImage(): Promise<string | null> {
    try {
      const containerId = await this.getOwnContainerId();
      if (!containerId) {
        this.log.debug('Could not determine own container ID for introspection');
        return null;
      }

      this.log.debug(`Introspecting container ID: ${containerId}`);

      const { stdout } = await execFileAsync(
        'docker',
        ['inspect', '--format', '{{.Config.Image}}', containerId],
        { timeout: 5_000 },
      );

      const image = stdout.trim();
      if (!image) {
        return null;
      }

      return image;
    } catch (error) {
      this.log.debug('Docker self-introspection failed:', error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /**
   * Get the container ID of this process.
   *
   * Tries multiple methods to support both cgroup v1 and v2:
   *   - /proc/self/cgroup (v1): contains lines like "12:name=systemd:/docker/<id>"
   *   - /proc/self/mountinfo (v2): contains overlay mount with docker container ID
   *   - hostname: Docker sets hostname to the short container ID by default
   */
  private async getOwnContainerId(): Promise<string | null> {
    // Method 1: Parse /proc/self/cgroup (cgroup v1)
    try {
      const cgroup = await readFile('/proc/self/cgroup', 'utf-8');
      for (const line of cgroup.split('\n')) {
        // Match docker container IDs in cgroup paths
        const match = line.match(/\/docker\/([a-f0-9]{64})/);
        if (match?.[1]) {
          return match[1];
        }
        // Also match containerd-managed containers
        const containerdMatch = line.match(/\/containerd\/([a-f0-9]{64})/);
        if (containerdMatch?.[1]) {
          return containerdMatch[1];
        }
      }
    } catch {
      // /proc/self/cgroup may not exist
    }

    // Method 2: Parse /proc/self/mountinfo (cgroup v2)
    try {
      const mountinfo = await readFile('/proc/self/mountinfo', 'utf-8');
      for (const line of mountinfo.split('\n')) {
        const match = line.match(/\/docker\/containers\/([a-f0-9]{64})\//);
        if (match?.[1]) {
          return match[1];
        }
      }
    } catch {
      // /proc/self/mountinfo may not exist
    }

    // Method 3: Use hostname (Docker sets it to the short container ID by default)
    try {
      const host = hostname();
      // Docker short IDs are 12 hex characters
      if (/^[a-f0-9]{12}$/.test(host)) {
        return host;
      }
    } catch {
      // hostname() may fail
    }

    return null;
  }

  /**
   * Start an agent container for a project.
   *
   * Uses the resolved server image with an overridden entrypoint to run
   * `ants-agent serve` instead of the server.
   *
   * @returns The container info including the host port that maps to the agent.
   */
  async startContainer(
    workingDirectory: string,
    hostPort: number,
    config?: DockerConfig,
    envVars?: Record<string, string>,
  ): Promise<DockerContainerInfo> {
    if (!this.dockerAvailable) {
      throw new Error('Docker is not available');
    }

    // Check if container already running for this workingDirectory
    const existing = this.containers.get(workingDirectory);
    if (existing && existing.status === 'running') {
      return existing;
    }

    // Resolve the image: use project-specific override, or the resolved server image
    const { image } = config?.image
      ? { image: config.image }
      : await this.resolveAgentImage();

    const containerName = `ants-agent-${hostPort}`;

    // Build docker run arguments
    const args: string[] = [
      'run', '-d',
      '--name', containerName,
      '-p', `${hostPort}:${CONTAINER_AGENT_PORT}`,
      '-v', `${workingDirectory}:${CONTAINER_WORKSPACE_PATH}`,
      // Override the entrypoint to run the agent instead of the server
      '--entrypoint', 'ants-agent',
    ];

    // Add extra volumes
    if (config?.volumes) {
      for (const vol of config.volumes) {
        args.push('-v', vol);
      }
    }

    // Add network
    if (config?.network) {
      args.push('--network', config.network);
    }

    // Add resource limits
    if (config?.resources?.cpus) {
      args.push('--cpus', config.resources.cpus);
    }
    if (config?.resources?.memory) {
      args.push('--memory', config.resources.memory);
    }

    // Add environment variables (API keys, etc.)
    if (envVars) {
      for (const [key, value] of Object.entries(envVars)) {
        args.push('-e', `${key}=${value}`);
      }
    }

    // Add extra env from config
    if (config?.env) {
      for (const [key, value] of Object.entries(config.env)) {
        args.push('-e', `${key}=${value}`);
      }
    }

    // Add the image and the command (serve on the container port)
    args.push(image, 'serve', '--port', String(CONTAINER_AGENT_PORT));

    this.log.info(`Starting Docker container: ${containerName} (port ${hostPort})`);
    this.log.debug('Docker args:', args.join(' '));

    try {
      const { stdout } = await execFileAsync('docker', args, {
        timeout: 60_000,
      });
      const containerId = stdout.trim();

      const info: DockerContainerInfo = {
        containerId: containerId.substring(0, 12),
        containerName,
        status: 'running',
        port: hostPort,
        workingDirectory,
        image,
        createdAt: new Date().toISOString(),
      };

      this.containers.set(workingDirectory, info);

      this.log.info(`Container started: ${info.containerId} on port ${hostPort}`);
      return info;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to start container';
      this.log.error('Docker container start failed:', msg);
      throw new Error(`Failed to start Docker container: ${msg}`);
    }
  }

  /**
   * Stop and remove a container for a project.
   */
  async stopContainer(workingDirectory: string): Promise<void> {
    const info = this.containers.get(workingDirectory);
    if (!info) {
      return;
    }

    this.log.info(`Stopping container: ${info.containerName}`);

    try {
      await execFileAsync('docker', ['stop', info.containerName], {
        timeout: 30_000,
      });
    } catch {
      // Container may already be stopped
    }

    try {
      await execFileAsync('docker', ['rm', info.containerName], {
        timeout: 10_000,
      });
    } catch {
      // Container may already be removed
    }

    this.containers.delete(workingDirectory);
  }

  /**
   * Get container info for a project.
   */
  getContainer(workingDirectory: string): DockerContainerInfo | undefined {
    return this.containers.get(workingDirectory);
  }

  /**
   * Get live stats for a running container.
   */
  async getContainerStats(workingDirectory: string): Promise<DockerContainerInfo | null> {
    const info = this.containers.get(workingDirectory);
    if (!info) {
      return null;
    }

    try {
      // Get container status
      const { stdout: statusOutput } = await execFileAsync(
        'docker', ['inspect', '--format={{.State.Status}}', info.containerName],
        { timeout: 5_000 },
      );

      info.status = statusOutput.trim() as DockerContainerInfo['status'];

      // Get resource usage if running
      if (info.status === 'running') {
        try {
          const { stdout: statsOutput } = await execFileAsync(
            'docker', ['stats', '--no-stream', '--format={{.CPUPerc}},{{.MemUsage}}', info.containerName],
            { timeout: 10_000 },
          );

          const [cpuPercent, memUsage] = statsOutput.trim().split(',');
          const [memoryUsage, memoryLimit] = (memUsage || '').split(' / ');

          info.stats = {
            cpuPercent: cpuPercent || undefined,
            memoryUsage: memoryUsage || undefined,
            memoryLimit: memoryLimit || undefined,
          };
        } catch {
          // Stats may not be available
        }
      }

      return info;
    } catch {
      // Container may have been removed
      this.containers.delete(workingDirectory);
      return null;
    }
  }

  /**
   * List all managed containers.
   */
  listContainers(): DockerContainerInfo[] {
    return Array.from(this.containers.values());
  }

  /**
   * Stop and remove all managed containers.
   */
  async shutdown(): Promise<void> {
    const dirs = Array.from(this.containers.keys());
    await Promise.all(dirs.map(dir => this.stopContainer(dir)));
  }

  /**
   * Check if a Docker image exists locally.
   */
  async imageExists(image?: string): Promise<boolean> {
    const targetImage = image || (await this.resolveAgentImage()).image;
    try {
      await execFileAsync('docker', ['image', 'inspect', targetImage], {
        timeout: 10_000,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Pull a Docker image from a registry.
   *
   * This is intended for desktop auto-pull: try to pull the image automatically,
   * reporting progress via a callback, and return success/failure.
   *
   * @param image - The image to pull (defaults to the resolved agent image)
   * @param onProgress - Optional callback for pull progress updates
   * @returns true if the pull succeeded, false if it failed
   */
  async pullImage(
    image?: string,
    onProgress?: (progress: PullProgress) => void,
  ): Promise<boolean> {
    const targetImage = image || (await this.resolveAgentImage()).image;

    this.log.info(`Pulling Docker image: ${targetImage}`);
    onProgress?.({ status: `Pulling ${targetImage}...`, complete: false });

    return new Promise<boolean>((resolve) => {
      const child: ChildProcess = execFile(
        'docker',
        ['pull', targetImage],
        { timeout: 300_000 }, // 5 minute timeout for large images
        (error: Error | null) => {
          if (error) {
            const msg = error.message || 'Pull failed';
            this.log.error(`Failed to pull image ${targetImage}: ${msg}`);
            onProgress?.({
              status: `Failed to pull ${targetImage}`,
              complete: true,
              error: msg,
            });
            resolve(false);
          } else {
            this.log.info(`Successfully pulled image: ${targetImage}`);
            onProgress?.({
              status: `Successfully pulled ${targetImage}`,
              percent: 100,
              complete: true,
            });
            resolve(true);
          }
        },
      );

      // Stream stderr/stdout for progress updates
      // Docker pull outputs progress to stdout
      let lastPercent: number | undefined;

      const handleData = (data: Buffer | string): void => {
        const line = data.toString().trim();
        if (!line) return;

        // Try to extract percentage from Docker pull output
        // Docker outputs lines like: "abc123: Downloading  [====>  ]  12.5MB/100MB"
        const percentMatch = line.match(/(\d+(?:\.\d+)?)%/);
        if (percentMatch) {
          const percent = Math.round(parseFloat(percentMatch[1]!));
          if (percent !== lastPercent) {
            lastPercent = percent;
            onProgress?.({ status: line, percent, complete: false });
          }
        } else if (line.includes('Pulling') || line.includes('Downloading') || line.includes('Extracting')) {
          onProgress?.({ status: line, complete: false });
        }
      };

      child.stdout?.on('data', handleData);
      child.stderr?.on('data', handleData);
    });
  }
}
