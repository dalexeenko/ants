/**
 * Base types and utilities for LLM providers.
 */

import type { AuthConfig } from "@ants/agent-core";

export interface ProviderOptions {
  auth?: AuthConfig;
  apiKey?: string;
  /** Custom fetch function (for React Native, use expo/fetch) */
  fetch?: typeof fetch;
  /** Base URL for the API */
  baseUrl?: string;
  /** Default headers to include in all requests */
  defaultHeaders?: Record<string, string>;
}
