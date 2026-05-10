/**
 * @openmgr/agent-react-native
 *
 * React Native bundle package for OpenMgr Agent.
 *
 * This package re-exports all React Native compatible components,
 * making it easy to use OpenMgr Agent in a React Native/Expo app.
 *
 * ## Included Packages
 *
 * - `@openmgr/agent-core` - Core agent functionality (includes skill managers)
 * - `@openmgr/agent-providers` - LLM provider integrations
 * - `@openmgr/agent-database-core` - Database schema and types
 * - `@openmgr/agent-database-react-native` - SQLite database for RN
 * - `@openmgr/agent-auth-core` - OAuth types and utilities
 * - `@openmgr/agent-auth-react-native` - OAuth for RN with Expo
 * - `@openmgr/agent-tools` - Platform-agnostic tools
 *
 * ## Quick Start
 *
 * ```typescript
 * import {
 *   Agent,
 *   createReactNativeDatabase,
 *   BundledSkillManager,
 *   createExpoOAuthHandler,
 * } from "@openmgr/agent-react-native";
 * import * as SQLite from "expo-sqlite";
 * import * as AuthSession from "expo-auth-session";
 * import * as Crypto from "expo-crypto";
 * import * as SecureStore from "expo-secure-store";
 * import * as WebBrowser from "expo-web-browser";
 *
 * // Setup database
 * const { db, close } = createReactNativeDatabase(SQLite, { path: "agent.db" });
 *
 * // Setup skills
 * const skillManager = new BundledSkillManager([
 *   { name: "code-review", content: SKILL_CODE_REVIEW },
 * ]);
 *
 * // Setup auth
 * const auth = createExpoOAuthHandler({
 *   AuthSession,
 *   Crypto,
 *   SecureStore,
 *   WebBrowser,
 *   appScheme: "myapp",
 * });
 *
 * // Create agent
 * const agent = new Agent({
 *   provider: "anthropic",
 *   model: "claude-sonnet-4-20250514",
 * });
 * ```
 */

// ============================================================================
// Core
// ============================================================================

export {
  // Agent
  Agent,
  createAgent,
  type AgentOptions,

  // Plugin system
  definePlugin,
  type AgentPlugin,

  // Tool system
  defineTool,
  type ToolDefinition,
  type ToolContext,
  type ToolResult,
  type ToolCall,

  // Events
  type AgentEvent,

  // Messages
  type Message,
  type MessageRole,

  // Skills types (platform-agnostic)
  type SkillMetadata,
  type LoadedSkill,
  type SkillSource,
  type SkillReference,
  type SkillManagerInterface,
  SkillLoadError,
  SkillNotFoundError,
  SkillMetadataSchema,
  toSkillMetadata,
  parseAllowedTools,

  // Subagent support
  SubagentManager,
  type SubagentManagerOptions,

  // Capabilities
  capabilityRegistry,
  CapabilityRegistry,

  // Agent type registry
  agentTypeRegistry,
  type AgentTypeDefinition,

  // Title generation
  generateTitle,
  isDefaultTitle,
} from "@openmgr/agent-core";

// ============================================================================
// Providers
// ============================================================================

export {
  // Provider classes
  AnthropicProvider,
  OpenAIProvider,
  GoogleProvider,
  OpenRouterProvider,
  GroqProvider,
  XAIProvider,
  type ProviderOptions,

  // Factory
  createProvider,
  type ProviderName,

  // Plugin
  providersPlugin,

  // Direct clients (for custom usage)
  AnthropicClient,
  OpenAIClient,
  GoogleClient,
} from "@openmgr/agent-providers";

// ============================================================================
// Database
// ============================================================================

export {
  // Schema and types from core
  schema,
  type Schema,
  type DatabaseConfig,
  type DatabaseConnection,
  type DatabaseAdapter,
  type MigrationResult,
  getSchemaStatements,
} from "@openmgr/agent-database-core";

export {
  // React Native database implementation
  createReactNativeDatabase,
  createInMemoryReactNativeDatabase,
  createReactNativeDatabaseAdapter,
  runReactNativeMigrations,
  type AgentDatabase,
  type ExpoSQLiteModule,
  type ReactNativeDatabaseConnection,
  DEFAULT_DB_NAME,
} from "@openmgr/agent-database-react-native";

