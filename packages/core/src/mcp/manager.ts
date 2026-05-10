import { EventEmitter } from "eventemitter3";
import type {
  McpClientInterface,
  McpServerConfig,
  McpSseConfig,
  McpTool,
  McpResource,
  McpPrompt,
  McpServerStatus,
  McpClientFactory,
} from "./types.js";
import { SseMcpClient } from "./sse-client.js";

export interface McpManagerEvents {
  "server.connected": (serverName: string, toolCount: number) => void;
  "server.disconnected": (serverName: string, reason?: string) => void;
  "server.error": (serverName: string, error: Error) => void;
}

export interface McpManagerOptions {
  /**
   * Optional client factory for creating MCP clients.
   * If provided, this will be used to create clients for all transports.
   * If not provided, only SSE transport is supported (stdio requires the factory).
   */
  clientFactory?: McpClientFactory;
}

export class McpManager extends EventEmitter<McpManagerEvents> {
  private clients: Map<string, McpClientInterface> = new Map();
  private tools: Map<string, McpTool> = new Map();
  private resources: Map<string, McpResource> = new Map();
  private prompts: Map<string, McpPrompt> = new Map();
  private clientFactory?: McpClientFactory;

  constructor(options: McpManagerOptions = {}) {
    super();
    this.clientFactory = options.clientFactory;
  }

  async loadFromConfig(
    mcpConfig: Record<string, McpServerConfig>
  ): Promise<void> {
    for (const [name, config] of Object.entries(mcpConfig)) {
      if (config.enabled === false) continue;

      try {
        await this.addServer(name, config);
      } catch (err) {
        this.emit("server.error", name, err as Error);
      }
    }
  }

  async addServer(name: string, config: McpServerConfig): Promise<void> {
    if (this.clients.has(name)) {
      await this.removeServer(name);
    }

    let client: McpClientInterface;

    // If a client factory is provided, use it for all transports
    if (this.clientFactory) {
      client = this.clientFactory(name, config);
    } else if (config.transport === "sse") {
      // Built-in SSE support (works in all environments)
      client = new SseMcpClient(name, config as McpSseConfig);
    } else {
      // Stdio transport requires a client factory (Node.js-specific)
      throw new Error(
        `Stdio MCP transport requires a client factory. ` +
        `Use McpManager with a clientFactory option, or use @openmgr/agent-node which provides one.`
      );
    }

    try {
      await client.connect();

      this.clients.set(name, client);

      const serverTools = await client.listTools();
      for (const tool of serverTools) {
        const fullName = `mcp_${name}_${tool.name}`;
        this.tools.set(fullName, { ...tool, name: fullName });
      }

      // Load resources if supported
      if (client.listResources) {
        const serverResources = await client.listResources();
        for (const resource of serverResources) {
          const fullUri = `mcp://${name}/${resource.uri}`;
          this.resources.set(fullUri, { ...resource, serverName: name });
        }
      }

      // Load prompts if supported
      if (client.listPrompts) {
        const serverPrompts = await client.listPrompts();
        for (const prompt of serverPrompts) {
          const fullName = `mcp_${name}_${prompt.name}`;
          this.prompts.set(fullName, { ...prompt, name: fullName, serverName: name });
        }
      }

      this.emit("server.connected", name, serverTools.length);
    } catch (err) {
      this.emit("server.error", name, err as Error);
      throw err;
    }
  }

  async removeServer(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (!client) return;

    try {
      await client.disconnect();
    } catch {
      // Ignore disconnect errors - server may already be disconnected
    }

    this.clients.delete(name);

    for (const [fullName, tool] of this.tools) {
      if (tool.serverName === name) {
        this.tools.delete(fullName);
      }
    }

    for (const [fullUri, resource] of this.resources) {
      if (resource.serverName === name) {
        this.resources.delete(fullUri);
      }
    }

    for (const [fullName, prompt] of this.prompts) {
      if (prompt.serverName === name) {
        this.prompts.delete(fullName);
      }
    }

    this.emit("server.disconnected", name);
  }

  getTools(): McpTool[] {
    return Array.from(this.tools.values());
  }

  getTool(fullName: string): McpTool | undefined {
    return this.tools.get(fullName);
  }

  getServers(): McpServerStatus[] {
    const statuses: McpServerStatus[] = [];

    for (const [name, client] of this.clients) {
      const toolCount = Array.from(this.tools.values()).filter(
        (t) => t.serverName === name
      ).length;

      statuses.push({
        name,
        connected: client.connected,
        toolCount,
        transport: client.config.transport ?? "stdio",
      });
    }

    return statuses;
  }

  getClient(name: string): McpClientInterface | undefined {
    return this.clients.get(name);
  }

  async callTool(
    fullName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const tool = this.tools.get(fullName);
    if (!tool) {
      throw new Error(`Unknown MCP tool: ${fullName}`);
    }

    const client = this.clients.get(tool.serverName);
    if (!client) {
      throw new Error(`MCP server not found: ${tool.serverName}`);
    }

    if (!client.connected) {
      await client.connect();
    }

    const originalName = fullName.replace(`mcp_${tool.serverName}_`, "");
    return client.callTool(originalName, args);
  }

  // Resource methods
  getResources(): McpResource[] {
    return Array.from(this.resources.values());
  }

  getResource(fullUri: string): McpResource | undefined {
    return this.resources.get(fullUri);
  }

  async readResource(fullUri: string): Promise<string> {
    const resource = this.resources.get(fullUri);
    if (!resource) {
      throw new Error(`Unknown MCP resource: ${fullUri}`);
    }

    const client = this.clients.get(resource.serverName);
    if (!client) {
      throw new Error(`MCP server not found: ${resource.serverName}`);
    }

    if (!client.readResource) {
      throw new Error(`MCP server ${resource.serverName} does not support resources`);
    }

    if (!client.connected) {
      await client.connect();
    }

    return client.readResource(resource.uri);
  }

  // Prompt methods
  getPrompts(): McpPrompt[] {
    return Array.from(this.prompts.values());
  }

  getPrompt(fullName: string): McpPrompt | undefined {
    return this.prompts.get(fullName);
  }

  async invokePrompt(fullName: string, args?: Record<string, string>): Promise<string> {
    const prompt = this.prompts.get(fullName);
    if (!prompt) {
      throw new Error(`Unknown MCP prompt: ${fullName}`);
    }

    const client = this.clients.get(prompt.serverName);
    if (!client) {
      throw new Error(`MCP server not found: ${prompt.serverName}`);
    }

    if (!client.getPrompt) {
      throw new Error(`MCP server ${prompt.serverName} does not support prompts`);
    }

    if (!client.connected) {
      await client.connect();
    }

    const originalName = fullName.replace(`mcp_${prompt.serverName}_`, "");
    return client.getPrompt(originalName, args);
  }

  async shutdown(): Promise<void> {
    const disconnectPromises: Promise<void>[] = [];

    for (const [name, client] of this.clients) {
      disconnectPromises.push(
        client.disconnect().catch((err) => {
          console.error(`Error disconnecting MCP server ${name}:`, err);
        })
      );
    }

    await Promise.all(disconnectPromises);
    this.clients.clear();
    this.tools.clear();
    this.resources.clear();
    this.prompts.clear();
  }
}
