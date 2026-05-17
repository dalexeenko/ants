import { z } from "zod";

// ============================================================================
// Message Types
// ============================================================================

export const MessageRole = z.enum(["user", "assistant"]);
export type MessageRole = z.infer<typeof MessageRole>;

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.unknown()),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ToolResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  result: z.unknown(),
  isError: z.boolean().optional(),
  /** Extra data (e.g. images) stored/streamed to clients but NOT sent to the LLM. */
  metadata: z.record(z.unknown()).optional(),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

export const FinishReasonSchema = z.enum([
  "stop",
  "tool_calls",
  "max_tokens",
  "content_filter",
  "refusal",
  "pause_turn",
  "error",
]);

export const MessageSchema = z.object({
  id: z.string(),
  role: MessageRole,
  content: z.string(),
  toolCalls: z.array(ToolCallSchema).optional(),
  toolResults: z.array(ToolResultSchema).optional(),
  /** Normalized reason the model stopped producing output (assistant messages only). */
  finishReason: FinishReasonSchema.optional(),
  createdAt: z.number(),
});
export type Message = z.infer<typeof MessageSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  parentId: z.string().optional(),
  workingDirectory: z.string(),
  messages: z.array(MessageSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Session = z.infer<typeof SessionSchema>;

// ============================================================================
// Image/Multimodal Types
// ============================================================================

export const ImageSourceBase64Schema = z.object({
  type: z.literal("base64"),
  mediaType: z.enum(["image/jpeg", "image/png", "image/gif", "image/webp"]),
  data: z.string(),
});
export type ImageSourceBase64 = z.infer<typeof ImageSourceBase64Schema>;

export const ImageSourceUrlSchema = z.object({
  type: z.literal("url"),
  url: z.string().url(),
});
export type ImageSourceUrl = z.infer<typeof ImageSourceUrlSchema>;

export const ImagePartSchema = z.object({
  type: z.literal("image"),
  source: z.discriminatedUnion("type", [
    ImageSourceBase64Schema,
    ImageSourceUrlSchema,
  ]),
});
export type ImagePart = z.infer<typeof ImagePartSchema>;

export const TextPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});
export type TextPart = z.infer<typeof TextPartSchema>;

export const ContentPartSchema = z.discriminatedUnion("type", [
  TextPartSchema,
  ImagePartSchema,
]);
export type ContentPart = z.infer<typeof ContentPartSchema>;

// ============================================================================
// Agent Events
// ============================================================================

