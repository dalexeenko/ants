import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Test the core logic using an isolated HOME directory so tests don't
// read the real ~/.config/ants/agent.json on the host machine.
const TEST_DIR = join(tmpdir(), "ants-config-xdg-test-" + Date.now() + "-" + Math.random().toString(36).slice(2));
const TEST_PROJECT_DIR = join(TEST_DIR, "project");
const ORIGINAL_HOME = process.env.HOME;

describe("@ants/agent-config-xdg", () => {
  // Import dynamically so we can test without side effects
  let configXdg: typeof import("../index.js");

  beforeEach(async () => {
    await mkdir(TEST_PROJECT_DIR, { recursive: true });
    // Point HOME to the test directory so loadGlobalConfig() reads from
    // TEST_DIR/.config/ants/agent.json (which doesn't exist) instead
    // of the real user config.
    process.env.HOME = TEST_DIR;
    // Re-import for fresh module state (picks up new HOME via homedir())
    configXdg = await import("../index.js");
  });

  afterEach(async () => {
    process.env.HOME = ORIGINAL_HOME;
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("getGlobalConfigPath", () => {
    it("should return path to global config", () => {
      const path = configXdg.getGlobalConfigPath();
      expect(path).toContain(".config");
      expect(path).toContain("ants");
      expect(path).toContain("agent.json");
    });
  });

  describe("getLocalConfigPath", () => {
    it("should return path to local config in working directory", () => {
      const path = configXdg.getLocalConfigPath("/some/project");
      expect(path).toBe("/some/project/.ants.json");
    });
  });

  describe("loadLocalConfig", () => {
    it("should return null when no config exists", async () => {
      const config = await configXdg.loadLocalConfig(TEST_PROJECT_DIR);
      expect(config).toBeNull();
    });

    it("should load config from working directory", async () => {
      const configPath = join(TEST_PROJECT_DIR, ".ants.json");
      await writeFile(
        configPath,
        JSON.stringify({
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
        })
      );

      const config = await configXdg.loadLocalConfig(TEST_PROJECT_DIR);
      expect(config).toEqual({
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      });
    });

    it("should find config in parent directory", async () => {
      const subDir = join(TEST_PROJECT_DIR, "src", "components");
      await mkdir(subDir, { recursive: true });

      const configPath = join(TEST_PROJECT_DIR, ".ants.json");
      await writeFile(
        configPath,
        JSON.stringify({
          provider: "anthropic",
        })
      );

      const config = await configXdg.loadLocalConfig(subDir);
      expect(config).toEqual({
        provider: "anthropic",
      });
    });

    it("should return null for invalid JSON", async () => {
      const configPath = join(TEST_PROJECT_DIR, ".ants.json");
      await writeFile(configPath, "not valid json");

      const config = await configXdg.loadLocalConfig(TEST_PROJECT_DIR);
      expect(config).toBeNull();
    });
  });

  describe("loadConfig", () => {
    it("should return defaults when no config exists", async () => {
      const config = await configXdg.loadConfig(TEST_PROJECT_DIR);

      expect(config.provider).toBe("anthropic");
      expect(config.model).toBe("claude-sonnet-4-20250514");
    });

    it("should apply overrides", async () => {
      const config = await configXdg.loadConfig(TEST_PROJECT_DIR, {
        provider: "openai",
        model: "gpt-4-turbo",
      });

      expect(config.provider).toBe("openai");
      expect(config.model).toBe("gpt-4-turbo");
    });

    it("should apply apiKey override", async () => {
      const config = await configXdg.loadConfig(TEST_PROJECT_DIR, {
        apiKey: "sk-test-key",
      });

      expect(config.auth.type).toBe("api-key");
      expect(config.auth.apiKey).toBe("sk-test-key");
    });

    it("should merge local config with overrides", async () => {
      await writeFile(
        join(TEST_PROJECT_DIR, ".ants.json"),
        JSON.stringify({
          provider: "openai",
          model: "gpt-4",
          temperature: 0.5,
        })
      );

      const config = await configXdg.loadConfig(TEST_PROJECT_DIR, {
        model: "gpt-4-turbo",
      });

      expect(config.provider).toBe("openai"); // From local
      expect(config.model).toBe("gpt-4-turbo"); // Override
      expect(config.temperature).toBe(0.5); // From local
    });
  });

  describe("saveLocalConfig", () => {
    it("should create config file in working directory", async () => {
      await configXdg.saveLocalConfig(TEST_PROJECT_DIR, { 
        provider: "openai",
        model: "gpt-4",
      });

      const configPath = join(TEST_PROJECT_DIR, ".ants.json");
      expect(existsSync(configPath)).toBe(true);

      const content = await readFile(configPath, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.provider).toBe("openai");
      expect(parsed.model).toBe("gpt-4");
    });

    it("should merge with existing config", async () => {
      const configPath = join(TEST_PROJECT_DIR, ".ants.json");
      await writeFile(
        configPath,
        JSON.stringify({
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
        })
      );

      await configXdg.saveLocalConfig(TEST_PROJECT_DIR, { 
        model: "claude-opus-4-20250514" 
      });

      const content = await readFile(configPath, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.provider).toBe("anthropic"); // Preserved
      expect(parsed.model).toBe("claude-opus-4-20250514"); // Updated
    });
  });

  describe("setApiKey", () => {
    it("should set API key in local config", async () => {
      await configXdg.setApiKey("anthropic", "sk-test-123", "local", TEST_PROJECT_DIR);

      const config = await configXdg.loadLocalConfig(TEST_PROJECT_DIR);
      expect(config?.apiKeys?.anthropic).toEqual({
        type: "api-key",
        apiKey: "sk-test-123",
      });
    });

    it("should throw when local scope without workingDirectory", async () => {
      await expect(configXdg.setApiKey("anthropic", "sk-test", "local")).rejects.toThrow(
        "workingDirectory required"
      );
    });
  });

  describe("setAuthType", () => {
    it("should set auth type to oauth in local config", async () => {
      await configXdg.setAuthType("anthropic", "oauth", "local", TEST_PROJECT_DIR);

      const config = await configXdg.loadLocalConfig(TEST_PROJECT_DIR);
      expect(config?.apiKeys?.anthropic).toEqual({ type: "oauth" });
    });

    it("should set auth type to api-key in local config", async () => {
      await configXdg.setAuthType("openai", "api-key", "local", TEST_PROJECT_DIR);

      const config = await configXdg.loadLocalConfig(TEST_PROJECT_DIR);
      expect(config?.apiKeys?.openai).toEqual({ type: "api-key" });
    });

    it("should throw when local scope without workingDirectory", async () => {
      await expect(configXdg.setAuthType("anthropic", "oauth", "local")).rejects.toThrow(
        "workingDirectory required"
      );
    });
  });

  describe("xdgConfigLoader", () => {
    it("should implement ConfigLoader interface", () => {
      expect(configXdg.xdgConfigLoader.loadConfig).toBeDefined();
      expect(configXdg.xdgConfigLoader.loadGlobalConfig).toBeDefined();
      expect(configXdg.xdgConfigLoader.loadLocalConfig).toBeDefined();
      expect(configXdg.xdgConfigLoader.saveGlobalConfig).toBeDefined();
      expect(configXdg.xdgConfigLoader.saveLocalConfig).toBeDefined();
    });

    it("should work as a ConfigLoader for local config", async () => {
      await writeFile(
        join(TEST_PROJECT_DIR, ".ants.json"),
        JSON.stringify({
          provider: "openai",
          model: "gpt-4",
        })
      );

      const config = await configXdg.xdgConfigLoader.loadConfig(TEST_PROJECT_DIR);
      expect(config.provider).toBe("openai");
      expect(config.model).toBe("gpt-4");
    });
  });

  describe("auth resolution", () => {
    it("should prefer config API key over defaults", async () => {
      await writeFile(
        join(TEST_PROJECT_DIR, ".ants.json"),
        JSON.stringify({
          apiKeys: {
            anthropic: { type: "api-key", apiKey: "sk-config-key" },
          },
        })
      );

      const config = await configXdg.loadConfig(TEST_PROJECT_DIR);
      expect(config.auth.type).toBe("api-key");
      expect(config.auth.apiKey).toBe("sk-config-key");
    });

    it("should prefer override API key over config", async () => {
      await writeFile(
        join(TEST_PROJECT_DIR, ".ants.json"),
        JSON.stringify({
          apiKeys: {
            anthropic: { type: "api-key", apiKey: "sk-config-key" },
          },
        })
      );

      const config = await configXdg.loadConfig(TEST_PROJECT_DIR, {
        apiKey: "sk-override-key",
      });
      expect(config.auth.type).toBe("api-key");
      expect(config.auth.apiKey).toBe("sk-override-key");
    });

    it("should handle oauth auth type from config", async () => {
      await writeFile(
        join(TEST_PROJECT_DIR, ".ants.json"),
        JSON.stringify({
          apiKeys: {
            anthropic: { type: "oauth" },
          },
        })
      );

      const config = await configXdg.loadConfig(TEST_PROJECT_DIR);
      expect(config.auth.type).toBe("oauth");
      expect(config.auth.apiKey).toBeUndefined();
    });

    it("should handle string API key in config", async () => {
      await writeFile(
        join(TEST_PROJECT_DIR, ".ants.json"),
        JSON.stringify({
          apiKeys: {
            anthropic: "sk-string-key",
          },
        })
      );

      const config = await configXdg.loadConfig(TEST_PROJECT_DIR);
      expect(config.auth.type).toBe("api-key");
      expect(config.auth.apiKey).toBe("sk-string-key");
    });
  });
});
