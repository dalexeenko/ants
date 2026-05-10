import type { AgentPlugin, AgentInterface, ToolContext } from "@openmgr/agent-core";
import {
  generateTitle,
  isDefaultTitle,
  COMPACTION_SUMMARY_PREFIX,
} from "@openmgr/agent-core";
import type { Message, ToolCall, ToolResult } from "@openmgr/agent-core";
import type { ToolCallData, ToolResultData } from "@openmgr/agent-database-core";
import {
  createDatabase,
  createInMemoryDatabase,
  initializeDatabase,
  type AgentDatabase,
  type DatabaseConfig,
  type NodeDatabaseConnection,
} from "@openmgr/agent-database";
import { getSmallModel, type ProviderName, SMALL_MODELS } from "@openmgr/agent-providers";
import { SessionManager } from "./sessions.js";
import { randomUUID } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import { dirname, join } from "path";

/**
 * Normalize a provider name to a base ProviderName for small model lookup.
 * e.g. "anthropic-oauth" → "anthropic"
 */
function resolveBaseProvider(provider: string): ProviderName | null {
  // Direct match
  if (provider in SMALL_MODELS) {
    return provider as ProviderName;
  }
  // Strip suffixes like "-oauth", "-custom", etc.
  const base = provider.split("-")[0] as string;
  if (base && base in SMALL_MODELS) {
    return base as ProviderName;
  }
  return null;
}

export interface StoragePluginOptions extends DatabaseConfig {
  /** Run migrations on plugin initialization. Defaults to true. */
  runMigrations?: boolean;
  /** Use an in-memory database (for testing). Schema tables are created automatically. */
  inMemory?: boolean;
}

/**
 * Create a storage plugin that provides database access to the agent.
 * 
 * Each plugin instance creates its own isolated database connection,
 * so multiple agents (projects) can safely run concurrently without
 * interfering with each other's connections.
 * 
 * The plugin adds:
 * - `storage.db` - The Drizzle database instance
 * - `storage.sessions` - Session manager for CRUD operations
 * 
 * @example
 * ```ts
 * import { Agent } from "@openmgr/agent-core";
 * import { storagePlugin } from "@openmgr/agent-storage";
 * 
 * const agent = new Agent({ ... });
 * await agent.use(storagePlugin());
 * 
 * // Access storage via extensions
 * const sessions = agent.getExtension<SessionManager>("storage.sessions");
 * const session = await sessions.createSession({ ... });
 * ```
 */
// ---------------------------------------------------------------------------
// Helpers to convert agent-core tool types to storage types
// ---------------------------------------------------------------------------

function toStorageToolCalls(calls: ToolCall[] | undefined): ToolCallData[] | undefined {
  if (!calls || calls.length === 0) return undefined;
  return calls.map((tc) => ({
    id: tc.id,
    name: tc.name,
    arguments: tc.arguments,
  }));
}

function toStorageToolResults(results: ToolResult[] | undefined): ToolResultData[] | undefined {
  if (!results || results.length === 0) return undefined;
  return results.map((r) => ({
    toolCallId: r.id,
    content: typeof r.result === "string" ? r.result : JSON.stringify(r.result),
    isError: r.isError,
    ...(r.metadata ? { metadata: r.metadata } : {}),
  }));
}

/**
 * Extract a base64 data URL's binary content and format.
 * Returns null if the string is not a valid data:image URL.
 */
function parseDataUrl(dataUrl: string): { buffer: Buffer; format: string } | null {
  const match = dataUrl.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
  if (!match || !match[1] || !match[2]) return null;
  return { buffer: Buffer.from(match[2], "base64"), format: match[1] };
}

