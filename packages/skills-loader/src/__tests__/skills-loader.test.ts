import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir, homedir } from "os";
import {
  parseSkillMd,
  isSkillDirectory,
  loadSkillFromDirectory,
  loadSkillMetadata,
  FilesystemSkillManager,
  getSkillPaths,
  SkillLoadError,
  SkillNotFoundError,
} from "../index.js";

// Use a temp directory for tests
const TEST_DIR = join(tmpdir(), "openmgr-skills-loader-test-" + Date.now() + "-" + Math.random().toString(36).slice(2));
const TEST_SKILLS_DIR = join(TEST_DIR, ".openmgr", "skills");

const VALID_SKILL_MD = `---
name: test-skill
description: A test skill for unit testing
license: MIT
compatibility: Node.js 20+
---

# Test Skill Instructions

This is a test skill with some instructions.

## Usage

Use this skill when testing.
`;

const MINIMAL_SKILL_MD = `---
name: minimal
description: Minimal skill
---

Instructions here.
`;

describe("@openmgr/agent-skills-loader", () => {
  beforeEach(async () => {
    await mkdir(TEST_SKILLS_DIR, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("parseSkillMd", () => {
    it("should parse valid skill markdown", () => {
      const result = parseSkillMd(VALID_SKILL_MD);

      expect(result.metadata.name).toBe("test-skill");
      expect(result.metadata.description).toBe("A test skill for unit testing");
      expect(result.metadata.license).toBe("MIT");
      expect(result.metadata.compatibility).toBe("Node.js 20+");
      expect(result.instructions).toContain("# Test Skill Instructions");
      expect(result.instructions).toContain("Use this skill when testing.");
    });

    it("should parse minimal skill markdown", () => {
      const result = parseSkillMd(MINIMAL_SKILL_MD);

      expect(result.metadata.name).toBe("minimal");
      expect(result.metadata.description).toBe("Minimal skill");
      expect(result.metadata.license).toBeUndefined();
      expect(result.instructions).toBe("Instructions here.");
    });

    it("should throw for missing frontmatter", () => {
      expect(() => parseSkillMd("No frontmatter here")).toThrow(
        "must contain YAML frontmatter"
      );
    });

    it("should throw for invalid YAML", () => {
      const invalidYaml = `---
name: [invalid yaml
description: test
---

Content
`;
      expect(() => parseSkillMd(invalidYaml)).toThrow("Invalid YAML");
    });

    it("should throw for missing required fields", () => {
      const missingName = `---
description: Missing name field
---

Content
`;
      expect(() => parseSkillMd(missingName)).toThrow("Invalid skill metadata");
    });

    it("should throw for invalid skill name format", () => {
      const invalidName = `---
name: Invalid Name With Spaces
description: test
---

Content
`;
      expect(() => parseSkillMd(invalidName)).toThrow("Invalid skill metadata");
    });

    it("should parse allowed-tools field", () => {
      const withTools = `---
name: with-tools
description: Skill with allowed tools
allowed-tools: bash read write
---

Content
`;
      const result = parseSkillMd(withTools);
      expect(result.metadata.allowedTools).toEqual(["bash", "read", "write"]);
    });

    it("should parse metadata field", () => {
      const withMetadata = `---
name: with-metadata
description: Skill with custom metadata
metadata:
  author: Test Author
  version: 1.0.0
---

Content
`;
      const result = parseSkillMd(withMetadata);
      expect(result.metadata.metadata).toEqual({
        author: "Test Author",
        version: "1.0.0",
      });
    });
  });

  describe("isSkillDirectory", () => {
    it("should return true when SKILL.md exists", async () => {
      const skillDir = join(TEST_SKILLS_DIR, "my-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), VALID_SKILL_MD);

      expect(isSkillDirectory(skillDir)).toBe(true);
    });

    it("should return false when SKILL.md does not exist", async () => {
      const skillDir = join(TEST_SKILLS_DIR, "not-a-skill");
      await mkdir(skillDir, { recursive: true });

      expect(isSkillDirectory(skillDir)).toBe(false);
    });

    it("should return false for non-existent directory", () => {
      expect(isSkillDirectory("/nonexistent/path")).toBe(false);
    });
  });

  describe("loadSkillFromDirectory", () => {
    it("should load a valid skill", async () => {
      const skillDir = join(TEST_SKILLS_DIR, "test-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), VALID_SKILL_MD);

      const skill = await loadSkillFromDirectory(skillDir, "local");

      expect(skill.metadata.name).toBe("test-skill");
      expect(skill.metadata.description).toBe("A test skill for unit testing");
      expect(skill.path).toBe(skillDir);
      expect(skill.source).toBe("local");
      expect(skill.instructions).toContain("Test Skill Instructions");
    });

    it("should throw SkillLoadError when SKILL.md is missing", async () => {
      const skillDir = join(TEST_SKILLS_DIR, "no-skill-md");
      await mkdir(skillDir, { recursive: true });

      await expect(loadSkillFromDirectory(skillDir, "local")).rejects.toThrow(
        SkillLoadError
      );
    });

    it("should throw when skill name doesn't match directory name", async () => {
      const skillDir = join(TEST_SKILLS_DIR, "wrong-name");
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), VALID_SKILL_MD); // name is "test-skill"

      await expect(loadSkillFromDirectory(skillDir, "local")).rejects.toThrow(
        "does not match directory name"
      );
    });
  });

  describe("loadSkillMetadata", () => {
    it("should load metadata without full instructions", async () => {
      const skillDir = join(TEST_SKILLS_DIR, "test-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), VALID_SKILL_MD);

      const result = await loadSkillMetadata(skillDir, "local");

      expect(result.metadata.name).toBe("test-skill");
      expect(result.path).toBe(skillDir);
      expect(result.source).toBe("local");
    });
  });

  describe("getSkillPaths", () => {
    it("should return correct paths", () => {
      const paths = getSkillPaths("/project");

      expect(paths.local).toBe("/project/.openmgr/skills");
      expect(paths.global).toBe(join(homedir(), ".config", "openmgr", "skills"));
      expect(paths.bundled).toBeDefined();
      expect(paths.additionalBundled).toEqual([]);
    });

    it("should include additional bundled paths", () => {
      const paths = getSkillPaths("/project", {
        additionalBundledPaths: ["/custom/skills"],
      });

      expect(paths.additionalBundled).toEqual(["/custom/skills"]);
    });

    it("should use custom bundled path when provided", () => {
      const paths = getSkillPaths("/project", {
        bundledPath: "/custom/bundled",
      });

      expect(paths.bundled).toBe("/custom/bundled");
    });
  });

  describe("FilesystemSkillManager", () => {
    it("should discover skills from local directory", async () => {
      // Create a local skill
      const skillDir = join(TEST_SKILLS_DIR, "local-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: local-skill
description: A local skill
---

Local instructions.
`
      );

      const manager = new FilesystemSkillManager(TEST_DIR);
      const skills = await manager.discover();

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("local-skill");
      expect(skills[0].source).toBe("local");
    });

    it("should discover multiple skills", async () => {
      // Create first skill
      const skillDir1 = join(TEST_SKILLS_DIR, "skill-a");
      await mkdir(skillDir1, { recursive: true });
      await writeFile(
        join(skillDir1, "SKILL.md"),
        `---
name: skill-a
description: First skill
---

Content.
`
      );

      // Create second skill
      const skillDir2 = join(TEST_SKILLS_DIR, "skill-b");
      await mkdir(skillDir2, { recursive: true });
      await writeFile(
        join(skillDir2, "SKILL.md"),
        `---
name: skill-b
description: Second skill
---

Content.
`
      );

      const manager = new FilesystemSkillManager(TEST_DIR);
      const skills = await manager.discover();

      expect(skills).toHaveLength(2);
      expect(skills.map((s) => s.name).sort()).toEqual(["skill-a", "skill-b"]);
    });

    it("should load skill by name", async () => {
      const skillDir = join(TEST_SKILLS_DIR, "loadable-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: loadable-skill
description: Can be loaded
---

These are the instructions.
`
      );

      const manager = new FilesystemSkillManager(TEST_DIR);
      await manager.discover();

      const skill = await manager.load("loadable-skill");
      expect(skill.metadata.name).toBe("loadable-skill");
      expect(skill.instructions).toBe("These are the instructions.");
    });

    it("should throw SkillNotFoundError for unknown skill", async () => {
      const manager = new FilesystemSkillManager(TEST_DIR);
      await manager.discover();

      await expect(manager.load("nonexistent")).rejects.toThrow(
        SkillNotFoundError
      );
    });

    it("should check if skill exists", async () => {
      const skillDir = join(TEST_SKILLS_DIR, "existing-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: existing-skill
description: Exists
---

Content.
`
      );

      const manager = new FilesystemSkillManager(TEST_DIR);
      await manager.discover();

      expect(manager.hasSkill("existing-skill")).toBe(true);
      expect(manager.hasSkill("nonexistent")).toBe(false);
    });

    it("should get skill reference by name", async () => {
      const skillDir = join(TEST_SKILLS_DIR, "ref-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: ref-skill
description: Has a reference
---

Content.
`
      );

      const manager = new FilesystemSkillManager(TEST_DIR);
      await manager.discover();

      const ref = manager.getSkill("ref-skill");
      expect(ref).toBeDefined();
      expect(ref?.name).toBe("ref-skill");
      expect(ref?.description).toBe("Has a reference");
    });

    it("should return undefined for unknown skill reference", async () => {
      const manager = new FilesystemSkillManager(TEST_DIR);
      await manager.discover();

      expect(manager.getSkill("unknown")).toBeUndefined();
    });

    it("should generate system prompt section", async () => {
      const skillDir = join(TEST_SKILLS_DIR, "prompt-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: prompt-skill
description: For system prompt
---

Content.
`
      );

      const manager = new FilesystemSkillManager(TEST_DIR);
      await manager.discover();

      const section = manager.generateSystemPromptSection();
      expect(section).toContain("Available Skills");
      expect(section).toContain("prompt-skill");
      expect(section).toContain("For system prompt");
    });

    it("should return empty string for system prompt when no skills", async () => {
      const manager = new FilesystemSkillManager(TEST_DIR);
      await manager.discover();

      const section = manager.generateSystemPromptSection();
      expect(section).toBe("");
    });

    it("should generate skill tool description", async () => {
      const skillDir = join(TEST_SKILLS_DIR, "tool-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: tool-skill
description: For tool description
---

Content.
`
      );

      const manager = new FilesystemSkillManager(TEST_DIR);
      await manager.discover();

      const description = manager.generateSkillToolDescription();
      expect(description).toContain("tool-skill");
    });

    it("should return default description when no skills", async () => {
      const manager = new FilesystemSkillManager(TEST_DIR);
      await manager.discover();

      const description = manager.generateSkillToolDescription();
      expect(description).toContain("No skills are currently available");
    });

    it("should add bundled path", async () => {
      const manager = new FilesystemSkillManager(TEST_DIR);
      manager.addBundledPath("/custom/bundled/skills");

      const paths = manager.getPaths();
      expect(paths.additionalBundled).toContain("/custom/bundled/skills");
    });

    it("should not duplicate bundled paths", async () => {
      const manager = new FilesystemSkillManager(TEST_DIR);
      manager.addBundledPath("/custom/bundled/skills");
      manager.addBundledPath("/custom/bundled/skills");

      const paths = manager.getPaths();
      expect(
        paths.additionalBundled.filter((p) => p === "/custom/bundled/skills")
      ).toHaveLength(1);
    });

    it("should get available skills sorted alphabetically", async () => {
      const skillDir1 = join(TEST_SKILLS_DIR, "zebra-skill");
      await mkdir(skillDir1, { recursive: true });
      await writeFile(
        join(skillDir1, "SKILL.md"),
        `---
name: zebra-skill
description: Z skill
---
`
      );

      const skillDir2 = join(TEST_SKILLS_DIR, "alpha-skill");
      await mkdir(skillDir2, { recursive: true });
      await writeFile(
        join(skillDir2, "SKILL.md"),
        `---
name: alpha-skill
description: A skill
---
`
      );

      const manager = new FilesystemSkillManager(TEST_DIR);
      await manager.discover();

      const skills = manager.getAvailable();
      expect(skills[0].name).toBe("alpha-skill");
      expect(skills[1].name).toBe("zebra-skill");
    });

    it("should continue discovering after invalid skill", async () => {
      // Create valid skill
      const validDir = join(TEST_SKILLS_DIR, "valid-skill");
      await mkdir(validDir, { recursive: true });
      await writeFile(
        join(validDir, "SKILL.md"),
        `---
name: valid-skill
description: Valid
---
`
      );

      // Create invalid skill (wrong name)
      const invalidDir = join(TEST_SKILLS_DIR, "wrong-dir");
      await mkdir(invalidDir, { recursive: true });
      await writeFile(
        join(invalidDir, "SKILL.md"),
        `---
name: different-name
description: Invalid
---
`
      );

      const warnings: string[] = [];
      const manager = new FilesystemSkillManager(TEST_DIR, {
        warn: (msg: string) => warnings.push(msg),
      });
      await manager.discover();

      // Should still find valid skill
      expect(manager.hasSkill("valid-skill")).toBe(true);
      expect(manager.hasSkill("different-name")).toBe(false);
      expect(warnings.length).toBeGreaterThan(0);
    });
  });
});
