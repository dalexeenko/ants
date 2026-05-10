/**
 * Groq provider (fast inference) using direct API calls.
 * Uses OpenAI-compatible API with custom base URL.
 */

import type { LLMProvider, LLMStreamOptions, LLMStreamResult, AuthConfig } from "@ants/agent-core";
import { OpenAIClient, type OpenAIClientOptions } from "./openai-client.js";

export interface GroqProviderOptions {
  auth?: AuthConfig;
  apiKey?: string;
  /** Custom fetch function */
  fetch?: typeof fetch;
  /** Default headers */
  defaultHeaders?: Record<string, string>;
}

export class GroqProvider implements LLMProvider {
  private client: OpenAIClient;
  private apiKey: string;

  constructor(options: GroqProviderOptions = {}) {
    this.apiKey = options.auth?.apiKey ?? options.apiKey ?? "";

    const clientOptions: OpenAIClientOptions = {
      fetch: options.fetch,
      baseUrl: "https://api.groq.com/openai/v1",
      defaultHeaders: options.defaultHeaders,
    };

    this.client = new OpenAIClient(clientOptions);
  }

  async stream(options: LLMStreamOptions): Promise<LLMStreamResult> {
    if (!this.apiKey) {
      throw new Error("Groq API key not configured. Pass apiKey option when creating the provider.");
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
