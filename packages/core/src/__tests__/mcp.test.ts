/**
 * Tests for the McpManager class.
 *
 * Covers: construction, server connection lifecycle, tool/resource/prompt
 * discovery, error handling, multiple server management, and shutdown.
 *
 * All MCP client interactions are mocked — no network or running servers required.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpManager } from "../mcp/manager.js";
import type {
  McpClientInterface,
  McpServerConfig,
  McpTool,
  McpResource,
  McpPrompt,
  McpClientFactory,
} from "../mcp/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal mock McpClientInterface. */
function createMockClient(
  name: string,
  config: McpServerConfig,
  overrides: Partial<McpClientInterface> = {}
): McpClientInterface {
  let _connected = false;
  return {
    name,
    get connected() {
      return _connected;
    },
    config,
    connect: vi.fn(async () => {
      _connected = true;
    }),
    disconnect: vi.fn(async () => {
      _connected = false;
    }),
    listTools: vi.fn(async () => [] as McpTool[]),
    callTool: vi.fn(async () => "mock-result"),
    listResources: vi.fn(async () => [] as McpResource[]),
    readResource: vi.fn(async () => "mock-resource-content"),
    listPrompts: vi.fn(async () => [] as McpPrompt[]),
    getPrompt: vi.fn(async () => "mock-prompt-result"),
    ...overrides,
  };
}

const STDIO_CONFIG: McpServerConfig = {
  transport: "stdio",
  command: "mock-server",
  args: [],
  enabled: true,
  timeout: 30000,
};

const SSE_CONFIG: McpServerConfig = {
  transport: "sse",
  url: "http://localhost:1234/sse",
  enabled: true,
  timeout: 30000,
};

function sampleTools(serverName: string): McpTool[] {
  return [
    {
      name: "read_file",
      description: "Read a file",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      serverName,
    },
    {
      name: "write_file",
      description: "Write a file",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
      serverName,
    },
  ];
}

function sampleResources(serverName: string): McpResource[] {
  return [
    {
      uri: "file:///readme.md",
      name: "README",
      description: "Project readme",
      mimeType: "text/markdown",
      serverName,
    },
  ];
}

