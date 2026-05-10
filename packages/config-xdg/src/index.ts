/**
 * @openmgr/agent-config-xdg
 * 
 * XDG-compliant file-based configuration for OpenMgr Agent.
 * Stores configuration in ~/.config/openmgr/ following the XDG Base Directory Specification.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { resolve, join, dirname } from "path";
import { homedir } from "os";
import { z } from "zod";
import {
  type Config,
  type ConfigLoader,
  type ConfigOverrides,
  type ResolvedConfig,
  type ResolvedAuth,
  type ProviderAuth,
  normalizeProviderAuth,
  mergeConfigs,
  ApiKeysSchema,
  LspServerConfigSchema,
} from "@openmgr/agent-core";
import { McpServerConfigSchema } from "@openmgr/agent-core";

// XDG paths (computed lazily so tests can override HOME)
function getConfigDir(): string {
  return join(homedir(), ".config", "openmgr");
}
function getGlobalConfigFilePath(): string {
  return join(getConfigDir(), "agent.json");
}
const LOCAL_CONFIG_FILENAME = ".openmgr.json";

// Agent type config schema
const AgentTypeConfigSchema = z.object({
  version: z.string().optional(),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  deniedTools: z.array(z.string()).optional(),
  maxIterations: z.number().positive().optional(),
  tokenBudget: z.number().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  tags: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  integrity: z.string().regex(/^sha256-[0-9a-f]{64}$/).optional(),
});

// Config schema for validation
const ConfigSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  apiKeys: ApiKeysSchema.optional(),
  systemPrompt: z.string().optional(),
  tools: z.array(z.string()).optional(),
  disabledTools: z.array(z.string()).optional(),
  mcp: z.record(McpServerConfigSchema).optional(),
  lsp: z.record(LspServerConfigSchema).optional(),
  maxTokens: z.number().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  agentTypes: z.record(AgentTypeConfigSchema).optional(),
});

/**
 * Load and parse a JSON config file
 */
async function loadJsonFile(path: string): Promise<Config | null> {
  try {
    if (!existsSync(path)) return null;
    const content = await readFile(path, "utf-8");
    const parsed = JSON.parse(content);
    return ConfigSchema.parse(parsed);
  } catch {
    return null;
  }
}

/**
 * Save config to a JSON file
 */
async function saveJsonFile(path: string, config: Config): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Find local config file by walking up directory tree
 */
function findLocalConfigPath(startDir: string): string | null {
  let dir = resolve(startDir);
  const root = resolve("/");

  while (dir !== root) {
    const configPath = join(dir, LOCAL_CONFIG_FILENAME);
    if (existsSync(configPath)) {
      return configPath;
    }
    dir = dirname(dir);
  }

  return null;
}

/**
 * Get API key from environment variable
 */
function getEnvApiKey(provider: string): string | undefined {
  switch (provider) {
    case "openai":
      return process.env.OPENAI_API_KEY;
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY;
    case "google":
      return process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    case "openrouter":
      return process.env.OPENROUTER_API_KEY;
    case "groq":
      return process.env.GROQ_API_KEY;
    case "xai":
      return process.env.XAI_API_KEY;
    default:
      return undefined;
  }
}

/**
 * Resolve authentication from configs and environment
 */
function resolveAuth(
  provider: string,
  globalConfig: Config,
  localConfig: Config,
  overrideApiKey?: string
): ResolvedAuth {
  if (overrideApiKey) {
    return { type: "api-key", apiKey: overrideApiKey };
  }

  const apiKeyProvider = provider === "anthropic" || provider === "openai" ? provider : null;
  if (apiKeyProvider) {
    const localAuth = normalizeProviderAuth(localConfig.apiKeys?.[apiKeyProvider]);
    if (localAuth) {
      return { type: localAuth.type, apiKey: localAuth.apiKey };
    }

    const globalAuth = normalizeProviderAuth(globalConfig.apiKeys?.[apiKeyProvider]);
    if (globalAuth) {
      return { type: globalAuth.type, apiKey: globalAuth.apiKey };
    }
  }

  const envKey = getEnvApiKey(provider);
  if (envKey) {
    return { type: "api-key", apiKey: envKey };
  }

  return { type: "oauth" };
}

