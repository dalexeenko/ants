/**
 * Platform-agnostic skill managers for Ants Agent.
 *
 * These managers work without filesystem access, making them suitable for:
 * - React Native
 * - Browser environments
 * - Any environment where skills are pre-bundled or loaded remotely
 *
 * For filesystem-based skill loading, use @ants/agent-skills-loader.
 */

import { parse as parseYaml } from "yaml";
import {
  SkillMetadataSchema,
  toSkillMetadata,
  SkillLoadError,
  SkillNotFoundError,
  type SkillMetadata,
  type LoadedSkill,
  type SkillReference,
  type SkillManagerInterface,
} from "./types.js";

/**
 * Regex to match YAML frontmatter in markdown files
 * Matches: ---\n<yaml content>\n---
 */
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Parse a SKILL.md content string into metadata and instructions.
 * This function is platform-agnostic and can be used in any environment.
 *
 * @param content - The full content of a SKILL.md file
 * @returns Parsed metadata and instruction content
 * @throws Error if frontmatter is missing or invalid
 */
export function parseSkillMd(content: string): { metadata: SkillMetadata; instructions: string } {
  const match = content.match(FRONTMATTER_REGEX);

  if (!match) {
    throw new Error("SKILL.md must contain YAML frontmatter (---\\n...\\n---)");
  }

  const [, yamlContent, markdownBody] = match;

  if (!yamlContent) {
    throw new Error("Missing YAML frontmatter content");
  }

  // Parse YAML frontmatter
  let rawMetadata: unknown;
  try {
    rawMetadata = parseYaml(yamlContent);
  } catch (err) {
    throw new Error(
      `Invalid YAML in frontmatter: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Validate against schema
  const parseResult = SkillMetadataSchema.safeParse(rawMetadata);
  if (!parseResult.success) {
    const errors = parseResult.error.errors
      .map((e: { path: (string | number)[]; message: string }) => `${e.path.join(".")}: ${e.message}`)
      .join("; ");
    throw new Error(`Invalid skill metadata: ${errors}`);
  }

  return {
    metadata: toSkillMetadata(parseResult.data),
    instructions: (markdownBody ?? "").trim(),
  };
}

/**
 * A bundled skill with pre-loaded content.
 * Use this to bundle skills at build time.
 */
export interface BundledSkill {
  /** Skill name (must match the name in SKILL.md frontmatter) */
  name: string;
  /** The full content of SKILL.md */
  content: string;
}

/**
 * Options for BundledSkillManager
 */
export interface BundledSkillManagerOptions {
  /** Custom warning function (defaults to console.warn) */
  warn?: (msg: string) => void;
}

/**
 * Skill manager for pre-bundled skills.
 *
 * This manager works with skills that are bundled at build time,
 * making it suitable for React Native where filesystem access is not available.
 *
 * @example
 * ```typescript
 * import { BundledSkillManager } from "@ants/agent-core";
 * import { defaultSkills } from "@ants/agent-skills-content";
 *
 * // Convert skills-content format to BundledSkill format
 * const bundledSkills = defaultSkills.map(s => ({ name: s.name, content: s.content }));
 *
 * const skillManager = new BundledSkillManager(bundledSkills);
 * await skillManager.discover();
 *
 * const skill = await skillManager.load("code-review");
 * console.log(skill.instructions);
 * ```
 */
export class BundledSkillManager implements SkillManagerInterface {
  private skills: Map<string, BundledSkill> = new Map();
  private discovered: Map<string, SkillReference> = new Map();
  private parsedCache: Map<string, { metadata: SkillMetadata; instructions: string }> = new Map();
  private warnFn: (msg: string) => void;

  constructor(
    bundledSkills: BundledSkill[] = [],
    options: BundledSkillManagerOptions = {}
  ) {
    this.warnFn = options.warn ?? console.warn;

    for (const skill of bundledSkills) {
      this.skills.set(skill.name, skill);
    }
  }

  /**
   * Add a bundled skill after construction.
   */
  addSkill(skill: BundledSkill): void {
    this.skills.set(skill.name, skill);
  }

  /**
   * Add multiple bundled skills after construction.
   */
  addSkills(skills: BundledSkill[]): void {
    for (const skill of skills) {
      this.addSkill(skill);
    }
  }

  /**
   * Discover all bundled skills.
   * This parses and validates all skill content.
   */
  async discover(): Promise<SkillReference[]> {
    this.discovered.clear();
    this.parsedCache.clear();

    for (const [name, skill] of this.skills) {
      try {
        const parsed = parseSkillMd(skill.content);

        // Verify name matches
        if (parsed.metadata.name !== name) {
          this.warnFn(
            `Skill name mismatch: expected "${name}" but got "${parsed.metadata.name}"`
          );
          continue;
        }

        this.parsedCache.set(name, parsed);
        this.discovered.set(name, {
          name: parsed.metadata.name,
          description: parsed.metadata.description,
          path: `bundled://${name}`,
          source: "bundled",
        });
      } catch (err) {
        this.warnFn(
          `Failed to parse bundled skill "${name}": ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    return this.getAvailable();
  }

  /**
   * Get all discovered skills.
   */
  getAvailable(): SkillReference[] {
    return Array.from(this.discovered.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  /**
   * Check if a skill is available.
   */
  hasSkill(name: string): boolean {
    return this.discovered.has(name);
  }

  /**
   * Get a skill reference by name.
   */
  getSkill(name: string): SkillReference | undefined {
    return this.discovered.get(name);
  }

  /**
   * Load a skill's full content.
   */
  async load(name: string): Promise<LoadedSkill> {
    const ref = this.discovered.get(name);
    if (!ref) {
      throw new SkillNotFoundError(name);
    }

    // Use cached parsed content
    const parsed = this.parsedCache.get(name);
    if (!parsed) {
      throw new SkillLoadError(`bundled://${name}`, "Skill was not properly discovered");
    }

    return {
      path: ref.path,
      metadata: parsed.metadata,
      instructions: parsed.instructions,
      source: "bundled",
    };
  }

  /**
   * Generate the skills section for the system prompt.
   */
  generateSystemPromptSection(): string {
    const skills = this.getAvailable();

    if (skills.length === 0) {
      return "";
    }

    const skillsList = skills
      .map((s) => `- **${s.name}**: ${s.description}`)
      .join("\n");

    return `
# Available Skills

Load a skill with the \`skill\` tool when the task matches its description.

${skillsList}
`.trim();
  }

  /**
   * Generate the dynamic skill tool description.
   */
  generateSkillToolDescription(): string {
    const skills = this.getAvailable();

    if (skills.length === 0) {
      return "Load a skill to get detailed instructions for a specific task. No skills are currently available.";
    }

    const skillNames = skills.map((s) => s.name).join(", ");
    return `Load a skill to get detailed instructions for a specific task. Available skills: ${skillNames}`;
  }

  /**
   * Not applicable for bundled skills, but required by interface.
   */
  addBundledPath(): void {
    // No-op for BundledSkillManager
  }

  /**
   * No override warnings for bundled-only manager.
   */
  getOverrideWarnings(): string[] {
    return [];
  }
}

