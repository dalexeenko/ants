/**
 * Zod schemas for request body validation.
 *
 * Each schema mirrors the corresponding TypeScript interface from
 * models/ or services/ but provides runtime validation.
 */

import { z } from 'zod';

// ============================================================================
// Shared / Reusable
// ============================================================================

const McpServerConfigSchema = z.object({
  name: z.string(),
  type: z.enum(['local', 'remote']),
  command: z.array(z.string()).optional(),
  url: z.string().optional(),
  enabled: z.boolean().optional(),
});

const AgentConfigSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  mcp: z.record(z.string(), McpServerConfigSchema).optional(),
  defaultMode: z.enum(['plan', 'build']).optional(),
  maxAutoCompleteLoops: z.number().min(1).max(100).optional(),
}).passthrough(); // AgentConfig allows [key: string]: unknown

const TaskWebhookSchema = z.object({
  url: z.string(),
  events: z.array(z.enum(['success', 'error', 'complete'])),
  headers: z.record(z.string(), z.string()).optional(),
});

// ============================================================================
// Projects
// ============================================================================

export const CreateProjectSchema = z.object({
  name: z.string(),
  workingDirectory: z.string().optional(),
  autoStart: z.boolean().optional(),
  defaultModel: z.string().optional(),
  defaultMode: z.enum(['plan', 'build']).optional(),
  maxAutoCompleteLoops: z.number().min(1).max(100).optional(),
  worktreeEnabled: z.boolean().optional(),
  agentConfig: AgentConfigSchema.optional(),
});

export const UpdateProjectSchema = z.object({
  name: z.string().optional(),
  workingDirectory: z.string().optional(),
  autoStart: z.boolean().optional(),
  defaultModel: z.string().optional(),
  defaultMode: z.enum(['plan', 'build']).optional(),
  maxAutoCompleteLoops: z.number().min(1).max(100).optional(),
  worktreeEnabled: z.boolean().optional(),
  agentConfig: AgentConfigSchema.optional(),
});

export const AgentConfigBodySchema = AgentConfigSchema;

// ============================================================================
// Sessions
// ============================================================================

export const CreateSessionSchema = z.object({
  title: z.string().optional(),
  parentId: z.string().optional(),
  mode: z.enum(['plan', 'build']).optional(),
  useWorktree: z.boolean().optional(),
  worktreeBranch: z.string().optional(),
}).passthrough(); // Allow extra fields gracefully

export const PromptSchema = z.object({
  prompt: z.string(),
});

export const PermissionResponseSchema = z.object({
  response: z.string(),
});

export const QuestionResponseSchema = z.object({
  selected: z.array(z.string()).optional(),
  freeformText: z.string().optional(),
});

export const CreateBranchSchema = z.object({
  name: z.string(),
  messageId: z.string().optional(),
});

export const RollbackSchema = z.object({
  count: z.number().optional(),
});

// ============================================================================
// Tasks
// ============================================================================

export const CreateTaskSchema = z.object({
  name: z.string(),
  prompt: z.string(),
  cronSchedule: z.string(),
  enabled: z.boolean().optional(),
  sessionMode: z.enum(['newEachRun', 'dedicatedSession']).optional(),
  model: z.string().optional(),
  webhooks: z.array(TaskWebhookSchema).optional(),
});

export const UpdateTaskSchema = z.object({
  name: z.string().optional(),
  prompt: z.string().optional(),
  cronSchedule: z.string().optional(),
  enabled: z.boolean().optional(),
  sessionMode: z.enum(['newEachRun', 'dedicatedSession']).optional(),
  model: z.string().optional(),
  webhooks: z.array(TaskWebhookSchema).optional(),
});

// ============================================================================
// Webhooks
// ============================================================================

export const CreateWebhookEndpointSchema = z.object({
  name: z.string(),
  slug: z.string(),
  secret: z.string().optional(),
  enabled: z.boolean().optional(),
  source: z.string(),
  eventFilter: z.array(z.string()).optional(),
  promptTemplate: z.string(),
  sessionMode: z.enum(['newEachRun', 'dedicated']).optional(),
  dedicatedSessionId: z.string().optional(),
});

export const UpdateWebhookEndpointSchema = z.object({
  name: z.string().optional(),
  slug: z.string().optional(),
  secret: z.string().optional(),
  enabled: z.boolean().optional(),
  source: z.string().optional(),
  eventFilter: z.array(z.string()).optional(),
  promptTemplate: z.string().optional(),
  sessionMode: z.enum(['newEachRun', 'dedicated']).optional(),
  dedicatedSessionId: z.string().optional(),
});

// ============================================================================
// File Watchers
// ============================================================================

export const CreateFileWatcherSchema = z.object({
  name: z.string(),
  watchPath: z.string(),
  patterns: z.array(z.string()).optional(),
  ignorePatterns: z.array(z.string()).optional(),
  events: z.array(z.string()).optional(),
  debounceMs: z.number().optional(),
  promptTemplate: z.string(),
  enabled: z.boolean().optional(),
});

