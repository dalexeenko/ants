import { z } from "zod";

export const McpStdioConfigSchema = z.object({
  transport: z.literal("stdio").optional().default("stdio"),
  command: z.string(),
  args: z.array(z.string()).optional().default([]),
  env: z.record(z.string()).optional(),
  enabled: z.boolean().optional().default(true),
  timeout: z.number().optional().default(30000),
});

export const McpOAuthConfigSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string().optional(),
  authorizationUrl: z.string(),
  tokenUrl: z.string(),
  scopes: z.array(z.string()).optional(),
});

export const McpSseConfigSchema = z.object({
  transport: z.literal("sse"),
  url: z.string(),
  headers: z.record(z.string()).optional(),
  oauth: McpOAuthConfigSchema.optional(),
  enabled: z.boolean().optional().default(true),
  timeout: z.number().optional().default(30000),
});

export const McpServerConfigSchema = z.discriminatedUnion("transport", [
  McpStdioConfigSchema,
  McpSseConfigSchema,
]);

export type McpStdioConfig = z.infer<typeof McpStdioConfigSchema>;
export type McpSseConfig = z.infer<typeof McpSseConfigSchema>;
export type McpOAuthConfig = z.infer<typeof McpOAuthConfigSchema>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverName: string;
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  serverName: string;
}

export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
  serverName: string;
}

export interface McpClientInterface {
  readonly name: string;
  readonly connected: boolean;
  readonly config: McpServerConfig;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  listResources?(): Promise<McpResource[]>;
  readResource?(uri: string): Promise<string>;
  listPrompts?(): Promise<McpPrompt[]>;
  getPrompt?(name: string, args?: Record<string, string>): Promise<string>;
}

export interface McpServerStatus {
  name: string;
  connected: boolean;
  toolCount: number;
  transport: "stdio" | "sse";
  error?: string;
}

/**
 * Factory function type for creating MCP clients.
 * This allows different implementations to be injected (e.g., stdio for Node.js, different for React Native).
 */
export type McpClientFactory = (
  name: string,
  config: McpServerConfig
) => McpClientInterface;

/**
 * Environment variable resolver function type
 */
export type EnvResolver = (varName: string) => string | undefined;

/**
 * Default environment resolver - returns undefined.
 * In React Native or browser environments, provide a custom resolver.
 * For Node.js environments, use the resolver from @openmgr/agent-mcp-stdio.
 */
export const defaultEnvResolver: EnvResolver = (_varName: string) => {
  // Default implementation returns undefined - it's up to the platform-specific
  // packages to provide actual environment variable resolution
  return undefined;
};

/**
 * Expand environment variables in a record of strings
 * @param env - Record of environment variables with ${VAR} placeholders
 * @param resolver - Function to resolve environment variable names to values
 */
export function expandEnvVars(
  env: Record<string, string> | undefined,
  resolver: EnvResolver = defaultEnvResolver
): Record<string, string> | undefined {
  if (!env) return undefined;

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    result[key] = value.replace(/\$\{(\w+)\}/g, (_, varName) => {
      return resolver(varName) ?? "";
    });
  }
  return result;
}
