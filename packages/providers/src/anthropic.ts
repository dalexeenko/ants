/**
 * Anthropic provider (Claude models) using direct API calls.
 * 
 * This provider uses our custom Anthropic client instead of the Vercel AI SDK,
 * which works cross-platform (Node.js, Electron, React Native).
 */

import type { LLMProvider, LLMStreamOptions, LLMStreamResult, AuthConfig } from "@ants/agent-core";
import { AnthropicClient, type AnthropicAuth, type AnthropicClientOptions } from "./anthropic-client.js";

export interface AnthropicProviderOptions {
  auth?: AuthConfig;
  apiKey?: string;
  /** Custom fetch function (for React Native, use expo/fetch) */
  fetch?: typeof fetch;
  /** Base URL for the API */
  baseUrl?: string;
  /** Default headers to include in all requests */
  defaultHeaders?: Record<string, string>;
}

/**
 * Anthropic provider using direct API calls.
 * 
 * For API key authentication:
 * ```ts
 * const provider = new AnthropicProvider({ apiKey: "sk-ant-..." });
 * ```
 * 
 * For OAuth authentication (used by auth-anthropic package):
 * ```ts
 * const provider = new AnthropicProvider({
 *   auth: { type: "oauth" },
 *   // accessToken is passed per-request via stream options
 * });
 * ```
 */
export class AnthropicProvider implements LLMProvider {
  private client: AnthropicClient;
  private auth: AuthConfig;

  constructor(options: AnthropicProviderOptions = {}) {
    this.auth = options.auth ?? { 
      type: "api-key", 
      apiKey: options.apiKey 
    };

    const clientOptions: AnthropicClientOptions = {
      fetch: options.fetch,
      baseUrl: options.baseUrl,
      defaultHeaders: options.defaultHeaders,
    };

    this.client = new AnthropicClient(clientOptions);
  }

  async stream(options: LLMStreamOptions): Promise<LLMStreamResult> {
    const auth: AnthropicAuth = {
      type: this.auth.type === "oauth" ? "oauth" : "api-key",
      apiKey: this.auth.apiKey,
    };

    if (this.auth.type === "api-key" && !this.auth.apiKey) {
      throw new Error("Anthropic API key not configured. Pass apiKey option when creating the provider.");
    }

    return this.client.stream(auth, {
      model: options.model,
      messages: options.messages,
      tools: options.tools,
      system: options.system,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      abortSignal: options.abortSignal,
    });
  }
}
