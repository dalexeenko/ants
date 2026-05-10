/**
 * @ants/agent-node
 *
 * Ants Agent for Node.js environments.
 * This package bundles the core agent with Node.js-specific implementations:
 * - XDG filesystem configuration
 * - Filesystem-based skill loading
 * - Stdio MCP client
 * - Filesystem-based OAuth token storage
 * - Environment variable support for API keys
 *
 * Use this package when running in Node.js. For React Native or browser environments,
 * use @ants/agent-core directly with custom implementations.
 */

// Re-export everything from core
export * from "@ants/agent-core";

// Re-export FileTokenStore for Node.js OAuth
export { FileTokenStore, getDefaultAuthPaths } from "./file-token-store.js";

// Re-export browser sandbox types for callers that need to create controllers directly.
// Runtime values (createSandboxController, etc.) are loaded lazily via dynamic import
// so the module doesn't crash when playwright is not installed (e.g. lite Docker image).
export type { SandboxControllerOptions } from "@ants/agent-browser-sandbox";
export type { BrowserController } from "@ants/agent-browser-core";

// Lazy loader for the browser sandbox module — returns null if playwright is unavailable.
let _browserSandbox: typeof import("@ants/agent-browser-sandbox") | null | undefined;
async function loadBrowserSandbox(): Promise<typeof import("@ants/agent-browser-sandbox") | null> {
  if (_browserSandbox !== undefined) return _browserSandbox;
  try {
    _browserSandbox = await import("@ants/agent-browser-sandbox");
    return _browserSandbox;
  } catch {
    _browserSandbox = null;
    return null;
  }
}

/**
 * Dynamically create a sandbox browser controller.
 * Returns null if playwright / browser-sandbox is not available.
 */
export async function createSandboxController(
  options?: import("@ants/agent-browser-sandbox").SandboxControllerOptions,
) {
  const mod = await loadBrowserSandbox();
  if (!mod) return null;
  return mod.createSandboxController(options);
}

/**
 * Dynamically create a sandbox browser plugin.
 * Returns null if playwright / browser-sandbox is not available.
 */
export async function createSandboxBrowserPlugin(
  controller: import("@ants/agent-browser-core").BrowserController,
) {
  const mod = await loadBrowserSandbox();
  if (!mod) return null;
  return mod.createSandboxBrowserPlugin(controller);
}

// Re-export providers (selectively to avoid conflicts with core exports)
export {
  AnthropicProvider,
  OpenAIProvider,
  GoogleProvider,
  OpenRouterProvider,
  GroqProvider,
  XAIProvider,
  createProvider,
  providersPlugin,
  getSmallModel,
  SMALL_MODELS,
} from "@ants/agent-providers";

// Re-export Node.js-specific implementations
export {
  // XDG config functions
  loadConfig,
  loadGlobalConfig,
  loadLocalConfig,
  saveGlobalConfig,
  saveLocalConfig,
  setApiKey,
  setAuthType,
  getGlobalConfigPath,
  getLocalConfigPath,
  xdgConfigLoader,
} from "@ants/agent-config-xdg";

export {
  // Skills loader
  FilesystemSkillManager,
  SkillManager,
  parseSkillMd,
  isSkillDirectory,
  loadSkillFromDirectory,
  loadSkillMetadata,
  getSkillPaths,
  type SkillPaths,
  type SkillManagerOptions,
} from "@ants/agent-skills-loader";

export {
  // MCP stdio client
  StdioMcpClient,
} from "@ants/agent-mcp-stdio";

export {
  // Worktree management
  worktreePlugin,
  WorktreeManager as AgentWorktreeManager,
  ProjectWorktreeManager,
  type WorktreePluginOptions,
  type WorktreeInfo as AgentWorktreeInfo,
  type WorktreeCreateOptions,
  type WorktreeRemoveOptions,
} from "@ants/agent-worktree";

import {
  Agent,
  SseMcpClient,
  type AgentOptions,
  type AgentPlugin,
  type LLMProvider,
  type McpServerConfig,
  type McpClientInterface,
  type McpClientFactory,
  type McpSseConfig,
  type McpStdioConfig,
} from "@ants/agent-core";
import { loadConfig } from "@ants/agent-config-xdg";
import {
  AnthropicProvider,
  AnthropicOAuthProvider,
  OpenAIProvider,
  GoogleProvider,
  OpenRouterProvider,
  GroqProvider,
  XAIProvider,
  type ProviderOptions,
  type ProviderName,
} from "@ants/agent-providers";
import { FilesystemSkillManager } from "@ants/agent-skills-loader";
import { StdioMcpClient } from "@ants/agent-mcp-stdio";
import { toolsPlugin } from "@ants/agent-tools";
import { toolsTerminalPlugin } from "@ants/agent-tools-terminal";
import { worktreePlugin } from "@ants/agent-worktree";
import type { SandboxControllerOptions } from "@ants/agent-browser-sandbox";
import type { BrowserController } from "@ants/agent-browser-core";
import { FileTokenStore } from "./file-token-store.js";

