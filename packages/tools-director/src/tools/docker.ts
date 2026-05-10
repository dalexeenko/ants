import { z } from "zod";
import { defineTool } from "@ants/agent-core";
import { getDirectorContext } from "../context.js";

export const getDockerStatusTool = defineTool({
  name: "director_get_docker_status",
  description: `Check Docker availability and status on a remote server. Docker is used for sandboxed agent execution and is only available on remote servers.

Returns whether Docker is installed, its version, platform info, and whether the Ants agent image has been built.`,
  parameters: z.object({
    serverId: z
      .string()
      .describe("ID of the remote server to check Docker status on"),
  }),
  async execute(params, ctx) {
    const director = getDirectorContext(ctx.extensions);
    if (!director) {
      return { output: "Director context not available." };
    }

    try {
      const status = await director.getDockerStatus(params.serverId);

      const lines: string[] = [];
      lines.push(`Docker available: ${status.available ? "yes" : "no"}`);
      if (status.version) lines.push(`Version: ${status.version}`);
      if (status.platform) lines.push(`Platform: ${status.platform}`);
      if (status.insideDocker !== undefined) {
        lines.push(
          `Running inside Docker: ${status.insideDocker ? "yes" : "no"}`
        );
      }
      if (status.agentImageBuilt !== undefined) {
        lines.push(
          `Agent image built: ${status.agentImageBuilt ? "yes" : "no"}`
        );
      }

      if (!status.available) {
        lines.push(
          "\nDocker is not available on this server. To install Docker:"
        );
        lines.push("- macOS: Install Docker Desktop from docker.com");
        lines.push(
          "- Linux: Run `curl -fsSL https://get.docker.com | sh`"
        );
        lines.push(
          "- Windows: Install Docker Desktop with WSL2 backend"
        );
      }

      return { output: lines.join("\n") };
    } catch (err) {
      return {
        output: `Failed to get Docker status: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

export const updateDockerConfigTool = defineTool({
  name: "director_update_docker_config",
  description: `Enable or configure Docker sandboxing for a remote project. When enabled, agent sessions run inside Docker containers for isolation.

Docker must be available on the server (use director_get_docker_status to check).`,
  parameters: z.object({
    projectId: z
      .string()
      .describe("ID of the project to configure Docker for"),
    enabled: z.boolean().describe("Whether to enable Docker sandboxing"),
    image: z
      .string()
      .optional()
      .describe("Custom Docker image (defaults to the built-in Ants agent image)"),
    cpus: z
      .string()
      .optional()
      .describe("CPU limit (e.g., '2.0' for 2 CPUs)"),
    memory: z
      .string()
      .optional()
      .describe("Memory limit (e.g., '4g' for 4 GB)"),
  }),
  async execute(params, ctx) {
    const director = getDirectorContext(ctx.extensions);
    if (!director) {
      return { output: "Director context not available." };
    }

    try {
      await director.updateDockerConfig(params.projectId, {
        enabled: params.enabled,
        image: params.image,
        cpus: params.cpus,
        memory: params.memory,
      });

      if (params.enabled) {
        const details: string[] = ["Docker sandboxing enabled."];
        if (params.image) details.push(`Image: ${params.image}`);
        if (params.cpus) details.push(`CPU limit: ${params.cpus}`);
        if (params.memory) details.push(`Memory limit: ${params.memory}`);
        return { output: details.join(" ") };
      } else {
        return { output: "Docker sandboxing disabled for this project." };
      }
    } catch (err) {
      return {
        output: `Failed to update Docker config: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

export const dockerTools = [getDockerStatusTool, updateDockerConfigTool];
