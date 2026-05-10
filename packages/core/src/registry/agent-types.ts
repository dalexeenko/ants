/**
 * Registry for agent type definitions.
 * 
 * Agent types define named, reusable configurations for subagents.
 * They can be registered by plugins or loaded from user config.
 * When the LLM invokes the task tool with a `subagent_type`, the
 * registry is consulted to resolve the agent's configuration.
 */

export interface AgentTypeDefinition {
  /** Unique name for this agent type (e.g., "explore-code", "general-code") */
  name: string;

  /** Semantic version string (e.g., "1.0.0") */
  version?: string;

  /** Human-readable description shown to the LLM in the task tool */
  description: string;

  /** Custom system prompt for this agent type */
  systemPrompt?: string;

  /** Override model (e.g., use a cheaper model for simple tasks) */
  model?: string;

  /** Override provider */
  provider?: string;

  /** Tool allow list - only these tools will be available */
  allowedTools?: string[];

  /** Tool deny list - these tools will be blocked */
  deniedTools?: string[];

  /** Maximum agent loop iterations */
  maxIterations?: number;

  /** Maximum token budget */
  tokenBudget?: number;

  /** Temperature override */
  temperature?: number;

  /** Tags for categorization and filtering (e.g., ["root"] to mark as usable for project root prompt) */
  tags?: string[];

  /** Whether this agent type is enabled (default: true) */
  enabled?: boolean;

  /** Source of this definition: "builtin", "plugin", or "config" */
  source?: "builtin" | "plugin" | "config";

  /**
   * SHA-256 integrity hash of this definition's content.
   * Computed over all fields except `integrity` itself;
   * null and undefined values are excluded for forwards compatibility.
   * Used to verify uniqueness and detect changes.
   * Format: "sha256-<hex>"
   */
  integrity?: string;
}

/**
 * Records a name conflict where two agent type definitions at the same
 * precedence level competed for the same name. The last writer wins,
 * but the conflict is tracked so the UI can surface a warning.
 */
export interface AgentTypeConflict {
  /** The agent type name that collided */
  name: string;
  /** The definition that won (last writer) */
  kept: AgentTypeDefinition;
  /** The definition that was replaced */
  replaced: AgentTypeDefinition;
}

// ============================================================================
// Integrity hash computation
// ============================================================================

/**
 * Build a deterministic canonical object from an AgentTypeDefinition,
 * excluding the `integrity` field itself. Keys are sorted alphabetically
 * for determinism. Fields with `undefined` or `null` values are omitted
 * for forwards compatibility — adding new optional fields to
 * AgentTypeDefinition won't change the hash of existing definitions.
 */
function canonicalize(def: AgentTypeDefinition): Record<string, unknown> {
  const fields: Record<string, unknown> = {};

  const raw = def as unknown as Record<string, unknown>;
  for (const key of Object.keys(raw).sort()) {
    if (key === "integrity") continue;
    const value = raw[key];
    if (value === undefined || value === null) continue;
    fields[key] = value;
  }

  return fields;
}

/**
 * Convert a hex string from a Uint8Array.
 */
function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += (bytes[i] as number).toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Compute the SHA-256 integrity hash of an AgentTypeDefinition.
 * Uses the Web Crypto API (available in browsers, Node 15+, Workers, and React Native with polyfill).
 * 
 * @returns A string in the format "sha256-<hex>"
 */
export async function computeAgentTypeIntegrity(
  def: AgentTypeDefinition
): Promise<string> {
  const canonical = canonicalize(def);
  const json = JSON.stringify(canonical);
  const encoded = new TextEncoder().encode(json);

  // Use globalThis.crypto to work across Node, browsers, and Workers
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  const hex = toHex(new Uint8Array(hashBuffer));
  return `sha256-${hex}`;
}

/**
 * Verify that an AgentTypeDefinition's integrity hash matches its content.
 * Returns true if the hash matches, false if it doesn't, or null if no
 * integrity hash is set on the definition.
 */
