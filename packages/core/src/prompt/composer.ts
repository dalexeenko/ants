/**
 * SystemPromptComposer - Composable system prompt management.
 * 
 * Instead of a monolithic system prompt string, the composer allows
 * plugins, skills, and configuration to each contribute sections.
 * Sections are ordered by priority and assembled into a final prompt.
 * 
 * Benefits:
 * - Plugins can add/remove prompt sections without modifying a single string
 * - Subagents can receive modified/reduced system prompts
 * - Sections can be conditionally included based on available tools/capabilities
 * - Avoids wasting tokens describing tools the agent can't use
 */

export interface PromptSection {
  /** Unique identifier for this section */
  id: string;

  /** Display name for the section (for debugging) */
  name: string;

  /** Which plugin or source provided this section */
  source: string;

  /** The content of this section (will be joined with newlines) */
  content: string;

  /**
   * Priority for ordering (lower = earlier in prompt).
   * Standard ranges:
   * - 0-99:    Core identity and behavior
   * - 100-199: Environment and capabilities
   * - 200-299: Tool-specific instructions
   * - 300-399: Skills and workflows
   * - 400-499: Project-specific context
   * - 500+:    User customizations
   */
  priority: number;

  /**
   * Required capabilities for this section to be included.
   * If any listed capability is missing, the section is omitted.
   */
  requiredCapabilities?: string[];

  /**
   * If true, this section can be omitted when compacting context.
   */
  compactable?: boolean;
}

export class SystemPromptComposer {
  private sections: Map<string, PromptSection> = new Map();

  /**
   * Add or replace a prompt section.
   */
  set(section: PromptSection): void {
    this.sections.set(section.id, section);
  }

  /**
   * Remove a prompt section by ID.
   */
  remove(id: string): boolean {
    return this.sections.delete(id);
  }

  /**
   * Get a prompt section by ID.
   */
  get(id: string): PromptSection | undefined {
    return this.sections.get(id);
  }

  /**
   * Check if a section exists.
   */
  has(id: string): boolean {
    return this.sections.has(id);
  }

  /**
   * Get all sections, sorted by priority.
   */
  getSections(): PromptSection[] {
    return Array.from(this.sections.values()).sort((a, b) => a.priority - b.priority);
  }

  /**
   * Compose the final system prompt from all sections.
   * 
   * @param availableCapabilities - Set of available capabilities for filtering
   * @param options - Composition options
   */
  compose(
    availableCapabilities?: Set<string>,
    options?: ComposeOptions
  ): string {
    let sections = this.getSections();

    // Filter by capabilities
    if (availableCapabilities) {
      sections = sections.filter((section) => {
        if (!section.requiredCapabilities?.length) return true;
        return section.requiredCapabilities.every((cap) =>
          availableCapabilities.has(cap)
        );
      });
    }

    // Filter compactable sections if in compact mode
    if (options?.compact) {
      sections = sections.filter((section) => !section.compactable);
    }

    // Filter by allowed section IDs
    if (options?.includeSections) {
      const allowed = new Set(options.includeSections);
      sections = sections.filter((section) => allowed.has(section.id));
    }

    // Filter by excluded section IDs
    if (options?.excludeSections) {
      const excluded = new Set(options.excludeSections);
      sections = sections.filter((section) => !excluded.has(section.id));
    }

    // Join sections
    return sections.map((s) => s.content).join("\n\n");
  }

  /**
   * Get the number of sections.
   */
  get size(): number {
    return this.sections.size;
  }

  /**
   * Clear all sections.
   */
  clear(): void {
    this.sections.clear();
  }

  /**
   * Create a copy of this composer (for subagent customization).
   */
  clone(): SystemPromptComposer {
    const copy = new SystemPromptComposer();
    for (const [id, section] of this.sections) {
      copy.sections.set(id, { ...section });
    }
    return copy;
  }
}

export interface ComposeOptions {
  /** If true, omit sections marked as compactable */
  compact?: boolean;
  /** Only include these section IDs */
  includeSections?: string[];
  /** Exclude these section IDs */
  excludeSections?: string[];
}

// ============================================================================
// Standard Section IDs
// ============================================================================

/**
 * Well-known section IDs for standard prompt sections.
 */
export const PromptSections = {
  /** Core agent identity and behavior rules */
  CoreIdentity: "core.identity",
  /** Tone and style guidelines */
  ToneAndStyle: "core.tone",
  /** Task management instructions */
  TaskManagement: "core.tasks",
  /** Tool usage guidelines */
  ToolUsage: "core.tools",
  /** Available skills listing */
  Skills: "skills.available",
  /** Environment-specific instructions */
  Environment: "env.context",
  /** Project-specific instructions (from .openmgr.json or similar) */
  ProjectContext: "project.context",
  /** User customizations */
  UserCustom: "user.custom",
} as const;