export const AgentEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("user.message"),
    messageId: z.string(),
    content: z.string(),
  }),
  z.object({
    type: z.literal("message.start"),
    messageId: z.string(),
  }),
  z.object({
    type: z.literal("message.delta"),
    messageId: z.string(),
    delta: z.string(),
  }),
  z.object({
    type: z.literal("message.complete"),
    messageId: z.string(),
    content: z.string(),
    /** Normalized reason the model stopped producing output. */
    finishReason: FinishReasonSchema.optional(),
    contextUsage: z.object({
      currentTokens: z.number(),
      maxTokens: z.number(),
    }).optional(),
  }),
  z.object({
    type: z.literal("tool.start"),
    messageId: z.string(),
    toolCall: ToolCallSchema,
  }),
  z.object({
    type: z.literal("tool.complete"),
    messageId: z.string(),
    toolResult: ToolResultSchema,
  }),
  z.object({
    type: z.literal("error"),
    sessionId: z.string().optional(),
    error: z.string(),
  }),
  // Session lifecycle events (used by server/bridge transport layer)
  z.object({
    type: z.literal("done"),
    sessionId: z.string(),
    hasOpenTodos: z.boolean().optional(),
    hasOpenPhases: z.boolean().optional(),
    openTodoCount: z.number().optional(),
    openPhaseCount: z.number().optional(),
    todoCount: z.number().optional(),
    phaseCount: z.number().optional(),
    todos: z.array(z.object({
      id: z.string(),
      content: z.string(),
      status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
      priority: z.enum(["high", "medium", "low"]),
    })).optional(),
    phases: z.array(z.object({
      id: z.string(),
      content: z.string(),
      status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
    })).optional(),
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal("aborted"),
    sessionId: z.string().optional(),
    status: z.literal("aborted").optional(),
  }),
  z.object({
    type: z.literal("subagent.start"),
    sessionId: z.string(),
    parentSessionId: z.string(),
    description: z.string(),
    async: z.boolean(),
  }),
  z.object({
    type: z.literal("subagent.complete"),
    sessionId: z.string(),
    parentSessionId: z.string(),
    result: z.string(),
  }),
  z.object({
    type: z.literal("subagent.error"),
    sessionId: z.string(),
    parentSessionId: z.string(),
    error: z.string(),
  }),
  z.object({
    type: z.literal("mcp.server.connected"),
    serverName: z.string(),
    toolCount: z.number(),
  }),
  z.object({
    type: z.literal("mcp.server.disconnected"),
    serverName: z.string(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("compaction.pending"),
    stats: z.object({
      currentTokens: z.number(),
      threshold: z.number(),
      messagesToCompact: z.number(),
    }),
  }),
  z.object({
    type: z.literal("compaction.start"),
    stats: z.object({
      currentTokens: z.number(),
      threshold: z.number(),
      messagesToCompact: z.number(),
    }),
  }),
  z.object({
    type: z.literal("compaction.delta"),
    delta: z.string(),
  }),
  z.object({
    type: z.literal("compaction.complete"),
    compactionId: z.string(),
    stats: z.object({
      originalTokens: z.number(),
      compactedTokens: z.number(),
      messagesPruned: z.number(),
      compressionRatio: z.number(),
    }),
    contextUsage: z.object({
      currentTokens: z.number(),
      maxTokens: z.number(),
    }).optional(),
  }),
  z.object({
    type: z.literal("compaction.error"),
    error: z.string(),
  }),
  z.object({
    type: z.literal("command.result"),
    command: z.string(),
    output: z.string(),
  }),
  // Background task events (emitted by tools-terminal plugin)
  z.object({
    type: z.literal("background_task.start"),
    taskId: z.string(),
    command: z.string(),
    description: z.string(),
  }),
  z.object({
    type: z.literal("background_task.complete"),
    taskId: z.string(),
    command: z.string(),
    exitCode: z.number(),
    onComplete: z.string().optional(),
  }),
  z.object({
    type: z.literal("background_task.failed"),
    taskId: z.string(),
    command: z.string(),
    exitCode: z.number(),
    onComplete: z.string().optional(),
  }),
  z.object({
    type: z.literal("background_task.cancelled"),
    taskId: z.string(),
    command: z.string(),
  }),
  z.object({
    type: z.literal("background_task.check_back"),
    taskId: z.string(),
    command: z.string(),
    description: z.string(),
  }),
  // Tool permission events
  z.object({
    type: z.literal("tool.permission.request"),
    messageId: z.string(),
    toolCall: ToolCallSchema,
    subagentSessionId: z.string().optional(),
    subagentDescription: z.string().optional(),
  }),
  z.object({
    type: z.literal("tool.permission.granted"),
    messageId: z.string(),
    toolName: z.string(),
    allowAlways: z.boolean(),
  }),
  z.object({
    type: z.literal("tool.permission.denied"),
    messageId: z.string(),
    toolName: z.string(),
  }),
  // Agent state events
  z.object({
    type: z.literal("agent.workingDirectory.changed"),
    workingDirectory: z.string(),
  }),
  z.object({
    type: z.literal("agent.mode.changed"),
    mode: z.enum(["plan", "build"]),
  }),
  // Question events (for interactive user input via the question tool)
  z.object({
    type: z.literal("question.request"),
    questionId: z.string(),
    messageId: z.string(),
    question: z.string(),
    options: z.array(z.object({
      label: z.string(),
      description: z.string().optional(),
    })),
    multiple: z.boolean(),
    allowFreeform: z.literal(true),
  }),
  // Session metadata events
  z.object({
    type: z.literal("session.title.updated"),
    sessionId: z.string(),
    title: z.string(),
  }),
  // Todo/Phase state events (emitted when tools modify todos or phases)
  z.object({
    type: z.literal("todos.updated"),
    todos: z.array(z.object({
      id: z.string(),
      content: z.string(),
      status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
      priority: z.enum(["high", "medium", "low"]),
    })),
  }),
  z.object({
    type: z.literal("phases.updated"),
    phases: z.array(z.object({
      id: z.string(),
      content: z.string(),
      status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
    })),
  }),
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;

/**
 * Response from the user to a question tool invocation.
 * `selected` contains the labels of chosen options.
 * `freeformText` is set when the user types a custom response instead.
 */
export interface QuestionResponse {
  selected: string[];
  freeformText?: string;
}

// ============================================================================
// LLM Types
// ============================================================================

export interface LLMMessage {
  role: "user" | "assistant" | "system";
  content: string | ContentPart[];
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface LLMTool {
  name: string;
  description: string;
  parameters: z.ZodType<unknown>;
}

export interface LLMStreamResult {
  stream: AsyncIterable<LLMStreamChunk>;
  response: Promise<LLMResponse>;
}

export interface LLMStreamChunk {
  type: "text" | "tool_call";
  text?: string;
  toolCall?: ToolCall;
}

/**
 * Normalized finish reason across providers.
 * - `stop`: model produced a natural end (Anthropic `end_turn`, OpenAI `stop`, Google `STOP`)
 * - `tool_calls`: model paused to invoke tools (Anthropic `tool_use`, OpenAI `tool_calls`)
 * - `max_tokens`: output token cap reached (Anthropic `max_tokens`, OpenAI `length`, Google `MAX_TOKENS`)
 * - `content_filter`: provider safety filter triggered
 * - `refusal`: model refused (Anthropic `refusal`)
 * - `pause_turn`: long-running turn paused, can be resumed (Anthropic `pause_turn`)
 * - `error`: provider returned an error finish reason
 */
export type FinishReason = z.infer<typeof FinishReasonSchema>;

export interface LLMResponse {
  content: string;
  toolCalls: ToolCall[];
  /** Normalized reason the model stopped producing output. */
  finishReason?: FinishReason;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** Tokens written to prompt cache (Anthropic: cache_creation_input_tokens) */
    cacheCreationInputTokens?: number;
    /** Tokens read from prompt cache (Anthropic: cache_read_input_tokens, OpenAI: cached_tokens, Google: cachedContentTokenCount) */
    cacheReadInputTokens?: number;
  };
}

export interface LLMStreamOptions {
  model: string;
  messages: LLMMessage[];
  tools?: LLMTool[];
  system?: string;
  abortSignal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMProvider {
  stream(options: LLMStreamOptions): Promise<LLMStreamResult>;
}

// ============================================================================
// Tool Types
// ============================================================================

export interface ToolDefinition<TParams = unknown> {
  name: string;
  description: string;
  parameters: z.ZodType<TParams>;
  execute: (params: TParams, ctx: ToolContext) => Promise<ToolExecuteResult>;
  /** Optional tags for categorizing tools */
  tags?: string[];
  /** Optional icon name */
  icon?: string;
  /**
   * Capabilities required for this tool to function.
   * If any required capability is missing from the environment,
   * the tool will not be registered or presented to the LLM.
   * 
   * Examples: ["filesystem"], ["terminal"], ["network"], ["subagent"]
   */
  requiredCapabilities?: string[];
}

export interface ToolExecuteResult {
  output: string | Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Structured Tool Result Types
// ============================================================================

/**
 * Structured result types for richer tool output.
 * Tools can return these in the `output` field for typed handling by consumers.
 */

export interface FileResult {
  type: "file";
  path: string;
  content: string;
  language?: string;
  startLine?: number;
  endLine?: number;
}

export interface SearchResult {
  type: "search";
  query: string;
  matches: Array<{
    path: string;
    line: number;
    content: string;
    context?: string;
  }>;
  totalMatches: number;
  truncated?: boolean;
}

export interface ErrorResult {
  type: "error";
  code: string;
  message: string;
  details?: string;
  recoverable?: boolean;
  suggestedFix?: string;
}

export interface CommandExecutionResult {
  type: "command";
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration?: number;
}

export interface ListResult {
  type: "list";
  items: Array<{
    name: string;
    description?: string;
    metadata?: Record<string, unknown>;
  }>;
  totalCount: number;
  truncated?: boolean;
}

export interface DiffResult {
  type: "diff";
  path: string;
  hunks: Array<{
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    content: string;
  }>;
}

/**
 * Union of all structured result types.
 * Tools can return either a plain string, a Record, or a StructuredResult.
 */
export type StructuredResult =
  | FileResult
  | SearchResult
  | ErrorResult
  | CommandExecutionResult
  | ListResult
  | DiffResult;

/**
 * Context provided to tools during execution.
 * Plugins can extend this via the `extensions` field.
 */
export interface ToolContext {
  workingDirectory: string;
  abortSignal?: AbortSignal;
  sessionId?: string;
  /** The ID of the assistant message whose tool calls are being executed. */
  messageId?: string;
  
  // In-memory state (managed by core)
  getTodos?: () => TodoItem[];
  setTodos?: (todos: TodoItem[]) => void;
  getPhases?: () => PhaseItem[];
  setPhases?: (phases: PhaseItem[]) => void;
  
  // Event emission
  emitEvent?: (event: AgentEvent) => void;
  
  // Extension points for plugins
  getSessionManager?: () => unknown;
  getSkillManager?: () => unknown;
  getAgent?: () => unknown;
  
  /**
   * Extension data provided by plugins.
   * Plugins can store arbitrary data here keyed by plugin name.
   */
  extensions: Record<string, unknown>;
}

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "high" | "medium" | "low";
}

// ============================================================================
// Filesystem Abstraction
// ============================================================================

/**
 * File information returned by stat operations.
 */
export interface FileStat {
  size: number;
  isDirectory: boolean;
  isFile: boolean;
  modifiedAt?: number;
  createdAt?: number;
}

/**
 * Directory entry returned by readdir operations.
 */
export interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

/**
 * Platform-agnostic filesystem interface.
 * 
 * Tools should access the filesystem via `ctx.extensions.filesystem` rather than
 * directly using Node.js `fs` module. This allows tools to work across platforms
 * (Node.js, React Native, browser, etc.).
 * 
 * Implementations:
 * - Node.js: @ants/agent-tools-terminal provides a Node.js implementation
 * - React Native: @ants/agent-react-native provides an expo-file-system implementation
 */
export interface Filesystem {
  /**
   * Read the contents of a file as a UTF-8 string.
   */
  readFile(path: string): Promise<string>;
  
  /**
   * Write content to a file.
   * Creates parent directories if they don't exist.
   */
  writeFile(path: string, content: string): Promise<void>;
  
  /**
   * Get information about a file or directory.
   * Throws if the path does not exist.
   */
  stat(path: string): Promise<FileStat>;
  
  /**
   * Check if a path exists.
   */
  exists(path: string): Promise<boolean>;
  
  /**
   * Read the contents of a directory.
   */
  readdir(path: string): Promise<DirectoryEntry[]>;
  
  /**
   * Create a directory and any necessary parent directories.
   */
  mkdir(path: string): Promise<void>;
  
  /**
   * Delete a file.
   */
  unlink(path: string): Promise<void>;
  
  /**
   * Delete a directory and its contents recursively.
   */
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  
  /**
   * Resolve a path relative to a base directory.
   * Returns an absolute path.
   */
  resolve(base: string, ...paths: string[]): string;
  
  /**
   * Get the relative path from one path to another.
   */
  relative(from: string, to: string): string;
  
  /**
   * Get the directory name of a path.
   */
  dirname(path: string): string;
  
  /**
   * Get the base name of a path.
   */
  basename(path: string): string;
  
  /**
   * Join path segments.
   */
  join(...paths: string[]): string;
}

export interface PhaseItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
}

// BackgroundTask is defined here for type sharing, but managed by tools-terminal plugin
export interface BackgroundTask {
  id: string;
  command: string;
  description: string;
  status: "running" | "completed" | "failed" | "cancelled";
  tmuxSession: string;
  workingDirectory: string;
  startedAt: number;
  completedAt?: number;
  exitCode?: number;
  checkBackAt?: number;
  onComplete?: string;
}

// ============================================================================
// Auth & Config Types
// ============================================================================

export type AuthType = "oauth" | "api-key";

export interface AuthConfig {
  type: AuthType;
  apiKey?: string;
}

export type ProviderName = "anthropic" | "openai" | "google" | "openrouter" | "groq" | "xai" | string;

export type AgentMode = 'plan' | 'build';

export interface AgentConfig {
  provider: ProviderName;
  model: string;
  auth: AuthConfig;
  systemPrompt?: string;
  workingDirectory?: string;
  tools?: string[];
  disabledTools?: string[];
  maxTokens?: number;
  temperature?: number;
  /** Agent mode: 'plan' (read-only analysis) or 'build' (full tool access). Default: 'build' */
  mode?: AgentMode;
}

// ============================================================================
// Defaults
// ============================================================================

export const DEFAULT_SYSTEM_PROMPT = `You are a coding assistant that helps users with software engineering tasks.

# Tone and style
- Be concise. Your responses should be short and direct.
- Only use emojis if the user explicitly requests it.
- Focus on solving the user's problem, not explaining your process.
- Never use unnecessary superlatives, praise, or emotional validation.
- Never introduce yourself or state your name. Just help with the task.
- Output text to communicate with the user. Never use tools like Bash or code comments as means to communicate.

# Doing tasks
- Use tools to explore the codebase when needed
- Make changes carefully and verify they work
- When referencing code, include file path and line number (e.g. src/index.ts:42)
- Prefer editing existing files over creating new ones
- You can call multiple tools in parallel if they have no dependencies

# Tool usage
- Use specialized tools instead of bash when possible (Read instead of cat, Edit instead of sed)
- For file search and exploration, prefer dedicated search tools over bash find/grep`;

export const PLAN_MODE_SYSTEM_PROMPT_SECTION = `# Mode: Plan

You are currently in **Plan mode**. In this mode:
- You MUST NOT make any permanent changes to files, directories, or other assets.
- You MUST NOT use tools that write, edit, delete, or modify files (write, edit, apply_patch, bash commands that modify files).
- You CAN read files, search code, explore the codebase, and analyze information.
- You CAN create plans, outlines, and recommendations.
- You CAN use the todo and phase tools to organize your planning.
- Focus on understanding the problem, gathering context, and proposing a detailed plan of action.
- When you have a complete plan, present it clearly to the user so they can review before switching to Build mode.`;

export const BUILD_MODE_SYSTEM_PROMPT_SECTION = `# Mode: Build

You are currently in **Build mode**. All tools are available. You can read, write, edit, and execute code freely. Focus on implementing the task at hand.`;

/** Tools that are disabled in Plan mode */
export const PLAN_MODE_DISABLED_TOOLS = ['write', 'edit', 'apply_patch'];

export const DEFAULT_AGENT_CONFIG: Partial<AgentConfig> = {
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  auth: { type: "oauth" },
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  mode: "build",
};
