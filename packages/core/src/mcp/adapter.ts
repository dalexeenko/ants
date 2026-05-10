import { z } from "zod";
import { toolRegistry as globalToolRegistry, type ToolRegistry } from "../registry/tools.js";
import type { McpManager } from "./manager.js";
import type { McpTool, McpPrompt } from "./types.js";
import type { ToolDefinition, ToolContext, ToolExecuteResult } from "../types.js";

function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType {
  const type = schema.type as string | undefined;
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const required = schema.required as string[] | undefined;

  if (type === "object" && properties) {
    const shape: Record<string, z.ZodType> = {};

    for (const [key, propSchema] of Object.entries(properties)) {
      let fieldSchema: z.ZodType;

      switch (propSchema.type) {
        case "string":
          fieldSchema = z.string();
          break;
        case "number":
          fieldSchema = z.number();
          break;
        case "integer":
          fieldSchema = z.number().int();
          break;
        case "boolean":
          fieldSchema = z.boolean();
          break;
        case "array":
          fieldSchema = z.array(z.unknown());
          break;
        case "object":
          fieldSchema = z.record(z.unknown());
          break;
        default:
          fieldSchema = z.unknown();
      }

      if (propSchema.description) {
        fieldSchema = fieldSchema.describe(propSchema.description as string);
      }

      if (!required?.includes(key)) {
        fieldSchema = fieldSchema.optional();
      }

      shape[key] = fieldSchema;
    }

    return z.object(shape);
  }

  return z.record(z.unknown());
}

export function createMcpToolDefinition(
  tool: McpTool,
  manager: McpManager
): ToolDefinition {
  const parameters = jsonSchemaToZod(tool.inputSchema);

  return {
    name: tool.name,
    description: tool.description,
    parameters,
    execute: async (
      params: unknown,
      _ctx: ToolContext
    ): Promise<ToolExecuteResult> => {
      try {
        const result = await manager.callTool(
          tool.name,
          params as Record<string, unknown>
        );

        const output =
          typeof result === "string" ? result : JSON.stringify(result, null, 2);

        return { output };
      } catch (err) {
        return {
          output: `Error: ${(err as Error).message}`,
          metadata: { error: true },
        };
      }
    },
  };
}

export function registerMcpTools(manager: McpManager, registry?: ToolRegistry): void {
  const reg = registry ?? globalToolRegistry;
  const tools = manager.getTools();

  for (const tool of tools) {
    const definition = createMcpToolDefinition(tool, manager);
    reg.register(definition);
  }
}

export function unregisterMcpTools(manager: McpManager, registry?: ToolRegistry): void {
  const reg = registry ?? globalToolRegistry;
  const tools = manager.getTools();

  for (const tool of tools) {
    reg.unregister(tool.name);
  }
}

/**
 * Create a tool definition for reading MCP resources
 */
export function createMcpResourceTool(manager: McpManager): ToolDefinition {
  return {
    name: "mcp_read_resource",
    description: `Read a resource from an MCP server. Use mcp_list_resources first to see available resources.`,
    parameters: z.object({
      uri: z.string().describe("The full resource URI (e.g., mcp://server-name/resource-uri)"),
    }),
    execute: async (
      params: unknown,
      _ctx: ToolContext
    ): Promise<ToolExecuteResult> => {
      const { uri } = params as { uri: string };
      
      try {
        const content = await manager.readResource(uri);
        return { output: content };
      } catch (err) {
        return {
          output: `Error reading resource: ${(err as Error).message}`,
          metadata: { error: true },
        };
      }
    },
  };
}

/**
 * Create a tool definition for listing MCP resources
 */
export function createMcpListResourcesTool(manager: McpManager): ToolDefinition {
  return {
    name: "mcp_list_resources",
    description: "List all available resources from connected MCP servers",
    parameters: z.object({
      server: z.string().optional().describe("Filter by server name (optional)"),
    }),
    execute: async (
      params: unknown,
      _ctx: ToolContext
    ): Promise<ToolExecuteResult> => {
      const { server } = params as { server?: string };
      
      let resources = manager.getResources();
      
      if (server) {
        resources = resources.filter(r => r.serverName === server);
      }
      
      if (resources.length === 0) {
        return { output: "No resources available from connected MCP servers." };
      }
      
      const output = resources
        .map(r => {
          const lines = [`URI: mcp://${r.serverName}/${r.uri}`];
          lines.push(`  Name: ${r.name}`);
          if (r.description) lines.push(`  Description: ${r.description}`);
          if (r.mimeType) lines.push(`  MIME Type: ${r.mimeType}`);
          lines.push(`  Server: ${r.serverName}`);
          return lines.join("\n");
        })
        .join("\n\n");
      
      return { output };
    },
  };
}

