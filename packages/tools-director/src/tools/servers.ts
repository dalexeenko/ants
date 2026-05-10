import { z } from "zod";
import { defineTool } from "@openmgr/agent-core";
import { getDirectorContext } from "../context.js";

export const listServersTool = defineTool({
  name: "director_list_servers",
  description:
    "List all configured remote OpenMgr servers, including their connection status and authentication type.",
  parameters: z.object({}),
  async execute(_params, ctx) {
    const director = getDirectorContext(ctx.extensions);
    if (!director) {
      return { output: "Director context not available." };
    }

    try {
      const servers = await director.listServers();
      if (servers.length === 0) {
        return {
          output:
            "No remote servers configured. Use director_add_server to add one.",
        };
      }

      const formatted = servers.map((s) => ({
        id: s.id,
        name: s.name,
        url: s.url,
        authType: s.authType || "bearer",
        status: s.connected ? "connected" : "disconnected",
        lastSeen: s.lastSeen
          ? new Date(s.lastSeen).toLocaleString()
          : "never",
      }));

      return {
        output: JSON.stringify(formatted, null, 2),
        metadata: { count: servers.length },
      };
    } catch (err) {
      return {
        output: `Failed to list servers: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

export const addServerTool = defineTool({
  name: "director_add_server",
  description: `Add a new remote OpenMgr server connection. You need the server's URL and an authentication token.

For bearer auth (default): provide the URL and the bearer token.
For Cloudflare Access: set authType to 'cloudflare-access' (the user will need to configure it through the UI).

After adding, use director_test_server to verify the connection works.`,
  parameters: z.object({
    name: z.string().describe("Display name for the server"),
    url: z
      .string()
      .describe(
        "Server URL (e.g., 'https://openmgr.example.com' or 'http://localhost:6647')"
      ),
    token: z
      .string()
      .optional()
      .describe("Bearer authentication token (the OPENMGR_SECRET value from the server)"),
    authType: z
      .enum(["bearer", "cloudflare-access"])
      .default("bearer")
      .describe("Authentication type"),
  }),
  async execute(params, ctx) {
    const director = getDirectorContext(ctx.extensions);
    if (!director) {
      return { output: "Director context not available." };
    }

    try {
      const server = await director.addServer({
        name: params.name,
        url: params.url,
        token: params.token,
        authType: params.authType,
      });

      return {
        output: `Server "${server.name}" added (ID: ${server.id}). Use director_test_server to verify the connection.`,
        metadata: { serverId: server.id },
      };
    } catch (err) {
      return {
        output: `Failed to add server: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

export const updateServerTool = defineTool({
  name: "director_update_server",
  description:
    "Update a remote server's connection details (name, URL, or token). Use director_list_servers to get the server ID.",
  parameters: z.object({
    serverId: z.string().describe("ID of the server to update"),
    name: z.string().optional().describe("New display name"),
    url: z.string().optional().describe("New server URL"),
    token: z.string().optional().describe("New bearer token"),
  }),
  async execute(params, ctx) {
    const director = getDirectorContext(ctx.extensions);
    if (!director) {
      return { output: "Director context not available." };
    }

    const { serverId, ...updates } = params;
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );

    if (Object.keys(cleanUpdates).length === 0) {
      return {
        output: "No updates provided. Specify at least one field to change.",
      };
    }

    try {
      await director.updateServer(serverId, cleanUpdates);
      return {
        output: `Server updated. Changed: ${Object.keys(cleanUpdates).join(", ")}.`,
      };
    } catch (err) {
      return {
        output: `Failed to update server: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

export const removeServerTool = defineTool({
  name: "director_remove_server",
  description:
    "Remove a remote server connection. This also removes all associated remote projects from the app. Use director_list_servers to get the server ID.",
  parameters: z.object({
    serverId: z.string().describe("ID of the server to remove"),
  }),
  async execute(params, ctx) {
    const director = getDirectorContext(ctx.extensions);
    if (!director) {
      return { output: "Director context not available." };
    }

    try {
      await director.removeServer(params.serverId);
      return {
        output:
          "Server removed, along with any associated remote projects in the app.",
      };
    } catch (err) {
      return {
        output: `Failed to remove server: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

export const testServerTool = defineTool({
  name: "director_test_server",
  description:
    "Test the connection to a remote server. Can test an existing server by ID, or test a new URL+token combination before adding it.",
  parameters: z.object({
    serverId: z
      .string()
      .optional()
      .describe("ID of an existing server to test"),
    url: z
      .string()
      .optional()
      .describe("Server URL to test (alternative to serverId)"),
    token: z
      .string()
      .optional()
      .describe("Bearer token to test with (used with url)"),
  }),
  async execute(params, ctx) {
    const director = getDirectorContext(ctx.extensions);
    if (!director) {
      return { output: "Director context not available." };
    }

    if (!params.serverId && !params.url) {
      return {
        output:
          "Provide either a serverId (to test an existing server) or a url (to test a new connection).",
      };
    }

    try {
      const target = params.serverId
        ? params.serverId
        : { url: params.url!, token: params.token };

      const result = await director.testServer(target);

      if (result.success) {
        return {
          output: `Connection successful! ${result.message}${result.latencyMs ? ` (${result.latencyMs}ms)` : ""}`,
          metadata: { success: true, latencyMs: result.latencyMs },
        };
      } else {
        return {
          output: `Connection failed: ${result.message}`,
          metadata: { success: false },
        };
      }
    } catch (err) {
      return {
        output: `Connection test error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

export const serverTools = [
  listServersTool,
  addServerTool,
  updateServerTool,
  removeServerTool,
  testServerTool,
];