export const UpdateFileWatcherSchema = z.object({
  name: z.string().optional(),
  watchPath: z.string().optional(),
  patterns: z.array(z.string()).optional(),
  ignorePatterns: z.array(z.string()).optional(),
  events: z.array(z.string()).optional(),
  debounceMs: z.number().optional(),
  promptTemplate: z.string().optional(),
  enabled: z.boolean().optional(),
});

// ============================================================================
// Channels
// ============================================================================

const TriggerFilterSchema = z.object({
  type: z.enum(['channel', 'user', 'keyword', 'regex']),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
});

const TriggerConfigSchema = z.object({
  events: z.array(z.enum(['mention', 'direct_message', 'reaction', 'keyword', 'channel_message'])),
  filters: z.array(TriggerFilterSchema).optional(),
});

const ResponseConfigSchema = z.object({
  mode: z.enum(['reply', 'thread', 'dm', 'channel']).optional(),
  threadBehavior: z.enum(['always', 'if_exists', 'never']).optional(),
  typingIndicator: z.boolean().optional(),
  maxResponseLength: z.number().optional(),
});

export const CreateChannelSchema = z.object({
  type: z.enum(['slack', 'discord', 'twitter', 'reddit', 'telegram']),
  name: z.string(),
  config: z.record(z.string(), z.unknown()),
  credentials: z.record(z.string(), z.unknown()),
  enabled: z.boolean().optional(),
});

export const UpdateChannelSchema = z.object({
  name: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  credentials: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

export const CreateBindingSchema = z.object({
  projectId: z.string(),
  triggerConfig: TriggerConfigSchema,
  responseConfig: ResponseConfigSchema.optional(),
  enabled: z.boolean().optional(),
  priority: z.number().optional(),
});

export const UpdateBindingSchema = z.object({
  triggerConfig: TriggerConfigSchema.optional(),
  responseConfig: ResponseConfigSchema.optional(),
  enabled: z.boolean().optional(),
  priority: z.number().optional(),
});

export const SendMessageSchema = z.object({
  content: z.string(),
  targetChannelId: z.string().optional(),
  targetThreadId: z.string().optional(),
  targetUserId: z.string().optional(),
  projectId: z.string().optional(),
  sessionId: z.string().optional(),
});

// ============================================================================
// Approvals
// ============================================================================

export const CreateApprovalRuleSchema = z.object({
  projectId: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  toolPattern: z.string(),
  argPatterns: z.record(z.string(), z.string()).optional(),
  action: z.enum(['require_approval', 'dry_run', 'block']),
  priority: z.number().optional(),
});

export const UpdateApprovalRuleSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  toolPattern: z.string().optional(),
  argPatterns: z.record(z.string(), z.string()).optional(),
  action: z.enum(['require_approval', 'dry_run', 'block']).optional(),
  priority: z.number().optional(),
  enabled: z.boolean().optional(),
});

export const ReviewRequestSchema = z.object({
  note: z.string().optional(),
  reviewedBy: z.string().optional(),
});

// ============================================================================
// Notifications
// ============================================================================

export const PushSubscribeSchema = z.object({
  endpoint: z.string(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
  userId: z.string().optional(),
  deviceName: z.string().optional(),
});

export const PushUnsubscribeSchema = z.object({
  endpoint: z.string(),
});

export const NotificationPreferencesSchema = z.object({
  subscriptionId: z.string(),
  preferences: z.array(z.object({
    eventType: z.string(),
    enabled: z.boolean(),
  })),
});

export const TestNotificationSchema = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  projectId: z.string().optional(),
});

// ============================================================================
// Agent Comms
// ============================================================================

export const SendAgentMessageSchema = z.object({
  fromProjectId: z.string(),
  toProjectId: z.string(),
  type: z.enum(['request', 'response', 'notification']).optional(),
  action: z.string().optional(),
  subject: z.string().optional(),
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  parentMessageId: z.string().optional(),
});

// ============================================================================
// Users
// ============================================================================

export const LoginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export const CreateUserSchema = z.object({
  username: z.string(),
  password: z.string(),
  role: z.enum(['admin', 'operator', 'viewer']),
  displayName: z.string().optional(),
  email: z.string().optional(),
});

export const UpdateUserSchema = z.object({
  displayName: z.string().optional(),
  email: z.string().optional(),
  role: z.enum(['admin', 'operator', 'viewer']).optional(),
  enabled: z.boolean().optional(),
  oldPassword: z.string().optional(),
  newPassword: z.string().optional(),
});

export const CreateTokenSchema = z.object({
  name: z.string(),
  expiresAt: z.string().optional(),
});

export const SetProjectAccessSchema = z.object({
  role: z.enum(['admin', 'operator', 'viewer']),
});

// ============================================================================
// Groups
// ============================================================================

export const CreateGroupSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
});