/**
 * Create a tool definition for a specific MCP prompt
 */
export function createMcpPromptToolDefinition(
  prompt: McpPrompt,
  manager: McpManager
): ToolDefinition {
  // Build parameter schema from prompt arguments
  const shape: Record<string, z.ZodType> = {};
  
  if (prompt.arguments) {
    for (const arg of prompt.arguments) {
      let field: z.ZodType = z.string();
      if (arg.description) {
        field = field.describe(arg.description);
      }
      if (!arg.required) {
        field = field.optional();
      }
      shape[arg.name] = field;
    }
  }
  
  const parameters = Object.keys(shape).length > 0 
    ? z.object(shape)
    : z.object({});

  return {
    name: prompt.name,
    description: prompt.description ?? `Invoke the ${prompt.name} prompt template`,
    parameters,
    execute: async (
      params: unknown,
      _ctx: ToolContext
    ): Promise<ToolExecuteResult> => {
      try {
        const result = await manager.invokePrompt(
          prompt.name,
          params as Record<string, string>
        );
        return { output: result };
      } catch (err) {
        return {
          output: `Error invoking prompt: ${(err as Error).message}`,
          metadata: { error: true },
        };
      }
    },
  };
}

/**
 * Create a tool definition for listing MCP prompts
 */
export function createMcpListPromptsTool(manager: McpManager): ToolDefinition {
  return {
    name: "mcp_list_prompts",
    description: "List all available prompt templates from connected MCP servers",
    parameters: z.object({
      server: z.string().optional().describe("Filter by server name (optional)"),
    }),
    execute: async (
      params: unknown,
      _ctx: ToolContext
    ): Promise<ToolExecuteResult> => {
      const { server } = params as { server?: string };
      
      let prompts = manager.getPrompts();
      
      if (server) {
        prompts = prompts.filter(p => p.serverName === server);
      }
      
      if (prompts.length === 0) {
        return { output: "No prompts available from connected MCP servers." };
      }
      
      const output = prompts
        .map(p => {
          const lines = [`Prompt: ${p.name}`];
          if (p.description) lines.push(`  Description: ${p.description}`);
          lines.push(`  Server: ${p.serverName}`);
          if (p.arguments && p.arguments.length > 0) {
            lines.push(`  Arguments:`);
            for (const arg of p.arguments) {
              const required = arg.required ? " (required)" : " (optional)";
              lines.push(`    - ${arg.name}${required}${arg.description ? `: ${arg.description}` : ""}`);
            }
          }
          return lines.join("\n");
        })
        .join("\n\n");
      
      return { output };
    },
  };
}

/**
 * Register all MCP resources and prompts as tools
 */
export function registerMcpResourcesAndPrompts(manager: McpManager, registry?: ToolRegistry): void {
  const reg = registry ?? globalToolRegistry;

  // Register resource tools
  const resources = manager.getResources();
  if (resources.length > 0) {
    reg.register(createMcpListResourcesTool(manager));
    reg.register(createMcpResourceTool(manager));
  }
  
  // Register prompt tools
  const prompts = manager.getPrompts();
  if (prompts.length > 0) {
    reg.register(createMcpListPromptsTool(manager));
    
    // Register each prompt as its own tool
    for (const prompt of prompts) {
      const definition = createMcpPromptToolDefinition(prompt, manager);
      reg.register(definition);
    }
  }
}

/**
 * Unregister all MCP resources and prompts
 */
export function unregisterMcpResourcesAndPrompts(manager: McpManager, registry?: ToolRegistry): void {
  const reg = registry ?? globalToolRegistry;

  const resources = manager.getResources();
  if (resources.length > 0) {
    reg.unregister("mcp_list_resources");
    reg.unregister("mcp_read_resource");
  }
  
  const prompts = manager.getPrompts();
  if (prompts.length > 0) {
    reg.unregister("mcp_list_prompts");
    
    for (const prompt of prompts) {
      reg.unregister(prompt.name);
    }
  }
}
