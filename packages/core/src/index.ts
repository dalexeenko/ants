/**
 * @ants/agent-core
 *
 * Core agent functionality including the Agent class, plugin system, MCP integration,
 * skills, compaction, and slash commands.
 */

// Errors
export { IncompleteResponseError } from "./errors.js";

// Main Agent class
export { Agent, createAgent } from "./agent.js";
export type { AgentOptions, AgentSessionContext } from "./agent.js";

// Plugin system
export {
  definePlugin,
  defineTool,
  defineProvider,
  defineCommand,
} from "./plugin.js";
export type {
  AgentPlugin,
  AgentInterface,
  ProviderDefinition,
  ProviderOptions,
  CommandDefinition,
  CommandContext,
  CommandResult,
  PluginSkillSource,
} from "./plugin.js";

// Registries (classes + global singleton instances)
export { ToolRegistry, toolRegistry } from "./registry/tools.js";
export { ProviderRegistry, providerRegistry } from "./registry/providers.js";
export { CommandRegistry, commandRegistry } from "./registry/commands.js";
export { AgentTypeRegistry, agentTypeRegistry } from "./registry/agent-types.js";
export type { AgentTypeDefinition, AgentTypeConflict } from "./registry/agent-types.js";

// Types
export type {
  Message,
  MessageRole,
  ToolCall,
  ToolResult,
  Session,
  AgentEvent,
  LLMMessage,
  LLMTool,
  LLMProvider,
  LLMStreamOptions,
  LLMStreamResult,
  LLMStreamChunk,
  LLMResponse,
  FinishReason,
  ToolDefinition,
  ToolContext,
  ToolExecuteResult,
  TodoItem,
  PhaseItem,
  BackgroundTask,
  AuthConfig,
  AuthType,
  ProviderName,
  AgentConfig,
  ImagePart,
  ImageSourceBase64,
  ImageSourceUrl,
  TextPart,
  ContentPart,
  // Filesystem abstraction
  Filesystem,
  FileStat,
  DirectoryEntry,
  // Structured tool result types
  FileResult,
  SearchResult,
  ErrorResult,
  CommandExecutionResult,
  ListResult,
  DiffResult,
  StructuredResult,
  // Question tool types
  QuestionResponse,
  // Agent mode
  AgentMode,
} from "./types.js";

// Schemas (for runtime validation)
export {
  MessageSchema,
  ToolCallSchema,
  ToolResultSchema,
  SessionSchema,
  AgentEventSchema,
  FinishReasonSchema,
  ImageSourceBase64Schema,
  ImageSourceUrlSchema,
  ImagePartSchema,
  TextPartSchema,
  ContentPartSchema,
} from "./types.js";

// Defaults
export { DEFAULT_SYSTEM_PROMPT, DEFAULT_AGENT_CONFIG, PLAN_MODE_SYSTEM_PROMPT_SECTION, BUILD_MODE_SYSTEM_PROMPT_SECTION, PLAN_MODE_DISABLED_TOOLS } from "./types.js";

// Config types (pure - no Node.js dependencies)
// For Node.js filesystem config, use @ants/agent-config-xdg or @ants/agent-node
export {
  type ConfigLoader,
  type ConfigOverrides,
  type ResolvedConfig,
  type ResolvedAuth,
  type Config,
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
} from "./config/index.js";

// MCP
export { McpManager } from "./mcp/manager.js";
export type { McpManagerOptions, McpManagerEvents } from "./mcp/manager.js";
export { SseMcpClient } from "./mcp/sse-client.js";
export type { OAuthTokens, OAuthTokenStore, OAuthCallbackHandler } from "./mcp/oauth.js";
export {
  registerMcpTools,
  unregisterMcpTools,
  registerMcpResourcesAndPrompts,
  unregisterMcpResourcesAndPrompts,
} from "./mcp/adapter.js";
export {
  McpServerConfigSchema,
  McpStdioConfigSchema,
  McpSseConfigSchema,
  McpOAuthConfigSchema,
  expandEnvVars,
  defaultEnvResolver,
} from "./mcp/types.js";
export type {
  McpServerConfig,
  McpStdioConfig,
  McpSseConfig,
  McpOAuthConfig,
  McpTool,
  McpResource,
  McpPrompt,
  McpClientInterface,
  McpClientFactory,
  McpServerStatus,
  EnvResolver,
} from "./mcp/types.js";