export function storagePlugin(options: StoragePluginOptions = {}): AgentPlugin {
  const { runMigrations = true, inMemory = false, path, verbose } = options;
  const dbConfig: DatabaseConfig = { path, verbose };
  
  let connection: NodeDatabaseConnection;
  let sessionManager: SessionManager;

  // Directory for storing screenshot files.
  // Derived from the database path: <dbDir>/screenshots/
  // For in-memory databases this is null (screenshots stay as data URLs).
  const screenshotsDir = (!inMemory && path)
    ? join(dirname(path), "screenshots")
    : null;
  let screenshotsDirCreated = false;
  
  // Track sessions that already have a title generated so we don't
  // re-check the DB on every prompt after the first one.
  const titleGeneratedSessions = new Set<string>();

  // Per-session sequence counters so we can assign monotonically increasing
  // sequence numbers to messages as they are persisted incrementally.
  const sessionSequences = new Map<string, number>();

  return {
    name: "storage",
    version: "0.1.0",

    async onRegister(agent: AgentInterface) {
      if (inMemory) {
        // In-memory database for testing — tables are created automatically
        connection = createInMemoryDatabase();
      } else {
        // Initialize database (run migrations)
        if (runMigrations) {
          const result = await initializeDatabase(path);
          if (!result.success) {
            throw new Error(`Storage plugin failed to initialize: ${result.message}`);
          }
        }
        
        // Create an isolated database connection for this agent.
        // This avoids the global singleton issue where opening a second
        // project's DB would close the first project's connection.
        connection = createDatabase(dbConfig);
      }
      sessionManager = new SessionManager(connection.db);
      
      // Register extensions
      agent.setExtension("storage.db", connection.db);
      agent.setExtension("storage.sessions", sessionManager);

      // Wire up token usage persistence: every time the UsageTracker
      // records usage from an LLM response, persist the delta to the DB.
      const usageTracker = agent.getUsageTracker();
      usageTracker.setOnRecordCallback((sessionId, delta, costDelta) => {
        // Fire-and-forget — don't block the agent loop on DB writes
        sessionManager.incrementTokenUsage(sessionId, {
          promptTokens: delta.promptTokens,
          completionTokens: delta.completionTokens,
          totalTokens: delta.totalTokens,
          cacheCreationInputTokens: delta.cacheCreationInputTokens,
          cacheReadInputTokens: delta.cacheReadInputTokens,
          estimatedCost: costDelta,
        }).catch((err) => {
          console.error("Failed to persist token usage:", err);
        });
      });
    },

    async onAfterToolExecute(_toolCall: ToolCall, result: ToolResult, _ctx: ToolContext) {
      // Intercept screenshot tool results: write the base64 image to disk
      // and replace the data URL with a file path reference.
      if (!screenshotsDir || !result.metadata) return;

      const image = result.metadata.image as
        | { dataUrl?: string; width?: number; height?: number }
        | undefined;
      if (!image?.dataUrl) return;

      const parsed = parseDataUrl(image.dataUrl);
      if (!parsed) return;

      try {
        // Ensure the screenshots directory exists (once per plugin lifetime)
        if (!screenshotsDirCreated) {
          await mkdir(screenshotsDir, { recursive: true });
          screenshotsDirCreated = true;
        }

        const filename = `${randomUUID()}.${parsed.format}`;
        await writeFile(join(screenshotsDir, filename), parsed.buffer);

        // Replace the data URL with a relative path.
        // The path is relative to the .openmgr directory so each platform
        // can resolve it to a serveable URL independently.
        delete (image as Record<string, unknown>).dataUrl;
        (image as Record<string, unknown>).path = `screenshots/${filename}`;
      } catch (err) {
        // Non-critical — if the file write fails, the data URL stays in
        // metadata and will be persisted to SQLite (larger but functional).
        console.error("Failed to save screenshot to disk:", err);
      }
    },

    async onMessageAdded(message: Message, agent: AgentInterface) {
      const ctx = agent.getSessionContext();
      if (!ctx || !sessionManager) return;

      const sessionId = ctx.sessionId;

      // Lazily initialise the sequence counter for this session by
      // querying the current message count once.
      if (!sessionSequences.has(sessionId)) {
        const existing = await sessionManager.getSessionMessages(sessionId);
        sessionSequences.set(sessionId, existing.length);
      }

      const seq = sessionSequences.get(sessionId)!;
      sessionSequences.set(sessionId, seq + 1);

      const content =
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content);

      const isCompactionSummary = content.startsWith(COMPACTION_SUMMARY_PREFIX);

      await sessionManager.addMessage({
        sessionId,
        role: message.role,
        content,
        toolCalls: toStorageToolCalls(message.toolCalls),
        toolResults: toStorageToolResults(message.toolResults),
        isCompactionSummary,
        sequence: seq,
      });
    },

    async onAfterPrompt(_response: Message, agent: AgentInterface) {
      // Auto-generate a session title after the first prompt if the session has no title
      const sessionContext = agent.getSessionContext();
      if (!sessionContext || !sessionManager) return;

      const sessionId = sessionContext.sessionId;

      // Skip if we already generated a title for this session
      if (titleGeneratedSessions.has(sessionId)) return;

      try {
        // Check if the session already has a meaningful title
        const session = await sessionManager.getSession(sessionId);
        if (!session) return;
        if (!isDefaultTitle(session.title)) {
          // Already has a real title (e.g. user-provided), remember and skip
          titleGeneratedSessions.add(sessionId);
          return;
        }

        const messages = agent.getMessages();
        // Need at least a user message and an assistant response
        if (messages.length < 2) return;

        // Reuse the agent's existing (authenticated) provider
        const provider = agent.getProvider();
        if (!provider) return;

        const config = agent.getConfig();
        const baseProvider = resolveBaseProvider(config.provider);
        if (!baseProvider) return;

        const smallModel = getSmallModel(baseProvider);

        const title = await generateTitle(messages, {
          provider,
          model: smallModel,
        });

        await sessionManager.updateSession(sessionId, { title });
        titleGeneratedSessions.add(sessionId);

        // Notify listeners (app UI, SSE clients) that the title has changed
        agent.emit("event", {
          type: "session.title.updated",
          sessionId,
          title,
        });
      } catch (error) {
        // Title generation is non-critical, log and continue
        console.error("Auto title generation failed:", error);
      }
    },

    async onShutdown() {
      // Close this plugin's own database connection
      if (connection) {
        connection.close();
      }
    },
  };
}
