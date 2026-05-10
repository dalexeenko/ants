/**
 * LocalDockerService — manages Docker containers for local desktop projects.
 *
 * Uses the shared @ants/agent-docker DockerManager to:
 * - Check Docker availability
 * - Auto-pull the agent image (with progress reporting)
 * - Start/stop containers for local project agents
 *
 * Containers use HTTP/SSE to communicate with the desktop, same protocol
 * as remote agents. Each container runs `ants-agent serve` and
 * mounts the project directory at /workspace.
 */

import { DockerManager } from '@ants/agent-docker';
import type { DockerStatus, DockerContainerInfo, DockerConfig, PullProgress } from '@ants/agent-docker';
import { createLogger } from '@ants/ui';

const log = createLogger('LocalDocker');

export class LocalDockerService {
  private docker: DockerManager;
  private initialized = false;
  private _status: DockerStatus | null = null;
  private _imageReady = false;

  /** Next available port for container mapping */
  private nextPort = 13100;
  private usedPorts = new Set<number>();

  constructor() {
    this.docker = new DockerManager(log);
  }

  /**
   * Initialize the service — check Docker availability.
   * Safe to call multiple times (caches result).
   */
  async initialize(): Promise<DockerStatus> {
    if (this._status) return this._status;

    this._status = await this.docker.checkAvailability();
    this.initialized = true;

    if (this._status.available) {
      log.info(`Docker available: v${this._status.version}`);
    } else {
      log.info('Docker not available:', this._status.error || 'not installed');
    }

    return this._status;
  }

  /**
   * Get the cached Docker status, or initialize if not yet done.
   */
  async getStatus(): Promise<DockerStatus> {
    if (!this._status) {
      return this.initialize();
    }
    return this._status;
  }

  /**
   * Whether Docker is available and initialized.
   */
  get available(): boolean {
    return this._status?.available ?? false;
  }

  /**
   * Whether the agent image has been confirmed present.
   */
  get imageReady(): boolean {
    return this._imageReady;
  }

  /**
   * Ensure the agent image is available locally.
   * Tries to pull automatically with progress reporting.
   *
   * @param onProgress — called with pull progress updates
   * @returns true if image is ready, false if pull failed
   */
  async ensureImage(onProgress?: (progress: PullProgress) => void): Promise<boolean> {
    if (this._imageReady) return true;
    if (!this.available) return false;

    try {
      // Check if image already exists
      const exists = await this.docker.imageExists();
      if (exists) {
        this._imageReady = true;
        log.info('Agent image already present');
        return true;
      }

      // Try to pull
      log.info('Pulling agent image...');
      const { image } = await this.docker.resolveAgentImage();
      await this.docker.pullImage(image, onProgress);
      this._imageReady = true;
      log.info('Agent image pulled successfully');
      return true;
    } catch (e) {
      log.error('Failed to ensure agent image:', e);
      return false;
    }
  }

  /**
   * Start a container for a local project.
   *
   * @param workingDirectory — project directory to mount
   * @param config — optional Docker config overrides
   * @param envVars — environment variables (API keys, etc.)
   * @returns container info including the host port
   */
  async startContainer(
    workingDirectory: string,
    config?: DockerConfig,
    envVars?: Record<string, string>,
  ): Promise<DockerContainerInfo> {
    if (!this.available) {
      throw new Error('Docker is not available');
    }

    const port = this.allocatePort();
    try {
      const info = await this.docker.startContainer(workingDirectory, port, config, envVars);
      this.usedPorts.add(port);
      return info;
    } catch (e) {
      // Free the port on failure
      this.usedPorts.delete(port);
      throw e;
    }
  }

  /**
   * Stop a container for a project.
   */
  async stopContainer(workingDirectory: string): Promise<void> {
    const stats = await this.docker.getContainerStats(workingDirectory);
    if (stats?.port) {
      this.usedPorts.delete(stats.port);
    }
    await this.docker.stopContainer(workingDirectory);
  }

  /**
   * Get container stats for a project.
   */
  async getContainerStats(workingDirectory: string): Promise<DockerContainerInfo | null> {
    return this.docker.getContainerStats(workingDirectory);
  }

  /**
   * Shut down all containers managed by this service.
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down local Docker service');
    await this.docker.shutdown();
    this.usedPorts.clear();
  }

  // ── Port allocation ──────────────────────────────────────────────

  private allocatePort(): number {
    let port = this.nextPort;
    while (this.usedPorts.has(port)) {
      port++;
    }
    this.nextPort = port + 1;
    return port;
  }
}
