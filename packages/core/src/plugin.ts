import type { z } from "zod";
import type {
  ToolDefinition,
  ToolCall,
  ToolResult,
  ToolContext,
  LLMProvider,
  LLMStreamOptions,
  LLMStreamResult,
  Message,
  AgentEvent,
} from "./types.js";
import type { UsageTracker } from "./usage/tracker.js";
import type { AgentTypeDefinition } from "./registry/agent-types.js";

// Forward declaration - Agent will be imported where needed
export interface AgentInterface {
  emit(event: "event", data: AgentEvent): boolean;
  getConfig(): { provider: string; model: string };
  getProvider(): LLMProvider | null;
  setExtension(key: string, value: unknown): void;
  getExtension<T>(key: string): T | undefined;
  setWorkingDirectory(dir: string): void;
  getWorkingDirectory(): string;
  getMessages(): Message[];
  getSessionContext(): { sessionId: string; sessionManager: unknown } | null;
  getUsageTracker(): UsageTracker;
}

// ============================================================================
// Provider Definition
// ============================================================================

export interface ProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  [key: string]: unknown;
}

export interface ProviderDefinition {
  name: string;
  factory: (options: ProviderOptions) => LLMProvider;
}

// ============================================================================
// Command Definition
// ============================================================================

export interface CommandContext {
  agent: AgentInterface;
  sessionId?: string;
}

export interface CommandResult {
  /** Output to display to the user */
  output: string;
  /** If true, also process the original input as a prompt after the command */
  shouldContinue?: boolean;
  /** If shouldContinue is true, use this as the prompt instead of original input */
  transformedInput?: string;
}

export interface CommandDefinition {
  name: string;
  description: string;
  execute: (args: string, ctx: CommandContext) => Promise<CommandResult>;
}

// ============================================================================
// Plugin Skill Source (for bundled skills from plugins)
// ============================================================================

export interface PluginSkillSource {
  name: string;
  description: string;
  path: string;
}

// ============================================================================
// UI Plugin Contribution Types (React-free — uses `unknown` for components)
// ============================================================================

/**
 * UI contributions that a plugin can provide to the app.
 * All `component` fields use `unknown` so that @openmgr/agent-core
 * has no React dependency. The UI layer (@openmgr/ui/plugins) narrows
 * these to `React.ComponentType<...>` at the consumption boundary.
 *
 * Headless consumers (CLI, server) simply ignore the `ui` field.
 */
export interface UIPluginContributions {
  /** New middle content tab types */
  middleTabs?: UIMiddleTabContribution[];
  /** New right sidebar panels */
  sidebarPanels?: UISidebarPanelContribution[];
  /** Settings sections added to global or project settings */
  settingsSections?: UISettingsSectionContribution[];
  /** Top-level screens accessible from the icon rail */
  screens?: UIScreenContribution[];
  /** Custom renderers for specific tool call outputs */
  toolRenderers?: UIToolRendererContribution[];
  /** Decorators that inject content around chat messages */
  chatDecorators?: UIChatDecoratorContribution[];
  /** Auth provider UIs for remote server connections */
  authProviders?: UIAuthProviderContribution[];
}

export interface UIMiddleTabContribution {
  /** Unique type identifier, e.g., "my-plugin.dashboard" */
  type: string;
  /** Display label for the tab */
  label: string;
  /** Icon name (from the app's icon set) or emoji */
  icon: string;
  /** The React component to render as tab content */
  component: unknown;
  /** Whether this tab type appears in the "+" new tab menu */
  showInNewTabMenu?: boolean;
}

export interface UISidebarPanelContribution {
  /** Unique panel identifier */
  id: string;
  /** Display label for the tab */
  label: string;
  /** Icon name */
  icon?: string;
  /** The React component to render as panel content */
  component: unknown;
  /** Order priority (higher = further right). Built-in tabs use 0-100 */
  order?: number;
}

export interface UISettingsSectionContribution {
  /** Unique section identifier */
  id: string;
  /** Display label */
  label: string;
  /** Optional description text */
  description?: string;
  /** The React component to render as the settings section content */
  component: unknown;
  /** Where this settings section appears */
  scope: "global" | "project" | "both";
  /** Order priority (higher = further down). Built-in sections use 0-100 */
  order?: number;
}

export interface UIScreenContribution {
  /** Unique screen identifier */
  id: string;
  /** Display label */
  label: string;
  /** Icon name for the icon rail */
  icon: string;
  /** The React component to render as screen content */
  component: unknown;
  /** Order priority in icon rail */
  order?: number;
}

