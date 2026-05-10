import { describe, it, expect, beforeEach } from "vitest";
import {
  Agent,
  toolRegistry,
  providerRegistry,
  commandRegistry,
  definePlugin,
  defineTool,
} from "@openmgr/agent-core";
import { z } from "zod";

describe("Plugin Integration", () => {
  beforeEach(() => {
    // Clear registries for clean tests
    toolRegistry.clear();
    commandRegistry.clear();
  });

  describe("Plugin registration", () => {
    it("should register a plugin with tools", async () => {
      const testTool = defineTool({
        name: "test_tool",
        description: "A test tool",
        parameters: z.object({
          input: z.string(),
        }),
        execute: async (params) => ({
          output: `Received: ${params.input}`,
        }),
      });

      const plugin = definePlugin({
        name: "test-plugin",
        version: "1.0.0",
        tools: [testTool],
      });

      const agent = new Agent({
        provider: "anthropic",
        model: "test-model",
        auth: { type: "api-key", apiKey: "test-key" },
        workingDirectory: process.cwd(),
      });

      await agent.use(plugin);

      expect(toolRegistry.has("test_tool")).toBe(true);
      expect(agent.getPlugin("test-plugin")).toBeDefined();
    });

    it("should register a plugin with commands", async () => {
      const plugin = definePlugin({
        name: "command-plugin",
        version: "1.0.0",
        commands: [
          {
            name: "test",
            description: "A test command",
            execute: async () => ({ output: "Test output" }),
          },
        ],
      });

      const agent = new Agent({
        provider: "anthropic",
        model: "test-model",
        auth: { type: "api-key", apiKey: "test-key" },
        workingDirectory: process.cwd(),
      });

      await agent.use(plugin);

      expect(commandRegistry.has("test")).toBe(true);
    });

    it("should call onRegister hook", async () => {
      let registered = false;

      const plugin = definePlugin({
        name: "hook-plugin",
        onRegister: () => {
          registered = true;
        },
      });

      const agent = new Agent({
        provider: "anthropic",
        model: "test-model",
        auth: { type: "api-key", apiKey: "test-key" },
        workingDirectory: process.cwd(),
      });

      await agent.use(plugin);

      expect(registered).toBe(true);
    });

    it("should throw when registering duplicate plugins", async () => {
      const plugin = definePlugin({
        name: "duplicate-plugin",
      });

      const agent = new Agent({
        provider: "anthropic",
        model: "test-model",
        auth: { type: "api-key", apiKey: "test-key" },
        workingDirectory: process.cwd(),
      });

      await agent.use(plugin);

      await expect(agent.use(plugin)).rejects.toThrow("already registered");
    });
  });

  describe("Extension system", () => {
    it("should set and get extensions", () => {
      const agent = new Agent({
        provider: "anthropic",
        model: "test-model",
        auth: { type: "api-key", apiKey: "test-key" },
        workingDirectory: process.cwd(),
      });

      agent.setExtension("myKey", { foo: "bar" });
      
      const value = agent.getExtension<{ foo: string }>("myKey");
      expect(value).toEqual({ foo: "bar" });
    });

    it("should return undefined for missing extensions", () => {
      const agent = new Agent({
        provider: "anthropic",
        model: "test-model",
        auth: { type: "api-key", apiKey: "test-key" },
        workingDirectory: process.cwd(),
      });

      const value = agent.getExtension("missing");
      expect(value).toBeUndefined();
    });
  });
});
