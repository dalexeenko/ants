import { describe, it, expect } from "vitest";
import { StdioMcpClient } from "../index.js";
import type { McpStdioConfig } from "@openmgr/agent-core";

describe("@openmgr/agent-mcp-stdio", () => {
  const testConfig: McpStdioConfig = {
    transport: "stdio",
    command: "test-server",
    args: ["--arg1", "value1"],
    env: { TEST_VAR: "test_value" },
    enabled: true,
    timeout: 30000,
  };

  describe("StdioMcpClient", () => {
    describe("constructor", () => {
      it("should create client with name and config", () => {
        const client = new StdioMcpClient("test-server", testConfig);

        expect(client.name).toBe("test-server");
        expect(client.config).toEqual(testConfig);
        expect(client.connected).toBe(false);
      });

      it("should store the config correctly", () => {
        const client = new StdioMcpClient("my-server", testConfig);

        expect(client.config.command).toBe("test-server");
        expect(client.config.args).toEqual(["--arg1", "value1"]);
        expect(client.config.env).toEqual({ TEST_VAR: "test_value" });
      });

      it("should accept custom env resolver", () => {
        const customResolver = (varName: string) => `resolved-${varName}`;
        const client = new StdioMcpClient("test-server", testConfig, customResolver);

        expect(client.name).toBe("test-server");
        expect(client.connected).toBe(false);
      });
    });

    describe("disconnect when not connected", () => {
      it("should handle disconnect gracefully when not connected", async () => {
        const client = new StdioMcpClient("test-server", testConfig);

        expect(client.connected).toBe(false);
        await client.disconnect();
        expect(client.connected).toBe(false);
      });
    });

    describe("error states", () => {
      it("should throw when calling callTool without connecting", async () => {
        const client = new StdioMcpClient("test-server", testConfig);

        await expect(client.callTool("test_tool", {})).rejects.toThrow(
          "MCP client not connected"
        );
      });

      it("should throw when calling readResource without connecting", async () => {
        const client = new StdioMcpClient("test-server", testConfig);

        await expect(client.readResource("file:///test.txt")).rejects.toThrow(
          "MCP client not connected"
        );
      });

      it("should throw when calling getPrompt without connecting", async () => {
        const client = new StdioMcpClient("test-server", testConfig);

        await expect(client.getPrompt("test_prompt")).rejects.toThrow(
          "MCP client not connected"
        );
      });
    });

    describe("config handling", () => {
      it("should handle config without optional fields", () => {
        const minimalConfig: McpStdioConfig = {
          transport: "stdio",
          command: "server",
          args: [],
          enabled: true,
          timeout: 30000,
        };

        const client = new StdioMcpClient("minimal", minimalConfig);

        expect(client.config.command).toBe("server");
        expect(client.config.env).toBeUndefined();
      });

      it("should preserve all config properties", () => {
        const fullConfig: McpStdioConfig = {
          transport: "stdio",
          command: "/path/to/server",
          args: ["--port", "8080", "--debug"],
          env: {
            API_KEY: "secret",
            DEBUG: "true",
          },
          enabled: true,
          timeout: 60000,
        };

        const client = new StdioMcpClient("full", fullConfig);

        expect(client.config.command).toBe("/path/to/server");
        expect(client.config.args).toEqual(["--port", "8080", "--debug"]);
        expect(client.config.env).toEqual({
          API_KEY: "secret",
          DEBUG: "true",
        });
        expect(client.config.timeout).toBe(60000);
      });
    });
  });

  describe("exports", () => {
    it("should export StdioMcpClient class", () => {
      expect(StdioMcpClient).toBeDefined();
      expect(typeof StdioMcpClient).toBe("function");
    });
  });
});
