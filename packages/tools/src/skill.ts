import { z } from "zod";
import { defineTool, type SkillManagerInterface } from "@openmgr/agent-core";

/**
 * Skill tool - loads detailed instructions for a specific skill
 * 
 * Per the Agent Skills spec, skills are loaded on-demand when the agent
 * determines that a task matches the skill's description.
 */
export const skillTool = defineTool({
  name: "skill",
  description: "Load a skill to get detailed instructions for a specific task. No skills are currently available.",
  parameters: z.object({
    name: z.string().describe("The skill identifier from available_skills"),
  }),
  async execute(params, ctx) {
    const skillManager = ctx.getSkillManager?.() as SkillManagerInterface | undefined;
    
    if (!skillManager) {
      return {
        output: "Error: Skill system is not initialized.",
      };
    }

    if (!skillManager.hasSkill(params.name)) {
      const available = skillManager.getAvailable();
      if (available.length === 0) {
        return {
          output: `Error: Skill "${params.name}" not found. No skills are currently available.`,
        };
      }
      const skillNames = available.map((s: { name: string }) => s.name).join(", ");
      return {
        output: `Error: Skill "${params.name}" not found. Available skills: ${skillNames}`,
      };
    }

    try {
      const skill = await skillManager.load(params.name);
      
      return {
        output: skill.instructions,
        metadata: {
          skillName: skill.metadata.name,
          skillPath: skill.path,
          skillSource: skill.source,
        },
      };
    } catch (err) {
      return {
        output: `Error loading skill "${params.name}": ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
