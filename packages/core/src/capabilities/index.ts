/**
 * Environment Capabilities System
 * 
 * Provides a way for environments (Node.js, React Native, browser, etc.) to
 * declare what they support, and for tools to declare what they require.
 * 
 * This ensures:
 * 1. Tools are only registered if the environment can support them
 * 2. The LLM never sees tools it can't use
 * 3. Clear errors instead of cryptic runtime failures
 * 4. Plugin authors know exactly what they need to provide
 * 
 * Well-known capabilities:
 * - filesystem: Read/write files, glob, grep (provided by tools-terminal, react-native)
 * - terminal:   Shell/bash execution (Node.js only)
 * - network:    HTTP fetch, WebSocket, web search (most environments)
 * - subagent:   Spawn child agents (requires SubagentManager)
 * - storage:    Database/session persistence (requires storage plugin)
 * - browser:    Browser automation (requires browser-sandbox)
 * - git:        Git operations (requires terminal + git binary)
 * 
 * Custom capabilities can also be registered as arbitrary strings.
 */

// ============================================================================
// Well-Known Capability Names
// ============================================================================

/**
 * Well-known environment capabilities.
 * These are the standard capabilities that the framework recognizes.
 * Plugins and tools can also use custom string capabilities beyond these.
 */
export const Capability = {
  /** File read/write, directory listing, glob, grep */
  Filesystem: "filesystem",
  /** Shell/terminal command execution */
  Terminal: "terminal",
  /** HTTP fetch, WebSocket, web APIs */
  Network: "network",
  /** Spawn and manage child agent instances */
  Subagent: "subagent",
  /** Database-backed session and message persistence */
  Storage: "storage",
  /** Browser automation and page interaction */
  Browser: "browser",
  /** Git repository operations */
  Git: "git",
} as const;

export type WellKnownCapability = typeof Capability[keyof typeof Capability];

/**
 * A capability is either a well-known string or a custom string.
 */
export type CapabilityName = WellKnownCapability | (string & {});

// ============================================================================
// Capability Registry
// ============================================================================

/**
 * Tracks which capabilities are available in the current environment.
 * 
 * Plugins register capabilities when they're loaded.
 * Tools declare which capabilities they need.
 * The registry is consulted at tool registration and LLM tool filtering time.
 */
export class CapabilityRegistry {
  private capabilities: Map<string, CapabilityInfo> = new Map();

  /**
   * Register a capability as available.
   */
  register(name: CapabilityName, info?: Partial<CapabilityInfo>): void {
    this.capabilities.set(name, {
      name,
      providedBy: info?.providedBy ?? "unknown",
      version: info?.version,
      metadata: info?.metadata,
    });
  }

  /**
   * Unregister a capability.
   */
  unregister(name: CapabilityName): boolean {
    return this.capabilities.delete(name);
  }

  /**
   * Check if a capability is available.
   */
  has(name: CapabilityName): boolean {
    return this.capabilities.has(name);
  }

  /**
   * Check if all of the given capabilities are available.
   */
  hasAll(names: CapabilityName[]): boolean {
    return names.every((name) => this.capabilities.has(name));
  }

  /**
   * Check if any of the given capabilities are available.
   */
  hasAny(names: CapabilityName[]): boolean {
    return names.some((name) => this.capabilities.has(name));
  }

  /**
   * Get the missing capabilities from a required set.
   * Returns an empty array if all are available.
   */
  getMissing(required: CapabilityName[]): CapabilityName[] {
    return required.filter((name) => !this.capabilities.has(name));
  }

  /**
   * Get info about a registered capability.
   */
  get(name: CapabilityName): CapabilityInfo | undefined {
    return this.capabilities.get(name);
  }

  /**
   * Get all registered capabilities.
   */
  getAll(): CapabilityInfo[] {
    return Array.from(this.capabilities.values());
  }

  /**
   * Get all registered capability names.
   */
  getNames(): CapabilityName[] {
    return Array.from(this.capabilities.keys());
  }

  /**
   * Clear all registered capabilities.
   */
  clear(): void {
    this.capabilities.clear();
  }
}

/**
 * Information about a registered capability.
 */
export interface CapabilityInfo {
  /** The capability name */
  name: CapabilityName;
  /** Which plugin/package provides this capability */
  providedBy: string;
  /** Optional version string */
  version?: string;
  /** Optional metadata about the capability */
  metadata?: Record<string, unknown>;
}

/**
 * Global capability registry instance.
 * Shared across the agent framework.
 */
export const capabilityRegistry = new CapabilityRegistry();
