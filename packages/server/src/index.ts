import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AgentPlugin, Message, AgentEvent, ConversationTree, QuestionResponse, PermissionResponse, ToolResult, InstalledPluginInfo } from "@ants/agent-core";
import type { PluginManager } from "@ants/agent-core";
import type { SessionManager, ToolCallData, ToolResultData, SearchSessionsOptions, SearchMessagesOptions, MessageRow } from "@ants/agent-storage";

import type { RouteContext, SessionState } from "./routes/types.js";
import { toAgentMessages } from "./routes/types.js";
import { createHealthRoutes } from "./routes/health.js";
import { createConversationRoutes } from "./routes/conversations.js";
import { createSessionRoutes } from "./routes/sessions.js";
import { createPromptingRoutes } from "./routes/prompting.js";
import { createInteractionRoutes } from "./routes/interactions.js";
import { createSearchRoutes } from "./routes/search.js";
import { createPluginRoutes } from "./routes/plugins.js";
import { createToolRoutes } from "./routes/tools.js";
import { createProviderRoutes } from "./routes/providers.js";
import { createAgentTypeRoutes } from "./routes/agent-types.js";
import { createBrowserRoutes } from "./routes/browsers.js";
import { createScreencastWSS, isScreencastUrl } from "./routes/screencast.js";
import { createPermissionConfigRoutes } from "./routes/permission-config.js";
import { createUsageRoutes } from "./routes/usage.js";
import { createMcpRoutes } from "./routes/mcp.js";
import { createFileWatchRoutes } from "./routes/file-watch.js";

/**
 * Server configuration options.
 */
export interface ServerConfig {
  /** Port to listen on. Default: 3000 */
  port?: number;
  /** Hostname to bind to. Default: localhost */
  hostname?: string;
  /** Enable CORS. Default: true */
  cors?: boolean;
  /** CORS allowed origins. Default: * */
  corsOrigins?: string | string[];
}

/**
 * Tool information returned by the tools endpoint.
 */
export interface ToolInfo {
  name: string;
  description: string;
  available: boolean;
}

export interface ServerAgent {
  emit(event: "event", data: AgentEvent): boolean;
  on(event: "event", handler: (data: AgentEvent) => void): void;
  off(event: "event", handler: (data: AgentEvent) => void): void;
  getConfig(): { provider: string; model: string; workingDirectory?: string };
  setExtension(key: string, value: unknown): void;
  getExtension<T>(key: string): T | undefined;
  
  // Methods for prompting
  prompt(message: string): Promise<Message>;
  abort(): void;
  
  // Message history
  getMessages(): Message[];
  setMessages(messages: Message[]): void;
  clearMessages(): void;
  
  // Provider methods
  getAvailableProviders(): string[];
  
  // Tool methods (optional - for listing available tools)
  getTools?(): Array<{ name: string; description?: string }>;
  
  // Conversation tree (optional - for branching support)
  getConversationTree?(): ConversationTree | undefined;
  
  // Question system (optional - for interactive user input)
  respondToQuestion?(questionId: string, response: QuestionResponse): void;
  hasPendingQuestion?(questionId: string): boolean;

  // Permission system (optional - for tool permission requests from remote clients)
  setPermissionRequestCallback?(callback: ((toolCall: { id: string; name: string; arguments: Record<string, unknown> }) => Promise<PermissionResponse>) | null): void;

  // Session context (optional - used by plugins like storagePlugin for title generation)
  setSessionContext?(context: { sessionId: string; sessionManager: unknown }): void;

  // Plugin management
  use?(plugin: AgentPlugin): Promise<void>;
  unuse?(pluginName: string): Promise<void>;
  getPluginNames?(): string[];

  // Agent mode (Plan / Build)
  getMode?(): string;
  setMode?(mode: string): void;

  // Todos and Phases
  getTodos?(): Array<{ id: string; content: string; status: string; priority: string }>;
  getPhases?(): Array<{ id: string; content: string; status: string }>;

  // Browser controller access (for screencast streaming)
  getBrowserController?(): import("@ants/agent-browser-core").BrowserController | undefined;

  // Agent types (subagent presets)
  getAgentTypes?(): Array<{
    name: string;
    version?: string;
    description: string;
    systemPrompt?: string;
    model?: string;
    provider?: string;
    allowedTools?: string[];
    deniedTools?: string[];
    maxIterations?: number;
    tokenBudget?: number;
    temperature?: number;
    tags?: string[];
    enabled: boolean;
    source: string;
    integrity?: string;
  }>;
  getAgentTypeConflicts?(): Array<{
    name: string;
    kept: { name: string; description: string; source?: string; integrity?: string };
    replaced: { name: string; description: string; source?: string; integrity?: string };
  }>;
  setAgentTypeEnabled?(name: string, enabled: boolean): boolean;