// =============================================================================
// Environment Variable Mappings
// =============================================================================

/**
 * Environment variable names for each provider's API key
 */
export const PROVIDER_ENV_VARS: Record<ProviderName, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  groq: ["GROQ_API_KEY"],
  xai: ["XAI_API_KEY"],
};

/**
 * Get API key from environment variables for a provider
 */
export function getApiKeyFromEnv(provider: ProviderName): string | undefined {
  const envVars = PROVIDER_ENV_VARS[provider];
  for (const envVar of envVars) {
    const value = process.env[envVar];
    if (value) {
      return value;
    }
  }
  return undefined;
}

/**
 * Resolve provider options with environment variable fallback for API key
 */
export function resolveProviderOptions(
  provider: ProviderName,
  options: ProviderOptions = {}
): ProviderOptions {
  if (options.apiKey || options.auth?.apiKey) {
    return options;
  }
  
  const envApiKey = getApiKeyFromEnv(provider);
  if (envApiKey) {
    return {
      ...options,
      apiKey: envApiKey,
    };
  }
  
  return options;
}

// =============================================================================
// Node.js Provider Factory (with env var support)
// =============================================================================

/**
 * Create a provider instance by name with Node.js environment variable support.
 * 
 * This function will automatically look up API keys from environment variables
 * if not provided in options:
 * - ANTHROPIC_API_KEY for anthropic
 * - OPENAI_API_KEY for openai
 * - GOOGLE_GENERATIVE_AI_API_KEY or GOOGLE_API_KEY for google
 * - OPENROUTER_API_KEY for openrouter
 * - GROQ_API_KEY for groq
 * - XAI_API_KEY for xai
 */