/**
 * Load global configuration from ~/.config/openmgr/agent.json
 */
export async function loadGlobalConfig(): Promise<Config | null> {
  return loadJsonFile(getGlobalConfigFilePath());
}

/**
 * Load local configuration by searching up from working directory
 */
export async function loadLocalConfig(workingDirectory: string): Promise<Config | null> {
  const configPath = findLocalConfigPath(workingDirectory);
  if (!configPath) return null;
  return loadJsonFile(configPath);
}

/**
 * Load and resolve full configuration
 */
export async function loadConfig(
  workingDirectory: string = process.cwd(),
  overrides: ConfigOverrides = {}
): Promise<ResolvedConfig> {
  const globalConfig = (await loadGlobalConfig()) ?? {};
  const localConfig = (await loadLocalConfig(workingDirectory)) ?? {};

  const merged = mergeConfigs(globalConfig, localConfig, overrides);
  const auth = resolveAuth(merged.provider, globalConfig, localConfig, merged.apiKey);

  return {
    provider: merged.provider,
    model: merged.model,
    auth,
    systemPrompt: merged.systemPrompt,
    tools: merged.tools,
    disabledTools: merged.disabledTools,
    mcp: merged.mcp,
    lsp: merged.lsp,
    maxTokens: merged.maxTokens,
    temperature: merged.temperature,
    agentTypes: merged.agentTypes,
  };
}

/**
 * Save global configuration (merges with existing)
 */
export async function saveGlobalConfig(config: Partial<Config>): Promise<void> {
  const existing = (await loadGlobalConfig()) ?? {};
  const merged: Config = {
    ...existing,
    ...config,
    apiKeys: config.apiKeys
      ? { ...existing.apiKeys, ...config.apiKeys }
      : existing.apiKeys,
  };
  await saveJsonFile(getGlobalConfigFilePath(), merged);
}

/**
 * Save local configuration (merges with existing)
 */
export async function saveLocalConfig(
  workingDirectory: string,
  config: Partial<Config>
): Promise<void> {
  const configPath = join(workingDirectory, LOCAL_CONFIG_FILENAME);
  const existing = (await loadJsonFile(configPath)) ?? {};
  const merged: Config = {
    ...existing,
    ...config,
    apiKeys: config.apiKeys
      ? { ...existing.apiKeys, ...config.apiKeys }
      : existing.apiKeys,
  };
  await saveJsonFile(configPath, merged);
}

/**
 * Set API key for a provider
 */
export async function setApiKey(
  provider: "anthropic" | "openai",
  apiKey: string,
  scope: "global" | "local" = "global",
  workingDirectory?: string
): Promise<void> {
  const authConfig: ProviderAuth = { type: "api-key", apiKey };
  if (scope === "global") {
    await saveGlobalConfig({ apiKeys: { [provider]: authConfig } });
  } else {
    if (!workingDirectory) {
      throw new Error("workingDirectory required for local scope");
    }
    await saveLocalConfig(workingDirectory, { apiKeys: { [provider]: authConfig } });
  }
}

/**
 * Set auth type for a provider
 */
export async function setAuthType(
  provider: "anthropic" | "openai",
  type: "oauth" | "api-key",
  scope: "global" | "local" = "global",
  workingDirectory?: string
): Promise<void> {
  const authConfig: ProviderAuth = { type };
  if (scope === "global") {
    await saveGlobalConfig({ apiKeys: { [provider]: authConfig } });
  } else {
    if (!workingDirectory) {
      throw new Error("workingDirectory required for local scope");
    }
    await saveLocalConfig(workingDirectory, { apiKeys: { [provider]: authConfig } });
  }
}

/**
 * Get the global config file path
 */
export function getGlobalConfigPath(): string {
  return getGlobalConfigFilePath();
}

/**
 * Get the local config file path for a directory
 */
export function getLocalConfigPath(workingDirectory: string): string {
  return join(workingDirectory, LOCAL_CONFIG_FILENAME);
}

/**
 * XDG config loader implementation
 */
export const xdgConfigLoader: ConfigLoader = {
  loadConfig,
  loadGlobalConfig,
  loadLocalConfig,
  saveGlobalConfig,
  saveLocalConfig,
};

export default xdgConfigLoader;
