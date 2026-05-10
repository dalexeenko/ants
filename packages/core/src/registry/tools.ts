import type { ToolDefinition, LLMTool } from "../types.js";
import { capabilityRegistry as globalCapabilityRegistry, type CapabilityRegistry } from "../capabilities/index.js";

/**
 * Registry for tool definitions.
 * Tools are registered here and can be retrieved by name.
 * 
 * When capabilities are registered in the environment, the registry
 * will filter out tools whose required capabilities are not met.
 */
export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  /** Tools that were skipped due to missing capabilities, keyed by name */
  private deferred: Map<string, ToolDefinition> = new Map();
  /** The capability registry to consult for deferred tool evaluation */
  private capabilityRegistry: CapabilityRegistry;

  constructor(capabilityRegistry?: CapabilityRegistry) {
    this.capabilityRegistry = capabilityRegistry ?? globalCapabilityRegistry;
  }

  /**
   * Register a tool.
   * 
   * If the tool has `requiredCapabilities` and any are missing,
   * the tool is deferred (stored but not active). When new capabilities
   * are registered, deferred tools are re-evaluated.
   */
  register<TParams>(tool: ToolDefinition<TParams>): void {
    if (tool.requiredCapabilities?.length) {
      const missing = this.capabilityRegistry.getMissing(tool.requiredCapabilities);
      if (missing.length > 0) {
        // Defer this tool until capabilities are available
        this.deferred.set(tool.name, tool as ToolDefinition);
        return;
      }
    }
    this.tools.set(tool.name, tool as ToolDefinition);
    // Remove from deferred if it was there
    this.deferred.delete(tool.name);
  }

  /**
   * Re-evaluate all deferred tools.
   * Call this after registering new capabilities.
   */
  reevaluateDeferred(): string[] {
    const promoted: string[] = [];
    for (const [name, tool] of this.deferred) {
      if (!tool.requiredCapabilities?.length) {
        this.tools.set(name, tool);
        this.deferred.delete(name);
        promoted.push(name);
        continue;
      }
      const missing = this.capabilityRegistry.getMissing(tool.requiredCapabilities);
      if (missing.length === 0) {
        this.tools.set(name, tool);
        this.deferred.delete(name);
        promoted.push(name);
      }
    }
    return promoted;
  }

  /**
   * Unregister a tool by name
   */
  unregister(name: string): boolean {
    this.deferred.delete(name);
    return this.tools.delete(name);
  }

  /**
   * Get a tool by name
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool is registered (and active)
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Check if a tool is deferred (registered but missing capabilities)
   */
  isDeferred(name: string): boolean {
    return this.deferred.has(name);
  }

  /**
   * Get all active registered tools
   */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get all deferred tool names and their missing capabilities
   */
  getDeferredInfo(): Array<{ name: string; missingCapabilities: string[] }> {
    const info: Array<{ name: string; missingCapabilities: string[] }> = [];
    for (const [name, tool] of this.deferred) {
      info.push({
        name,
        missingCapabilities: tool.requiredCapabilities
          ? this.capabilityRegistry.getMissing(tool.requiredCapabilities)
          : [],
      });
    }
    return info;
  }

  /**
   * Get all registered tool names (active only)
   */
  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Convert tools to LLM format, optionally filtering by name.
   * Only returns tools whose capabilities are satisfied.
   * 
   * @param filter - If provided, only include these tools (whitelist)
   * @param disabled - If provided, exclude these tools (blacklist, applied after whitelist)
   */
  toLLMTools(filter?: string[], disabled?: string[]): LLMTool[] {
    let tools: ToolDefinition[] = filter
      ? (filter.map((name) => this.tools.get(name)).filter(Boolean) as ToolDefinition[])
      : this.getAll();

    if (disabled?.length) {
      const disabledSet = new Set(disabled);
      tools = tools.filter((tool) => !disabledSet.has(tool.name));
    }

    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  /**
   * Clear all registered and deferred tools
   */
  clear(): void {
    this.tools.clear();
    this.deferred.clear();
  }
}

/**
 * Global tool registry instance
 */
export const toolRegistry = new ToolRegistry();
