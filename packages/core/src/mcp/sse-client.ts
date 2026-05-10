import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { McpClientInterface, McpSseConfig, McpTool, McpResource, McpPrompt } from "./types.js";

export class SseMcpClient implements McpClientInterface {
  readonly name: string;
  readonly config: McpSseConfig;
  private client: Client | null = null;
  private transport: SSEClientTransport | null = null;
  private _connected = false;
  private tools: McpTool[] = [];
  private resources: McpResource[] = [];
  private prompts: McpPrompt[] = [];

  constructor(name: string, config: McpSseConfig) {
    this.name = name;
    this.config = config;
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    if (this._connected) return;

    const headers: Record<string, string> = {
      ...this.config.headers,
    };

    this.transport = new SSEClientTransport(new URL(this.config.url), {
      requestInit: {
        headers,
      },
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

  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.client) {
      throw new Error(`MCP client not connected: ${this.name}`);
    }

    const result = await this.client.callTool({ name, arguments: args });

    const content = result.content as Array<{ type: string; text?: string }>;

    if (result.isError) {
      const errorContent = content.find((c) => c.type === "text");
      throw new Error(
        errorContent && "text" in errorContent
          ? errorContent.text
          : "Tool call failed"
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