/**
 * Configuration for remote skill server.
 */
export interface RemoteSkillConfig {
  /** Base URL of the skill server (e.g., "https://api.example.com/skills") */
  baseUrl: string;
  /** Optional auth token for authenticated requests */
  authToken?: string;
  /** Optional custom headers */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds (default: 10000) */
  timeout?: number;
}

/**
 * Response from remote skill discovery endpoint.
 */
export interface RemoteSkillListResponse {
  skills: Array<{
    name: string;
    description: string;
  }>;
}

/**
 * Response from remote skill load endpoint.
 */
export interface RemoteSkillResponse {
  name: string;
  description: string;
  content: string;
}

/**
 * Skill manager for loading skills from a remote server.
 *
 * This allows skills to be updated without app updates by loading
 * them from a remote API.
 *
 * Expected API:
 * - GET /skills - Returns list of available skills
 * - GET /skills/:name - Returns full skill content
 *
 * @example
 * ```typescript
 * const skillManager = new RemoteSkillManager({
 *   baseUrl: "https://api.myapp.com/skills",
 *   authToken: "bearer-token",
 * });
 *
 * await skillManager.discover();
 * const skill = await skillManager.load("code-review");
 * ```
 */
export class RemoteSkillManager implements SkillManagerInterface {
  private config: Required<Omit<RemoteSkillConfig, "authToken" | "headers">> & {
    authToken?: string;
    headers: Record<string, string>;
  };
  private discovered: Map<string, SkillReference> = new Map();
  private warnFn: (msg: string) => void;