export const UpdateGroupSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
});

export const AddGroupMemberSchema = z.object({
  userId: z.string(),
});

export const SetGroupProjectAccessSchema = z.object({
  role: z.enum(['admin', 'operator', 'viewer']),
});

// ============================================================================
// User Notification Preferences
// ============================================================================

export const SetUserNotificationPreferenceSchema = z.object({
  enabled: z.boolean(),
  eventTypes: z.array(z.string()).optional(),
});

// ============================================================================
// Providers
// ============================================================================

export const SetApiKeySchema = z.object({
  apiKey: z.string().min(1),
});

// ============================================================================
// Templates
// ============================================================================

const AgentConfigTemplateSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
});

export const CreateTemplateSchema = z.object({
  name: z.string(),
  slug: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  agentConfig: AgentConfigTemplateSchema.optional(),
  skills: z.array(z.string()).optional(),
  mcpServers: z.record(z.string(), z.unknown()).optional(),
  tools: z.record(z.string(), z.unknown()).optional(),
  promptTemplate: z.string().optional(),
  setupCommands: z.array(z.string()).optional(),
  fileTemplates: z.record(z.string(), z.string()).optional(),
});

export const UpdateTemplateSchema = z.object({
  name: z.string().optional(),
  slug: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  agentConfig: AgentConfigTemplateSchema.optional(),
  skills: z.array(z.string()).optional(),
  mcpServers: z.record(z.string(), z.unknown()).optional(),
  tools: z.record(z.string(), z.unknown()).optional(),
  promptTemplate: z.string().optional(),
  setupCommands: z.array(z.string()).optional(),
  fileTemplates: z.record(z.string(), z.string()).optional(),
});

export const CreateProjectFromTemplateSchema = z.object({
  name: z.string(),
  workingDirectory: z.string(),
});

export const ImportTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  content: z.string(),
});

// ============================================================================
// Plugins
// ============================================================================

export const InstallPluginSchema = z.object({
  packageSpec: z.string(),
});

export const UninstallPluginSchema = z.object({
  packageName: z.string(),
});

export const RegisterPluginSchema = z.object({
  packageName: z.string().min(1, 'packageName is required'),
  packageSpec: z.string().min(1, 'packageSpec is required'),
  version: z.string().optional(),
});

export const UpdatePluginSchema = z.object({
  packageSpec: z.string().min(1).optional(),
  version: z.string().optional(),
  enabled: z.boolean().optional(),
});

export const SetProjectPluginSchema = z.object({
  enabled: z.boolean(),
});

// ============================================================================
// System / API Keys
// ============================================================================

export const CreateCustomEnvVarSchema = z.object({
  name: z.string(),
  envVar: z.string(),
  value: z.string(),
});

export const UpdateCustomEnvVarSchema = z.object({
  name: z.string().optional(),
  value: z.string().optional(),
});

export const SetProviderKeysSchema = z.object({
  values: z.record(z.string(), z.string()),
});

export const SetOAuthCredentialsSchema = z.object({
  refresh: z.string(),
  access: z.string(),
  expires: z.number(),
  accountId: z.string().optional(),
});

export const OAuthCodeExchangeSchema = z.object({
  code: z.string(),
  sessionId: z.string(),
});

export const CleanupSessionsSchema = z.object({
  olderThanDays: z.number().optional(),
});

// ============================================================================
// Analytics
// ============================================================================

export const TrackEventSchema = z.object({
  eventType: z.enum(['prompt', 'tool_call', 'task_run', 'error', 'agent_start', 'agent_stop']),
  projectId: z.string().optional(),
  sessionId: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  promptTokens: z.number().optional(),
  completionTokens: z.number().optional(),
  totalTokens: z.number().optional(),
  estimatedCostUsd: z.number().optional(),
  durationMs: z.number().optional(),
  toolName: z.string().optional(),
  success: z.boolean().optional(),
  errorMessage: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const CleanupEventsSchema = z.object({
  olderThanDays: z.number().optional(),
});

// ============================================================================
// Files
// ============================================================================

export const WriteFileContentSchema = z.object({
  content: z.string(),
});

export const CreateDirectorySchema = z.object({
  path: z.string(),
  recursive: z.boolean().optional(),
});

export const MovePathSchema = z.object({
  from: z.string(),
  to: z.string(),
});

export const CopyPathSchema = z.object({
  from: z.string(),
  to: z.string(),
  recursive: z.boolean().optional(),
});

// ============================================================================
// Terminals
// ============================================================================

export const CreateTerminalSchema = z.object({
  shell: z.string().optional(),
  workingDirectory: z.string().optional(),
});

export const ResizeTerminalSchema = z.object({
  cols: z.number(),
  rows: z.number(),
});

// ============================================================================
// Filesystem (Server-level browsing)
// ============================================================================

export const MkdirSchema = z.object({
  parentPath: z.string().min(1, 'parentPath is required'),
  name: z.string(),
});