  // Permission config (optional - for getting/updating tool permission configuration)
  getPermissionConfig?(): { defaultMode?: string; alwaysAllow?: string[]; alwaysDeny?: string[]; allowAll?: boolean };
  updatePermissionConfig?(config: { defaultMode?: string; alwaysAllow?: string[]; alwaysDeny?: string[]; allowAll?: boolean }): void;

  // Disabled tools (optional - for managing which tools are disabled)
  getDisabledTools?(): string[];
  setDisabledTools?(tools: string[]): void;

  // Token usage (optional - for reporting usage statistics)
  getUsageTracker?(): { hydrate(sessionId: string, model: string, provider: string, usage: { promptTokens: number; completionTokens: number; totalTokens: number; cacheCreationInputTokens?: number; cacheReadInputTokens?: number; estimatedCost: number; requestCount: number }, parentSessionId?: string): void };
  getUsageSummary?(): {
    total: { promptTokens: number; completionTokens: number; totalTokens: number; cacheCreationInputTokens?: number; cacheReadInputTokens?: number; estimatedCost: number; requestCount: number };
    sessions: Array<{
      sessionId: string;
      parentSessionId?: string;
      model: string;
      provider: string;
      usage: { promptTokens: number; completionTokens: number; totalTokens: number; cacheCreationInputTokens?: number; cacheReadInputTokens?: number };
      estimatedCost: number;
      requestCount: number;
      startedAt: number;
      updatedAt: number;
    }>;
  };

  // MCP server management (optional - for managing MCP servers)
  getMcpServers?(): Array<{ name: string; connected: boolean; toolCount: number; transport: string; error?: string }>;
  addMcpServer?(name: string, config: Record<string, unknown>): Promise<void>;
  removeMcpServer?(name: string): Promise<void>;
  getMcpTools?(): Array<{ name: string; description?: string; serverName: string }>;

  // Lifecycle (optional - for cleaning up resources like browser instances)
  shutdown?(): Promise<void>;
}

/**
 * Server state accessible via context.
 *
 * The server uses per-session agent instances for full isolation.
 * `agentFactory` creates new agents on demand (one per session).
 * `primaryAgent` is used for non-session operations (tools, providers, status).
 */
export interface ServerState {
  /** Primary agent for project-level operations (tools, providers, status). */
  agent: ServerAgent;
  /** Factory to create a new agent instance for a session. */
  agentFactory: () => Promise<ServerAgent>;
  sessions?: SessionManager;
  /** Optional plugin manager for runtime plugin install/uninstall. */
  pluginManager?: PluginManager;
}

/** Maximum idle time before a session agent is cleaned up (10 minutes). */
const SESSION_AGENT_IDLE_MS = 10 * 60 * 1000;

/**
 * Extended Hono app with route context for WebSocket setup.
 */
export type CreateServerResult = Hono & { routeContext: RouteContext };

/**
 * Create the Hono server application.
 *
 * Returns a Hono app augmented with `routeContext` for WebSocket upgrade handling.
 */
