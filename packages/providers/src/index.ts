/**
 * @openmgr/agent-providers
 * 
 * LLM providers for @openmgr/agent
 * 
 * Supported providers:
 * - Anthropic (Claude models)
 * - OpenAI (GPT models)
 * - Google (Gemini models)
 * - OpenRouter (multi-model gateway)
 * - Groq (fast inference)
 * - xAI (Grok models)
 */

import type { AgentPlugin, LLMProvider } from "@openmgr/agent-core";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";
import { GoogleProvider } from "./google.js";
import { OpenRouterProvider } from "./openrouter.js";
import { GroqProvider } from "./groq.js";
import { XAIProvider } from "./xai.js";
import type { ProviderOptions } from "./base.js";

// Export all provider classes
export { AnthropicProvider } from "./anthropic.js";
export { AnthropicOAuthProvider, createAnthropicOAuthProvider, type AnthropicOAuthProviderOptions } from "./anthropic-oauth.js";
export { OpenAIProvider } from "./openai.js";
export { GoogleProvider } from "./google.js";
export { OpenRouterProvider } from "./openrouter.js";
export { GroqProvider } from "./groq.js";
export { XAIProvider } from "./xai.js";

// Export base types
export { type ProviderOptions } from "./base.js";

// Export clients for direct usage
export { AnthropicClient, createAnthropicClient, type AnthropicClientOptions, type AnthropicAuth } from "./anthropic-client.js";
export { OpenAIClient, createOpenAIClient, type OpenAIClientOptions, type OpenAIAuth } from "./openai-client.js";
export { GoogleClient, createGoogleClient, type GoogleClientOptions, type GoogleAuth } from "./google-client.js";

// Export SSE utilities
export { parseSSEStream, readSSEResponse, type SSEEvent } from "./sse.js";

export type ProviderName = "anthropic" | "openai" | "google" | "openrouter" | "groq" | "xai";

/**
 * Mapping of providers to their small/fast models for lightweight tasks like title generation
 */
export const SMALL_MODELS: Record<ProviderName, string> = {
  anthropic: "claude-3-5-haiku-20241022",
  openai: "gpt-4o-mini",
  google: "gemini-2.0-flash",
  openrouter: "anthropic/claude-3-5-haiku", // OpenRouter uses provider/model format
  groq: "llama-3.1-8b-instant",
  xai: "grok-2-mini",
};

/**
 * Get the small/fast model for a provider (for lightweight tasks like title generation)
 */
export function getSmallModel(provider: ProviderName): string {
  return SMALL_MODELS[provider];
}

/**
 * Create a provider instance by name
 */
export function createProvider(
  provider: ProviderName,
  options: ProviderOptions = {}
): LLMProvider {
  switch (provider) {
    case "anthropic":
      return new AnthropicProvider(options);
    case "openai":
      return new OpenAIProvider(options);
    case "google":
      return new GoogleProvider(options);
    case "openrouter":
      return new OpenRouterProvider(options);
    case "groq":
      return new GroqProvider(options);
    case "xai":
      return new XAIProvider(options);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Plugin that registers all LLM providers with the agent
 */
export const providersPlugin: AgentPlugin = {
  name: "@openmgr/agent-providers",
  version: "0.1.0",
  providers: [
    {
      name: "anthropic",
      factory: (options: ProviderOptions) => new AnthropicProvider(options),
    },
    {
      name: "openai",
      factory: (options: ProviderOptions) => new OpenAIProvider(options),
    },
    {
      name: "google",
      factory: (options: ProviderOptions) => new GoogleProvider(options),
    },
    {
      name: "openrouter",
      factory: (options: ProviderOptions) => new OpenRouterProvider(options),
    },
    {
      name: "groq",
      factory: (options: ProviderOptions) => new GroqProvider(options),
    },
    {
      name: "xai",
      factory: (options: ProviderOptions) => new XAIProvider(options),
    },
  ],
};

export default providersPlugin;