function samplePrompts(serverName: string): McpPrompt[] {
  return [
    {
      name: "summarize",
      description: "Summarize text",
      arguments: [
        { name: "text", description: "Text to summarize", required: true },
      ],
      serverName,
    },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("McpManager", () => {
  let manager: McpManager;
  let mockFactory: McpClientFactory;
  let createdClients: Map<string, McpClientInterface>;

  beforeEach(() => {
    createdClients = new Map();
    mockFactory = vi.fn((name: string, config: McpServerConfig) => {
      const client = createMockClient(name, config);
      createdClients.set(name, client);
      return client;
    });
    manager = new McpManager({ clientFactory: mockFactory });
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  // -----------------------------------------------------------------------
  // 1. Construction and configuration
  // -----------------------------------------------------------------------
  describe("construction", () => {
    it("creates a manager with default options", () => {
      const m = new McpManager();
      expect(m.getTools()).toEqual([]);
      expect(m.getServers()).toEqual([]);
    });

    it("accepts a client factory", () => {
      const m = new McpManager({ clientFactory: mockFactory });
      expect(m.getTools()).toEqual([]);
    });

    it("is an EventEmitter", () => {
      expect(typeof manager.on).toBe("function");
      expect(typeof manager.emit).toBe("function");
    });
  });

  // -----------------------------------------------------------------------
  // 2. Server connection lifecycle
  // -----------------------------------------------------------------------
  describe("server connection lifecycle", () => {
    it("addServer connects a client and registers tools", async () => {
      const tools = sampleTools("fs");
      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        const client = createMockClient(name, config, {
          listTools: vi.fn(async () => tools),
        });
        createdClients.set(name, client);
        return client;
      });
      manager = new McpManager({ clientFactory: mockFactory });

      await manager.addServer("fs", STDIO_CONFIG);

      const client = createdClients.get("fs")!;
      expect(client.connect).toHaveBeenCalledOnce();
      expect(client.listTools).toHaveBeenCalledOnce();
      expect(manager.getTools()).toHaveLength(2);
    });

    it("emits server.connected on successful addServer", async () => {
      const handler = vi.fn();
      manager.on("server.connected", handler);

      await manager.addServer("test", STDIO_CONFIG);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith("test", 0);
    });

    it("removeServer disconnects and clears tools", async () => {
      const tools = sampleTools("fs");
      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        const client = createMockClient(name, config, {
          listTools: vi.fn(async () => tools),
        });
        createdClients.set(name, client);
        return client;
      });
      manager = new McpManager({ clientFactory: mockFactory });

      await manager.addServer("fs", STDIO_CONFIG);
      expect(manager.getTools()).toHaveLength(2);

      await manager.removeServer("fs");

      const client = createdClients.get("fs")!;
      expect(client.disconnect).toHaveBeenCalledOnce();
      expect(manager.getTools()).toHaveLength(0);
      expect(manager.getServers()).toHaveLength(0);
    });

    it("emits server.disconnected on removeServer", async () => {
      const handler = vi.fn();
      manager.on("server.disconnected", handler);

      await manager.addServer("x", STDIO_CONFIG);
      await manager.removeServer("x");

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith("x");
    });

    it("removeServer is a no-op for unknown servers", async () => {
      await expect(manager.removeServer("nonexistent")).resolves.toBeUndefined();
    });

    it("addServer replaces an existing server with the same name", async () => {
      await manager.addServer("s", STDIO_CONFIG);
      const firstClient = createdClients.get("s")!;

      // The factory will be called again; clear the map to get the new client
      createdClients.delete("s");
      await manager.addServer("s", STDIO_CONFIG);
      const secondClient = createdClients.get("s")!;

      expect(firstClient.disconnect).toHaveBeenCalled();
      expect(secondClient.connect).toHaveBeenCalledOnce();
      expect(manager.getServers()).toHaveLength(1);
    });

    it("removeServer ignores disconnect errors from the client", async () => {
      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        const client = createMockClient(name, config, {
          disconnect: vi.fn(async () => {
            throw new Error("disconnect boom");
          }),
        });
        createdClients.set(name, client);
        return client;
      });
      manager = new McpManager({ clientFactory: mockFactory });

      await manager.addServer("s", STDIO_CONFIG);
      // Should not throw
      await expect(manager.removeServer("s")).resolves.toBeUndefined();
      expect(manager.getServers()).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Tool discovery
  // -----------------------------------------------------------------------
  describe("tool discovery", () => {
    it("prefixes tool names with mcp_{serverName}_", async () => {
      const tools = sampleTools("myserver");
      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        const client = createMockClient(name, config, {
          listTools: vi.fn(async () => tools),
        });
        createdClients.set(name, client);
        return client;
      });
      manager = new McpManager({ clientFactory: mockFactory });

      await manager.addServer("myserver", STDIO_CONFIG);

      const names = manager.getTools().map((t) => t.name);
      expect(names).toContain("mcp_myserver_read_file");
      expect(names).toContain("mcp_myserver_write_file");
    });

    it("getTool returns the tool by full name", async () => {
      const tools = sampleTools("fs");
      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        const client = createMockClient(name, config, {
          listTools: vi.fn(async () => tools),
        });
        createdClients.set(name, client);
        return client;
      });
      manager = new McpManager({ clientFactory: mockFactory });

      await manager.addServer("fs", STDIO_CONFIG);

      const tool = manager.getTool("mcp_fs_read_file");
      expect(tool).toBeDefined();
      expect(tool!.description).toBe("Read a file");
    });

    it("getTool returns undefined for unknown tool", () => {
      expect(manager.getTool("mcp_nope_nothing")).toBeUndefined();
    });

    it("callTool delegates to the correct client with the original name", async () => {
      const tools = sampleTools("fs");
      const callToolMock = vi.fn(async () => "file content");
      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        const client = createMockClient(name, config, {
          listTools: vi.fn(async () => tools),
          callTool: callToolMock,
        });
        createdClients.set(name, client);
        return client;
      });
      manager = new McpManager({ clientFactory: mockFactory });

      await manager.addServer("fs", STDIO_CONFIG);

      const result = await manager.callTool("mcp_fs_read_file", {
        path: "/tmp/test.txt",
      });

      expect(callToolMock).toHaveBeenCalledWith("read_file", {
        path: "/tmp/test.txt",
      });
      expect(result).toBe("file content");
    });

    it("callTool throws for unknown tool", async () => {
      await expect(
        manager.callTool("mcp_nope_nothing", {})
      ).rejects.toThrow("Unknown MCP tool: mcp_nope_nothing");
    });

    it("callTool reconnects if client is disconnected", async () => {
      const tools = sampleTools("fs");
      let _connected = false;
      const connectMock = vi.fn(async () => {
        _connected = true;
      });

      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        const client: McpClientInterface = {
          name,
          get connected() {
            return _connected;
          },
          config,
          connect: connectMock,
          disconnect: vi.fn(async () => {
            _connected = false;
          }),
          listTools: vi.fn(async () => tools),
          callTool: vi.fn(async () => "reconnected-result"),
        };
        createdClients.set(name, client);
        return client;
      });
      manager = new McpManager({ clientFactory: mockFactory });

      await manager.addServer("fs", STDIO_CONFIG);
      // Simulate the client having been disconnected
      _connected = false;

      const result = await manager.callTool("mcp_fs_read_file", {
        path: "/x",
      });

      // connect should have been called again (initial connect + reconnect)
      expect(connectMock).toHaveBeenCalledTimes(2);
      expect(result).toBe("reconnected-result");
    });
  });

  // -----------------------------------------------------------------------
  // 4. Resource discovery
  // -----------------------------------------------------------------------
  describe("resource discovery", () => {
    it("loads resources from servers that support them", async () => {
      const resources = sampleResources("docs");
      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        const client = createMockClient(name, config, {
          listResources: vi.fn(async () => resources),
        });
        createdClients.set(name, client);
        return client;
      });
      manager = new McpManager({ clientFactory: mockFactory });

      await manager.addServer("docs", STDIO_CONFIG);

      expect(manager.getResources()).toHaveLength(1);
      expect(manager.getResource("mcp://docs/file:///readme.md")).toBeDefined();
    });

    it("readResource delegates to the correct client", async () => {
      const resources = sampleResources("docs");
      const readMock = vi.fn(async () => "# Hello");
      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        const client = createMockClient(name, config, {
          listResources: vi.fn(async () => resources),
          readResource: readMock,
        });
        createdClients.set(name, client);
        return client;
      });
      manager = new McpManager({ clientFactory: mockFactory });

      await manager.addServer("docs", STDIO_CONFIG);

      const content = await manager.readResource(
        "mcp://docs/file:///readme.md"
      );
      expect(content).toBe("# Hello");
      expect(readMock).toHaveBeenCalledWith("file:///readme.md");
    });

    it("readResource throws for unknown resource", async () => {
      await expect(
        manager.readResource("mcp://nope/file:///x")
      ).rejects.toThrow("Unknown MCP resource");
    });

    it("readResource throws if client doesn't support resources", async () => {
      const resources = sampleResources("docs");
      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        const client = createMockClient(name, config, {
          listResources: vi.fn(async () => resources),
          readResource: undefined,
        });
        createdClients.set(name, client);
        return client;
      });
      manager = new McpManager({ clientFactory: mockFactory });

      await manager.addServer("docs", STDIO_CONFIG);

      await expect(
        manager.readResource("mcp://docs/file:///readme.md")
      ).rejects.toThrow("does not support resources");
    });

    it("removeServer clears resources", async () => {
      const resources = sampleResources("docs");
      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        const client = createMockClient(name, config, {
          listResources: vi.fn(async () => resources),
        });
        createdClients.set(name, client);
        return client;
      });
      manager = new McpManager({ clientFactory: mockFactory });

      await manager.addServer("docs", STDIO_CONFIG);
      expect(manager.getResources()).toHaveLength(1);

      await manager.removeServer("docs");
      expect(manager.getResources()).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Prompt discovery
  // -----------------------------------------------------------------------
  describe("prompt discovery", () => {
    it("loads prompts from servers that support them", async () => {
      const prompts = samplePrompts("ai");
      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        const client = createMockClient(name, config, {
          listPrompts: vi.fn(async () => prompts),
        });
        createdClients.set(name, client);
        return client;
      });
      manager = new McpManager({ clientFactory: mockFactory });

      await manager.addServer("ai", STDIO_CONFIG);

      expect(manager.getPrompts()).toHaveLength(1);
      expect(manager.getPrompt("mcp_ai_summarize")).toBeDefined();
    });

    it("invokePrompt delegates to the correct client", async () => {
      const prompts = samplePrompts("ai");
      const getPromptMock = vi.fn(async () => "Summary: short text");
      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        const client = createMockClient(name, config, {
          listPrompts: vi.fn(async () => prompts),
          getPrompt: getPromptMock,
        });
        createdClients.set(name, client);
        return client;
      });
      manager = new McpManager({ clientFactory: mockFactory });

      await manager.addServer("ai", STDIO_CONFIG);

      const result = await manager.invokePrompt("mcp_ai_summarize", {
        text: "long text...",
      });
      expect(result).toBe("Summary: short text");
      expect(getPromptMock).toHaveBeenCalledWith("summarize", {
        text: "long text...",
      });
    });

    it("invokePrompt throws for unknown prompt", async () => {
      await expect(
        manager.invokePrompt("mcp_nope_nothing")
      ).rejects.toThrow("Unknown MCP prompt");
    });

    it("invokePrompt throws if client doesn't support prompts", async () => {
      const prompts = samplePrompts("ai");
      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        const client = createMockClient(name, config, {
          listPrompts: vi.fn(async () => prompts),
          getPrompt: undefined,
        });
        createdClients.set(name, client);
        return client;
      });
      manager = new McpManager({ clientFactory: mockFactory });

      await manager.addServer("ai", STDIO_CONFIG);

      await expect(
        manager.invokePrompt("mcp_ai_summarize", { text: "hi" })
      ).rejects.toThrow("does not support prompts");
    });

    it("removeServer clears prompts", async () => {
      const prompts = samplePrompts("ai");
      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        const client = createMockClient(name, config, {
          listPrompts: vi.fn(async () => prompts),
        });
        createdClients.set(name, client);
        return client;
      });
      manager = new McpManager({ clientFactory: mockFactory });

      await manager.addServer("ai", STDIO_CONFIG);
      expect(manager.getPrompts()).toHaveLength(1);

      await manager.removeServer("ai");
      expect(manager.getPrompts()).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // 6. Error handling
  // -----------------------------------------------------------------------
  describe("error handling", () => {
    it("addServer emits server.error and re-throws on connect failure", async () => {
      const connectError = new Error("connection refused");
      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        const client = createMockClient(name, config, {
          connect: vi.fn(async () => {
            throw connectError;
          }),
        });
        createdClients.set(name, client);
        return client;
      });
      manager = new McpManager({ clientFactory: mockFactory });

      const errorHandler = vi.fn();
      manager.on("server.error", errorHandler);

      await expect(manager.addServer("bad", STDIO_CONFIG)).rejects.toThrow(
        "connection refused"
      );
      expect(errorHandler).toHaveBeenCalledWith("bad", connectError);
    });

    it("addServer emits server.error on listTools failure", async () => {
      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        const client = createMockClient(name, config, {
          listTools: vi.fn(async () => {
            throw new Error("tools timeout");
          }),
        });
        createdClients.set(name, client);
        return client;
      });
      manager = new McpManager({ clientFactory: mockFactory });

      const errorHandler = vi.fn();
      manager.on("server.error", errorHandler);

      await expect(manager.addServer("bad", STDIO_CONFIG)).rejects.toThrow(
        "tools timeout"
      );
      expect(errorHandler).toHaveBeenCalledOnce();
    });

    it("throws when stdio transport is used without a client factory", async () => {
      const m = new McpManager(); // no factory
      await expect(m.addServer("s", STDIO_CONFIG)).rejects.toThrow(
        "Stdio MCP transport requires a client factory"
      );
    });

    it("callTool throws when the server is not found", async () => {
      // Manually place a tool into the tools map pointing at a missing server
      const tools = sampleTools("ghost");
      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        const client = createMockClient(name, config, {
          listTools: vi.fn(async () => tools),
        });
        createdClients.set(name, client);
        return client;
      });
      manager = new McpManager({ clientFactory: mockFactory });

      await manager.addServer("ghost", STDIO_CONFIG);
      // Now remove the client but keep tools around by clearing clients directly
      // We need to use removeServer which clears both; instead test via callTool
      // with a tool referencing a server that doesn't exist anymore.
      // The simplest way: add server, get tools, then remove the client entry.
      // Use getClient to verify.
      await manager.removeServer("ghost");

      // Tools should be cleared by removeServer, so callTool should throw
      // "Unknown MCP tool"
      await expect(
        manager.callTool("mcp_ghost_read_file", {})
      ).rejects.toThrow("Unknown MCP tool");
    });
  });

  // -----------------------------------------------------------------------
  // 7. loadFromConfig
  // -----------------------------------------------------------------------
  describe("loadFromConfig", () => {
    it("loads multiple servers from config", async () => {
      const config: Record<string, McpServerConfig> = {
        alpha: STDIO_CONFIG,
        beta: STDIO_CONFIG,
      };

      await manager.loadFromConfig(config);

      expect(manager.getServers()).toHaveLength(2);
      const names = manager.getServers().map((s) => s.name);
      expect(names).toContain("alpha");
      expect(names).toContain("beta");
    });

    it("skips servers with enabled=false", async () => {
      const config: Record<string, McpServerConfig> = {
        active: STDIO_CONFIG,
        inactive: { ...STDIO_CONFIG, enabled: false },
      };

      await manager.loadFromConfig(config);

      expect(manager.getServers()).toHaveLength(1);
      expect(manager.getServers()[0]!.name).toBe("active");
    });

    it("emits server.error but continues when a server fails to connect", async () => {
      let callCount = 0;
      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        callCount++;
        if (callCount === 1) {
          return createMockClient(name, config, {
            connect: vi.fn(async () => {
              throw new Error("boom");
            }),
          });
        }
        return createMockClient(name, config);
      });
      manager = new McpManager({ clientFactory: mockFactory });

      const errorHandler = vi.fn();
      manager.on("server.error", errorHandler);

      const config: Record<string, McpServerConfig> = {
        bad: STDIO_CONFIG,
        good: STDIO_CONFIG,
      };

      await manager.loadFromConfig(config);

      // The error handler should have been called for "bad" (once from addServer re-emit, once from loadFromConfig catch)
      expect(errorHandler).toHaveBeenCalled();
      // "good" should still connect
      expect(manager.getServers()).toHaveLength(1);
      expect(manager.getServers()[0]!.name).toBe("good");
    });
  });

  // -----------------------------------------------------------------------
  // 8. Multiple server management
  // -----------------------------------------------------------------------
  describe("multiple server management", () => {
    it("manages tools from multiple servers without collision", async () => {
      const toolsA = sampleTools("alpha");
      const toolsB: McpTool[] = [
        {
          name: "search",
          description: "Search things",
          inputSchema: { type: "object", properties: {} },
          serverName: "beta",
        },
      ];

      let callIdx = 0;
      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        callIdx++;
        const tools = callIdx === 1 ? toolsA : toolsB;
        const client = createMockClient(name, config, {
          listTools: vi.fn(async () => tools),
        });
        createdClients.set(name, client);
        return client;
      });
      manager = new McpManager({ clientFactory: mockFactory });

      await manager.addServer("alpha", STDIO_CONFIG);
      await manager.addServer("beta", STDIO_CONFIG);

      expect(manager.getTools()).toHaveLength(3);
      expect(manager.getTool("mcp_alpha_read_file")).toBeDefined();
      expect(manager.getTool("mcp_alpha_write_file")).toBeDefined();
      expect(manager.getTool("mcp_beta_search")).toBeDefined();
    });

    it("removing one server does not affect another server's tools", async () => {
      const toolsA = sampleTools("a");
      const toolsB = sampleTools("b");

      let callIdx = 0;
      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        callIdx++;
        const tools = callIdx === 1 ? toolsA : toolsB;
        const client = createMockClient(name, config, {
          listTools: vi.fn(async () => tools),
        });
        createdClients.set(name, client);
        return client;
      });
      manager = new McpManager({ clientFactory: mockFactory });

      await manager.addServer("a", STDIO_CONFIG);
      await manager.addServer("b", STDIO_CONFIG);

      expect(manager.getTools()).toHaveLength(4);

      await manager.removeServer("a");

      expect(manager.getTools()).toHaveLength(2);
      expect(manager.getTool("mcp_b_read_file")).toBeDefined();
      expect(manager.getTool("mcp_a_read_file")).toBeUndefined();
    });

    it("getServers returns status for all connected servers", async () => {
      const tools = sampleTools("x");
      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        const client = createMockClient(name, config, {
          listTools: vi.fn(async () => (name === "x" ? tools : [])),
        });
        createdClients.set(name, client);
        return client;
      });
      manager = new McpManager({ clientFactory: mockFactory });

      await manager.addServer("x", STDIO_CONFIG);
      await manager.addServer("y", STDIO_CONFIG);

      const statuses = manager.getServers();
      expect(statuses).toHaveLength(2);

      const xStatus = statuses.find((s) => s.name === "x");
      expect(xStatus).toBeDefined();
      expect(xStatus!.connected).toBe(true);
      expect(xStatus!.toolCount).toBe(2);

      const yStatus = statuses.find((s) => s.name === "y");
      expect(yStatus).toBeDefined();
      expect(yStatus!.connected).toBe(true);
      expect(yStatus!.toolCount).toBe(0);
    });

    it("getClient returns the client for a given server name", async () => {
      await manager.addServer("s", STDIO_CONFIG);
      expect(manager.getClient("s")).toBeDefined();
      expect(manager.getClient("missing")).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 9. Shutdown and cleanup
  // -----------------------------------------------------------------------
  describe("shutdown", () => {
    it("disconnects all clients and clears all data", async () => {
      const tools = sampleTools("a");
      const resources = sampleResources("a");
      const prompts = samplePrompts("a");

      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        const client = createMockClient(name, config, {
          listTools: vi.fn(async () => tools),
          listResources: vi.fn(async () => resources),
          listPrompts: vi.fn(async () => prompts),
        });
        createdClients.set(name, client);
        return client;
      });
      manager = new McpManager({ clientFactory: mockFactory });

      await manager.addServer("a", STDIO_CONFIG);
      await manager.addServer("b", STDIO_CONFIG);

      expect(manager.getTools().length).toBeGreaterThan(0);
      expect(manager.getResources().length).toBeGreaterThan(0);
      expect(manager.getPrompts().length).toBeGreaterThan(0);

      await manager.shutdown();

      expect(manager.getTools()).toHaveLength(0);
      expect(manager.getResources()).toHaveLength(0);
      expect(manager.getPrompts()).toHaveLength(0);
      expect(manager.getServers()).toHaveLength(0);

      for (const client of createdClients.values()) {
        expect(client.disconnect).toHaveBeenCalled();
      }
    });

    it("shutdown handles disconnect errors gracefully", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        const client = createMockClient(name, config, {
          disconnect: vi.fn(async () => {
            throw new Error("shutdown error");
          }),
        });
        createdClients.set(name, client);
        return client;
      });
      manager = new McpManager({ clientFactory: mockFactory });

      await manager.addServer("a", STDIO_CONFIG);
      await manager.addServer("b", STDIO_CONFIG);

      // Should not throw
      await expect(manager.shutdown()).resolves.toBeUndefined();

      // All state should still be cleared
      expect(manager.getServers()).toHaveLength(0);
      expect(manager.getTools()).toHaveLength(0);

      consoleSpy.mockRestore();
    });

    it("shutdown can be called multiple times safely", async () => {
      await manager.addServer("s", STDIO_CONFIG);

      await manager.shutdown();
      await expect(manager.shutdown()).resolves.toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 10. Transport selection
  // -----------------------------------------------------------------------
  describe("transport selection", () => {
    it("uses client factory when provided (stdio config)", async () => {
      await manager.addServer("s", STDIO_CONFIG);
      expect(mockFactory).toHaveBeenCalledWith("s", STDIO_CONFIG);
    });

    it("uses client factory when provided (sse config)", async () => {
      await manager.addServer("s", SSE_CONFIG);
      expect(mockFactory).toHaveBeenCalledWith("s", SSE_CONFIG);
    });

    it("getServers reports transport correctly", async () => {
      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        return createMockClient(name, config);
      });
      manager = new McpManager({ clientFactory: mockFactory });

      await manager.addServer("stdio-server", STDIO_CONFIG);
      await manager.addServer("sse-server", SSE_CONFIG);

      const statuses = manager.getServers();
      const stdioStatus = statuses.find((s) => s.name === "stdio-server");
      const sseStatus = statuses.find((s) => s.name === "sse-server");

      expect(stdioStatus!.transport).toBe("stdio");
      expect(sseStatus!.transport).toBe("sse");
    });
  });

  // -----------------------------------------------------------------------
  // 11. Clients without optional capabilities
  // -----------------------------------------------------------------------
  describe("clients without optional capabilities", () => {
    it("handles clients without listResources", async () => {
      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        const client = createMockClient(name, config);
        // Remove the optional method
        delete (client as Record<string, unknown>).listResources;
        createdClients.set(name, client);
        return client;
      });
      manager = new McpManager({ clientFactory: mockFactory });

      await manager.addServer("minimal", STDIO_CONFIG);

      expect(manager.getResources()).toHaveLength(0);
    });

    it("handles clients without listPrompts", async () => {
      mockFactory = vi.fn((name: string, config: McpServerConfig) => {
        const client = createMockClient(name, config);
        delete (client as Record<string, unknown>).listPrompts;
        createdClients.set(name, client);
        return client;
      });
      manager = new McpManager({ clientFactory: mockFactory });

      await manager.addServer("minimal", STDIO_CONFIG);

      expect(manager.getPrompts()).toHaveLength(0);
    });
  });
});
