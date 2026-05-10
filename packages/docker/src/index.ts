/**
 * @ants/agent-docker
 *
 * Docker container management for Ants agents.
 *
 * Provides the DockerManager class for managing Docker containers used to
 * sandbox agent sessions. Shared between the server and desktop app.
 *
 * @example
 * ```ts
 * import { DockerManager } from "@ants/agent-docker";
 *
 * const docker = new DockerManager(myLogger);
 * const status = await docker.checkAvailability();
 * if (status.available) {
 *   const image = await docker.resolveAgentImage();
 *   console.log(`Using image: ${image.image} (${image.source})`);
 * }
 * ```
 */

// Manager
export {
  DockerManager,
  DEFAULT_AGENT_IMAGE,
  CONTAINER_WORKSPACE_PATH,
  CONTAINER_AGENT_PORT,
} from './docker-manager.js';

// Types
export type {
  DockerConfig,
  DockerContainerInfo,
  DockerStatus,
  ImageSource,
  AgentImageInfo,
  PullProgress,
  DockerLogger,
} from './types.js';
