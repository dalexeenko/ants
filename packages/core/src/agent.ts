import { EventEmitter } from "eventemitter3";
import { generateId, getParentDir } from "./utils/id.js";
import { ToolRegistry, toolRegistry } from "./registry/tools.js";
import { ProviderRegistry, providerRegistry } from "./registry/providers.js";
import { CommandRegistry, commandRegistry } from "./registry/commands.js";
import { registerBuiltinCommands } from "./commands/builtin.js";
import { AgentTypeRegistry, agentTypeRegistry } from "./registry/agent-types.js";
import { CapabilityRegistry, capabilityRegistry } from "./capabilities/index.js";
import { McpManager } from "./mcp/manager.js";
import type { McpClientFactory } from "./mcp/types.js";
import {
  registerMcpTools,
  unregisterMcpTools,
  registerMcpResourcesAndPrompts,
  unregisterMcpResourcesAndPrompts,
} from "./mcp/adapter.js";
import { CompactionEngine } from "./compaction/engine.js";
import type { CompactionConfig, CompactionResult } from "./compaction/types.js";
import { DEFAULT_COMPACTION_CONFIG, getModelLimit } from "./compaction/types.js";
import { estimateConversationTokens } from "./compaction/tokens.js";
import type { SkillManagerInterface } from "./skills/types.js";
import type { ConfigLoader, ResolvedConfig } from "./config/types.js";
import type {
  AgentConfig,
  AgentEvent,
  Message,
  LLMProvider,
  ToolContext,
  AuthConfig,
  TodoItem,
  PhaseItem,
  QuestionResponse,
  AgentMode,
} from "./types.js";
import { DEFAULT_SYSTEM_PROMPT, PLAN_MODE_SYSTEM_PROMPT_SECTION, BUILD_MODE_SYSTEM_PROMPT_SECTION, PLAN_MODE_DISABLED_TOOLS } from "./types.js";
import type { McpServerConfig } from "./mcp/types.js";
import type { AgentPlugin, ProviderOptions } from "./plugin.js";
import {
  ToolPermissionManager,
  type ToolPermissionConfig,
  type PermissionRequestCallback,
  type PermissionResponse,
} from "./permissions.js";
import { UsageTracker } from "./usage/tracker.js";
import type { UsageBudget, UsageSummary, TokenUsage } from "./usage/tracker.js";
import { CircuitBreaker } from "./retry/index.js";
import type { RetryPolicy, CircuitBreakerConfig } from "./retry/index.js";
import { DEFAULT_RETRY_POLICY } from "./retry/index.js";
import type { CapabilityName } from "./capabilities/index.js";
import { PromptExecutor } from "./prompt/executor.js";
import { ToolExecutor } from "./tools/executor.js";

export interface AgentOptions {
  provider?: string;
  model?: string;
  apiKey?: string;
  systemPrompt?: string;
  workingDirectory?: string;
  tools?: string[];
  /**
   * Skip automatic config loading. If true, only use provided options.
   */
  skipConfigLoad?: boolean;
  /**
   * Custom config loader implementation.
   * If not provided and skipConfigLoad is false, config loading is skipped.
   * Use @ants/agent-node which provides filesystem-based config loading.
   */
  configLoader?: ConfigLoader;
  /**
   * Pre-resolved configuration. If provided, configLoader is not used.
   */
  resolvedConfig?: ResolvedConfig;
  /**
   * Skill manager implementation.
   * If not provided, skills are disabled.
   * Use @ants/agent-node which provides filesystem-based skill loading.
   */
  skillManager?: SkillManagerInterface;
  mcp?: Record<string, McpServerConfig>;
  /**
   * Factory function for creating MCP clients.
   * Required for stdio transport. If not provided, only SSE transport is supported.
   * Use @ants/agent-node which provides a factory that includes stdio support.
   */
  mcpClientFactory?: McpClientFactory;
  compaction?: Partial<CompactionConfig>;
  permissions?: ToolPermissionConfig;
  maxTokens?: number;
  temperature?: number;
  retryPolicy?: Partial<RetryPolicy>;
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>;
}

export interface AgentSessionContext {
  sessionId: string;
  sessionManager: unknown;
}

// Ensure built-in commands are registered once
let builtinCommandsRegistered = false;

