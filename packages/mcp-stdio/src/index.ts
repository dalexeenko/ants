/**
 * @openmgr/agent-mcp-stdio
 *
 * Stdio MCP (Model Context Protocol) client for OpenMgr Agent.
 * This package provides the Node.js-specific stdio transport for MCP servers.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  McpClientInterface,
  McpStdioConfig,
  McpTool,
  McpResource,
  McpPrompt,
  EnvResolver,
} from "@openmgr/agent-core";
import { expandEnvVars, defaultEnvResolver } from "@openmgr/agent-core";

export class StdioMcpClient implements McpClientInterface {
  readonly name: string;
  readonly config: McpStdioConfig;
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private _connected = false;
  private tools: McpTool[] = [];
  private resources: McpResource[] = [];
  private prompts: McpPrompt[] = [];
  private envResolver: EnvResolver;

  constructor(name: string, config: McpStdioConfig, envResolver: EnvResolver = defaultEnvResolver) {
    this.name = name;
    this.config = config;
    this.envResolver = envResolver;
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    if (this._connected) return;

    // Build environment from process.env + config.env
    const env: Record<string, string> = {};

    // Copy current environment (Node.js specific)
    if (typeof process !== "undefined" && process.env) {
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
          env[key] = value;
        }
      }
    }

    // Expand and merge config env
    const expandedEnv = expandEnvVars(this.config.env, this.envResolver);
    if (expandedEnv) {
      Object.assign(env, expandedEnv);
    }

    this.transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args ?? [],
      env,
    });

    this.client = new Client(
      {
        name: "openmgr-agent",
        version: "0.1.0",
      },
      {
        capabilities: {},
      }
    );

    await this.client.connect(this.transport);
    this._connected = true;

    await this.refreshTools();
    await this.refreshResources();
    await this.refreshPrompts();
  }

  async disconnect(): Promise<void> {
    if (!this._connected) return;

    if (this.client) {
      await this.client.close();
      this.client = null;
    }

    this.transport = null;
    this._connected = false;
    this.tools = [];
    this.resources = [];
    this.prompts = [];
  }

  private async refreshTools(): Promise<void> {
    if (!this.client) return;

    try {
      const result = await this.client.listTools();
      this.tools = result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
        inputSchema: tool.inputSchema as Record<string, unknown>,
        serverName: this.name,
      }));
    } catch {
      this.tools = [];
    }
  }

  private async refreshResources(): Promise<void> {
    if (!this.client) return;

    try {
      const result = await this.client.listResources();
      this.resources = result.resources.map((resource) => ({
        uri: resource.uri,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
        serverName: this.name,
      }));
    } catch {
      // Server may not support resources
      this.resources = [];
    }
  }

  private async refreshPrompts(): Promise<void> {
    if (!this.client) return;

    try {
      const result = await this.client.listPrompts();
      this.prompts = result.prompts.map((prompt) => ({
        name: prompt.name,
        description: prompt.description,
        arguments: prompt.arguments?.map((arg) => ({
          name: arg.name,
          description: arg.description,
          required: arg.required,
        })),
        serverName: this.name,
      }));
    } catch {
      // Server may not support prompts
      this.prompts = [];
    }
  }

  async listTools(): Promise<McpTool[]> {
    if (!this._connected) {
      await this.connect();
    }
    return this.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) {
      throw new Error(`MCP client not connected: ${this.name}`);
    }

    const result = await this.client.callTool({ name, arguments: args });

    const content = result.content as Array<{ type: string; text?: string }>;

    if (result.isError) {
      const errorContent = content.find((c) => c.type === "text");
      throw new Error(
        errorContent && "text" in errorContent ? errorContent.text : "Tool call failed"
      );
    }

    const textContent = content.find((c) => c.type === "text");
    if (textContent && "text" in textContent) {
      return textContent.text;
    }

    return content;
  }

  async listResources(): Promise<McpResource[]> {
    if (!this._connected) {
      await this.connect();
    }
    return this.resources;
  }

  async readResource(uri: string): Promise<string> {
    if (!this.client) {
      throw new Error(`MCP client not connected: ${this.name}`);
    }

    const result = await this.client.readResource({ uri });
    const contents = result.contents;

    if (contents.length === 0) {
      return "";
    }

    // Handle different content types
    const content = contents[0]!;
    if ("text" in content) {
      return content.text;
    } else if ("blob" in content) {
      // Base64 encoded binary data
      return content.blob;
    }

    return JSON.stringify(content);
  }

  async listPrompts(): Promise<McpPrompt[]> {
    if (!this._connected) {
      await this.connect();
    }
    return this.prompts;
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<string> {
    if (!this.client) {
      throw new Error(`MCP client not connected: ${this.name}`);
    }

    const result = await this.client.getPrompt({ name, arguments: args });
    const messages = result.messages;

    // Convert messages to a string representation
    return messages
      .map((msg) => {
        const role = msg.role;
        const content = msg.content;
        if (typeof content === "string") {
          return `[${role}]: ${content}`;
        } else if (content.type === "text") {
          return `[${role}]: ${content.text}`;
        } else if (content.type === "image") {
          return `[${role}]: [Image: ${content.mimeType}]`;
        } else if (content.type === "resource") {
          return `[${role}]: [Resource: ${content.resource.uri}]`;
        }
        return `[${role}]: ${JSON.stringify(content)}`;
      })
      .join("\n\n");
  }
}

// Re-export types for convenience
export type { McpClientInterface, McpStdioConfig, McpTool, McpResource, McpPrompt, EnvResolver };
