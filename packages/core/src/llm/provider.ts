import type { LLMProvider, AuthConfig } from "../types.js";

export interface ProviderOptions {
  auth?: AuthConfig;
  apiKey?: string;
  baseUrl?: string;
  [key: string]: unknown;
}

export abstract class BaseLLMProvider implements LLMProvider {
  protected auth: AuthConfig;

  constructor(options: ProviderOptions = {}) {
    if (options.apiKey) {
      this.auth = { type: "api-key", apiKey: options.apiKey };
    } else {
      this.auth = options.auth ?? { type: "oauth" };
    }
  }

  abstract stream(options: Parameters<LLMProvider["stream"]>[0]): ReturnType<LLMProvider["stream"]>;
}