export class Agent extends EventEmitter<{
  event: (event: AgentEvent) => void;
}> {
  private config: AgentConfig;
  private provider: LLMProvider | null = null;
  private messages: Message[] = [];
  private abortController: AbortController | null = null;
  private mcpManager: McpManager | null = null;
  private mcpClientFactory?: McpClientFactory;
  private compactionEngine: CompactionEngine | null = null;
  private compactionConfig: CompactionConfig;
  private skillManager: SkillManagerInterface | null = null;
  private todos: TodoItem[] = [];
  private phases: PhaseItem[] = [];
  private sessionContext: AgentSessionContext | null = null;
  
  // Plugin system
  private plugins: Map<string, AgentPlugin> = new Map();
  private extensions: Map<string, unknown> = new Map();

  // Tool permissions
  private permissionManager: ToolPermissionManager;

  // Question resolvers (for blocking on user input from the question tool)
  private questionResolvers: Map<string, (response: QuestionResponse) => void> = new Map();

  // Permission resolvers (for blocking on user permission response from remote clients)
  private permissionResolvers: Map<string, (response: PermissionResponse) => void> = new Map();

  // Usage tracking
  private usageTracker: UsageTracker;

  // Retry and circuit breaker
  private retryPolicy: RetryPolicy;
  private circuitBreaker: CircuitBreaker;

  // Delegated managers
  private promptExecutor: PromptExecutor;
  private toolExecutor: ToolExecutor;

  // Instance-scoped registries (default to global singletons)
  private _toolRegistry: ToolRegistry;
  private _providerRegistry: ProviderRegistry;
  private _commandRegistry: CommandRegistry;
  private _agentTypeRegistry: AgentTypeRegistry;
  private _capabilityRegistry: CapabilityRegistry;

  constructor(
    config: AgentConfig, 
    compactionConfig?: Partial<CompactionConfig>,
    permissionConfig?: ToolPermissionConfig,
    mcpClientFactory?: McpClientFactory,
    skillManager?: SkillManagerInterface,
    retryPolicy?: Partial<RetryPolicy>,
    circuitBreakerConfig?: Partial<CircuitBreakerConfig>
  ) {
    super();
    this.config = {
      ...config,
      systemPrompt: config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    };
    this.mcpClientFactory = mcpClientFactory;
    this.skillManager = skillManager ?? null;

    // Initialize registries (default to global singletons)
    this._toolRegistry = toolRegistry;
    this._providerRegistry = providerRegistry;
    this._commandRegistry = commandRegistry;
    this._agentTypeRegistry = agentTypeRegistry;
    this._capabilityRegistry = capabilityRegistry;

    // Try to create provider from registry
    if (this._providerRegistry.has(config.provider)) {
      this.provider = this._providerRegistry.create(config.provider, {
        auth: config.auth,
        apiKey: config.auth.apiKey,
      });
    }

    this.compactionConfig = { ...DEFAULT_COMPACTION_CONFIG, ...compactionConfig };

    if (this.compactionConfig.enabled && this.provider) {
      this.compactionEngine = new CompactionEngine(
        this.provider,
        this.config.model,
        this.compactionConfig
      );
    }

    // Initialize permission manager
    this.permissionManager = new ToolPermissionManager(permissionConfig);

    // Initialize usage tracker
    this.usageTracker = new UsageTracker();

    // Initialize retry and circuit breaker
    this.retryPolicy = { ...DEFAULT_RETRY_POLICY, ...retryPolicy };
    this.circuitBreaker = new CircuitBreaker(circuitBreakerConfig);

    // Initialize delegated managers
    this.toolExecutor = new ToolExecutor({
      getPermissionManager: () => this.permissionManager,
      getRetryPolicy: () => this.retryPolicy,
      getCircuitBreaker: () => this.circuitBreaker,
      getPlugins: () => this.plugins.values(),
      getToolRegistry: () => this._toolRegistry,
      emitEvent: (event) => this.emit("event", event),
    });

    this.promptExecutor = new PromptExecutor({
      getProvider: () => this.provider,
      getConfig: () => this.config,
      getMessages: () => this.messages,
      pushMessage: async (msg) => {
        this.messages.push(msg);
        // Call onMessageAdded hooks so plugins (e.g. storage) can persist
        // incrementally. Awaited to guarantee the write lands before the
        // agent loop continues.
        for (const plugin of this.plugins.values()) {
          if (plugin.onMessageAdded) {
            await plugin.onMessageAdded(msg, this);
          }
        }
      },
      getAbortSignal: () => this.abortController?.signal,
      emitEvent: (event) => this.emit("event", event),
      getSessionId: () => this.sessionContext?.sessionId,
      getUsageTracker: () => this.usageTracker,
      getToolRegistry: () => this._toolRegistry,
      shouldAutoCompact: () => !!(this.compactionConfig.autoCompact && this.compactionEngine),
      checkCompactionNeeded: () => this.compactionEngine?.shouldCompact(this.messages) ?? null,
      runCompaction: (onDelta) => this.runCompaction(onDelta),
      getWorkingWindow: () => this.getWorkingWindow(),
      executeTools: (messageId, toolCalls) => this.executeTools(messageId, toolCalls),
    });
    
    // Register built-in commands once
    if (!builtinCommandsRegistered) {
      registerBuiltinCommands(this._commandRegistry);
      builtinCommandsRegistered = true;
    }
  }

  // ============================================================================
  // Plugin System
  // ============================================================================

  /**
   * Register a plugin with this agent
   */
  async use(plugin: AgentPlugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin already registered: ${plugin.name}`);
    }

    // Register capabilities first (so tools can check them)
    if (plugin.capabilities) {
      for (const cap of plugin.capabilities) {
        this._capabilityRegistry.register(cap, {
          providedBy: plugin.name,
          version: plugin.version,
        });
      }
      // Re-evaluate any deferred tools now that new capabilities are available
      this._toolRegistry.reevaluateDeferred();
    }

    // Register tools
    if (plugin.tools) {
      for (const tool of plugin.tools) {
        this._toolRegistry.register(tool);
      }
    }

    // Register providers
    if (plugin.providers) {
      for (const provider of plugin.providers) {
        this._providerRegistry.register(provider);
      }
    }

    // Register commands
    if (plugin.commands) {
      for (const command of plugin.commands) {
        this._commandRegistry.register(command);
      }
    }

    // Register agent types
    if (plugin.agentTypes) {
      for (const agentType of plugin.agentTypes) {
        this._agentTypeRegistry.register({
          ...agentType,
          source: agentType.source ?? "plugin",
        });
      }
    }

    // Register skills - add the skill paths to the skill manager
    if (plugin.skills && this.skillManager && this.skillManager.addBundledPath) {
      for (const skill of plugin.skills) {
        // Get the parent directory of the skill file (e.g., /path/to/skills/code-review from /path/to/skills/code-review/SKILL.md)
        const skillDir = getParentDir(skill.path);
        const skillsBaseDir = getParentDir(skillDir);
        this.skillManager.addBundledPath(skillsBaseDir);
      }
      // Re-discover skills to pick up the new paths
      await this.skillManager.discover();
      
      // Update system prompt with new skills
      const skillsSection = this.skillManager.generateSystemPromptSection();
      if (skillsSection) {
        // Remove old skills section and add new one
        const basePrompt = this.config.systemPrompt?.replace(/\n\n# Available Skills[\s\S]*$/, "") ?? DEFAULT_SYSTEM_PROMPT;
        this.config.systemPrompt = basePrompt + "\n\n" + skillsSection;
      }
    }

    // Call lifecycle hook
    await plugin.onRegister?.(this);

    this.plugins.set(plugin.name, plugin);
    
    // If plugin registered providers and we don't have one yet, try to create it now
    // This must happen after onRegister since the plugin may set up state there
    if (plugin.providers && !this.provider && this._providerRegistry.has(this.config.provider)) {
      this.provider = this._providerRegistry.create(this.config.provider, {
        auth: this.config.auth,
        apiKey: this.config.auth.apiKey,
      });
      
      // Also create/update compaction engine if needed
      if (this.compactionConfig.enabled && this.provider) {
        this.compactionEngine = new CompactionEngine(
          this.provider,
          this.config.model,
          this.compactionConfig
        );
      }
    }
  }

  /**
   * Unregister a plugin and remove all its contributions from the global registries.
   * Calls the plugin's onShutdown hook before removal.
   */
  async unuse(pluginName: string): Promise<void> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      throw new Error(`Plugin not registered: ${pluginName}`);
    }

    // Call shutdown hook first
    await plugin.onShutdown?.(this);

    // Unregister tools
    if (plugin.tools) {
      for (const tool of plugin.tools) {
        this._toolRegistry.unregister(tool.name);
      }
    }

    // Unregister providers
    if (plugin.providers) {
      for (const provider of plugin.providers) {
        this._providerRegistry.unregister(provider.name);
      }
    }

    // Unregister commands
    if (plugin.commands) {
      for (const command of plugin.commands) {
        this._commandRegistry.unregister(command.name);
      }
    }

    // Unregister agent types
    if (plugin.agentTypes) {
      for (const agentType of plugin.agentTypes) {
        this._agentTypeRegistry.unregister(agentType.name);
      }
    }

    // Unregister capabilities
    if (plugin.capabilities) {
      for (const cap of plugin.capabilities) {
        this._capabilityRegistry.unregister(cap);
      }
    }

    // Remove the plugin
    this.plugins.delete(pluginName);
  }

  /**
   * Get a registered plugin by name
   */
  getPlugin(name: string): AgentPlugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Get all registered plugin names
   */
  getPluginNames(): string[] {
    return Array.from(this.plugins.keys());
  }

  /**
   * Set extension data (for plugins to store state)
   */
  setExtension(key: string, value: unknown): void {
    this.extensions.set(key, value);
  }

  /**
   * Get extension data
   */
  getExtension<T>(key: string): T | undefined {
    return this.extensions.get(key) as T | undefined;
  }

  // ============================================================================
  // Provider Management
  // ============================================================================

  /**
   * Set the LLM provider by name
   */
  setProvider(name: string, options: ProviderOptions = {}): void {
    this.provider = this._providerRegistry.create(name, {
      ...options,
      auth: this.config.auth,
    });
    this.config.provider = name;
    
    // Recreate compaction engine with new provider
    if (this.compactionConfig.enabled && this.provider) {
      this.compactionEngine = new CompactionEngine(
        this.provider,
        this.config.model,
        this.compactionConfig
      );
    }
  }

  /**
   * Set the LLM provider directly with a provider instance.
   * Use this when you have a pre-configured provider (e.g., OAuth provider with tokens).
   */
  setProviderInstance(provider: LLMProvider, providerName?: string): void {
    this.provider = provider;
    if (providerName) {
      this.config.provider = providerName;
    }
    
    // Recreate compaction engine with new provider
    if (this.compactionConfig.enabled && this.provider) {
      this.compactionEngine = new CompactionEngine(
        this.provider,
        this.config.model,
        this.compactionConfig
      );
    }
  }

  /**
   * Check if a provider is available
   */
  hasProvider(name: string): boolean {
    return this._providerRegistry.has(name);
  }

  /**
   * Get available provider names
   */
  getAvailableProviders(): string[] {
    return this._providerRegistry.getNames();
  }

  // ============================================================================
  // Tool Management
  // ============================================================================

  /**
   * Get all registered tools
   */
  getTools(): Array<{ name: string; description?: string }> {
    return this._toolRegistry.getAll().map(tool => ({
      name: tool.name,
      description: tool.description,
    }));
  }

  // ============================================================================
  // Registry Access
  // ============================================================================

  /**
   * Get the tool registry for this agent.
   * Defaults to the global singleton; can be overridden per-instance
   * via useIsolatedToolRegistry().
   */
  getToolRegistry(): ToolRegistry {
    return this._toolRegistry;
  }

  /**
   * Create and use a new per-instance ToolRegistry, isolating this agent's
   * tools from the global singleton. Must be called before registering any
   * plugins (i.e., before agent.use()).
   */
  useIsolatedToolRegistry(): void {
    this._toolRegistry = new ToolRegistry(this._capabilityRegistry);
  }

  /**
   * Get the provider registry for this agent.
   */
  getProviderRegistry(): ProviderRegistry {
    return this._providerRegistry;
  }

  /**
   * Get the command registry for this agent.
   */
  getCommandRegistry(): CommandRegistry {
    return this._commandRegistry;
  }

  /**
   * Get the agent type registry for this agent.
   */
  getAgentTypeRegistry(): AgentTypeRegistry {
    return this._agentTypeRegistry;
  }

  /**
   * Get the capability registry for this agent.
   */
  getCapabilityRegistry(): CapabilityRegistry {
    return this._capabilityRegistry;
  }

  // ============================================================================
  // MCP Integration
  // ============================================================================

  async initMcp(mcpConfig: Record<string, McpServerConfig>): Promise<void> {
    if (this.mcpManager) {
      await this.shutdownMcp();
    }

    this.mcpManager = new McpManager({
      clientFactory: this.mcpClientFactory,
    });

    this.mcpManager.on("server.connected", (serverName, toolCount) => {
      this.emit("event", {
        type: "mcp.server.connected",
        serverName,
        toolCount,
      } as AgentEvent);
    });

    this.mcpManager.on("server.disconnected", (serverName, reason) => {
      this.emit("event", {
        type: "mcp.server.disconnected",
        serverName,
        reason,
      } as AgentEvent);
    });

    await this.mcpManager.loadFromConfig(mcpConfig);
    registerMcpTools(this.mcpManager, this._toolRegistry);
    registerMcpResourcesAndPrompts(this.mcpManager, this._toolRegistry);
  }

  async shutdownMcp(): Promise<void> {
    if (this.mcpManager) {
      unregisterMcpResourcesAndPrompts(this.mcpManager, this._toolRegistry);
      unregisterMcpTools(this.mcpManager, this._toolRegistry);
      await this.mcpManager.shutdown();
      this.mcpManager = null;
    }
  }

  getMcpManager(): McpManager | null {
    return this.mcpManager;
  }

  // ============================================================================
  // Skills Integration
  // ============================================================================

  /**
   * Set the skill manager for this agent.
   * Call this before prompting to enable skill discovery.
   */
  setSkillManager(manager: SkillManagerInterface): void {
    this.skillManager = manager;
  }

  /**
   * Initialize skills if a skill manager is configured.
   * Discovers skills and updates the system prompt.
   */
  async initSkills(): Promise<void> {
    if (!this.skillManager) {
      // No skill manager configured - skills are disabled
      return;
    }

    await this.skillManager.discover();

    // Log any override warnings
    const warnings = this.skillManager.getOverrideWarnings?.() ?? [];
    for (const warning of warnings) {
      console.warn(`Warning: ${warning}`);
    }

    // Inject skills section into system prompt
    const skillsSection = this.skillManager.generateSystemPromptSection();
    if (skillsSection) {
      this.config.systemPrompt =
        (this.config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT) + "\n\n" + skillsSection;
    }
  }

  getSkillManager(): SkillManagerInterface | null {
    return this.skillManager;
  }

  // ============================================================================
  // Compaction
  // ============================================================================

  getCompactionEngine(): CompactionEngine | null {
    return this.compactionEngine;
  }

  getCompactionConfig(): CompactionConfig {
    return { ...this.compactionConfig };
  }

  updateCompactionConfig(updates: Partial<CompactionConfig>): void {
    this.compactionConfig = { ...this.compactionConfig, ...updates };
    if (this.compactionEngine) {
      this.compactionEngine.updateConfig(updates);
    }
  }

  async runCompaction(onDelta?: (delta: string) => void): Promise<CompactionResult> {
    if (!this.compactionEngine) {
      throw new Error("Compaction not enabled");
    }

    const result = await this.compactionEngine.compact(this.messages, onDelta);

    // Allow plugins to add context to summary (e.g., background tasks)
    let summaryWithContext = result.summary;
    for (const plugin of this.plugins.values()) {
      const pluginWithContext = plugin as unknown as { getContextSummary?: () => string };
      if (typeof pluginWithContext.getContextSummary === "function") {
        const additionalContext = pluginWithContext.getContextSummary();
        if (additionalContext) {
          summaryWithContext = `${summaryWithContext}\n\n${additionalContext}`;
        }
      }
    }

    // Append the summary message to the conversation.
    // It will be persisted via the onMessageAdded plugin hooks.
    const summaryMessage = this.compactionEngine.createSummaryMessage(summaryWithContext);
    this.messages.push(summaryMessage);
    for (const plugin of this.plugins.values()) {
      if (plugin.onMessageAdded) {
        await plugin.onMessageAdded(summaryMessage, this);
      }
    }

    return result;
  }

  shouldCompact(): boolean {
    if (!this.compactionEngine) return false;
    return this.compactionEngine.shouldCompact(this.messages) !== null;
  }

  /**
   * Get the current context window usage: estimated token count and model limit.
   */
  getContextUsage(): { currentTokens: number; maxTokens: number; model: string } {
    const model = this.config.model;
    const maxTokens = getModelLimit(model);
    const workingWindow = this.getWorkingWindow();
    const currentTokens = estimateConversationTokens(workingWindow);
    return { currentTokens, maxTokens, model };
  }

  /**
   * Get the working window of messages — everything from the last compaction
   * summary to the end. This is what gets sent to the LLM.
   */
  getWorkingWindow(): Message[] {
    if (!this.compactionEngine) return [...this.messages];
    return this.compactionEngine.getWorkingWindow(this.messages);
  }

  // ============================================================================
  // Tool Permissions
  // ============================================================================

  /**
   * Get the permission manager
   */
  getPermissionManager(): ToolPermissionManager {
    return this.permissionManager;
  }

  /**
   * Set the callback for requesting user permission for tool execution
   */
  setPermissionRequestCallback(callback: PermissionRequestCallback | null): void {
    this.permissionManager.setRequestCallback(callback);
  }

  /**
   * Update the permission configuration
   */
  updatePermissionConfig(config: Partial<ToolPermissionConfig>): void {
    this.permissionManager.updateConfig(config);
  }

  /**
   * Allow a tool for the current session
   */
  allowToolForSession(toolName: string): void {
    this.permissionManager.allowForSession(toolName);
  }

  /**
   * Deny a tool for the current session
   */
  denyToolForSession(toolName: string): void {
    this.permissionManager.denyForSession(toolName);
  }

  /**
   * Clear all session-level tool permissions
   */
  clearToolPermissions(): void {
    this.permissionManager.clearSessionPermissions();
  }

  // ============================================================================
  // Question System (interactive user input)
  // ============================================================================

  /**
   * Register a resolver for a pending question.
   * Called by the question tool to block until the user responds.
   */
  registerQuestionResolver(questionId: string, resolver: (response: QuestionResponse) => void): void {
    this.questionResolvers.set(questionId, resolver);
  }

  /**
   * Respond to a pending question, unblocking the question tool's execution.
   * Called by frontends (CLI, server, app) when the user provides an answer.
   */
  respondToQuestion(questionId: string, response: QuestionResponse): void {
    const resolver = this.questionResolvers.get(questionId);
    if (resolver) {
      resolver(response);
      this.questionResolvers.delete(questionId);
    }
  }

  /**
   * Check if there is a pending question.
   */
  hasPendingQuestion(questionId: string): boolean {
    return this.questionResolvers.has(questionId);
  }

  // ============================================================================
  // Permission System (remote interactive permission requests)
  // ============================================================================

  /**
   * Set up the permission system for remote use.
   * Installs a permission callback that creates a pending promise for each
   * tool permission request, allowing remote clients to respond via
   * respondToPermission().
   */
  setupRemotePermissions(): void {
    this.setPermissionRequestCallback(async (toolCall) => {
      return new Promise<PermissionResponse>((resolve) => {
        this.permissionResolvers.set(toolCall.id, resolve);
      });
    });
  }

  /**
   * Respond to a pending permission request, unblocking the tool execution.
   * Called by frontends (server, app) when the user provides an answer.
   */
  respondToPermission(toolCallId: string, response: PermissionResponse): void {
    const resolver = this.permissionResolvers.get(toolCallId);
    if (resolver) {
      resolver(response);
      this.permissionResolvers.delete(toolCallId);
    }
  }

  /**
   * Check if there is a pending permission request.
   */
  hasPendingPermission(toolCallId: string): boolean {
    return this.permissionResolvers.has(toolCallId);
  }

  // ============================================================================
  // Static Factory
  // ============================================================================

  static async create(options: AgentOptions = {}): Promise<Agent> {
    // Default working directory - uses process.cwd() in Node.js environments
    // For React Native or other environments, workingDirectory should be explicitly provided
    const workingDirectory = options.workingDirectory ?? 
      (typeof process !== "undefined" && process.cwd ? process.cwd() : ".");

    let config: ResolvedConfig | undefined;

    // Determine configuration source
    if (options.resolvedConfig) {
      // Use pre-resolved config
      config = options.resolvedConfig;
    } else if (!options.skipConfigLoad && options.configLoader) {
      // Use provided config loader
      config = await options.configLoader.loadConfig(workingDirectory, {
        provider: options.provider,
        model: options.model,
        apiKey: options.apiKey,
        systemPrompt: options.systemPrompt,
        tools: options.tools,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
      });
    }

    // Build auth config
    const auth: AuthConfig = config?.auth ?? (
      options.apiKey
        ? { type: "api-key", apiKey: options.apiKey }
        : { type: "oauth" }
    );

    const agent = new Agent(
      {
        provider: config?.provider ?? options.provider ?? "anthropic",
        model: config?.model ?? options.model ?? "claude-sonnet-4-20250514",
        auth,
        systemPrompt: config?.systemPrompt ?? options.systemPrompt,
        tools: config?.tools ?? options.tools,
        disabledTools: config?.disabledTools,
        workingDirectory,
        maxTokens: config?.maxTokens ?? options.maxTokens,
        temperature: config?.temperature ?? options.temperature,
      },
      options.compaction,
      options.permissions,
      options.mcpClientFactory,
      options.skillManager,
      options.retryPolicy,
      options.circuitBreakerConfig,
    );

    // Initialize MCP if configured
    const mcpConfig = options.mcp ?? config?.mcp;
    if (mcpConfig && Object.keys(mcpConfig).length > 0) {
      await agent.initMcp(mcpConfig);
    }

    // Initialize skills if a skill manager was provided
    if (options.skillManager) {
      await agent.initSkills();
    }

    // Load agent types from config
    if (config?.agentTypes) {
      for (const [name, typeConfig] of Object.entries(config.agentTypes)) {
        agent._agentTypeRegistry.register({
          name,
          version: typeConfig.version,
          description: typeConfig.description ?? `Custom agent type: ${name}`,
          systemPrompt: typeConfig.systemPrompt,
          model: typeConfig.model,
          provider: typeConfig.provider,
          allowedTools: typeConfig.allowedTools,
          deniedTools: typeConfig.deniedTools,
          maxIterations: typeConfig.maxIterations,
          tokenBudget: typeConfig.tokenBudget,
          temperature: typeConfig.temperature,
          enabled: typeConfig.enabled,
          source: "config",
          integrity: typeConfig.integrity,
        });
      }
    }

    return agent;
  }

  // ============================================================================
  // Prompt & Agent Loop (delegates to PromptExecutor and ToolExecutor)
  // ============================================================================

  async prompt(userMessage: string): Promise<Message> {
    // Check for slash command (auto-detect)
    if (userMessage.startsWith("/")) {
      const commandResult = await this._commandRegistry.execute(userMessage, {
        agent: this,
        sessionId: this.sessionContext?.sessionId,
      });

      if (commandResult) {
        // Emit command result event
        this.emit("event", {
          type: "command.result",
          command: userMessage.split(" ")[0],
          output: commandResult.output,
        } as AgentEvent);

        if (!commandResult.shouldContinue) {
          // Return command output as a message
          return {
            id: generateId(),
            role: "assistant",
            content: commandResult.output,
            createdAt: Date.now(),
          };
        }
        // If shouldContinue, use transformed input or original
        userMessage = commandResult.transformedInput ?? userMessage;
      }
    }

    // Call onBeforePrompt hooks
    for (const plugin of this.plugins.values()) {
      if (plugin.onBeforePrompt) {
        userMessage = await plugin.onBeforePrompt(userMessage, this);
      }
    }

    const userMsg: Message = {
      id: generateId(),
      role: "user",
      content: userMessage,
      createdAt: Date.now(),
    };
    this.messages.push(userMsg);

    // Notify plugins of the new user message (same hook used by the
    // executor for assistant/tool-result messages) so that storage
    // plugins can persist it immediately.
    for (const plugin of this.plugins.values()) {
      if (plugin.onMessageAdded) {
        await plugin.onMessageAdded(userMsg, this);
      }
    }

    this.emit("event", {
      type: "user.message",
      messageId: userMsg.id,
      content: userMsg.content,
    });

    this.abortController = new AbortController();

    try {
      const response = await this.runAgentLoop();

      // Call onAfterPrompt hooks
      for (const plugin of this.plugins.values()) {
        if (plugin.onAfterPrompt) {
          await plugin.onAfterPrompt(response, this);
        }
      }

      return response;
    } finally {
      this.abortController = null;
    }
  }

  private async runAgentLoop(): Promise<Message> {
    return this.promptExecutor.runAgentLoop();
  }

  private async executeTools(
    messageId: string,
    toolCalls: import("./types.js").ToolCall[]
  ): Promise<import("./types.js").ToolResult[]> {
    const ctx: ToolContext = {
      workingDirectory: this.config.workingDirectory!,
      abortSignal: this.abortController?.signal,
      sessionId: this.sessionContext?.sessionId,
      messageId,
      getTodos: () => this.todos,
      setTodos: (todos: TodoItem[]) => {
        this.todos = todos;
        this.emit("event", { type: "todos.updated", todos });
      },
      getPhases: () => this.phases,
      setPhases: (phases: PhaseItem[]) => {
        this.phases = phases;
        this.emit("event", { type: "phases.updated", phases });
      },
      emitEvent: (event: AgentEvent) => this.emit("event", event),
      getSessionManager: () => this.sessionContext?.sessionManager,
      getSkillManager: () => this.skillManager,
      getAgent: () => this,
      extensions: Object.fromEntries(this.extensions),
    };

    return this.toolExecutor.executeTools(messageId, toolCalls, ctx);
  }

  // ============================================================================
  // State Management
  // ============================================================================

  abort(): void {
    this.abortController?.abort();
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  clearMessages(): void {
    this.messages = [];
  }

  setMessages(messages: Message[]): void {
    this.messages = [...messages];
  }

  getProvider(): LLMProvider | null {
    return this.provider;
  }

  getConfig(): AgentConfig {
    return { ...this.config };
  }

  setModel(provider: string, model: string): void {
    this.config.provider = provider;
    this.config.model = model;

    if (this._providerRegistry.has(provider)) {
      this.provider = this._providerRegistry.create(provider, {
        auth: this.config.auth,
      });
    }

    if (this.compactionEngine && this.provider) {
      this.compactionEngine = new CompactionEngine(
        this.provider,
        model,
        this.compactionConfig
      );
    }
  }

  getTodos(): TodoItem[] {
    return [...this.todos];
  }

  setTodos(todos: TodoItem[]): void {
    this.todos = [...todos];
  }

  clearTodos(): void {
    this.todos = [];
  }

  getPhases(): PhaseItem[] {
    return [...this.phases];
  }

  setPhases(phases: PhaseItem[]): void {
    this.phases = [...phases];
  }

  clearPhases(): void {
    this.phases = [];
  }

  setSessionContext(context: AgentSessionContext): void {
    this.sessionContext = context;
  }

  getSessionContext(): AgentSessionContext | null {
    return this.sessionContext;
  }

  /**
   * Get the current working directory.
   */
  getWorkingDirectory(): string {
    return this.config.workingDirectory!;
  }

  /**
   * Get the current system prompt.
   */
  getSystemPrompt(): string {
    return this.config.systemPrompt ?? "";
  }

  /**
   * Set the system prompt. This replaces the entire prompt (including
   * any skills section that was appended). Use with care — prefer
   * composing the prompt externally and setting the full result.
   */
  setSystemPrompt(prompt: string): void {
    this.config.systemPrompt = prompt;
  }

  /**
   * Set the working directory for tool execution.
   * Emits an event so consumers can react to the change.
   */
  setWorkingDirectory(dir: string): void {
    this.config.workingDirectory = dir;
    this.emit("event", {
      type: "agent.workingDirectory.changed",
      workingDirectory: dir,
    });
  }

  // ============================================================================
  // Agent Mode (Plan / Build)
  // ============================================================================

  /**
   * Get the current agent mode ('plan' or 'build').
   */
  getMode(): AgentMode {
    return this.config.mode ?? "build";
  }

  /**
   * Set the agent mode. Updates the system prompt with the mode section
   * and enables/disables write tools based on the mode.
   */
  setMode(mode: AgentMode): void {
    const previousMode = this.config.mode ?? "build";
    this.config.mode = mode;

    // Update system prompt: remove old mode section and add new one
    const modeRegex = /\n\n# Mode: (?:Plan|Build)[\s\S]*?(?=\n\n# |\n\n$|$)/;
    let prompt = this.config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    prompt = prompt.replace(modeRegex, "");
    
    const modeSection = mode === "plan" 
      ? PLAN_MODE_SYSTEM_PROMPT_SECTION 
      : BUILD_MODE_SYSTEM_PROMPT_SECTION;
    this.config.systemPrompt = prompt + "\n\n" + modeSection;

    // In plan mode, add write tools to disabled list
    // In build mode, remove them from disabled list (if we added them)
    if (mode === "plan") {
      const disabled = new Set(this.config.disabledTools ?? []);
      for (const tool of PLAN_MODE_DISABLED_TOOLS) {
        disabled.add(tool);
      }
      this.config.disabledTools = [...disabled];
    } else if (previousMode === "plan") {
      // Only remove the tools we specifically added for plan mode
      const disabled = new Set(this.config.disabledTools ?? []);
      for (const tool of PLAN_MODE_DISABLED_TOOLS) {
        disabled.delete(tool);
      }
      this.config.disabledTools = disabled.size > 0 ? [...disabled] : undefined;
    }

    this.emit("event", {
      type: "agent.mode.changed",
      mode,
    });
  }

  // ============================================================================
  // Usage Tracking
  // ============================================================================

  /**
   * Get the usage tracker instance.
   */
  getUsageTracker(): UsageTracker {
    return this.usageTracker;
  }

  /**
   * Get a summary of token usage and estimated cost.
   */
  getUsageSummary(): UsageSummary {
    return this.usageTracker.getSummary();
  }

  /**
   * Set a token/cost budget for this agent.
   */
  setUsageBudget(budget: UsageBudget | undefined): void {
    this.usageTracker.setBudget(budget);
  }

  /**
   * Get current token usage for this session.
   */
  getTokenUsage(): TokenUsage {
    return this.usageTracker.getSessionUsage(
      this.sessionContext?.sessionId ?? "default"
    );
  }

  // ============================================================================
  // Shutdown
  // ============================================================================

  async shutdown(): Promise<void> {
    // Call plugin shutdown hooks
    for (const plugin of this.plugins.values()) {
      if (plugin.onShutdown) {
        await plugin.onShutdown(this);
      }
    }

    // Shutdown MCP
    await this.shutdownMcp();
  }
}

export async function createAgent(options?: AgentOptions): Promise<Agent> {
  return Agent.create(options);
}
