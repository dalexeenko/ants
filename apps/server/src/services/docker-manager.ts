/**
 * Re-exports from @openmgr/agent-docker.
 *
 * The DockerManager implementation has been extracted into the shared
 * @openmgr/agent-docker package so it can be used by both the server
 * and the desktop app. This file re-exports everything for backwards
 * compatibility with existing server imports.
 */

export {
  DockerManager,
  DEFAULT_AGENT_IMAGE,
  CONTAINER_WORKSPACE_PATH,
  CONTAINER_AGENT_PORT,
} from '@openmgr/agent-docker';

export type {
  DockerConfig,
  DockerContainerInfo,
  DockerStatus,
  ImageSource,
  AgentImageInfo,
  PullProgress,
  DockerLogger,
} from '@openmgr/agent-docker';