// ============================================================================
// Storage (Session Management)
// ============================================================================

export {
  // Session manager
  SessionManager,
  type SessionManagerOptions,
  type GenericAgentDatabase,
  type CreateSessionOptions,
  type CreateMessageOptions,
  type UpdateSessionOptions,
  type SearchSessionsOptions,
  type SearchMessagesOptions,
  type SearchSessionResult,
  type SearchMessageResult,
  // Schema tables
  projects,
  remoteServers,
  sessions,
  messages,
  compactionHistory,
  // Schema types
  type ProjectRow,
  type ProjectInsert,
  type RemoteServerRow,
  type RemoteServerInsert,
  type SessionRow,
  type SessionInsert,
  type MessageRow,
  type MessageInsert,
  type CompactionHistoryRow,
  type CompactionHistoryInsert,
  type ToolCallData,
  type ToolResultData,
} from "@openmgr/agent-storage/portable";

// Re-export drizzle-orm utilities for type-compatible usage in apps
export { eq, desc, and, or, like, isNull, asc, sql } from "drizzle-orm";

// ============================================================================
// Skills
// ============================================================================

export {
  // Skill parsing
  parseSkillMd,

  // Bundled skills manager
  BundledSkillManager,
  type BundledSkill,
  type BundledSkillManagerOptions,

  // Remote skills manager
  RemoteSkillManager,
  type RemoteSkillConfig,
  type RemoteSkillListResponse,
  type RemoteSkillResponse,

  // Hybrid manager
  HybridSkillManager,
  type HybridSkillManagerOptions,
} from "@openmgr/agent-core";

// Re-export BundledSkillManager as SkillManager for convenience
export { BundledSkillManager as SkillManager } from "@openmgr/agent-core";

// ============================================================================
// Auth
// ============================================================================

export {
  // Types
  type OAuthTokens,
  type OAuthTokenStore,
  type PKCEUtils,
  type OAuthFlowHandler,
  type AuthorizationInfo,
  type OAuthCallbackHandler,

  // Config
  ANTHROPIC_OAUTH_CONFIG,
  TOKEN_REFRESH_BUFFER_SECONDS,

  // Utilities
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  shouldRefreshTokens,
  base64UrlEncode,
  base64ToBase64Url,
  createOAuthFlowHandler,
} from "@openmgr/agent-auth-core";

export {
  // React Native auth implementation
  createExpoOAuthHandler,
  createManualOAuthHandler,
  SecureTokenStore,
  ExpoPKCEUtils,
  type ExpoOAuthHandlerOptions,
  type ExpoSecureStore,
  type ExpoCrypto,
  type ExpoWebBrowser,
  type ExpoAuthSession,
} from "@openmgr/agent-auth-react-native";

export {
  // Anthropic OAuth Provider for React Native
  AnthropicOAuthProvider,
  createAnthropicOAuthProvider,
  type AnthropicOAuthProviderOptions,
} from "@openmgr/agent-providers";

// Re-export OAuth types from auth-core
export { type OAuthTokens as AnthropicOAuthTokens } from "@openmgr/agent-auth-core";

// ============================================================================
// Tools (platform-agnostic only)
// ============================================================================

export {
  // Todo tools
  todoReadTool,
  todoWriteTool,

  // Phase tools
  phaseReadTool,
  phaseWriteTool,

  // Web tools
  webFetchTool,
  webSearchTool,

  // Skill tool
  skillTool,

  // Plugin
  toolsPlugin,
} from "@openmgr/agent-tools";

// ============================================================================
// Filesystem
// ============================================================================

export {
  // React Native filesystem implementation
  ReactNativeFilesystem,
  createReactNativeFilesystem,
  type ExpoFileSystemModule,
} from "./filesystem.js";

// Re-export filesystem types from core
export type {
  Filesystem,
  FileStat,
  DirectoryEntry,
} from "@openmgr/agent-core";

// ============================================================================
// File Tools (platform-agnostic, require filesystem extension)
// ============================================================================

export {
  // Individual tools
  readTool,
  writeTool,
  editTool,
  listTool,
  
  // All tools array
  fileTools,
  
  // Plugin
  fileToolsPlugin,
} from "./file-tools.js";