export async function verifyAgentTypeIntegrity(
  def: AgentTypeDefinition
): Promise<boolean | null> {
  if (!def.integrity) return null;
  const computed = await computeAgentTypeIntegrity(def);
  return computed === def.integrity;
}

/**
 * Registry for managing agent type definitions.
 * 
 * Precedence (highest to lowest):
 * 1. Config-defined types (user overrides)
 * 2. Plugin-defined types
 * 3. Built-in types
 */
export class AgentTypeRegistry {
  private types: Map<string, AgentTypeDefinition> = new Map();
  /** Tracks name collisions at the same precedence level */
  private conflicts: Map<string, AgentTypeConflict> = new Map();

  /**
   * Register an agent type.
   * If an agent type with the same name already exists from a lower-precedence
   * source, it will be overridden. Same-precedence collisions are tracked as
   * conflicts (last writer wins, but a warning is recorded).
   */
  register(definition: AgentTypeDefinition): void {
    const existing = this.types.get(definition.name);
    
    // Config always wins, then plugin, then builtin
    if (existing) {
      const precedence = { config: 3, plugin: 2, builtin: 1 };
      const existingPrecedence = precedence[existing.source ?? "builtin"];
      const newPrecedence = precedence[definition.source ?? "builtin"];
      if (newPrecedence < existingPrecedence) {
        return; // Don't override higher-precedence definition
      }
      // Track same-precedence collision
      if (newPrecedence === existingPrecedence && existing.integrity !== definition.integrity) {
        this.conflicts.set(definition.name, {
          name: definition.name,
          kept: definition,
          replaced: existing,
        });
      }
    }

    this.types.set(definition.name, definition);
  }

  /**
   * Get all recorded name conflicts (same-precedence overwrites).
   */
  getConflicts(): AgentTypeConflict[] {
    return Array.from(this.conflicts.values());
  }

  /**
   * Set the enabled state of an existing agent type in-place,
   * without changing its source or triggering precedence checks.
   * Returns true if the type was found and updated.
   */
  setEnabled(name: string, enabled: boolean): boolean {
    const existing = this.types.get(name);
    if (!existing) return false;
    this.types.set(name, { ...existing, enabled });
    return true;
  }

  /**
   * Unregister an agent type by name
   */
  unregister(name: string): boolean {
    return this.types.delete(name);
  }

  /**
   * Get an agent type by name
   */
  get(name: string): AgentTypeDefinition | undefined {
    const def = this.types.get(name);
    if (def && def.enabled === false) return undefined;
    return def;
  }

  /**
   * Check if an agent type is registered and enabled
   */
  has(name: string): boolean {
    const def = this.types.get(name);
    return !!def && def.enabled !== false;
  }

  /**
   * Get all registered and enabled agent types
   */
  getAll(): AgentTypeDefinition[] {
    return Array.from(this.types.values()).filter(
      (def) => def.enabled !== false
    );
  }

  /**
   * Get all registered agent types including disabled ones
   */
  getAllIncludingDisabled(): AgentTypeDefinition[] {
    return Array.from(this.types.values());
  }

  /**
   * Get all registered agent type names (enabled only)
   */
  getNames(): string[] {
    return this.getAll().map((def) => def.name);
  }

  /**
   * Generate the description text for the task tool.
   * Lists all available agent types with their descriptions.
   */
  generateTaskToolDescription(): string {
    const types = this.getAll();
    if (types.length === 0) {
      return "";
    }

    const lines = types.map(
      (t) => `- ${t.name}: ${t.description}`
    );

    return [
      "",
      "Available agent types (use the subagent_type parameter):",
      ...lines,
      "",
      "When a matching agent type exists for your task, prefer using subagent_type over manually specifying allowedTools/deniedTools/model.",
    ].join("\n");
  }

  /**
   * Clear all registered agent types
   */
  clear(): void {
    this.types.clear();
    this.conflicts.clear();
  }
}

/**
 * Global agent type registry instance
 */
export const agentTypeRegistry = new AgentTypeRegistry();
