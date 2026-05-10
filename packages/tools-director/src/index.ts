/**
 * @openmgr/agent-tools-director
 *
 * Director agent tools for configuring and managing OpenMgr.
 * These tools let the Director agent interact with the app's configuration
 * layer: projects, sessions, remote servers, auth, Docker, settings, and navigation.
 *
 * The platform layer (desktop/mobile bridge) must implement DirectorContext
 * and set it as an agent extension via:
 *   agent.setExtension('director.context', myDirectorContextImpl)
 */

import type { AgentPlugin } from "@openmgr/agent-core";
import { projectTools } from "./tools/projects.js";
import { sessionTools } from "./tools/sessions.js";
import { serverTools } from "./tools/servers.js";
import { authTools } from "./tools/auth.js";
import { dockerTools } from "./tools/docker.js";
import { settingsTools } from "./tools/settings.js";
import { modelTools } from "./tools/models.js";
import { filesystemTools } from "./tools/filesystem.js";
import { DIRECTOR_SYSTEM_PROMPT } from "./prompt.js";

// Re-export context types and helpers
export type {
  DirectorContext,
  DirectorProject,
  DirectorSession,
  DirectorServer,
  DirectorAuthStatus,
  DirectorDockerStatus,
  DirectorSystemInfo,
  DirectorAppSettings,
  DirectorModelInfo,
  DirectorDirectoryEntry,
  NavigationTarget,
  CreateProjectOptions,
  UpdateProjectOptions,
  CreateSessionOptions,
  AddServerOptions,
  UpdateServerOptions,
  DockerConfigOptions,
  TestServerResult,
} from "./context.js";
export { DIRECTOR_CONTEXT_KEY, getDirectorContext } from "./context.js";
export { DIRECTOR_SYSTEM_PROMPT } from "./prompt.js";

/**
 * All Director tools
 */
export const directorTools = [
  ...projectTools,
  ...sessionTools,
  ...serverTools,
  ...authTools,
  ...modelTools,
  ...dockerTools,
  ...settingsTools,
  ...filesystemTools,
];

/**
 * Plugin that registers all Director tools with the agent.
 *
 * Before using, the platform layer must set the DirectorContext extension:
 *   agent.setExtension('director.context', myImpl)
 */
export const directorToolsPlugin: AgentPlugin = {
  name: "@openmgr/agent-tools-director",
  version: "0.1.0",
  tools: directorTools as AgentPlugin["tools"],
};

/**
 * The Director agent type definition.
 * Provides a named preset for creating the Director agent.
 */
export const directorAgentType = {
  name: "director",
  version: "1.0.0",
  description:
    "The Director — a dedicated agent for configuring and managing the OpenMgr app. Handles projects, sessions, servers, auth, Docker, and settings.",
  systemPrompt: DIRECTOR_SYSTEM_PROMPT,
  allowedTools: directorTools.map((t) => t.name),
  deniedTools: [] as string[],
  tags: ["builtin", "meta"],
  source: "builtin" as const,
};

export default directorToolsPlugin;
