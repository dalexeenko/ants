/**
 * Tool Permission System
 * 
 * Manages tool execution permissions with support for:
 * - Allow once (single execution)
 * - Allow always (for the session)
 * - Deny (skip execution)
 * - Configuration-based rules (allow/deny by tool name or pattern)
 */

import type { ToolCall } from "./types.js";

/**
 * Permission decision for a tool
 */
export type PermissionDecision = "allow" | "deny" | "ask";

/**
 * User's response to a permission request
 */
export type PermissionResponse = "allow_once" | "allow_always" | "deny";

/**
 * Configuration for tool permissions
 */
export interface ToolPermissionConfig {
  /** 
   * Default permission mode for tools not explicitly configured
   * - "allow": Execute without asking (dangerous)
   * - "deny": Never execute
   * - "ask": Ask user for each tool call (default)
   */
  defaultMode?: "allow" | "deny" | "ask";

  /**
   * Tools that are always allowed (glob patterns supported)
   * Examples: ["read", "glob", "grep", "mcp_*"]
   */
  alwaysAllow?: string[];

  /**
   * Tools that are always denied (glob patterns supported)
   * Examples: ["bash", "write", "edit"]
   */
  alwaysDeny?: string[];

  /**
   * Allow all tools without confirmation (use with caution!)
   * This overrides all other settings
   */
  allowAll?: boolean;
}

/**
 * Callback for requesting permission from the user
 */
export type PermissionRequestCallback = (
  toolCall: ToolCall
) => Promise<PermissionResponse>;

/**
 * Manages tool execution permissions
 */
export class ToolPermissionManager {
  private config: ToolPermissionConfig;
  private sessionAllowed: Set<string> = new Set();
  private sessionDenied: Set<string> = new Set();
  private requestCallback: PermissionRequestCallback | null = null;

  constructor(config: ToolPermissionConfig = {}) {
    this.config = {
      defaultMode: "ask",
      alwaysAllow: [],
      alwaysDeny: [],
      allowAll: false,
      ...config,
    };
  }

  /**
   * Set the callback for requesting user permission
   */
  setRequestCallback(callback: PermissionRequestCallback | null): void {
    this.requestCallback = callback;
  }

  /**
   * Get the callback for requesting user permission
   */
  getRequestCallback(): PermissionRequestCallback | null {
    return this.requestCallback;
  }

  /**
   * Update the permission configuration
   */
  updateConfig(config: Partial<ToolPermissionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get the current configuration
   */
  getConfig(): ToolPermissionConfig {
    return { ...this.config };
  }

  /**
   * Check if a tool name matches a pattern (supports * glob)
   */
  private matchesPattern(toolName: string, pattern: string): boolean {
    if (pattern === "*") return true;
    if (pattern.endsWith("*")) {
      return toolName.startsWith(pattern.slice(0, -1));
    }
    if (pattern.startsWith("*")) {
      return toolName.endsWith(pattern.slice(1));
    }
    return toolName === pattern;
  }

  /**
   * Check if a tool matches any pattern in a list
   */
  private matchesAnyPattern(toolName: string, patterns: string[]): boolean {
    return patterns.some((pattern) => this.matchesPattern(toolName, pattern));
  }

  /**
   * Determine the permission decision for a tool without prompting
   */
  getPermissionDecision(toolName: string): PermissionDecision {
    // If allowAll is set, always allow
    if (this.config.allowAll) {
      return "allow";
    }

    // Check session-level denials first (user explicitly denied)
    if (this.sessionDenied.has(toolName)) {
      return "deny";
    }

    // Check session-level allowances (user said "allow always")
    if (this.sessionAllowed.has(toolName)) {
      return "allow";
    }

    // Check configured deny patterns (takes precedence over allow)
    if (this.config.alwaysDeny && this.matchesAnyPattern(toolName, this.config.alwaysDeny)) {
      return "deny";
    }

    // Check configured allow patterns
    if (this.config.alwaysAllow && this.matchesAnyPattern(toolName, this.config.alwaysAllow)) {
      return "allow";
    }

    // Fall back to default mode
    return this.config.defaultMode ?? "ask";
  }

  /**
   * Check permission for a tool, prompting user if necessary
   * Returns true if the tool should be executed, false otherwise
   */
  async checkPermission(toolCall: ToolCall): Promise<boolean> {
    const decision = this.getPermissionDecision(toolCall.name);

    if (decision === "allow") {
      return true;
    }

    if (decision === "deny") {
      return false;
    }

    // Need to ask user
    if (!this.requestCallback) {
      // No callback set, fall back to deny for safety
      console.warn(`Tool permission request for "${toolCall.name}" but no callback set. Denying.`);
      return false;
    }

    const response = await this.requestCallback(toolCall);

    switch (response) {
      case "allow_once":
        return true;
      case "allow_always":
        this.sessionAllowed.add(toolCall.name);
        return true;
      case "deny":
        // Don't add to sessionDenied - user might want to allow next time
        return false;
      default:
        return false;
    }
  }

  /**
   * Manually allow a tool for the session
   */
  allowForSession(toolName: string): void {
    this.sessionAllowed.add(toolName);
    this.sessionDenied.delete(toolName);
  }

  /**
   * Manually deny a tool for the session
   */
  denyForSession(toolName: string): void {
    this.sessionDenied.add(toolName);
    this.sessionAllowed.delete(toolName);
  }

  /**
   * Check if a tool is allowed for the session
   */
  isAllowedForSession(toolName: string): boolean {
    return this.sessionAllowed.has(toolName);
  }

  /**
   * Check if a tool is denied for the session
   */
  isDeniedForSession(toolName: string): boolean {
    return this.sessionDenied.has(toolName);
  }

  /**
   * Clear all session-level permissions
   */
  clearSessionPermissions(): void {
    this.sessionAllowed.clear();
    this.sessionDenied.clear();
  }

  /**
   * Get list of tools allowed for the session
   */
  getSessionAllowed(): string[] {
    return Array.from(this.sessionAllowed);
  }

  /**
   * Get list of tools denied for the session
   */
  getSessionDenied(): string[] {
    return Array.from(this.sessionDenied);
  }
}

/**
 * Default safe tools that are auto-approved without user confirmation.
 * Includes read-only tools and tools that only mutate ephemeral
 * in-memory session state (todos, phases) or perform read-only
 * network requests.
 */
export const SAFE_READ_TOOLS = [
  // Filesystem read-only
  "read",
  "glob",
  "grep",
  // Session state (in-memory only, no filesystem side effects)
  "todoread",
  "todowrite",
  "phaseread",
  "phasewrite",
  // Informational
  "skill",
  "question",
  "task_status",
  // Network read-only
  "web_fetch",
  "web_search",
];

/**
 * Default tools that modify the filesystem
 */
export const WRITE_TOOLS = [
  "write",
  "edit",
  "bash",
];

/**
 * Create a permission config that allows read-only tools
 */
export function createReadOnlyConfig(): ToolPermissionConfig {
  return {
    defaultMode: "ask",
    alwaysAllow: SAFE_READ_TOOLS,
    alwaysDeny: [],
  };
}

/**
 * Create a permission config that requires confirmation for everything
 */
export function createStrictConfig(): ToolPermissionConfig {
  return {
    defaultMode: "ask",
    alwaysAllow: [],
    alwaysDeny: [],
  };
}

/**
 * Create a permission config that allows everything (dangerous!)
 */
export function createPermissiveConfig(): ToolPermissionConfig {
  return {
    allowAll: true,
  };
}
