import { describe, it, expect } from "vitest";
import { FilesystemSkillManager, getBundledSkillsDir, getBundledSkillNames } from "@openmgr/agent-skills-loader";

describe("Skills Integration", () => {
  describe("Bundled skills discovery", () => {
    it("should discover all bundled skills", async () => {
      const bundledSkillsPath = getBundledSkillsDir();
      const manager = new FilesystemSkillManager(process.cwd(), {
        additionalBundledPaths: [bundledSkillsPath],
      });

      await manager.discover();
      const skills = manager.getAvailable();

      // Check that we found the expected bundled skills
      const bundledNames = getBundledSkillNames();
      expect(skills.length).toBeGreaterThanOrEqual(bundledNames.length);

      for (const name of bundledNames) {
        expect(manager.hasSkill(name)).toBe(true);
      }
    });

    it("should load a bundled skill", async () => {
      const bundledSkillsPath = getBundledSkillsDir();
      const manager = new FilesystemSkillManager(process.cwd(), {
        additionalBundledPaths: [bundledSkillsPath],
      });

      await manager.discover();
      
      const skill = await manager.load("code-review");

      expect(skill.metadata.name).toBe("code-review");
      expect(skill.metadata.description).toBeTruthy();
      expect(skill.instructions).toBeTruthy();
      expect(skill.source).toBe("bundled");
    });

    it("should generate system prompt section", async () => {
      const bundledSkillsPath = getBundledSkillsDir();
      const manager = new FilesystemSkillManager(process.cwd(), {
        additionalBundledPaths: [bundledSkillsPath],
      });

      await manager.discover();
      
      const section = manager.generateSystemPromptSection();

      expect(section).toContain("# Available Skills");
      expect(section).toContain("code-review");
      expect(section).toContain("debug");
    });

    it("should throw SkillNotFoundError for missing skill", async () => {
      const manager = new FilesystemSkillManager(process.cwd());
      await manager.discover();

      await expect(manager.load("non-existent-skill")).rejects.toThrow("not found");
    });
  });
});
