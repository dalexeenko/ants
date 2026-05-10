import { z } from "zod";
import { defineTool } from "@openmgr/agent-core";
import { getDirectorContext } from "../context.js";

export const browseDirectoryTool = defineTool({
  name: "director_browse_directory",
  description: `Browse the contents of a directory on the filesystem. Returns a list of files and subdirectories at the given path.

Use this to explore the filesystem when helping users find or choose a directory for a project. If no path is provided, starts at the user's home/default directory.

Each entry includes the name, full path, and whether it is a directory.`,
  parameters: z.object({
    path: z
      .string()
      .optional()
      .describe(
        "Absolute path to the directory to browse. If omitted, lists the default starting directory."
      ),
  }),
  async execute(params, ctx) {
    const director = getDirectorContext(ctx.extensions);
    if (!director) {
      return { output: "Director context not available." };
    }

    try {
      let targetPath = params.path;

      // If no path provided, use the default projects directory or fall back
      if (!targetPath) {
        const defaultDir = await director.getDefaultProjectsDirectory();
        if (defaultDir) {
          // Go up one level to show the parent (so they can see the projects dir)
          const parentPath = defaultDir.substring(
            0,
            defaultDir.lastIndexOf("/")
          );
          targetPath = parentPath || defaultDir;
        } else {
          return {
            output:
              "No path provided and no default directory available. Please provide an absolute path to browse.",
          };
        }
      }

      const entries = await director.listDirectory(targetPath);

      if (entries.length === 0) {
        return {
          output: `Directory "${targetPath}" is empty.`,
          metadata: { path: targetPath, count: 0 },
        };
      }

      // Sort: directories first, then files, alphabetically within each group
      const sorted = [...entries].sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      const formatted = sorted.map((e) => ({
        name: e.name,
        path: e.path,
        type: e.isDirectory ? "directory" : "file",
      }));

      return {
        output: JSON.stringify(
          { path: targetPath, entries: formatted },
          null,
          2
        ),
        metadata: { path: targetPath, count: entries.length },
      };
    } catch (err) {
      return {
        output: `Failed to browse directory: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

export const getDefaultProjectsDirectoryTool = defineTool({
  name: "director_get_default_projects_directory",
  description: `Get the default directory where new projects are created. This is typically "<Documents>/OpenMgr Projects" on desktop or the app's document directory on mobile.

Use this to suggest a default location when the user wants to create a project but hasn't specified a path.`,
  parameters: z.object({}),
  async execute(_params, ctx) {
    const director = getDirectorContext(ctx.extensions);
    if (!director) {
      return { output: "Director context not available." };
    }

    try {
      const defaultDir = await director.getDefaultProjectsDirectory();
      if (defaultDir) {
        return {
          output: JSON.stringify({ defaultProjectsDirectory: defaultDir }),
          metadata: { path: defaultDir },
        };
      } else {
        return {
          output:
            "No default projects directory is configured on this platform. The user will need to specify a path manually.",
        };
      }
    } catch (err) {
      return {
        output: `Failed to get default projects directory: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

export const filesystemTools = [
  browseDirectoryTool,
  getDefaultProjectsDirectoryTool,
];