export function createNodeProvider(
  provider: ProviderName,
  options: ProviderOptions = {}
): LLMProvider {
  const resolvedOptions = resolveProviderOptions(provider, options);
  
  switch (provider) {
    case "anthropic":
      return new AnthropicProvider(resolvedOptions);
    case "openai":
      return new OpenAIProvider(resolvedOptions);
    case "google":
      return new GoogleProvider(resolvedOptions);
    case "openrouter":
      return new OpenRouterProvider(resolvedOptions);
    case "groq":
      return new GroqProvider(resolvedOptions);
    case "xai":
      return new XAIProvider(resolvedOptions);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Plugin that registers all LLM providers with Node.js environment variable support.
 * 
 * Use this plugin instead of providersPlugin from @ants/agent-providers
 * to get automatic API key resolution from environment variables.
 */
export const nodeProvidersPlugin: AgentPlugin = {
  name: "@ants/agent-node/providers",
  version: "0.1.0",
  providers: [
    {
      name: "anthropic",
      factory: (options: ProviderOptions) => createNodeProvider("anthropic", options),
    },
    {
      name: "openai",
      factory: (options: ProviderOptions) => createNodeProvider("openai", options),
    },
    {
      name: "google",
      factory: (options: ProviderOptions) => createNodeProvider("google", options),
    },
    {
      name: "openrouter",
      factory: (options: ProviderOptions) => createNodeProvider("openrouter", options),
    },
    {
      name: "groq",
      factory: (options: ProviderOptions) => createNodeProvider("groq", options),
    },
    {
      name: "xai",
      factory: (options: ProviderOptions) => createNodeProvider("xai", options),
    },
  ],
};

/**
 * Create an MCP client for Node.js environments.
 * Supports both stdio (via child process) and SSE transports.
 */
export function createNodeMcpClient(
  name: string,
  config: McpServerConfig
): McpClientInterface {
  if (config.transport === "sse") {
    return new SseMcpClient(name, config as McpSseConfig);
  } else {
    // Default to stdio transport
    return new StdioMcpClient(name, config as McpStdioConfig);
  }
}

/**
 * MCP client factory for Node.js environments.
 * This is passed to the Agent to enable stdio MCP support.
 */
export const nodeMcpClientFactory: McpClientFactory = createNodeMcpClient;

/**
 * Browser configuration for the Node.js agent.
 */
export interface NodeAgentBrowserOptions {
  /**
   * Set to false to disable browser tools entirely.
   * @default true
   */
  enabled?: boolean;

  /**
   * Run browser in headless mode.
   * @default true (headless in Node.js; desktop can override to false)
   */
  headless?: boolean;

  /**
   * Provide a pre-built BrowserController instead of creating one.
   * When set, headless/controllerOptions are ignored.
   */
  controller?: BrowserController;

  /**
   * Additional options passed to createSandboxController.
   */
  controllerOptions?: Omit<SandboxControllerOptions, "headless">;
}

/**
 * Options for creating a Node.js agent
 */
export interface NodeAgentOptions extends AgentOptions {
  /**
   * Browser sandbox configuration.
   * Pass `false` to disable, or an options object to customize.
   * Defaults to headless Chromium.
   */
  browser?: false | NodeAgentBrowserOptions;
}

/**
 * Create an Agent configured for Node.js environments.
 *
 * This function:
 * - Loads configuration from XDG paths (~/.config/ants/)
 * - Sets up filesystem-based skill discovery
 * - Configures stdio MCP client support
 *
 * @example
 * ```typescript
 * import { createNodeAgent } from "@ants/agent-node";
 *
 * const agent = await createNodeAgent({
 *   workingDirectory: process.cwd(),
 * });
 *
 * const response = await agent.prompt("Hello!");
 * ```
 */
export async function createNodeAgent(options: NodeAgentOptions = {}): Promise<Agent> {
  const workingDirectory = options.workingDirectory ?? process.cwd();

  // Load configuration from XDG paths unless skipped
  let resolvedConfig = options.resolvedConfig;
  if (!resolvedConfig && !options.skipConfigLoad) {
    resolvedConfig = await loadConfig(workingDirectory, {
      provider: options.provider,
      model: options.model,
      apiKey: options.apiKey,
      systemPrompt: options.systemPrompt,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
    });
  }

  // Set up filesystem skill manager (unless one is provided)
  const skillManager = options.skillManager ?? new FilesystemSkillManager(workingDirectory);

  // Create the agent with Node.js implementations
  const agent = await Agent.create({
    ...options,
    workingDirectory,
    mcpClientFactory: options.mcpClientFactory ?? nodeMcpClientFactory,
    skillManager,
    resolvedConfig,
    skipConfigLoad: true, // Config is handled above
  });

  // Register Node.js providers (with env var support) and tool plugins
  await agent.use(nodeProvidersPlugin);
  await agent.use(toolsPlugin);
  await agent.use(toolsTerminalPlugin);
  await agent.use(worktreePlugin());

  // Register browser sandbox plugin (headless by default).
  // Uses dynamic import so the agent still works when playwright is not
  // installed (e.g. lite Docker image) — browser tools are simply unavailable.
  const browserOpts = options.browser;
  if (browserOpts !== false) {
    const browserConfig: NodeAgentBrowserOptions = browserOpts ?? {};
    const enabled = browserConfig.enabled !== false;

    if (enabled) {
      const browserSandbox = await loadBrowserSandbox();
      if (browserSandbox) {
        const controller = browserConfig.controller ?? browserSandbox.createSandboxController({
          headless: browserConfig.headless ?? true,
          ...browserConfig.controllerOptions,
        });
        await agent.use(browserSandbox.createSandboxBrowserPlugin(controller));
      }
    }
  }

  // If using Anthropic with OAuth, wire up the OAuth provider with stored tokens
  const authConfig = resolvedConfig?.auth ?? agent.getConfig().auth;
  const providerName = resolvedConfig?.provider ?? agent.getConfig().provider;
  
  if (providerName === "anthropic" && authConfig?.type === "oauth") {
    const tokenStore = new FileTokenStore();
    const tokens = await tokenStore.loadTokens();
    
    if (tokens) {
      const oauthProvider = new AnthropicOAuthProvider({
        tokens,
        onTokenRefresh: async (refreshedTokens) => {
          await tokenStore.saveTokens(refreshedTokens);
        },
      });
      agent.setProviderInstance(oauthProvider, "anthropic");
    }
  }

  return agent;
}

/**
 * Get or create a FilesystemSkillManager from an agent
 */
export function getSkillManager(agent: Agent): FilesystemSkillManager | undefined {
  return agent.getExtension<FilesystemSkillManager>("skills.manager");
}

/**
 * Create a StdioMcpClient for a given server configuration
 */
export { StdioMcpClient as createStdioMcpClient } from "@ants/agent-mcp-stdio";