export interface UIToolRendererContribution {
  /** Tool name(s) this renderer handles */
  toolNames: string[];
  /** Component to render the tool call (invocation + result) */
  component: unknown;
}

export interface UIChatDecoratorContribution {
  /** Unique decorator identifier */
  id: string;
  /** Position relative to the message: before, after, or wrap */
  position: "before" | "after" | "wrap";
  /** Optional filter: which messages this decorator applies to */
  filter?: (message: unknown) => boolean;
  /** The React component to render */
  component: unknown;
}

export interface UIAuthProviderContribution {
  /** Unique auth type identifier, e.g., 'cloudflare-access' */
  id: string;
  /** Display label, e.g., 'Cloudflare Access' */
  label: string;
  /** Icon name */
  icon?: string;
  /** Component rendered when this auth type is selected in the Add Server modal */
  connectionComponent: unknown;
  /** Component rendered in the ServerSettings Connection section when this auth type is active */
  settingsComponent: unknown;
  /**
   * Function to produce auth headers for requests to a server using this auth type.
   * Signature: (authConfig: Record<string, unknown>) => Record<string, string>
   */
  getAuthHeaders?: unknown;
}

// ============================================================================
// Plugin Interface
// ============================================================================

export interface AgentPlugin {
  /** Unique plugin name */
  name: string;
  /** Optional version */
  version?: string;
  
  // What the plugin provides
  /** Tools to register */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools?: ToolDefinition<any>[];
  /** LLM providers to register */
  providers?: ProviderDefinition[];
  /** Slash commands to register */
  commands?: CommandDefinition[];
  /** Skill sources to register */
  skills?: PluginSkillSource[];
  /** Agent type definitions (named subagent presets) to register */
  agentTypes?: AgentTypeDefinition[];
  /**
   * Environment capabilities this plugin provides.
   * When the plugin is registered, these capabilities become available
   * to the tool registry for filtering.
   * 
   * Example: ["filesystem", "terminal"] for the tools-terminal plugin
   */
  capabilities?: string[];

  /**
   * UI contributions — React components for app extension points.
   * Ignored in headless contexts (CLI, server). The `component` fields
   * use `unknown` at this level; the UI layer narrows them to
   * `React.ComponentType<...>` at the consumption boundary.
   */
  ui?: UIPluginContributions;
  
  // Lifecycle hooks
  /** Called when the plugin is registered with an agent */
  onRegister?(agent: AgentInterface): void | Promise<void>;
  /** Called before each prompt - can modify the message */
  onBeforePrompt?(message: string, agent: AgentInterface): string | Promise<string>;
  /** Called after each prompt completes */
  onAfterPrompt?(response: Message, agent: AgentInterface): void | Promise<void>;
  /**
   * Called each time a message is added to the conversation during the agent
   * loop (assistant responses, tool-result messages, etc.). Awaited before
   * the loop continues, so the handler can persist the message to disk before
   * the next iteration.
   */
  onMessageAdded?(message: Message, agent: AgentInterface): void | Promise<void>;
  /** 
   * Called before a tool is executed. Can be used for:
   * - Audit logging
   * - Tool call mutation/interception
   * - Performance monitoring
   * - Rate limiting
   */
  onBeforeToolExecute?(toolCall: ToolCall, ctx: ToolContext): void | Promise<void>;
  /**
   * Called after a tool has executed. Can be used for:
   * - Audit logging of results
   * - Performance tracking (measure duration between before/after)
   * - Result transformation
   * - Error analysis
   */
  onAfterToolExecute?(toolCall: ToolCall, result: ToolResult, ctx: ToolContext): void | Promise<void>;
  /** Called when the agent is shutting down */
  onShutdown?(agent: AgentInterface): void | Promise<void>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Define a plugin with type safety
 */
export function definePlugin(plugin: AgentPlugin): AgentPlugin {
  return plugin;
}

/**
 * Define a tool with type safety
 */
export function defineTool<TParams>(
  definition: ToolDefinition<TParams>
): ToolDefinition<TParams> {
  return definition;
}

/**
 * Define a provider with type safety
 */
export function defineProvider(definition: ProviderDefinition): ProviderDefinition {
  return definition;
}

/**
 * Define a command with type safety
 */
export function defineCommand(definition: CommandDefinition): CommandDefinition {
  return definition;
}

/**
 * Define UI contributions with type safety
 */
export function defineUIContributions(ui: UIPluginContributions): UIPluginContributions {
  return ui;
}
