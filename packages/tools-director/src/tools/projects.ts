import { z } from "zod";
import { defineTool } from "@openmgr/agent-core";
import { getDirectorContext } from "../context.js";

export const listProjectsTool = defineTool({
  name: "director_list_projects",
  description:
    "List all projects configured in OpenMgr, including their name, path, type (local/remote), provider, model, and other configuration details.",
  parameters: z.object({}),
  async execute(_params, ctx) {
    const director = getDirectorContext(ctx.extensions);
    if (!director) {
      return { output: "Director context not available." };
    }

    const projects = await director.listProjects();
    if (projects.length === 0) {
      return {
        output: "No projects configured. Use director_create_project to add one.",
      };
    }

    const formatted = projects.map((p) => ({
      id: p.id,
      name: p.name,
      path: p.path,
      type: p.providerType,
      server: p.remoteServerName || undefined,
      provider: p.provider || "not set",
      model: p.model || "not set",
      customInstructions: p.customInstructions ? "yes" : "no",
      docker: p.dockerEnabled ? "enabled" : "disabled",
    }));

    return {
      output: JSON.stringify(formatted, null, 2),
      metadata: { count: projects.length },
    };
  },
});

export const createProjectTool = defineTool({
  name: "director_create_project",
  description: `Create a new project in OpenMgr. Projects can be local (run on this machine) or remote (run on a remote OpenMgr server).

For local projects, you can either:
- Provide an explicit filesystem path to the project directory
- Omit the path and set useDefaultDirectory to true — the project will be created in the default projects directory (e.g., "<Documents>/OpenMgr Projects/<project-name>"), and the directory will be created automatically if it does not exist

For remote projects, also provide the remoteServerId of an existing remote server.`,
  parameters: z.object({
    name: z.string().describe("Display name for the project"),
    path: z
      .string()
      .optional()
      .describe(
        "Filesystem path to the project directory (e.g., /Users/me/my-project). Optional if useDefaultDirectory is true."
      ),
    useDefaultDirectory: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "When true and no path is provided, automatically create the project in the default projects directory using a folder name derived from the project name."
      ),
    providerType: z
      .enum(["local", "remote"])
      .default("local")
      .describe("Whether to run the agent locally or on a remote server"),
    remoteServerId: z
      .string()
      .optional()
      .describe(
        "ID of the remote server to use (required when providerType is 'remote')"
      ),
  }),
  async execute(params, ctx) {
    const director = getDirectorContext(ctx.extensions);
    if (!director) {
      return { output: "Director context not available." };
    }

    if (params.providerType === "remote" && !params.remoteServerId) {
      return {
        output:
          "A remoteServerId is required when creating a remote project. Use director_list_servers to see available servers.",
      };
    }

    // Resolve the project path
    let resolvedPath = params.path;

    if (!resolvedPath && params.useDefaultDirectory) {
      try {
        const defaultDir = await director.getDefaultProjectsDirectory();
        if (!defaultDir) {
          return {
            output:
              "Cannot use default directory: no default projects directory is configured on this platform. Please provide an explicit path.",
          };
        }
        // Derive a safe folder name from the project name
        const safeName = params.name
          .replace(/[^a-zA-Z0-9-_ ]/g, "")
          .replace(/\s+/g, "-")
          .toLowerCase();
        resolvedPath = `${defaultDir}/${safeName}`;

        // Ensure the default projects directory and the project subdirectory exist
        await director.ensureDirectoryExists(defaultDir);
        await director.ensureDirectoryExists(resolvedPath);
      } catch (err) {
        return {
          output: `Failed to set up default directory: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    if (!resolvedPath) {
      return {
        output:
          "A path is required. Either provide a path directly, or set useDefaultDirectory to true to use the default projects directory.",
      };
    }

    try {
      const project = await director.createProject({
        name: params.name,
        path: resolvedPath,
        providerType: params.providerType ?? "local",
        remoteServerId: params.remoteServerId,
      });

      return {
        output: `Project "${project.name}" created successfully (ID: ${project.id}, type: ${project.providerType}, path: ${project.path}).`,
        metadata: { projectId: project.id },
      };
    } catch (err) {
      return {
        output: `Failed to create project: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

export const updateProjectTool = defineTool({
  name: "director_update_project",
  description: `Update settings for an existing project. You can change the project name, LLM provider, model, custom instructions, and root agent type.

Use director_list_projects first to get the project ID.`,
  parameters: z.object({
    projectId: z.string().describe("ID of the project to update"),
    name: z.string().optional().describe("New display name"),
    provider: z
      .string()
      .optional()
      .describe(
        "LLM provider (e.g., 'anthropic', 'openai', 'google', 'openrouter', 'groq', 'xai')"
      ),
    model: z
      .string()
      .optional()
      .describe("Model name (e.g., 'claude-sonnet-4-20250514', 'gpt-4o')"),
    customInstructions: z
      .string()
      .optional()
      .describe("Custom system prompt instructions to append to the agent's prompt"),
    rootAgentType: z
      .string()
      .optional()
      .describe("Root agent type preset to use (e.g., 'general-code')"),
  }),
  async execute(params, ctx) {
    const director = getDirectorContext(ctx.extensions);
    if (!director) {
      return { output: "Director context not available." };
    }

    const { projectId, ...updates } = params;
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );

    if (Object.keys(cleanUpdates).length === 0) {
      return { output: "No updates provided. Specify at least one field to update." };
    }

    try {
      await director.updateProject(projectId, cleanUpdates);
      return {
        output: `Project updated successfully. Changed: ${Object.keys(cleanUpdates).join(", ")}.`,
      };
    } catch (err) {
      return {
        output: `Failed to update project: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

export const removeProjectTool = defineTool({
  name: "director_remove_project",
  description:
    "Remove a project from OpenMgr. This does NOT delete any files on disk — it only removes the project from the app's configuration. Use director_list_projects first to get the project ID.",
  parameters: z.object({
    projectId: z.string().describe("ID of the project to remove"),
  }),
  async execute(params, ctx) {
    const director = getDirectorContext(ctx.extensions);
    if (!director) {
      return { output: "Director context not available." };
    }

    try {
      await director.removeProject(params.projectId);
      return {
        output:
          "Project removed from OpenMgr. No files were deleted from disk.",
      };
    } catch (err) {
      return {
        output: `Failed to remove project: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

export const projectTools = [
  listProjectsTool,
  createProjectTool,
  updateProjectTool,
  removeProjectTool,
];
