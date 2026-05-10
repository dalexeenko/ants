/**
 * OpenRouter provider (multi-model gateway) using direct API calls.
 * Uses OpenAI-compatible API with custom base URL.
 */

import type { LLMProvider, LLMStreamOptions, LLMStreamResult, AuthConfig } from "@ants/agent-core";
import { OpenAIClient, type OpenAIClientOptions } from "./openai-client.js";

export interface OpenRouterProviderOptions {
  auth?: AuthConfig;
  apiKey?: string;
  /** Custom fetch function */
  fetch?: typeof fetch;
  /** Default headers */
  defaultHeaders?: Record<string, string>;
}

export class OpenRouterProvider implements LLMProvider {
  private client: OpenAIClient;
  private apiKey: string;

  constructor(options: OpenRouterProviderOptions = {}) {
    this.apiKey = options.auth?.apiKey ?? options.apiKey ?? "";

    const clientOptions: OpenAIClientOptions = {
      fetch: options.fetch,
      baseUrl: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://ants.ai",
        "X-Title": "Ants Agent",
        ...options.defaultHeaders,
      },
    };

    this.client = new OpenAIClient(clientOptions);
  }

  async stream(options: LLMStreamOptions): Promise<LLMStreamResult> {
    if (!this.apiKey) {
      throw new Error("OpenRouter API key not configured. Pass apiKey option when creating the provider.");
    }

    return this.client.stream(
      { apiKey: this.apiKey },
      {
        model: options.model,
        messages: options.messages,
        tools: options.tools,
        system: options.system,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        abortSignal: options.abortSignal,
      }
    );
  }
}
