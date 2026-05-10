import { z } from "zod";
import { defineTool } from "@openmgr/agent-core";
import { getDirectorContext } from "../context.js";

export const getAuthStatusTool = defineTool({
  name: "director_get_auth_status",
  description: `Check the current authentication configuration — which LLM providers have API keys set up, both locally and on any remote servers.

This helps diagnose issues like "why can't I use OpenAI?" (answer: no API key configured).`,
  parameters: z.object({}),
  async execute(_params, ctx) {
    const director = getDirectorContext(ctx.extensions);
    if (!director) {
      return { output: "Director context not available." };
    }

    try {
      const status = await director.getAuthStatus();

      const sections: string[] = [];

      // Local auth
      sections.push("## Local Authentication");
      const local = status.local;
      sections.push(
        `- Anthropic: ${local.anthropic.authenticated ? `authenticated (${local.anthropic.method})` : "not configured"}`
      );
      sections.push(
        `- OpenAI: ${local.openai.hasApiKey ? "API key set" : "not configured"}`
      );
      sections.push(
        `- Google: ${local.google.hasApiKey ? "API key set" : "not configured"}`
      );
      sections.push(
        `- OpenRouter: ${local.openrouter.hasApiKey ? "API key set" : "not configured"}`
      );
      sections.push(
        `- Groq: ${local.groq.hasApiKey ? "API key set" : "not configured"}`
      );
      sections.push(
        `- xAI: ${local.xai.hasApiKey ? "API key set" : "not configured"}`
      );

      // Server auth
      if (status.servers.length > 0) {
        for (const server of status.servers) {
          sections.push(`\n## Server: ${server.serverName}`);
          for (const provider of server.providers) {
            sections.push(
              `- ${provider.name}: ${provider.configured ? "configured" : "not configured"}`
            );
          }
        }
      }

      return {
        output: sections.join("\n"),
      };
    } catch (err) {
      return {
        output: `Failed to get auth status: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

export const setApiKeyTool = defineTool({
  name: "director_set_api_key",
  description: `Set an API key for an LLM provider. Can set keys locally (for on-device agents) or on a remote server.

Supported providers: anthropic, openai, google, openrouter, groq, xai.
Remote servers may support additional providers.

IMPORTANT: Never ask the user to type their API key in the chat. Instead, suggest they use the Settings UI directly or paste it when prompted. If they do provide a key, set it immediately and don't echo it back.`,
  parameters: z.object({
    provider: z
      .string()
      .describe(
        "Provider ID (e.g., 'anthropic', 'openai', 'google', 'openrouter', 'groq', 'xai')"
      ),
    key: z.string().describe("The API key value"),
    serverId: z
      .string()
      .optional()
      .describe(
        "If provided, sets the key on this remote server instead of locally"
      ),
  }),
  async execute(params, ctx) {
    const director = getDirectorContext(ctx.extensions);
    if (!director) {
      return { output: "Director context not available." };
    }

    try {
      await director.setApiKey(params.provider, params.key, params.serverId);
      const location = params.serverId ? "on the remote server" : "locally";
      return {
        output: `API key for ${params.provider} has been set ${location}.`,
      };
    } catch (err) {
      return {
        output: `Failed to set API key: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

export const deleteApiKeyTool = defineTool({
  name: "director_delete_api_key",
  description:
    "Delete an API key for an LLM provider, either locally or on a remote server.",
  parameters: z.object({
    provider: z.string().describe("Provider ID (e.g., 'anthropic', 'openai')"),
    serverId: z
      .string()
      .optional()
      .describe("If provided, deletes the key on this remote server instead of locally"),
  }),
  async execute(params, ctx) {
    const director = getDirectorContext(ctx.extensions);
    if (!director) {
      return { output: "Director context not available." };
    }

    try {
      await director.deleteApiKey(params.provider, params.serverId);
      const location = params.serverId ? "on the remote server" : "locally";
      return {
        output: `API key for ${params.provider} removed ${location}.`,
      };
    } catch (err) {
      return {
        output: `Failed to delete API key: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

export const authTools = [getAuthStatusTool, setApiKeyTool, deleteApiKeyTool];
