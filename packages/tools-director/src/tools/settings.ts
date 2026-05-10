import { z } from "zod";
import { defineTool } from "@ants/agent-core";
import { getDirectorContext } from "../context.js";

export const getSettingsTool = defineTool({
  name: "director_get_settings",
  description:
    "Get the current app settings, including theme configuration.",
  parameters: z.object({}),
  async execute(_params, ctx) {
    const director = getDirectorContext(ctx.extensions);
    if (!director) {
      return { output: "Director context not available." };
    }

    try {
      const settings = await director.getSettings();
      return {
        output: JSON.stringify(
          {
            theme: settings.theme,
          },
          null,
          2
        ),
      };
    } catch (err) {
      return {
        output: `Failed to get settings: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

export const setThemeTool = defineTool({
  name: "director_set_theme",
  description: "Set the app's color theme to light, dark, or system (follows OS preference).",
  parameters: z.object({
    theme: z
      .enum(["light", "dark", "system"])
      .describe("Theme mode to set"),
  }),
  async execute(params, ctx) {
    const director = getDirectorContext(ctx.extensions);
    if (!director) {
      return { output: "Director context not available." };
    }

    try {
      await director.setTheme(params.theme);
      return { output: `Theme set to "${params.theme}".` };
    } catch (err) {
      return {
        output: `Failed to set theme: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

export const getSystemInfoTool = defineTool({
  name: "director_get_system_info",
  description:
    "Get system information. If a serverId is provided, gets info from that remote server (agent version, uptime, memory, Docker status). Without a serverId, gets local app info.",
  parameters: z.object({
    serverId: z
      .string()
      .optional()
      .describe("ID of a remote server to get info from"),
  }),
  async execute(params, ctx) {
    const director = getDirectorContext(ctx.extensions);
    if (!director) {
      return { output: "Director context not available." };
    }

    try {
      const info = await director.getSystemInfo(params.serverId);

      const lines: string[] = [];
      if (info.agentVersion) lines.push(`Agent version: ${info.agentVersion}`);
      if (info.nodeVersion) lines.push(`Node.js: ${info.nodeVersion}`);
      if (info.platform) lines.push(`Platform: ${info.platform}`);
      if (info.uptime !== undefined) {
        const hours = Math.floor(info.uptime / 3600);
        const minutes = Math.floor((info.uptime % 3600) / 60);
        lines.push(`Uptime: ${hours}h ${minutes}m`);
      }
      if (info.memoryUsage) {
        const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
        lines.push(
          `Memory: ${mb(info.memoryUsage.heapUsed)}MB used / ${mb(info.memoryUsage.heapTotal)}MB heap / ${mb(info.memoryUsage.rss)}MB RSS`
        );
      }
      if (info.dockerStatus) {
        lines.push(
          `Docker: ${info.dockerStatus.available ? `available (${info.dockerStatus.version || "unknown version"})` : "not available"}`
        );
      }

      return {
        output: lines.length > 0 ? lines.join("\n") : "No system info available.",
      };
    } catch (err) {
      return {
        output: `Failed to get system info: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

export const settingsTools = [
  getSettingsTool,
  setThemeTool,
  getSystemInfoTool,
];
