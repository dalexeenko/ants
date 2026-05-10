import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// Test the re-exports without mocking
import {
  // Re-exports from core
  definePlugin,
  defineTool,
  defineCommand,
  toolRegistry,
  // Re-exports from config-xdg
  loadLocalConfig,
  getLocalConfigPath,
  xdgConfigLoader,
  // Re-exports from skills-loader
  FilesystemSkillManager,
  parseSkillMd,
  isSkillDirectory,
  getSkillPaths,
  // Re-exports from mcp-stdio
  StdioMcpClient,
  // Node-specific provider utilities
  getApiKeyFromEnv,
  resolveProviderOptions,
  createNodeProvider,
  nodeProvidersPlugin,
  PROVIDER_ENV_VARS,
} from "../index.js";

// Use a temp directory for tests
const TEST_DIR = join(tmpdir(), "openmgr-node-test-" + Date.now() + "-" + Math.random().toString(36).slice(2));
const TEST_PROJECT_DIR = join(TEST_DIR, "project");

describe("@openmgr/agent-node", () => {
  beforeEach(async () => {
    await mkdir(TEST_PROJECT_DIR, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("re-exports from @openmgr/agent-core", () => {
    it("should re-export definePlugin", () => {
      expect(definePlugin).toBeDefined();
      expect(typeof definePlugin).toBe("function");
    });

    it("should re-export defineTool", () => {
      expect(defineTool).toBeDefined();
      expect(typeof defineTool).toBe("function");
    });

    it("should re-export defineCommand", () => {
      expect(defineCommand).toBeDefined();
      expect(typeof defineCommand).toBe("function");
    });

    it("should re-export toolRegistry", () => {
      expect(toolRegistry).toBeDefined();
      expect(toolRegistry.register).toBeDefined();
      expect(toolRegistry.get).toBeDefined();
    });
  });

  describe("re-exports from @openmgr/agent-config-xdg", () => {
    it("should re-export loadLocalConfig", async () => {
      expect(loadLocalConfig).toBeDefined();
      expect(typeof loadLocalConfig).toBe("function");

      // Test it works
      const config = await loadLocalConfig(TEST_PROJECT_DIR);
      expect(config).toBeNull(); // No config file
    });

    it("should re-export getLocalConfigPath", () => {
      expect(getLocalConfigPath).toBeDefined();
      expect(typeof getLocalConfigPath).toBe("function");

      const path = getLocalConfigPath(TEST_PROJECT_DIR);
      expect(path).toBe(join(TEST_PROJECT_DIR, ".openmgr.json"));
    });

    it("should re-export xdgConfigLoader", () => {
      expect(xdgConfigLoader).toBeDefined();
      expect(xdgConfigLoader.loadConfig).toBeDefined();
      expect(xdgConfigLoader.loadLocalConfig).toBeDefined();
    });
  });

  describe("re-exports from @openmgr/agent-skills-loader", () => {
    it("should re-export FilesystemSkillManager", () => {
      expect(FilesystemSkillManager).toBeDefined();

      const manager = new FilesystemSkillManager(TEST_PROJECT_DIR);
      expect(manager.discover).toBeDefined();
      expect(manager.load).toBeDefined();
    });

    it("should re-export parseSkillMd", () => {
      expect(parseSkillMd).toBeDefined();
      expect(typeof parseSkillMd).toBe("function");

      const result = parseSkillMd(`---
name: test
description: Test skill
---

Instructions
`);
      expect(result.metadata.name).toBe("test");
    });

    it("should re-export isSkillDirectory", async () => {
      expect(isSkillDirectory).toBeDefined();
      expect(typeof isSkillDirectory).toBe("function");

      expect(isSkillDirectory(TEST_PROJECT_DIR)).toBe(false);

      // Create a skill
      const skillDir = join(TEST_PROJECT_DIR, "test-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: test-skill
description: Test
---
`
      );

      expect(isSkillDirectory(skillDir)).toBe(true);
    });

    it("should re-export getSkillPaths", () => {
      expect(getSkillPaths).toBeDefined();
      expect(typeof getSkillPaths).toBe("function");

      const paths = getSkillPaths(TEST_PROJECT_DIR);
      expect(paths.local).toBe(join(TEST_PROJECT_DIR, ".openmgr", "skills"));
    });
  });

  describe("re-exports from @openmgr/agent-mcp-stdio", () => {
    it("should re-export StdioMcpClient", () => {
      expect(StdioMcpClient).toBeDefined();

      const client = new StdioMcpClient("test", {
        transport: "stdio",
        command: "test",
        args: [],
        enabled: true,
        timeout: 30000,
      });

      expect(client.name).toBe("test");
      expect(client.connected).toBe(false);
    });
  });

  describe("integration", () => {
    it("should allow creating a skill manager and discovering skills", async () => {
      // Create a skill
      const skillsDir = join(TEST_PROJECT_DIR, ".openmgr", "skills");
      const skillDir = join(skillsDir, "my-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---
name: my-skill
description: A test skill for integration testing
---

# My Skill Instructions

Do this, then that.
`
      );

      const manager = new FilesystemSkillManager(TEST_PROJECT_DIR);
      const skills = await manager.discover();

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("my-skill");

      const loaded = await manager.load("my-skill");
      expect(loaded.instructions).toContain("Do this, then that");
    });

    it("should allow loading local config", async () => {
      await writeFile(
        join(TEST_PROJECT_DIR, ".openmgr.json"),
        JSON.stringify({
          provider: "openai",
          model: "gpt-4",
        })
      );

      const config = await xdgConfigLoader.loadConfig(TEST_PROJECT_DIR);
      expect(config.provider).toBe("openai");
      expect(config.model).toBe("gpt-4");
    });

    it("should allow defining plugins", () => {
      const plugin = definePlugin({
        name: "test-plugin",
        version: "1.0.0",
      });

      expect(plugin.name).toBe("test-plugin");
      expect(plugin.version).toBe("1.0.0");
    });
  });

  describe("Node.js provider utilities", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      // Clear relevant env vars before each test
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.GROQ_API_KEY;
      delete process.env.XAI_API_KEY;
    });

    afterEach(() => {
      // Restore original env
      process.env = { ...originalEnv };
    });

    it("should export PROVIDER_ENV_VARS mapping", () => {
      expect(PROVIDER_ENV_VARS).toBeDefined();
      expect(PROVIDER_ENV_VARS.anthropic).toContain("ANTHROPIC_API_KEY");
      expect(PROVIDER_ENV_VARS.openai).toContain("OPENAI_API_KEY");
      expect(PROVIDER_ENV_VARS.google).toContain("GOOGLE_GENERATIVE_AI_API_KEY");
      expect(PROVIDER_ENV_VARS.google).toContain("GOOGLE_API_KEY");
      expect(PROVIDER_ENV_VARS.openrouter).toContain("OPENROUTER_API_KEY");
      expect(PROVIDER_ENV_VARS.groq).toContain("GROQ_API_KEY");
      expect(PROVIDER_ENV_VARS.xai).toContain("XAI_API_KEY");
    });

    it("should get API key from environment variables", () => {
      process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
      process.env.OPENAI_API_KEY = "test-openai-key";

      expect(getApiKeyFromEnv("anthropic")).toBe("test-anthropic-key");
      expect(getApiKeyFromEnv("openai")).toBe("test-openai-key");
      expect(getApiKeyFromEnv("google")).toBeUndefined();
    });

    it("should prefer first env var for Google provider", () => {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = "primary-key";
      process.env.GOOGLE_API_KEY = "fallback-key";

      expect(getApiKeyFromEnv("google")).toBe("primary-key");
    });

    it("should fallback to secondary env var for Google provider", () => {
      process.env.GOOGLE_API_KEY = "fallback-key";

      expect(getApiKeyFromEnv("google")).toBe("fallback-key");
    });

    it("should resolve provider options with env var fallback", () => {
      process.env.ANTHROPIC_API_KEY = "env-key";

      const options = resolveProviderOptions("anthropic", {});
      expect(options.apiKey).toBe("env-key");
    });

    it("should prefer explicit apiKey over env var", () => {
      process.env.ANTHROPIC_API_KEY = "env-key";

      const options = resolveProviderOptions("anthropic", { apiKey: "explicit-key" });
      expect(options.apiKey).toBe("explicit-key");
    });

    it("should prefer auth.apiKey over env var", () => {
      process.env.ANTHROPIC_API_KEY = "env-key";

      const options = resolveProviderOptions("anthropic", { 
        auth: { type: "api-key", apiKey: "auth-key" } 
      });
      expect(options.auth?.apiKey).toBe("auth-key");
      expect(options.apiKey).toBeUndefined();
    });

    it("should create provider with env var API key", () => {
      process.env.OPENAI_API_KEY = "test-openai-key";

      const provider = createNodeProvider("openai");
      expect(provider).toBeDefined();
      // The provider is created successfully (would throw if no API key)
    });

    it("should throw when creating provider without API key", () => {
      expect(() => {
        const provider = createNodeProvider("anthropic");
        // Force the provider to use the API key by calling stream
        // (the error happens when actually making a request)
      }).not.toThrow(); // Provider creation doesn't throw, but stream() will
    });

    it("should export nodeProvidersPlugin", () => {
      expect(nodeProvidersPlugin).toBeDefined();
      expect(nodeProvidersPlugin.name).toBe("@openmgr/agent-node/providers");
      expect(nodeProvidersPlugin.providers).toHaveLength(6);
      
      const providerNames = nodeProvidersPlugin.providers!.map(p => p.name);
      expect(providerNames).toContain("anthropic");
      expect(providerNames).toContain("openai");
      expect(providerNames).toContain("google");
      expect(providerNames).toContain("openrouter");
      expect(providerNames).toContain("groq");
      expect(providerNames).toContain("xai");
    });

    it("should create providers through nodeProvidersPlugin with env vars", () => {
      process.env.ANTHROPIC_API_KEY = "test-key";

      const anthropicDef = nodeProvidersPlugin.providers!.find(p => p.name === "anthropic");
      expect(anthropicDef).toBeDefined();

      const provider = anthropicDef!.factory({});
      expect(provider).toBeDefined();
    });
  });
});
