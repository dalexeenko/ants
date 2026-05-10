/**
 * Google AI provider (Gemini models) using direct API calls.
 */

import type { LLMProvider, LLMStreamOptions, LLMStreamResult, AuthConfig } from "@ants/agent-core";
import { GoogleClient, type GoogleClientOptions } from "./google-client.js";

export interface GoogleProviderOptions {
  auth?: AuthConfig;
  apiKey?: string;
  /** Custom fetch function */
  fetch?: typeof fetch;
  /** Base URL for the API */
  baseUrl?: string;
  /** Default headers */
  defaultHeaders?: Record<string, string>;
}

export class GoogleProvider implements LLMProvider {
  private client: GoogleClient;
  private apiKey: string;

  constructor(options: GoogleProviderOptions = {}) {
    this.apiKey = options.auth?.apiKey ?? options.apiKey ?? "";

    const clientOptions: GoogleClientOptions = {
      fetch: options.fetch,
      baseUrl: options.baseUrl,
      defaultHeaders: options.defaultHeaders,
    };

    this.client = new GoogleClient(clientOptions);
  }

  async stream(options: LLMStreamOptions): Promise<LLMStreamResult> {
    if (!this.apiKey) {
      throw new Error("Google AI API key not configured. Pass apiKey option when creating the provider.");
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
