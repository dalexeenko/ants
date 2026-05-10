/**
 * @openmgr/agent-skills-loader
 *
 * Filesystem-based skill loading for OpenMgr Agent.
 * Provides functions to discover and load skills from:
 * - Local project: .openmgr/skills/
 * - Global user: ~/.config/openmgr/skills/
 * - Bundled: shipped with this package
 */

import { readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { dirname, join, basename, resolve } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import type {
  SkillMetadata,
  LoadedSkill,
  SkillSource,
  SkillReference,
  AgentPlugin,
  PluginSkillSource,
} from "@openmgr/agent-core";
import {
  SkillLoadError,
  SkillNotFoundError,
  parseSkillMd,
} from "@openmgr/agent-core";

// Re-export types and functions for convenience
export type { SkillMetadata, LoadedSkill, SkillSource, SkillReference };
export { SkillLoadError, SkillNotFoundError, parseSkillMd };

// ============================================================================
// Bundled Skills
// ============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Path to bundled skills (one directory up from dist/index.js to skills/) */
const BUNDLED_SKILLS_DIR = join(__dirname, "..", "skills");

/**
 * Information about a bundled skill.
 */
export interface BundledSkillInfo {
  name: string;
  description: string;
  path: string;
}

/**
 * All bundled skills with their metadata.
 */
export const bundledSkills: BundledSkillInfo[] = [
  {
    name: "code-review",
    description: "Review code for bugs, style issues, performance problems, and suggest improvements",
    path: join(BUNDLED_SKILLS_DIR, "code-review", "SKILL.md"),
  },
  {
    name: "debug",
    description: "Systematic debugging approach for identifying and fixing issues",
    path: join(BUNDLED_SKILLS_DIR, "debug", "SKILL.md"),
  },
  {
    name: "documentation",
    description: "Write clear and comprehensive documentation for code and APIs",
    path: join(BUNDLED_SKILLS_DIR, "documentation", "SKILL.md"),
  },
  {
    name: "git-commit",
    description: "Create well-formatted commit messages following conventional commit standards",
    path: join(BUNDLED_SKILLS_DIR, "git-commit", "SKILL.md"),
  },
  {
    name: "pr-review",
    description: "Review pull requests thoroughly and provide constructive feedback",
    path: join(BUNDLED_SKILLS_DIR, "pr-review", "SKILL.md"),
  },
  {
    name: "refactor",
    description: "Refactor code to improve structure, readability, and maintainability",
    path: join(BUNDLED_SKILLS_DIR, "refactor", "SKILL.md"),
  },
  {
    name: "security-review",
    description: "Review code for security vulnerabilities and suggest fixes",
    path: join(BUNDLED_SKILLS_DIR, "security-review", "SKILL.md"),
  },
  {
    name: "test-writing",
    description: "Write comprehensive tests for code including unit, integration, and e2e tests",
    path: join(BUNDLED_SKILLS_DIR, "test-writing", "SKILL.md"),
  },
];

/**
 * Get the path to a bundled skill by name.
 */
export function getBundledSkillPath(name: string): string | null {
  const skill = bundledSkills.find((s) => s.name === name);
  return skill?.path ?? null;
}

/**
 * Get all bundled skill names.
 */
export function getBundledSkillNames(): string[] {
  return bundledSkills.map((s) => s.name);
}

/**
 * Get the directory containing all bundled skills.
 */
export function getBundledSkillsDir(): string {
  return BUNDLED_SKILLS_DIR;
}

/**
 * Convert bundled skills to PluginSkillSource format for plugin registration.
 */
function toPluginSkillSources(): PluginSkillSource[] {
  return bundledSkills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    path: skill.path,
  }));
}

/**
 * Create a plugin that registers all bundled skills.
 *
 * @example
 * ```ts
 * import { Agent } from "@openmgr/agent-core";
 * import { skillsBundledPlugin } from "@openmgr/agent-skills-loader";
 *
 * const agent = new Agent({ ... });
 * await agent.use(skillsBundledPlugin());
 * ```
 */
export function skillsBundledPlugin(): AgentPlugin {
  return {
    name: "skills-bundled",
    version: "0.1.0",
    skills: toPluginSkillSources(),
  };
}

