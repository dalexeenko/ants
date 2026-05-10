/**
 * OpenAI provider (GPT models) using direct API calls.
 */

import type { LLMProvider, LLMStreamOptions, LLMStreamResult, AuthConfig } from "@openmgr/agent-core";
import { OpenAIClient, type OpenAIClientOptions } from "./openai-client.js";

export interface OpenAIProviderOptions {
  auth?: AuthConfig;
  apiKey?: string;
  /** Custom fetch function */
  fetch?: typeof fetch;
  /** Base URL for the API */
  baseUrl?: string;
  /** Default headers */
  defaultHeaders?: Record<string, string>;
}

export class OpenAIProvider implements LLMProvider {
  private client: OpenAIClient;
  private apiKey: string;

  constructor(options: OpenAIProviderOptions = {}) {
    this.apiKey = options.auth?.apiKey ?? options.apiKey ?? "";

    const clientOptions: OpenAIClientOptions = {
      fetch: options.fetch,
      baseUrl: options.baseUrl ?? "https://api.openai.com/v1",
      defaultHeaders: options.defaultHeaders,
    };

    this.client = new OpenAIClient(clientOptions);
  }

  async stream(options: LLMStreamOptions): Promise<LLMStreamResult> {
    if (!this.apiKey) {
      throw new Error("OpenAI API key not configured. Pass apiKey option when creating the provider.");
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