// Note: StdioMcpClient is no longer exported from core.
// For stdio MCP transport, use @ants/agent-mcp-stdio or @ants/agent-node.

// Skills types (pure - no Node.js dependencies)
// For Node.js filesystem skills, use @ants/agent-skills-loader or @ants/agent-node
export type {
  SkillMetadata,
  LoadedSkill,
  SkillSource,
  SkillReference,
  SkillManagerInterface,
} from "./skills/types.js";
export {
  SkillLoadError,
  SkillNotFoundError,
  SkillMetadataSchema,
  SkillNameSchema,
  SkillDescriptionSchema,
  SkillCompatibilitySchema,
  toSkillMetadata,
  parseAllowedTools,
} from "./skills/types.js";

// Platform-agnostic skill managers (work in React Native, browsers, etc.)
export {
  parseSkillMd,
  BundledSkillManager,
  RemoteSkillManager,
  HybridSkillManager,
} from "./skills/managers.js";
export type {
  BundledSkill,
  BundledSkillManagerOptions,
  RemoteSkillConfig,
  RemoteSkillListResponse,
  RemoteSkillResponse,
  HybridSkillManagerOptions,
} from "./skills/managers.js";

// Compaction
export { CompactionEngine, COMPACTION_SUMMARY_PREFIX } from "./compaction/engine.js";
export type {
  CompactionConfig,
  CompactionResult,
  CompactionStats,
} from "./compaction/types.js";
export { DEFAULT_COMPACTION_CONFIG } from "./compaction/types.js";

// Built-in commands
export { registerBuiltinCommands } from "./commands/builtin.js";

// Title generation
export { generateTitle, isDefaultTitle } from "./title.js";
export type { TitleGeneratorOptions } from "./title.js";

// Tool Permissions
export {
  ToolPermissionManager,
  createReadOnlyConfig,
} from "./permissions.js";
export type {
  ToolPermissionConfig,
  PermissionDecision,
  PermissionResponse,
  PermissionRequestCallback,
} from "./permissions.js";

// Usage tracking
export { UsageTracker, MODEL_PRICING } from "./usage/index.js";
export type {
  TokenUsage,
  ModelPricing,
  UsageRecord,
  UsageBudget,
  UsageSummary,
  UsageRecordCallback,
} from "./usage/index.js";

// Subagent management
export { SubagentManager } from "./subagent/index.js";
export type {
  SubagentManagerOptions,
  AgentFactory,
  SubagentSpawnOptions,
  SubagentResult,
  SubagentInfo,
  SubagentStatus,
  SubagentUsage,
  SubagentManagerInterface,
  SharedStateEntry,
  SharedStateEvents,
  BusMessage,
  MessageBusEvents,
} from "./subagent/index.js";

// Middleware
export type { Middleware, MiddlewareContext, NextFunction, NamedMiddleware } from "./middleware/index.js";

// Conversation Branching
export { ConversationTree } from "./branching/index.js";
export type { ConversationNode, Branch } from "./branching/index.js";

// System Prompt Composition
export type { PromptSection, ComposeOptions } from "./prompt/composer.js";

// Capabilities
export { capabilityRegistry, CapabilityRegistry } from "./capabilities/index.js";
export type { CapabilityName, CapabilityInfo, WellKnownCapability } from "./capabilities/index.js";

// Retry and Circuit Breaker
export { withRetry, CircuitBreaker, isTransientError } from "./retry/index.js";
export { DEFAULT_RETRY_POLICY } from "./retry/index.js";
export type { RetryPolicy, CircuitBreakerConfig, CircuitBreakerState } from "./retry/index.js";

// Plugin Manager
export { PluginManager } from "./plugins/manager.js";
export type {
  PluginManagerOptions,
  InstalledPluginInfo,
  PluginInstallResult,
} from "./plugins/manager.js";

// Cross-platform utilities
export { generateId, getParentDir } from "./utils/id.js";