// ============================================================================
// Filesystem Skill Loading
// ============================================================================

const SKILL_FILENAME = "SKILL.md";

/**
 * Check if a directory contains a valid skill (has SKILL.md)
 */
export function isSkillDirectory(dirPath: string): boolean {
  return existsSync(join(dirPath, SKILL_FILENAME));
}

/**
 * Load a skill from a directory
 */
export async function loadSkillFromDirectory(
  dirPath: string,
  source: SkillSource
): Promise<LoadedSkill> {
  const skillFilePath = join(dirPath, SKILL_FILENAME);

  if (!existsSync(skillFilePath)) {
    throw new SkillLoadError(dirPath, `${SKILL_FILENAME} not found`);
  }

  let content: string;
  try {
    content = await readFile(skillFilePath, "utf-8");
  } catch (err) {
    throw new SkillLoadError(
      dirPath,
      `Failed to read ${SKILL_FILENAME}`,
      err instanceof Error ? err : undefined
    );
  }

  let parsed: { metadata: SkillMetadata; instructions: string };
  try {
    parsed = parseSkillMd(content);
  } catch (err) {
    throw new SkillLoadError(
      dirPath,
      err instanceof Error ? err.message : String(err),
      err instanceof Error ? err : undefined
    );
  }

  // Validate that skill name matches directory name
  const dirName = basename(dirPath);
  if (parsed.metadata.name !== dirName) {
    throw new SkillLoadError(
      dirPath,
      `Skill name "${parsed.metadata.name}" does not match directory name "${dirName}"`
    );
  }

  return {
    path: dirPath,
    metadata: parsed.metadata,
    instructions: parsed.instructions,
    source,
  };
}

/**
 * Load just the metadata from a skill directory (for discovery)
 */
export async function loadSkillMetadata(
  dirPath: string,
  source: SkillSource
): Promise<{ metadata: SkillMetadata; path: string; source: SkillSource }> {
  const skill = await loadSkillFromDirectory(dirPath, source);
  return {
    metadata: skill.metadata,
    path: skill.path,
    source: skill.source,
  };
}

/**
 * Skill discovery paths in priority order
 */
export interface SkillPaths {
  /** Project-local: .openmgr/skills/ in working directory */
  local: string;
  /** Global user: ~/.config/openmgr/skills/ */
  global: string;
  /** Bundled: shipped with the package */
  bundled: string;
  /** Additional bundled paths from plugins */
  additionalBundled: string[];
}

/**
 * Options for SkillManager
 */
export interface SkillManagerOptions {
  /** Additional paths to discover bundled skills from (e.g., from plugins) */
  additionalBundledPaths?: string[];
  /** Custom bundled path (defaults to __dirname/bundled) */
  bundledPath?: string;
}

/**
 * Get skill discovery paths for a given working directory
 */
export function getSkillPaths(
  workingDirectory: string,
  options: { additionalBundledPaths?: string[]; bundledPath?: string } = {}
): SkillPaths {
  // Default bundled path - this may not exist if called outside the core package
  const defaultBundledPath = options.bundledPath ?? join(workingDirectory, ".openmgr", "bundled-skills");
  
  return {
    local: join(workingDirectory, ".openmgr", "skills"),
    global: join(homedir(), ".config", "openmgr", "skills"),
    bundled: defaultBundledPath,
    additionalBundled: options.additionalBundledPaths ?? [],
  };
}

/**
 * Manages skill discovery and loading from the filesystem
 */
export class FilesystemSkillManager {
  private workingDirectory: string;
  private paths: SkillPaths;
  private discovered: Map<string, SkillReference> = new Map();
  private overrideWarnings: string[] = [];
  private warnFn: (msg: string) => void;

  constructor(
    workingDirectory: string,
    options: SkillManagerOptions & { warn?: (msg: string) => void } = {}
  ) {
    this.workingDirectory = resolve(workingDirectory);
    this.paths = getSkillPaths(this.workingDirectory, options);
    this.warnFn = options.warn ?? console.warn;
  }

