import { describe, it, expect } from "vitest";
import {
  defaultSkills,
  getSkillContent,
  getSkillNames,
  CODE_REVIEW_SKILL,
  DEBUG_SKILL,
  DOCUMENTATION_SKILL,
  GIT_COMMIT_SKILL,
  PR_REVIEW_SKILL,
  REFACTOR_SKILL,
  SECURITY_REVIEW_SKILL,
  TEST_WRITING_SKILL,
} from "../index.js";

describe("@openmgr/agent-skills-content", () => {
  describe("defaultSkills", () => {
    it("should contain all 8 default skills", () => {
      expect(defaultSkills).toHaveLength(8);
    });

    it("should contain all expected skill names", () => {
      const names = defaultSkills.map((s) => s.name);
      expect(names).toContain("code-review");
      expect(names).toContain("debug");
      expect(names).toContain("documentation");
      expect(names).toContain("git-commit");
      expect(names).toContain("pr-review");
      expect(names).toContain("refactor");
      expect(names).toContain("security-review");
      expect(names).toContain("test-writing");
    });

    it("should have valid skill content for each skill", () => {
      for (const skill of defaultSkills) {
        expect(skill.name).toBeTruthy();
        expect(skill.description).toBeTruthy();
        expect(skill.content).toBeTruthy();
        // Content should contain frontmatter
        expect(skill.content).toContain("---");
        expect(skill.content).toContain(`name: ${skill.name}`);
      }
    });
  });

  describe("getSkillContent", () => {
    it("should return skill content by name", () => {
      const skill = getSkillContent("code-review");
      expect(skill).toBeDefined();
      expect(skill?.name).toBe("code-review");
      expect(skill?.content).toContain("Code Review");
    });

    it("should return undefined for unknown skill", () => {
      const skill = getSkillContent("unknown-skill");
      expect(skill).toBeUndefined();
    });
  });

  describe("getSkillNames", () => {
    it("should return all skill names", () => {
      const names = getSkillNames();
      expect(names).toHaveLength(8);
      expect(names).toContain("code-review");
      expect(names).toContain("debug");
    });
  });

  describe("individual skill exports", () => {
    it("should export CODE_REVIEW_SKILL", () => {
      expect(CODE_REVIEW_SKILL.name).toBe("code-review");
      expect(CODE_REVIEW_SKILL.content).toContain("Code Review");
    });

    it("should export DEBUG_SKILL", () => {
      expect(DEBUG_SKILL.name).toBe("debug");
      expect(DEBUG_SKILL.content).toContain("Debugging");
    });

    it("should export DOCUMENTATION_SKILL", () => {
      expect(DOCUMENTATION_SKILL.name).toBe("documentation");
    });

    it("should export GIT_COMMIT_SKILL", () => {
      expect(GIT_COMMIT_SKILL.name).toBe("git-commit");
    });

    it("should export PR_REVIEW_SKILL", () => {
      expect(PR_REVIEW_SKILL.name).toBe("pr-review");
    });

    it("should export REFACTOR_SKILL", () => {
      expect(REFACTOR_SKILL.name).toBe("refactor");
    });

    it("should export SECURITY_REVIEW_SKILL", () => {
      expect(SECURITY_REVIEW_SKILL.name).toBe("security-review");
    });

    it("should export TEST_WRITING_SKILL", () => {
      expect(TEST_WRITING_SKILL.name).toBe("test-writing");
    });
  });
});
