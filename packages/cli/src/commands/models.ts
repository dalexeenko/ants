import type { Command } from "commander";
import chalk from "chalk";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  loadGlobalConfig,
  loadLocalConfig,
  saveGlobalConfig,
  saveLocalConfig,
} from "@ants/agent-config-xdg";
import { isLoggedIn, getValidAccessToken } from "@ants/agent-auth-anthropic";
import { FileTokenStore } from "@ants/agent-node";

// ============================================================================
// Model Registry
// ============================================================================

interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  contextWindow?: number;
  maxOutput?: number;
}

interface ProviderConfig {
  id: string;
  name: string;
  models: ModelInfo[];
}

const PROVIDER_MODELS: ProviderConfig[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    models: [
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", description: "Balanced model", contextWindow: 200000, maxOutput: 64000 },
      { id: "claude-opus-4-20250514", name: "Claude Opus 4", description: "Capable model", contextWindow: 200000, maxOutput: 32000 },
      { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", description: "Previous generation", contextWindow: 200000, maxOutput: 8192 },
      { id: "claude-3-opus-20240229", name: "Claude 3 Opus", description: "Highest capability (legacy)", contextWindow: 200000, maxOutput: 4096 },
      { id: "claude-3-haiku-20240307", name: "Claude 3 Haiku", description: "Fast and efficient (legacy)", contextWindow: 200000, maxOutput: 4096 },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    models: [
      { id: "gpt-4o", name: "GPT-4o", description: "Multimodal flagship model", contextWindow: 128000, maxOutput: 16384 },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", description: "Fast and affordable", contextWindow: 128000, maxOutput: 16384 },
      { id: "gpt-4-turbo", name: "GPT-4 Turbo", description: "Previous generation", contextWindow: 128000, maxOutput: 4096 },
    ],
  },
  {
    id: "google",
    name: "Google",
    models: [
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", description: "Latest Gemini model", contextWindow: 1000000, maxOutput: 8192 },
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", description: "High capability", contextWindow: 2000000, maxOutput: 8192 },
      { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", description: "Fast and efficient", contextWindow: 1000000, maxOutput: 8192 },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    models: [
      { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet via OpenRouter" },
      { id: "openai/gpt-4o", name: "GPT-4o via OpenRouter" },
    ],
  },
  {
    id: "groq",
    name: "Groq",
    models: [
      { id: "llama-3.1-70b-versatile", name: "Llama 3.1 70B", description: "Fast inference", contextWindow: 128000 },
      { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B", description: "MoE model", contextWindow: 32768 },
    ],
  },
  {
    id: "xai",
    name: "xAI",
    models: [
      { id: "grok-2", name: "Grok 2", description: "Latest Grok model", contextWindow: 131072 },
      { id: "grok-beta", name: "Grok Beta", description: "Beta release", contextWindow: 131072 },
    ],
  },
];

// ============================================================================
// Model Lookup Helpers
// ============================================================================

function findModel(modelId: string): { provider: string; model: ModelInfo } | undefined {
  for (const provider of PROVIDER_MODELS) {
    const model = provider.models.find((m) => m.id === modelId);
    if (model) {
      return { provider: provider.id, model };
    }
  }
  return undefined;
}

function getEnvApiKey(provider: string): string | undefined {
  switch (provider) {
    case "anthropic": return process.env.ANTHROPIC_API_KEY;
    case "openai": return process.env.OPENAI_API_KEY;
    case "google": return process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    case "openrouter": return process.env.OPENROUTER_API_KEY;
    case "groq": return process.env.GROQ_API_KEY;
    case "xai": return process.env.XAI_API_KEY;
    default: return undefined;
  }
}

// ============================================================================
// Model Cache
// ============================================================================

const CACHE_DIR = join(homedir(), ".config", "ants", "cache");
const MODELS_CACHE_FILE = join(CACHE_DIR, "models.json");

interface CachedModels {
  fetchedAt: string;
  providers: Record<string, ModelInfo[]>;
}

async function loadCachedModels(): Promise<CachedModels | null> {
  try {
    if (!existsSync(MODELS_CACHE_FILE)) return null;
    const content = await readFile(MODELS_CACHE_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function saveCachedModels(providers: Record<string, ModelInfo[]>): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  const cache: CachedModels = {
    fetchedAt: new Date().toISOString(),
    providers,
  };
  await writeFile(MODELS_CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
}

// ============================================================================
// Anthropic Model Fetcher
// ============================================================================

interface AnthropicModelResponse {
  data: Array<{ id: string; display_name: string }>;
  has_more: boolean;
  last_id?: string;
}

async function fetchAnthropicModels(auth: { apiKey?: string; accessToken?: string }): Promise<ModelInfo[]> {
  const models: ModelInfo[] = [];
  let afterId: string | undefined;

  while (true) {
    const url = new URL("https://api.anthropic.com/v1/models");
    url.searchParams.set("limit", "100");
    if (afterId) {
      url.searchParams.set("after_id", afterId);
    }

    const headers: Record<string, string> = {
      "anthropic-version": "2023-06-01",
    };

    if (auth.accessToken) {
      headers["authorization"] = `Bearer ${auth.accessToken}`;
      headers["anthropic-beta"] = "oauth-2025-04-20";
    } else if (auth.apiKey) {
      headers["x-api-key"] = auth.apiKey;
    } else {
      throw new Error("No authentication provided");
    }

    const response = await fetch(url.toString(), { headers });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to fetch models: ${response.status} ${text}`);
    }

    const data = (await response.json()) as AnthropicModelResponse;
    for (const model of data.data) {
      models.push({
        id: model.id,
        name: model.display_name,
        contextWindow: 200000,
        maxOutput: 64000,
      });
    }

    if (!data.has_more) break;
    afterId = data.last_id;
  }

  return models;
}

// ============================================================================
// Commands
// ============================================================================

export function registerModelsCommands(program: Command): void {
  const modelsCmd = program
    .command("models")
    .description("List and manage available models");

  // ── models list ──────────────────────────────────────────────────────────

  modelsCmd
    .command("list")
    .description("List available models")
    .option("-p, --provider <provider>", "Filter by provider")
    .option("--builtin", "Show only built-in model list (ignore cache)")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const cachedModels = options.builtin ? null : await loadCachedModels();

      const getModelsForProvider = (providerId: string): ModelInfo[] => {
        if (cachedModels?.providers[providerId]) {
          return cachedModels.providers[providerId]!;
        }
        const provider = PROVIDER_MODELS.find((p) => p.id === providerId);
        return provider?.models ?? [];
      };

      if (options.provider) {
        const provider = PROVIDER_MODELS.find((p) => p.id === options.provider);
        if (!provider) {
          console.error(chalk.red(`Unknown provider: ${options.provider}`));
          console.log(chalk.gray(`Valid providers: ${PROVIDER_MODELS.map((p) => p.id).join(", ")}`));
          process.exit(1);
        }

        const models = getModelsForProvider(options.provider);

        if (options.json) {
          console.log(JSON.stringify({ provider: options.provider, models }, null, 2));
          return;
        }

        console.log(chalk.cyan(`\n${provider.name} Models:\n`));
        for (const model of models) {
          console.log(`  ${chalk.green(model.id)}`);
          console.log(`    ${chalk.white(model.name)}`);
          if (model.description) {
            console.log(`    ${chalk.gray(model.description)}`);
          }
          if (model.contextWindow) {
            console.log(`    ${chalk.gray(`Context: ${(model.contextWindow / 1000).toFixed(0)}K tokens`)}`);
          }
          console.log();
        }
        return;
      }

      if (options.json) {
        const result = PROVIDER_MODELS.map((p) => ({
          id: p.id,
          name: p.name,
          models: getModelsForProvider(p.id),
        }));
        console.log(JSON.stringify({ providers: result }, null, 2));
        return;
      }

      console.log(chalk.cyan("\nAvailable Models by Provider:\n"));

      for (const provider of PROVIDER_MODELS) {
        const models = getModelsForProvider(provider.id);
        console.log(chalk.white(`${provider.name} (${provider.id}):`));
        for (const model of models) {
          console.log(`  ${chalk.green(model.id)}`);
          if (model.description) {
            console.log(`    ${chalk.gray(model.description)}`);
          }
        }
        console.log();
      }

      console.log(chalk.gray("Use 'oa models list --provider <name>' for details"));
      console.log(chalk.gray("Use 'oa models refresh' to fetch latest models from providers"));
    });

  // ── models set ───────────────────────────────────────────────────────────

  modelsCmd
    .command("set")
    .description("Set the default model")
    .argument("<model>", "Model ID (e.g., claude-sonnet-4-20250514, gpt-4o)")
    .option("--provider <provider>", "Provider for the model (auto-detected if not specified)")
    .option("--local", "Save to local project config")
    .option("-d, --directory <dir>", "Working directory", process.cwd())
    .action(async (model: string, options) => {
      let provider = options.provider;

      if (!provider) {
        const found = findModel(model);
        if (found) {
          provider = found.provider;
        }
      }

      const validProviders = ["anthropic", "openai", "google", "openrouter", "groq", "xai"];
      if (provider && !validProviders.includes(provider)) {
        console.error(chalk.red(`Invalid provider: ${provider}. Valid: ${validProviders.join(", ")}`));
        process.exit(1);
      }

      const config: Record<string, string> = { model };
      if (provider) {
        config.provider = provider;
      }

      if (options.local) {
        await saveLocalConfig(options.directory, config);
        console.log(chalk.green(`Set model to ${model}${provider ? ` (provider: ${provider})` : ""} in local config`));
      } else {
        await saveGlobalConfig(config);
        console.log(chalk.green(`Set model to ${model}${provider ? ` (provider: ${provider})` : ""} in global config`));
      }
    });

  // ── models current ───────────────────────────────────────────────────────

  modelsCmd
    .command("current")
    .description("Show the current model configuration")
    .option("-d, --directory <dir>", "Working directory", process.cwd())
    .action(async (options) => {
      const { loadConfig } = await import("@ants/agent-config-xdg");
      const config = await loadConfig(options.directory);

      console.log(chalk.cyan("\nCurrent Model Configuration:\n"));
      console.log(`  Provider: ${chalk.white(config.provider)}`);
      console.log(`  Model:    ${chalk.white(config.model)}`);

      const modelInfo = findModel(config.model);
      if (modelInfo) {
        console.log(`  Name:     ${chalk.green(modelInfo.model.name)}`);
        if (modelInfo.model.description) {
          console.log(`  Info:     ${chalk.gray(modelInfo.model.description)}`);
        }
      }
    });

  // ── models refresh ───────────────────────────────────────────────────────

  modelsCmd
    .command("refresh")
    .description("Fetch latest models from providers (requires API credentials)")
    .option("-p, --provider <provider>", "Only refresh specific provider (anthropic)")
    .option("-d, --directory <dir>", "Working directory", process.cwd())
    .action(async (options) => {
      const globalConfig = (await loadGlobalConfig()) ?? {};
      const localConfig = (await loadLocalConfig(options.directory)) ?? {};
      const apiKeys = { ...globalConfig.apiKeys, ...localConfig.apiKeys };

      const existingCache = await loadCachedModels();
      const providers: Record<string, ModelInfo[]> = existingCache?.providers ?? {};

      console.log(chalk.cyan("Fetching latest models...\n"));

      if (!options.provider || options.provider === "anthropic") {
        // Check for API key first
        const anthropicApiKey = typeof apiKeys?.anthropic === "string"
          ? apiKeys.anthropic
          : (apiKeys?.anthropic as { apiKey?: string })?.apiKey;
        const envApiKey = getEnvApiKey("anthropic");
        const apiKey = anthropicApiKey || envApiKey;

        if (apiKey) {
          // Use API key auth
          try {
            console.log(chalk.gray("Fetching Anthropic models (API key)..."));
            const models = await fetchAnthropicModels({ apiKey });
            providers["anthropic"] = models;
            console.log(chalk.green(`  Found ${models.length} Anthropic models`));
          } catch (err) {
            console.log(chalk.yellow(`  Failed to fetch Anthropic models: ${(err as Error).message}`));
          }
        } else {
          // Try OAuth
          const tokenStore = new FileTokenStore();
          const loggedIn = await isLoggedIn(tokenStore);

          if (loggedIn) {
            try {
              console.log(chalk.gray("Fetching Anthropic models (OAuth)..."));
              const accessToken = await getValidAccessToken(tokenStore);
              if (accessToken) {
                const models = await fetchAnthropicModels({ accessToken });
                providers["anthropic"] = models;
                console.log(chalk.green(`  Found ${models.length} Anthropic models`));
              } else {
                console.log(chalk.yellow("  OAuth token expired. Run 'oa auth login anthropic' to re-authenticate."));
              }
            } catch (err) {
              console.log(chalk.yellow(`  Failed to fetch Anthropic models: ${(err as Error).message}`));
            }
          } else {
            console.log(chalk.gray("  Skipping Anthropic (no API key or OAuth session)"));
          }
        }
      }

      await saveCachedModels(providers);
      console.log(chalk.green(`\nModels cached to ${MODELS_CACHE_FILE}`));
    });
}
