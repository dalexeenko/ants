/**
 * Configuration types and utilities
 */

export {
  type Config,
  type ConfigLoader,
  type ConfigOverrides,
  type ResolvedConfig,
  type ResolvedAuth,
  type AuthType,
  type ProviderAuth,
  type ApiKeys,
  type LspServerConfig,
  type AgentTypeConfig,
  LspServerConfigSchema,
  AuthTypeSchema,
  ProviderAuthSchema,
  ApiKeysSchema,
  CONFIG_DEFAULTS,
  normalizeProviderAuth,
  mergeConfigs,
} from "./types.js";
