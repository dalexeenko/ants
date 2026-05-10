/**
 * @ants/agent
 *
 * Ants Agent - AI coding assistant with batteries included
 *
 * This is the main meta-package that re-exports all functionality from
 * the individual packages for convenience.
 */

// Core Agent functionality
export {
  // Agent class and factory
  Agent,
  createAgent,
  type AgentOptions,
  type AgentSessionContext,

  // Plugin system
  definePlugin,
  defineTool,
  defineProvider,
  defineCommand,
  type AgentPlugin,
  type AgentInterface,
  type ProviderDefinition,
  type ProviderOptions,
  type CommandDefinition,
  type CommandContext,
  type CommandResult,

  // Registries
  toolRegistry,
  providerRegistry,
  commandRegistry,

  // Types
  type Message,
  type MessageRole,
  type ToolCall,
  type ToolResult,
  type Session,
  type AgentEvent,
  type LLMMessage,
  type LLMTool,
  type LLMProvider,
  type LLMStreamOptions,
  type LLMStreamResult,
  type LLMStreamChunk,
  type LLMResponse,
  type ToolDefinition,
  type ToolContext,
  type ToolExecuteResult,
  type TodoItem,
  type PhaseItem,
  type BackgroundTask,
  type AuthConfig,
  type AuthType,
  type ProviderName,
  type AgentConfig,

  // Schemas
  MessageSchema,
  ToolCallSchema,
  ToolResultSchema,
  SessionSchema,
  AgentEventSchema,

  // Defaults
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_AGENT_CONFIG,

  // Config types
  type ResolvedConfig,
  type ConfigLoader,

  // MCP
  McpManager,
  SseMcpClient,
  registerMcpTools,
  unregisterMcpTools,
  registerMcpResourcesAndPrompts,
  unregisterMcpResourcesAndPrompts,
  type McpServerConfig,
  type McpStdioConfig,
  type McpSseConfig,
  type McpOAuthConfig,
  type McpTool,
  type McpResource,
  type McpPrompt,
  type McpClientFactory,
  type OAuthCallbackHandler,

  // Skills types
  type SkillMetadata,
  type LoadedSkill,
  type SkillManagerInterface,
  SkillLoadError,
  SkillNotFoundError,

  // Compaction
  CompactionEngine,
  COMPACTION_SUMMARY_PREFIX,
  type CompactionConfig,
  type CompactionResult,
  type CompactionStats,
  DEFAULT_COMPACTION_CONFIG,

  // Built-in commands
  registerBuiltinCommands,
} from "@ants/agent-core";

// Providers
export {
  providersPlugin,
  createProvider,
  AnthropicProvider,
  OpenAIProvider,
  GoogleProvider,
  OpenRouterProvider,
  GroqProvider,
  XAIProvider,
  type ProviderName as LLMProviderName,
} from "@ants/agent-providers";

// Tools (pure code)
export {
  todoReadTool,
  todoWriteTool,
  phaseReadTool,
  phaseWriteTool,
  webFetchTool,
  webSearchTool,
  skillTool,
  toolsPlugin,
} from "@ants/agent-tools";

// Tools (terminal/filesystem)
export {
  bashTool,
  readTool,
  writeTool,
  editTool,
  globTool,
  grepTool,
  toolsTerminalPlugin,
} from "@ants/agent-tools-terminal";

// Database
export {
  getDb,
  closeDb,
  getDbPath,
  getDefaultDbPath,
  createDatabase,
  createInMemoryDatabase,
  schema,
  runMigrations,
  initializeDatabase,
  type AgentDatabase,
  type DatabaseConfig,
  type BetterSQLite3Database,
  type MigrationResult,
  
  // Schema tables
  sessions,
  messages,
  compactionHistory,
  mcpOAuthTokens,
  memoryEntries,
  anthropicTokens,
  
  // Schema types
  type ToolCallData,
  type ToolResultData,
  type SessionRow,
  type SessionInsert,
  type MessageRow,
  type MessageInsert,
  type CompactionHistoryRow,
  type CompactionHistoryInsert,
  type McpOAuthTokenRow,
  type McpOAuthTokenInsert,
  type MemoryEntryRow,
  type MemoryEntryInsert,
  type AnthropicTokenRow,
  type AnthropicTokenInsert,
} from "@ants/agent-database";

// Storage (session management)
export {
  SessionManager,
  storagePlugin,
  type CreateSessionOptions,
  type CreateMessageOptions,
  type UpdateSessionOptions,
  type StoragePluginOptions,
} from "@ants/agent-storage";

// Memory — re-exported as type-only. Runtime values must be accessed via the
// loadMemoryModule() helper or by importing @ants/agent-memory directly.
// The memory package depends on @huggingface/transformers which may not be
// installed (e.g. lite Docker image), so static re-exports would crash.
export type { MemoryItem, MemorySearchResult } from "@ants/agent-memory";

/**
 * Lazily load the @ants/agent-memory module.
 * Returns null if the module or its native dependencies are unavailable
 * (e.g. in the lite Docker image where onnxruntime is stripped).
 */
export async function loadMemoryModule(): Promise<typeof import("@ants/agent-memory") | null> {
  try {
    return await import("@ants/agent-memory");
  } catch {
    return null;
  }
}

// Anthropic OAuth Provider (from providers package)
export {
  AnthropicOAuthProvider,
  createAnthropicOAuthProvider,
  type AnthropicOAuthProviderOptions,
} from "@ants/agent-providers";

// Auth (OAuth flow utilities)
export {
  // PKCE utilities
  WebCryptoPKCEUtils,
  generateCodeVerifier,
  generateCodeChallenge,
  // OAuth flow functions (require OAuthTokenStore)
  login,
  exchangeCode,
  isLoggedIn,
  getValidAccessToken,
  createOAuthHandler,
  // URL generation
  generateAuthorizationUrl,
  // Types
  type LoginResult,
  type AuthorizationInfo,
} from "@ants/agent-auth-anthropic";

// Re-exports from auth-core
export {
  refreshAccessToken,
  exchangeCodeForTokens,
  shouldRefreshTokens,
  buildAuthorizationUrl,
  ANTHROPIC_OAUTH_CONFIG,
  type OAuthTokens,
  type OAuthTokenStore,
  type PKCEUtils,
  type OAuthFlowHandler,
} from "@ants/agent-auth-core";

// Skills (from skills-loader which now includes bundled skills)
export {
  skillsBundledPlugin,
  bundledSkills,
  getBundledSkillPath,
  getBundledSkillNames,
  getBundledSkillsDir,
  FilesystemSkillManager,
  type BundledSkillInfo,
} from "@ants/agent-skills-loader";

// LSP
export {
  LspManager,
  LspClient,
  LspTransport,
  getLanguageId,
  DEFAULT_LANGUAGE_SERVERS,
  LANGUAGE_IDS,
  type LanguageServerConfig,
  type LspManagerOptions,
  type Diagnostic,
  type Position,
} from "@ants/agent-lsp";

// Server
export {
  createServer,
  startServer,
  serverPlugin,
  type ServerConfig,
  type ServerState,
} from "@ants/agent-server";

// CLI
export {
  registerAllCommands,
  Spinner,
  DebugLogger,
  debug,
} from "@ants/agent-cli";
