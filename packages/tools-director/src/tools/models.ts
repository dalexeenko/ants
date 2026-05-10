import { z } from "zod";
import { defineTool } from "@ants/agent-core";
import { getDirectorContext } from "../context.js";

export const listModelsTool = defineTool({
  name: "director_list_models",
  description: `List the available LLM models for a project. Shows which models the user can choose from based on their configured API keys.

If a projectId is provided, returns models available for that specific project (for remote projects, this queries the remote server's model catalog).
If no projectId is provided, returns models available locally based on the user's configured API keys.

Use this to help users understand what models they can use, compare options, or pick the best model for their needs.`,
  parameters: z.object({
    projectId: z
      .string()
      .optional()
      .describe(
        "Project ID to list models for. If omitted, lists locally available models."
      ),
  }),
  async execute(params, ctx) {
    const director = getDirectorContext(ctx.extensions);
    if (!director) {
      return { output: "Director context not available." };
    }

    try {
      const models = await director.listModels(params.projectId);

      if (models.length === 0) {
        return {
          output:
            "No models available. This usually means no API keys are configured. Use director_get_auth_status to check which providers are set up, and director_set_api_key to add one.",
        };
      }

      // Group models by provider for cleaner output
      const byProvider = new Map<string, typeof models>();
      for (const model of models) {
        const key = model.provider;
        if (!byProvider.has(key)) {
          byProvider.set(key, []);
        }
        byProvider.get(key)!.push(model);
      }

      const sections: string[] = [];
      sections.push(`## Available Models (${models.length} total)\n`);

      for (const [provider, providerModels] of byProvider) {
        const displayName =
          providerModels[0]?.providerName || provider;
        sections.push(`### ${displayName}`);
        for (const model of providerModels) {
          const parts = [`- **${model.name}** (\`${model.id}\`)`];
          if (model.description) {
            parts.push(`  ${model.description}`);
          }
          sections.push(parts.join("\n"));
        }
        sections.push("");
      }

      return {
        output: sections.join("\n"),
        metadata: { count: models.length },
      };
    } catch (err) {
      return {
        output: `Failed to list models: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

export const modelTools = [listModelsTool];