export function createServer(state: ServerState): CreateServerResult {
  const app = new Hono();

  // Shared state maps
  const sessionStates: Map<string, SessionState> = new Map();
  const sessionLastActivity: Map<string, number> = new Map();
  const permissionResolvers: Map<string, (response: PermissionResponse) => void> = new Map();

  /**
   * Install the remote permission callback on an agent.
   */
  function installPermissionCallback(agent: ServerAgent): void {
    if (agent.setPermissionRequestCallback) {
      agent.setPermissionRequestCallback(async (toolCall) => {
        return new Promise<PermissionResponse>((resolve) => {
          permissionResolvers.set(toolCall.id, resolve);
        });
      });
    }
  }

  /**
   * Get or create an agent for a specific session.
   */
  async function getSessionAgent(sessionId: string): Promise<ServerAgent> {
    const existing = sessionStates.get(sessionId);
    if (existing?.agent) {
      sessionLastActivity.set(sessionId, Date.now());
      return existing.agent;
    }

    const agent = await state.agentFactory();
    installPermissionCallback(agent);

    if (agent.setSessionContext) {
      agent.setSessionContext({ sessionId, sessionManager: state.sessions });
    }

    if (state.sessions) {
      const messages = await state.sessions.getSessionMessages(sessionId);
      if (messages.length > 0) {
        agent.setMessages(toAgentMessages(messages));
      }

      // Hydrate the usage tracker with persisted token stats so the
      // UI widget shows cumulative usage across session reloads.
      if (agent.getUsageTracker) {
        const storedUsage = await state.sessions.getTokenUsage(sessionId);
        if (storedUsage && storedUsage.requestCount > 0) {
          const session = await state.sessions.getSession(sessionId);
          const config = agent.getConfig();
          agent.getUsageTracker().hydrate(
            sessionId,
            session?.model ?? config.model,
            session?.provider ?? config.provider,
            storedUsage,
            session?.parentId ?? undefined,
          );
        }
      }
    }

    const sessionState = sessionStates.get(sessionId) || { isActive: false };
    sessionState.agent = agent;
    sessionStates.set(sessionId, sessionState);
    sessionLastActivity.set(sessionId, Date.now());

    return agent;
  }

  // Periodically clean up idle session agents
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [sessionId, lastActive] of sessionLastActivity.entries()) {
      if (now - lastActive > SESSION_AGENT_IDLE_MS) {
        const sessionState = sessionStates.get(sessionId);
        if (sessionState && !sessionState.isActive && sessionState.agent) {
          console.log(`[agent-server] Cleaning up idle agent for session ${sessionId}`);
          const idleAgent = sessionState.agent;
          sessionState.agent = undefined;
          sessionLastActivity.delete(sessionId);
          idleAgent.shutdown?.().catch((err: unknown) => {
            console.error(`[agent-server] Error shutting down idle agent for session ${sessionId}:`, err);
          });
        }
      }
    }
  }, 60_000);

  // Install permission callback on the primary agent
  installPermissionCallback(state.agent);

  // Build the shared route context
  const ctx: RouteContext = {
    state,
    sessionStates,
    sessionLastActivity,
    permissionResolvers,
    getSessionAgent,
  };

  // CORS middleware
  app.use("*", cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }));

  // Mount route modules
  const healthRoutes = createHealthRoutes(ctx);
  app.route("/", healthRoutes);

  app.route("/beta/conversations", createConversationRoutes(ctx));
  app.route("/search", createSearchRoutes(ctx));

  const sessionRoutes = createSessionRoutes(ctx);
  const promptingRoutes = createPromptingRoutes(ctx);
  const interactionRoutes = createInteractionRoutes(ctx);
  app.route("/session", sessionRoutes);
  app.route("/session", promptingRoutes);
  app.route("/session", interactionRoutes);

  app.route("/plugins", createPluginRoutes(ctx));
  app.route("/tools", createToolRoutes(ctx));
  app.route("/provider", createProviderRoutes(ctx));
  app.route("/agent-types", createAgentTypeRoutes(ctx));
  app.route("/session", createBrowserRoutes(ctx));
  app.route("/permissions", createPermissionConfigRoutes(ctx));
  app.route("/usage", createUsageRoutes(ctx));
  app.route("/mcp", createMcpRoutes(ctx));
  app.route("/files", createFileWatchRoutes(ctx));

  // Attach routeContext for WebSocket upgrade handling in startServer
  return Object.assign(app, { routeContext: ctx });
}

/**
 * Start the server using @hono/node-server.
 * This requires the @hono/node-server package to be installed.
 *
 * Accepts a Hono app (optionally with routeContext for WebSocket support).
 */
export async function startServer(
  app: Hono | CreateServerResult,
  config: ServerConfig = {}
): Promise<{ port: number; hostname: string; close: () => void }> {
  const { port = 3000, hostname = "localhost" } = config;

  // Check if the app has a routeContext (from createServer)
  const routeContext = "routeContext" in app ? app.routeContext : null;

  // Dynamic import of @hono/node-server
  const { serve } = await import("@hono/node-server");

  const server = serve({
    fetch: app.fetch,
    port,
    hostname,
  });

  // Set up WebSocket upgrade handling for screencast if we have the route context
  if (routeContext) {
    const { handleUpgrade } = createScreencastWSS(routeContext);

    server.on("upgrade", (req, socket, head) => {
      const url = req.url || "";
      if (isScreencastUrl(url)) {
        handleUpgrade(req, socket, head);
      } else {
        // Not a recognized WebSocket route — destroy the socket
        socket.destroy();
      }
    });
  }

  // Get actual port (useful when port is 0 for random port)
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;

  return {
    port: actualPort,
    hostname,
    close: () => {
      server.close();
    },
  };
}

/**
 * Create a server plugin that adds HTTP API endpoints.
 * 
 * Note: This plugin sets up routes but doesn't start the server.
 * Use `startServer()` to actually start listening.
 */
export function serverPlugin(): AgentPlugin {
  return {
    name: "server",
    version: "0.1.0",
    
    async onRegister(agent) {
      // The server is created separately using createServer()
      // This plugin just marks server capability as available
      agent.setExtension("server.available", true);
    },
  };
}

export { Hono };
