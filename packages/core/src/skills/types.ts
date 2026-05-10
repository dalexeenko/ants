import { z } from "zod";

/**
 * Skill source - where the skill was discovered from
 * Priority order: local > global > bundled
 */
export type SkillSource = "local" | "global" | "bundled";

/**
 * Skill metadata from SKILL.md frontmatter
 * Per Agent Skills specification: https://agentskills.io/specification
 */
export interface SkillMetadata {
  /** 
   * Required. Max 64 characters. Lowercase letters, numbers, and hyphens only.
   * Must not start or end with a hyphen. Must match parent directory name.
   */
  name: string;

  /**
   * Required. Max 1024 characters. Describes what the skill does and when to use it.
   */
  description: string;

  /** Optional. License name or reference to a bundled license file. */
  license?: string;

  /** 
   * Optional. Max 500 characters. Indicates environment requirements
   * (intended product, system packages, network access, etc.)
   */
  compatibility?: string;

  /** Optional. Arbitrary key-value mapping for additional metadata. */
  metadata?: Record<string, string>;

  /** 
   * Optional. Space-delimited list of pre-approved tools the skill may use.
   * Experimental per the spec.
   */
  allowedTools?: string[];
}

/**
 * A fully loaded skill with content
 */
export interface LoadedSkill {
  /** Absolute path to the skill directory */
  path: string;

  /** Parsed metadata from frontmatter */
  metadata: SkillMetadata;

  /** Markdown body content (instructions) */
  instructions: string;

  /** Where this skill was loaded from */
  source: SkillSource;
}

/**
 * A reference to an available skill (metadata only, for listing)
 */
export interface SkillReference {
  /** Skill name identifier */
  name: string;

  /** Skill description */
  description: string;

  /** Absolute path to the skill directory */
  path: string;

  /** Where this skill was discovered from */
  source: SkillSource;
}

/**
 * Validation schema for skill name
 * - 1-64 characters
 * - Lowercase alphanumeric and hyphens only
 * - Cannot start/end with hyphen
 * - No consecutive hyphens
 */
export const SkillNameSchema = z
  .string()
  .min(1, "Skill name must be at least 1 character")
  .max(64, "Skill name must be at most 64 characters")
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
    "Skill name must be lowercase alphanumeric with hyphens, cannot start/end with hyphen"
  )
  .refine(
    (name) => !name.includes("--"),
    "Skill name cannot contain consecutive hyphens"
  );

/**
 * Validation schema for skill description
 */
export const SkillDescriptionSchema = z
  .string()
  .min(1, "Skill description must not be empty")
  .max(1024, "Skill description must be at most 1024 characters");

/**
 * Validation schema for compatibility field
 */
export const SkillCompatibilitySchema = z
  .string()
  .max(500, "Compatibility must be at most 500 characters")
  .optional();

/**
 * Validation schema for skill metadata (frontmatter)
 */
export const SkillMetadataSchema = z.object({
  name: SkillNameSchema,
  description: SkillDescriptionSchema,
  license: z.string().optional(),
  compatibility: SkillCompatibilitySchema,
  metadata: z.record(z.string()).optional(),
  "allowed-tools": z.string().optional(), // Space-delimited in YAML
});

/**
 * Parse allowed-tools string into array
 */
export function parseAllowedTools(allowedToolsStr?: string): string[] | undefined {
  if (!allowedToolsStr) return undefined;
  return allowedToolsStr.split(/\s+/).filter(Boolean);
}

/**
 * Convert raw frontmatter to SkillMetadata
 */
export function toSkillMetadata(raw: z.infer<typeof SkillMetadataSchema>): SkillMetadata {
  return {
    name: raw.name,
    description: raw.description,
    license: raw.license,
    compatibility: raw.compatibility,
    metadata: raw.metadata,
    allowedTools: parseAllowedTools(raw["allowed-tools"]),
  };
}

/**
 * Error thrown when a skill fails to load
 */
export class SkillLoadError extends Error {
  constructor(
    public readonly skillPath: string,
    message: string,
    public override readonly cause?: Error
  ) {
    super(`Failed to load skill at ${skillPath}: ${message}`);
    this.name = "SkillLoadError";
  }
}

/**
 * Error thrown when a skill is not found
 */
export class SkillNotFoundError extends Error {
  constructor(public readonly skillName: string) {
    super(`Skill not found: ${skillName}`);
    this.name = "SkillNotFoundError";
  }
}

/**
 * Interface for skill managers.
 * 
 * Implementations can load skills from different sources:
 * - Filesystem (Node.js)
 * - Bundled assets (React Native)
 * - Network (remote skills)
 */
export interface SkillManagerInterface {
  /**
   * Discover available skills
   */
  discover(): Promise<SkillReference[]>;

  /**
   * Get list of discovered skills
   */
  getAvailable(): SkillReference[];

  /**
   * Check if a skill exists
   */
  hasSkill(name: string): boolean;

  /**
   * Get skill reference by name
   */
  getSkill(name: string): SkillReference | undefined;

  /**
   * Load a skill's full content
   */
  load(name: string): Promise<LoadedSkill>;

  /**
   * Generate system prompt section listing available skills
   */
  generateSystemPromptSection(): string;

  /**
   * Generate tool description for the skill loader tool
   */
  generateSkillToolDescription(): string;

  /**
   * Add a path to discover bundled skills from (for plugins)
   */
  addBundledPath?(path: string): void;

  /**
   * Get any warnings about skill overrides
   */
  getOverrideWarnings?(): string[];
}
