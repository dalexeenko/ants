import type { Command } from "commander";
import chalk from "chalk";

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start the HTTP server")
    .option("-p, --port <port>", "Port to listen on", "3000")
    .option("-d, --directory <dir>", "Working directory", process.cwd())
    .option("--provider <provider>", "LLM provider (anthropic|openai)")
    .option("--model <model>", "Model name")
    .action(async (options) => {
      // Dynamic imports to avoid loading heavy modules unless needed
      const { createServer, startServer } = await import("@openmgr/agent-server");
      const { providerRegistry, PluginManager, SubagentManager, capabilityRegistry } = await import("@openmgr/agent-core");
      const { createNodeAgent } = await import("@openmgr/agent-node");
      const { getDb, SessionManager, storagePlugin, initializeDatabase } = await import("@openmgr/agent-storage");
      const { AnthropicOAuthProvider } = await import("@openmgr/agent-providers");
      const { join } = await import("node:path");
      const { homedir } = await import("node:os");

      // Run migrations to ensure all tables exist before opening the connection
      await initializeDatabase();

      // Get database and create session manager
      const db = getDb();
      const sessions = new SessionManager(db);

      // Check for OAuth tokens passed via environment variable
      const oauthTokensJson = process.env.ANTHROPIC_OAUTH_TOKENS;
      let useOAuth = false;
      
      if (oauthTokensJson) {
        try {
          const parsed = JSON.parse(oauthTokensJson);
          console.log(chalk.gray(`Using Anthropic OAuth tokens (expires: ${new Date(parsed.expiresAt).toISOString()})`));
          
          // Shared mutable token reference — all provider instances see the latest tokens.
          // When any instance refreshes, the callback updates this reference so
          // subsequent provider instances (created for new session agents) get
          // the refreshed tokens instead of the original stale ones.
          const currentTokens = {
            accessToken: parsed.accessToken,
            refreshToken: parsed.refreshToken,
            expiresAt: parsed.expiresAt,
          };

          providerRegistry.register({
            name: "anthropic-oauth",
            factory: () => new AnthropicOAuthProvider({
              tokens: { ...currentTokens },
              onTokenRefresh: async (refreshed) => {
                currentTokens.accessToken = refreshed.accessToken;
                currentTokens.refreshToken = refreshed.refreshToken;
                currentTokens.expiresAt = refreshed.expiresAt;
                console.log(chalk.gray(`OAuth tokens refreshed (new expiry: ${new Date(refreshed.expiresAt).toISOString()})`));
              },
            }),
          });
          useOAuth = true;
        } catch (e) {
          console.error(chalk.yellow(`Warning: Failed to parse ANTHROPIC_OAUTH_TOKENS: ${e}`));
        }
      }

      const agentOptions = {
        workingDirectory: options.directory,
        provider: useOAuth ? "anthropic-oauth" : (options.provider || undefined),
        model: options.model,
        // Allow all tools by default when running as a server.
        // The openmgr server handles its own approval/permission layer;
        // the agent-server itself should not block on tool permissions.
        permissions: { allowAll: true } as const,
      };

      // Create the primary agent (used for project-level operations: tools, providers, status)
      const agent = await createNodeAgent(agentOptions);
      
      // Register memory plugin for semantic memory/knowledge base tools.
      // Loaded dynamically because @openmgr/agent-memory depends on
      // @huggingface/transformers + onnxruntime-node which may not be
      // installed (e.g. lite Docker image). Falls back to keyword-only search.
      let memoryPlugin: (() => any) | null = null;
      try {
        const mod = await import("@openmgr/agent-memory");
        memoryPlugin = mod.memoryPlugin;
      } catch {
        console.log(chalk.gray("Memory plugin unavailable (embeddings dependencies not installed). Keyword-only memory search will be used."));
      }
      if (memoryPlugin) {
        await agent.use(memoryPlugin());
      }

      // Subagent support — enables task, task_status, task_cancel tools.
      // The toolsPlugin registers these tools with requiredCapabilities: ["subagent"],
      // so they remain deferred until the capability is registered.
      const subagentManager = new SubagentManager(agent);
      agent.setExtension('subagentManager', subagentManager);
      capabilityRegistry.register('subagent', {
        providedBy: '@openmgr/agent-server',
        version: '0.1.0',
      });
      agent.getToolRegistry().reevaluateDeferred();

      // Factory to create per-session agent instances.
      // Each session gets its own Agent with isolated message history.
      // Agents share the same global tool/provider registries but have
      // independent message state, abort controllers, etc.
      // We skip MCP init for session agents since MCP tools are registered
      // globally by the primary agent.
      const agentFactory = async () => {
        const sessionAgent = await createNodeAgent({
          ...agentOptions,
          mcp: undefined,  // MCP tools already registered globally by primary agent
          skipConfigLoad: true,  // Reuse the same resolved config
          resolvedConfig: {
            provider: agent.getConfig().provider,
            model: agent.getConfig().model,
            systemPrompt: agent.getConfig().systemPrompt,
            auth: agent.getConfig().auth,
          },
        });
        // Register storage plugin for title generation (DB already initialized, skip migrations)
        await sessionAgent.use(storagePlugin({ runMigrations: false }));
        // Register memory plugin for knowledge base tools (if available)
        if (memoryPlugin) {
          await sessionAgent.use(memoryPlugin());
        }
        // Subagent support for session agents (capability already registered globally by primary agent)
        const sessionSubagentManager = new SubagentManager(sessionAgent);
        sessionAgent.setExtension('subagentManager', sessionSubagentManager);
        sessionAgent.getToolRegistry().reevaluateDeferred();
        return sessionAgent as Parameters<typeof createServer>[0]["agent"];
      };

      // Expose agent type methods on the agent for the server to use.
      // The Agent class has getAgentTypeRegistry() but not the flat methods
      // that ServerAgent expects. We add them here so the route can call them.
      const agentWithTypes = agent as any;
      agentWithTypes.getAgentTypes = () => {
        return agent.getAgentTypeRegistry().getAllIncludingDisabled().map((def) => ({
          ...def,
          enabled: def.enabled !== false,
          source: def.source ?? 'builtin',
        }));
      };
      agentWithTypes.getAgentTypeConflicts = () => {
        return agent.getAgentTypeRegistry().getConflicts();
      };
      agentWithTypes.setAgentTypeEnabled = (name: string, enabled: boolean) => {
        return agent.getAgentTypeRegistry().setEnabled(name, enabled);
      };

      // Create plugin manager for runtime plugin installation
      const pluginDir = join(homedir(), ".config", "openmgr", "plugins");
      const pluginManager = new PluginManager({ pluginDir });

      // Install server-managed plugins from config before starting
      // The server writes a `plugins` array to .openmgr.json with package
      // specs that should be installed.
      const { existsSync, readFileSync } = await import("node:fs");
      const configPath = join(options.directory, ".openmgr.json");
      if (existsSync(configPath)) {
        try {
          const rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
          const pluginSpecs: string[] = rawConfig.plugins ?? [];
          for (const spec of pluginSpecs) {
            try {
              console.log(chalk.gray(`Installing plugin: ${spec}`));
              const installed = await pluginManager.install(spec);
              for (const plugin of installed.plugins) {
                await agent.use(plugin);
                console.log(chalk.gray(`  Loaded plugin: ${plugin.name}`));
              }
            } catch (e) {
              console.error(chalk.yellow(`Warning: Failed to install plugin "${spec}": ${e instanceof Error ? e.message : e}`));
            }
          }
        } catch {
          // Config parse error — ignore, the agent will handle it
        }
      }

      // Cast agent to ServerAgent type (it implements all required methods)
      const app = createServer({ 
        agent: agent as Parameters<typeof createServer>[0]["agent"],
        agentFactory,
        sessions,
        pluginManager,
      });
      
      const { port, hostname } = await startServer(app, {
        port: parseInt(options.port, 10),
        hostname: "0.0.0.0",  // Bind to all interfaces (IPv4 and IPv6)
      });

      console.log(chalk.cyan(`Server listening on http://${hostname}:${port}`));
      console.log(chalk.gray(`Provider: ${useOAuth ? "anthropic-oauth" : (options.provider ?? "default")}`));
      console.log(chalk.gray(`Model: ${options.model ?? "default"}`));
      console.log(chalk.gray(`Working directory: ${options.directory}`));
      console.log(chalk.gray("\nPress Ctrl+C to stop"));
    });
}