  /**
   * Add additional bundled skill paths (e.g., from plugins)
   */
  addBundledPath(path: string): void {
    if (!this.paths.additionalBundled.includes(path)) {
      this.paths.additionalBundled.push(path);
    }
  }

  /**
   * Get the skill discovery paths
   */
  getPaths(): SkillPaths {
    return this.paths;
  }

  /**
   * Get any warnings about skill overrides
   */
  getOverrideWarnings(): string[] {
    return [...this.overrideWarnings];
  }

  /**
   * Discover all available skills from all paths
   * Skills in higher-priority paths override those in lower-priority paths
   */
  async discover(): Promise<SkillReference[]> {
    this.discovered.clear();
    this.overrideWarnings = [];

    // Discover in reverse priority order (bundled first, then global, then local)
    // so that higher priority paths override lower ones
    const bundledSource: SkillSource = "bundled";
    const globalSource: SkillSource = "global";
    const localSource: SkillSource = "local";
    
    const sources: Array<{ path: string; source: SkillSource }> = [
      // Additional bundled paths from plugins (lowest priority among bundled)
      ...this.paths.additionalBundled.map((path) => ({ path, source: bundledSource })),
      // Core bundled path
      { path: this.paths.bundled, source: bundledSource },
      // User paths (higher priority)
      { path: this.paths.global, source: globalSource },
      { path: this.paths.local, source: localSource },
    ];

    for (const { path, source } of sources) {
      await this.discoverFromPath(path, source);
    }

    return this.getAvailable();
  }

  /**
   * Discover skills from a specific path
   */
  private async discoverFromPath(basePath: string, source: SkillSource): Promise<void> {
    if (!existsSync(basePath)) {
      return;
    }

    let entries: string[];
    try {
      entries = await readdir(basePath);
    } catch {
      return;
    }

    for (const entry of entries) {
      const skillPath = join(basePath, entry);

      if (!isSkillDirectory(skillPath)) {
        continue;
      }

      try {
        const skill = await loadSkillFromDirectory(skillPath, source);
        const existing = this.discovered.get(skill.metadata.name);

        if (existing) {
          // Higher priority source overrides lower priority
          this.overrideWarnings.push(
            `Skill "${skill.metadata.name}" from ${source} (${skillPath}) overrides ${existing.source} (${existing.path})`
          );
        }

        this.discovered.set(skill.metadata.name, {
          name: skill.metadata.name,
          description: skill.metadata.description,
          path: skill.path,
          source: skill.source,
        });
      } catch (err) {
        // Log error but continue discovering other skills
        this.warnFn(
          `Warning: Failed to load skill from ${skillPath}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  /**
   * Get all discovered skills
   */
  getAvailable(): SkillReference[] {
    return Array.from(this.discovered.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Check if a skill is available
   */
  hasSkill(name: string): boolean {
    return this.discovered.has(name);
  }

  /**
   * Load a skill by name
   */
  async load(name: string): Promise<LoadedSkill> {
    const ref = this.discovered.get(name);

    if (!ref) {
      throw new SkillNotFoundError(name);
    }

    return loadSkillFromDirectory(ref.path, ref.source);
  }

  /**
   * Get a skill reference by name
   */
  getSkill(name: string): SkillReference | undefined {
    return this.discovered.get(name);
  }

  /**
   * Generate the skills section for the system prompt
   */
  generateSystemPromptSection(): string {
    const skills = this.getAvailable();

    if (skills.length === 0) {
      return "";
    }

    const skillsList = skills.map((s) => `- **${s.name}**: ${s.description}`).join("\n");

    return `
# Available Skills

Load a skill with the \`skill\` tool when the task matches its description.

${skillsList}
`.trim();
  }

  /**
   * Generate the dynamic skill tool description
   */
  generateSkillToolDescription(): string {
    const skills = this.getAvailable();

    if (skills.length === 0) {
      return "Load a skill to get detailed instructions for a specific task. No skills are currently available.";
    }

    const skillNames = skills.map((s) => s.name).join(", ");
    return `Load a skill to get detailed instructions for a specific task. Available skills: ${skillNames}`;
  }
}

// Export alias for backwards compatibility
export { FilesystemSkillManager as SkillManager };