  constructor(
    config: RemoteSkillConfig,
    options: { warn?: (msg: string) => void } = {}
  ) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ""), // Remove trailing slash
      authToken: config.authToken,
      headers: config.headers ?? {},
      timeout: config.timeout ?? 10000,
    };
    this.warnFn = options.warn ?? console.warn;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.config.headers,
    };

    if (this.config.authToken) {
      headers["Authorization"] = `Bearer ${this.config.authToken}`;
    }

    return headers;
  }

  /**
   * Discover available skills from the remote server.
   */
  async discover(): Promise<SkillReference[]> {
    this.discovered.clear();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(`${this.config.baseUrl}`, {
        method: "GET",
        headers: this.getHeaders(),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: RemoteSkillListResponse = await response.json();

      for (const skill of data.skills) {
        this.discovered.set(skill.name, {
          name: skill.name,
          description: skill.description,
          path: `remote://${skill.name}`,
          source: "bundled", // Treat remote as bundled for priority purposes
        });
      }
    } catch (err) {
      this.warnFn(
        `Failed to discover remote skills: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    return this.getAvailable();
  }

  /**
   * Get all discovered skills.
   */
  getAvailable(): SkillReference[] {
    return Array.from(this.discovered.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  /**
   * Check if a skill is available.
   */
  hasSkill(name: string): boolean {
    return this.discovered.has(name);
  }

  /**
   * Get a skill reference by name.
   */
  getSkill(name: string): SkillReference | undefined {
    return this.discovered.get(name);
  }

  /**
   * Load a skill from the remote server.
   */
  async load(name: string): Promise<LoadedSkill> {
    const ref = this.discovered.get(name);
    if (!ref) {
      throw new SkillNotFoundError(name);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(`${this.config.baseUrl}/${encodeURIComponent(name)}`, {
        method: "GET",
        headers: this.getHeaders(),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: RemoteSkillResponse = await response.json();

      // Parse the skill content
      const parsed = parseSkillMd(data.content);

      return {
        path: `remote://${name}`,
        metadata: parsed.metadata,
        instructions: parsed.instructions,
        source: "bundled",
      };
    } catch (err) {
      throw new SkillLoadError(
        `remote://${name}`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  /**
   * Generate the skills section for the system prompt.
   */
  generateSystemPromptSection(): string {
    const skills = this.getAvailable();

    if (skills.length === 0) {
      return "";
    }

    const skillsList = skills
      .map((s) => `- **${s.name}**: ${s.description}`)
      .join("\n");

    return `
# Available Skills

Load a skill with the \`skill\` tool when the task matches its description.

${skillsList}
`.trim();
  }

  /**
   * Generate the dynamic skill tool description.
   */
  generateSkillToolDescription(): string {
    const skills = this.getAvailable();

    if (skills.length === 0) {
      return "Load a skill to get detailed instructions for a specific task. No skills are currently available.";
    }

    const skillNames = skills.map((s) => s.name).join(", ");
    return `Load a skill to get detailed instructions for a specific task. Available skills: ${skillNames}`;
  }

  addBundledPath(): void {
    // No-op
  }

  getOverrideWarnings(): string[] {
    return [];
  }
}

/**
 * Options for HybridSkillManager.
 */
export interface HybridSkillManagerOptions {
  /** Bundled skills (loaded at build time) */
  bundledSkills?: BundledSkill[];
  /** Remote skill server configuration */
  remote?: RemoteSkillConfig;
  /** Custom warning function */
  warn?: (msg: string) => void;
}

/**
 * Skill manager that combines bundled and remote skills.
 *
 * Remote skills take priority over bundled skills with the same name,
 * allowing for updates without app releases.
 *
 * @example
 * ```typescript
 * import { HybridSkillManager } from "@ants/agent-core";
 * import { defaultSkills } from "@ants/agent-skills-content";
 *
 * const skillManager = new HybridSkillManager({
 *   bundledSkills: defaultSkills.map(s => ({ name: s.name, content: s.content })),
 *   remote: {
 *     baseUrl: "https://api.myapp.com/skills",
 *   },
 * });
 *
 * await skillManager.discover();
 * ```
 */
export class HybridSkillManager implements SkillManagerInterface {
  private bundled: BundledSkillManager;
  private remote?: RemoteSkillManager;
  private combined: Map<string, SkillReference> = new Map();
  private overrideWarnings: string[] = [];
  private warnFn: (msg: string) => void;

  constructor(options: HybridSkillManagerOptions = {}) {
    this.warnFn = options.warn ?? console.warn;
    this.bundled = new BundledSkillManager(options.bundledSkills ?? [], {
      warn: this.warnFn,
    });

    if (options.remote) {
      this.remote = new RemoteSkillManager(options.remote, { warn: this.warnFn });
    }
  }

  /**
   * Add bundled skills after construction.
   */
  addSkills(skills: BundledSkill[]): void {
    this.bundled.addSkills(skills);
  }

  /**
   * Discover skills from both bundled and remote sources.
   * Remote skills override bundled skills with the same name.
   */
  async discover(): Promise<SkillReference[]> {
    this.combined.clear();
    this.overrideWarnings = [];

    // Discover bundled skills first
    await this.bundled.discover();
    for (const skill of this.bundled.getAvailable()) {
      this.combined.set(skill.name, skill);
    }

    // Discover remote skills (override bundled)
    if (this.remote) {
      try {
        await this.remote.discover();
        for (const skill of this.remote.getAvailable()) {
          const existing = this.combined.get(skill.name);
          if (existing) {
            this.overrideWarnings.push(
              `Remote skill "${skill.name}" overrides bundled skill`
            );
          }
          this.combined.set(skill.name, skill);
        }
      } catch (err) {
        this.warnFn(
          `Failed to discover remote skills, using bundled only: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    return this.getAvailable();
  }

  /**
   * Get all discovered skills.
   */
  getAvailable(): SkillReference[] {
    return Array.from(this.combined.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  /**
   * Check if a skill is available.
   */
  hasSkill(name: string): boolean {
    return this.combined.has(name);
  }

  /**
   * Get a skill reference by name.
   */
  getSkill(name: string): SkillReference | undefined {
    return this.combined.get(name);
  }

  /**
   * Load a skill, preferring remote over bundled.
   */
  async load(name: string): Promise<LoadedSkill> {
    const ref = this.combined.get(name);
    if (!ref) {
      throw new SkillNotFoundError(name);
    }

    // If it's a remote skill, load from remote
    if (ref.path.startsWith("remote://") && this.remote) {
      return this.remote.load(name);
    }

    // Otherwise load from bundled
    return this.bundled.load(name);
  }

  /**
   * Generate the skills section for the system prompt.
   */
  generateSystemPromptSection(): string {
    const skills = this.getAvailable();

    if (skills.length === 0) {
      return "";
    }

    const skillsList = skills
      .map((s) => `- **${s.name}**: ${s.description}`)
      .join("\n");

    return `
# Available Skills

Load a skill with the \`skill\` tool when the task matches its description.

${skillsList}
`.trim();
  }

  /**
   * Generate the dynamic skill tool description.
   */
  generateSkillToolDescription(): string {
    const skills = this.getAvailable();

    if (skills.length === 0) {
      return "Load a skill to get detailed instructions for a specific task. No skills are currently available.";
    }

    const skillNames = skills.map((s) => s.name).join(", ");
    return `Load a skill to get detailed instructions for a specific task. Available skills: ${skillNames}`;
  }

  addBundledPath(): void {
    // No-op for hybrid manager
  }

  getOverrideWarnings(): string[] {
    return [...this.overrideWarnings];
  }
}
