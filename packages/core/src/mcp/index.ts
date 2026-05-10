export { McpManager } from "./manager.js";
export type { McpManagerOptions, McpManagerEvents } from "./manager.js";
export { SseMcpClient } from "./sse-client.js";
export {
  registerMcpTools,
  unregisterMcpTools,
  registerMcpResourcesAndPrompts,
  unregisterMcpResourcesAndPrompts,
  createMcpToolDefinition,
} from "./adapter.js";
export {
  McpStdioConfigSchema,
  McpSseConfigSchema,
  McpServerConfigSchema,
  McpOAuthConfigSchema,
  expandEnvVars,
  defaultEnvResolver,
  type McpClientInterface,
  type McpClientFactory,
  type McpServerConfig,
  type McpStdioConfig,
  type McpSseConfig,
  type McpOAuthConfig,
  type McpTool,
  type McpResource,
  type McpPrompt,
  type McpServerStatus,
  type EnvResolver,
} from "./types.js";

// Note: StdioMcpClient is no longer exported from core.
// For stdio MCP transport, use @openmgr/agent-mcp-stdio or @openmgr/agent-node.
