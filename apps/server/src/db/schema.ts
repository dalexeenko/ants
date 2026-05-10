import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  workingDirectory: text('working_directory').notNull(),
  autoStart: integer('auto_start', { mode: 'boolean' }).notNull().default(true),
  worktreeEnabled: integer('worktree_enabled', { mode: 'boolean' }),
  agentConfig: text('agent_config'), // JSON string for agent configuration
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').notNull().unique(),
  encryptedValues: text('encrypted_values').notNull(),
  encryptedOauth: text('encrypted_oauth'), // AES-256-GCM encrypted JSON: OAuthCredentials
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const customEnvVars = sqliteTable('custom_env_vars', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  envVar: text('env_var').notNull().unique(),
  encryptedValue: text('encrypted_value').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  prompt: text('prompt').notNull(),
  schedule: text('schedule'),
  webhookUrl: text('webhook_url'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastRunAt: integer('last_run_at', { mode: 'timestamp' }),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export type NewProject = typeof projects.$inferInsert;
export type Project = typeof projects.$inferSelect;

export type NewApiKey = typeof apiKeys.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;

export type NewCustomEnvVar = typeof customEnvVars.$inferInsert;
export type CustomEnvVar = typeof customEnvVars.$inferSelect;

export type NewTask = typeof tasks.$inferInsert;
export type Task = typeof tasks.$inferSelect;

// ============================================================================
// Channels - Messaging platform connections (Slack, Discord, etc.)
// ============================================================================

export const channels = sqliteTable('channels', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // 'slack', 'discord', 'twitter', etc.
  name: text('name').notNull(),
  config: text('config').notNull(), // JSON platform-specific configuration
  credentials: text('credentials').notNull(), // JSON encrypted credentials
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export type NewChannel = typeof channels.$inferInsert;
export type Channel = typeof channels.$inferSelect;

// ============================================================================
// Channel Project Bindings - Many-to-many with trigger/response configuration
// ============================================================================

export const channelProjectBindings = sqliteTable('channel_project_bindings', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  triggerConfig: text('trigger_config').notNull(), // JSON trigger rules
  responseConfig: text('response_config'), // JSON response settings
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  priority: integer('priority').notNull().default(0),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export type NewChannelProjectBinding = typeof channelProjectBindings.$inferInsert;
export type ChannelProjectBinding = typeof channelProjectBindings.$inferSelect;

// ============================================================================
// Channel Message Queue - Persistent queue for reliable message processing
// ============================================================================

export const channelMessageQueue = sqliteTable('channel_message_queue', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  bindingId: text('binding_id').references(() => channelProjectBindings.id, { onDelete: 'set null' }),
  direction: text('direction').notNull(), // 'inbound' | 'outbound'
  status: text('status').notNull(), // 'pending' | 'processing' | 'completed' | 'failed'
  payload: text('payload').notNull(), // JSON message content
  platformRef: text('platform_ref'), // Platform message/thread ID
  sessionId: text('session_id'), // Agent session ID
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  processedAt: integer('processed_at', { mode: 'timestamp' }),
});

export type NewChannelMessage = typeof channelMessageQueue.$inferInsert;
export type ChannelMessage = typeof channelMessageQueue.$inferSelect;

// ============================================================================
// Channel Thread Sessions - Maps platform threads to agent sessions
// ============================================================================

export const channelThreadSessions = sqliteTable('channel_thread_sessions', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  platformThreadId: text('platform_thread_id').notNull(),
  sessionId: text('session_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  lastActiveAt: integer('last_active_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  uniqueIndex('channel_thread_unique').on(table.channelId, table.platformThreadId),
]);

export type NewChannelThreadSession = typeof channelThreadSessions.$inferInsert;
export type ChannelThreadSession = typeof channelThreadSessions.$inferSelect;

// ============================================================================
// Analytics - Usage tracking, cost estimation, and performance metrics
// ============================================================================

export const analyticsEvents = sqliteTable('analytics_events', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  sessionId: text('session_id'),
  eventType: text('event_type').notNull(), // 'prompt', 'tool_call', 'task_run', 'error', 'agent_start', 'agent_stop'
  provider: text('provider'),
  model: text('model'),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  totalTokens: integer('total_tokens'),
  cacheCreationInputTokens: integer('cache_creation_input_tokens'),
  cacheReadInputTokens: integer('cache_read_input_tokens'),
  estimatedCostUsd: integer('estimated_cost_usd'), // stored as microdollars (1/1,000,000 USD) for precision
  durationMs: integer('duration_ms'),
  toolName: text('tool_name'),
  success: integer('success', { mode: 'boolean' }),
  errorMessage: text('error_message'),
  metadata: text('metadata'), // JSON
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export type NewAnalyticsEvent = typeof analyticsEvents.$inferInsert;
export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;

export const analyticsDaily = sqliteTable('analytics_daily', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  date: text('date').notNull(), // YYYY-MM-DD
  totalPrompts: integer('total_prompts').notNull().default(0),
  totalToolCalls: integer('total_tool_calls').notNull().default(0),
  totalTaskRuns: integer('total_task_runs').notNull().default(0),
  successfulTaskRuns: integer('successful_task_runs').notNull().default(0),
  failedTaskRuns: integer('failed_task_runs').notNull().default(0),
  totalPromptTokens: integer('total_prompt_tokens').notNull().default(0),
  totalCompletionTokens: integer('total_completion_tokens').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  totalCacheCreationInputTokens: integer('total_cache_creation_input_tokens').notNull().default(0),
  totalCacheReadInputTokens: integer('total_cache_read_input_tokens').notNull().default(0),
  totalCostUsd: integer('total_cost_usd').notNull().default(0), // microdollars
  totalErrors: integer('total_errors').notNull().default(0),
  avgResponseMs: integer('avg_response_ms'),
  uniqueSessions: integer('unique_sessions').notNull().default(0),
}, (table) => [
  uniqueIndex('analytics_daily_project_date').on(table.projectId, table.date),
]);

export type NewAnalyticsDaily = typeof analyticsDaily.$inferInsert;
export type AnalyticsDaily = typeof analyticsDaily.$inferSelect;

// ============================================================================
// Agent-to-Agent Communication
// ============================================================================

export const agentMessages = sqliteTable('agent_messages', {
  id: text('id').primaryKey(),
  fromProjectId: text('from_project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  toProjectId: text('to_project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'request', 'response', 'notification'
  action: text('action').notNull(), // 'code_review', 'question', 'share_finding', 'task_delegate', 'custom'
  subject: text('subject'),
  content: text('content').notNull(),
  metadata: text('metadata'), // JSON
  parentMessageId: text('parent_message_id').references((): any => agentMessages.id),
  status: text('status').notNull().default('pending'), // 'pending', 'delivered', 'processing', 'completed', 'failed'
  responseContent: text('response_content'),
  sessionId: text('session_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  processedAt: integer('processed_at', { mode: 'timestamp' }),
});

export type NewAgentMessage = typeof agentMessages.$inferInsert;
export type AgentMessage = typeof agentMessages.$inferSelect;

// ============================================================================
// Webhooks & External Event Triggers
// ============================================================================

export const webhookEndpoints = sqliteTable('webhook_endpoints', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(), // URL-safe identifier for the webhook path
  secret: text('secret'), // HMAC secret for signature verification
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  source: text('source').notNull(), // 'github', 'gitlab', 'bitbucket', 'generic', 'ci'
  eventFilter: text('event_filter'), // JSON array of event types to accept
  promptTemplate: text('prompt_template').notNull(), // Template with {{variables}} for the prompt
  sessionMode: text('session_mode').notNull().default('newEachRun'), // 'newEachRun' | 'dedicated'
  dedicatedSessionId: text('dedicated_session_id'),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  uniqueIndex('webhook_endpoints_slug').on(table.projectId, table.slug),
]);

export type NewWebhookEndpoint = typeof webhookEndpoints.$inferInsert;
export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;

export const webhookDeliveries = sqliteTable('webhook_deliveries', {
  id: text('id').primaryKey(),
  endpointId: text('endpoint_id').notNull().references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
  source: text('source').notNull(),
  eventType: text('event_type'),
  payload: text('payload').notNull(), // JSON
  status: text('status').notNull().default('pending'), // 'pending', 'processing', 'completed', 'failed', 'ignored'
  sessionId: text('session_id'),
  prompt: text('prompt'), // The rendered prompt
  responseContent: text('response_content'),
  errorMessage: text('error_message'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  processedAt: integer('processed_at', { mode: 'timestamp' }),
});

export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;

export const fileWatchers = sqliteTable('file_watchers', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  watchPath: text('watch_path').notNull(), // Relative to project working directory
  patterns: text('patterns'), // JSON array of glob patterns to match
  ignorePatterns: text('ignore_patterns'), // JSON array of glob patterns to ignore
  events: text('events').notNull().default('["change"]'), // JSON array: 'change', 'add', 'unlink'
  debounceMs: integer('debounce_ms').notNull().default(1000),
  promptTemplate: text('prompt_template').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export type NewFileWatcher = typeof fileWatchers.$inferInsert;
export type FileWatcher = typeof fileWatchers.$inferSelect;

// ============================================================================
// Multi-User Support - Users, Roles, and Audit Logging
// ============================================================================

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  displayName: text('display_name'),
  email: text('email'),
  passwordHash: text('password_hash').notNull(), // scrypt hash
  role: text('role').notNull().default('operator'), // 'admin', 'operator', 'viewer'
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export type NewUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

export const userTokens = sqliteTable('user_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(), // SHA-256 hash of the token
  name: text('name').notNull(), // description/label for this token
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }), // null = never
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export type NewUserToken = typeof userTokens.$inferInsert;
export type UserToken = typeof userTokens.$inferSelect;

export const projectAccess = sqliteTable('project_access', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('operator'), // 'admin', 'operator', 'viewer'
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  uniqueIndex('project_access_unique').on(table.userId, table.projectId),
]);

export type NewProjectAccess = typeof projectAccess.$inferInsert;
export type ProjectAccess = typeof projectAccess.$inferSelect;

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  username: text('username'), // denormalized for when user is deleted
  action: text('action').notNull(), // 'project.create', 'session.prompt', 'user.login', etc.
  resourceType: text('resource_type'), // 'project', 'session', 'task', 'channel', etc.
  resourceId: text('resource_id'),
  details: text('details'), // JSON with additional context
  ipAddress: text('ip_address'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export type NewAuditLog = typeof auditLog.$inferInsert;
export type AuditLog = typeof auditLog.$inferSelect;

// ============================================================================
// Project Templates
// ============================================================================

export const projectTemplates = sqliteTable('project_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  category: text('category'), // 'web', 'api', 'cli', 'library', 'devops', 'data', 'other'
  agentConfig: text('agent_config'), // JSON - provider, model, systemPrompt
  skills: text('skills'), // JSON array of skill identifiers
  mcpServers: text('mcp_servers'), // JSON - MCP server configurations
  tools: text('tools'), // JSON - tool configuration/permissions
  promptTemplate: text('prompt_template'), // Initial prompt to run after project creation
  setupCommands: text('setup_commands'), // JSON array of shell commands to run (planned, not yet implemented)
  fileTemplates: text('file_templates'), // JSON - { path: content } for files to create (planned, not yet implemented)
  rootAgentType: text('root_agent_type'), // Which agent type to set as project root (planned, not yet implemented)
  agentTypes: text('agent_types'), // JSON array of agent type names to include (planned, not yet implemented)
  source: text('source').notNull().default('local'), // 'local', 'hub', 'builtin'
  hubTemplateId: text('hub_template_id'), // Reference to hub template if synced (planned, not yet implemented)
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export type NewProjectTemplate = typeof projectTemplates.$inferInsert;
export type ProjectTemplate = typeof projectTemplates.$inferSelect;

// ============================================================================
// Approval Workflows
// ============================================================================

export const approvalRules = sqliteTable('approval_rules', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  toolPattern: text('tool_pattern').notNull(), // glob pattern matching tool names
  argPatterns: text('arg_patterns'), // JSON - conditions on tool arguments
  action: text('action').notNull().default('require_approval'), // 'require_approval', 'dry_run', 'block'
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  priority: integer('priority').notNull().default(0),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export type NewApprovalRule = typeof approvalRules.$inferInsert;
export type ApprovalRule = typeof approvalRules.$inferSelect;

export const approvalRequests = sqliteTable('approval_requests', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull(),
  ruleId: text('rule_id').references(() => approvalRules.id, { onDelete: 'set null' }),
  toolName: text('tool_name').notNull(),
  toolArgs: text('tool_args').notNull(), // JSON
  context: text('context'), // JSON - surrounding conversation context
  status: text('status').notNull().default('pending'), // 'pending', 'approved', 'denied', 'expired', 'auto_approved'
  reviewedBy: text('reviewed_by'), // user ID or 'system'
  reviewNote: text('review_note'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  reviewedAt: integer('reviewed_at', { mode: 'timestamp' }),
});

export type NewApprovalRequest = typeof approvalRequests.$inferInsert;
export type ApprovalRequest = typeof approvalRequests.$inferSelect;

// ============================================================================
// Web Push Notifications
// ============================================================================

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: text('id').primaryKey(),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(), // client public key
  auth: text('auth').notNull(), // auth secret
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  deviceName: text('device_name'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
});

export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;

export const notificationPreferences = sqliteTable('notification_preferences', {
  id: text('id').primaryKey(),
  subscriptionId: text('subscription_id').notNull().references(() => pushSubscriptions.id, { onDelete: 'cascade' }),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }), // null = global
  eventType: text('event_type').notNull(), // 'task_complete', 'task_failed', 'approval_needed', 'agent_error', 'agent_message', 'channel_message'
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
}, (table) => [
  uniqueIndex('notification_prefs_unique').on(table.subscriptionId, table.projectId, table.eventType),
]);

export type NewNotificationPreference = typeof notificationPreferences.$inferInsert;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;

// ============================================================================
// Multi-User Support - Groups, OAuth, Auth Codes, and Web Sessions
// ============================================================================

// User Groups
export const userGroups = sqliteTable('user_groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// User Group Members
export const userGroupMembers = sqliteTable('user_group_members', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  groupId: text('group_id').notNull().references(() => userGroups.id, { onDelete: 'cascade' }),
  joinedAt: integer('joined_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  uniqueIndex('user_group_member_unique').on(table.userId, table.groupId),
]);

// Group Project Access — per-project roles for groups
export const groupProjectAccess = sqliteTable('group_project_access', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull().references(() => userGroups.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('operator'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  uniqueIndex('group_project_access_unique').on(table.groupId, table.projectId),
]);

// OAuth Providers — configured social auth providers
export const oauthProviders = sqliteTable('oauth_providers', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // 'google', 'github', 'microsoft', 'oidc'
  clientId: text('client_id').notNull(),
  encryptedClientSecret: text('encrypted_client_secret').notNull(),
  discoveryUrl: text('discovery_url'), // for OIDC
  config: text('config'), // JSON - extra provider-specific config
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// OAuth Accounts — links external identities to local users
export const oauthAccounts = sqliteTable('oauth_accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(), // 'google', 'github', 'microsoft', 'oidc'
  providerAccountId: text('provider_account_id').notNull(),
  email: text('email'),
  profile: text('profile'), // JSON - name, avatar, etc.
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  uniqueIndex('oauth_account_unique').on(table.provider, table.providerAccountId),
]);

// Auth Codes — one-time authorization codes for app auth flow
export const authCodes = sqliteTable('auth_codes', {
  id: text('id').primaryKey(),
  codeHash: text('code_hash').notNull().unique(), // SHA-256 hash
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  redirectUri: text('redirect_uri').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  usedAt: integer('used_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// ============================================================================
// Plugins - Server-level installed packages + per-project overrides
// ============================================================================

// Server Plugins — npm packages registered for agent use
export const serverPlugins = sqliteTable('server_plugins', {
  id: text('id').primaryKey(),
  packageName: text('package_name').notNull().unique(), // npm package name
  packageSpec: text('package_spec').notNull(), // what was passed to npm install (e.g. "foo@^2.0")
  version: text('version'), // resolved version after install, if known
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export type NewServerPlugin = typeof serverPlugins.$inferInsert;
export type ServerPlugin = typeof serverPlugins.$inferSelect;

// Project Plugin Overrides — per-project enable/disable of server-level plugins
// If no row exists for a (project, plugin) pair, the server-level default applies.
export const projectPlugins = sqliteTable('project_plugins', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  pluginId: text('plugin_id').notNull().references(() => serverPlugins.id, { onDelete: 'cascade' }),
  enabled: integer('enabled', { mode: 'boolean' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  uniqueIndex('project_plugin_unique').on(table.projectId, table.pluginId),
]);

export type NewProjectPlugin = typeof projectPlugins.$inferInsert;
export type ProjectPlugin = typeof projectPlugins.$inferSelect;

// Web Sessions — cookie-based sessions for server web UI
export const webSessions = sqliteTable('web_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(), // SHA-256 hash of session token
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export type NewUserGroup = typeof userGroups.$inferInsert;
export type UserGroup = typeof userGroups.$inferSelect;

export type NewUserGroupMember = typeof userGroupMembers.$inferInsert;
export type UserGroupMember = typeof userGroupMembers.$inferSelect;

export type NewGroupProjectAccess = typeof groupProjectAccess.$inferInsert;
export type GroupProjectAccess = typeof groupProjectAccess.$inferSelect;

export type NewOauthProvider = typeof oauthProviders.$inferInsert;
export type OauthProvider = typeof oauthProviders.$inferSelect;

export type NewOauthAccount = typeof oauthAccounts.$inferInsert;
export type OauthAccount = typeof oauthAccounts.$inferSelect;

export type NewAuthCode = typeof authCodes.$inferInsert;
export type AuthCode = typeof authCodes.$inferSelect;

export type NewWebSession = typeof webSessions.$inferInsert;
export type WebSession = typeof webSessions.$inferSelect;
