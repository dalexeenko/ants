import { eq, desc, and, isNull, like, or, asc, lt, sql } from "drizzle-orm";
import {
  sessions,
  messages,
  compactionHistory,
  type SessionRow,
  type SessionInsert,
  type MessageRow,
  type MessageInsert,
  type CompactionHistoryRow,
  type CompactionHistoryInsert,
  type ToolCallData,
  type ToolResultData,
  type Schema,
} from "@ants/agent-database-core";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

/**
 * Cross-platform UUID v4 generator using Web Crypto API.
 * Works in Node.js, browsers, and React Native.
 */
function generateUUID(): string {
  // Use globalThis.crypto which works in Node.js 19+, browsers, and React Native
  const crypto = globalThis.crypto;
  if (!crypto) {
    throw new Error('crypto API not available');
  }
  if ('randomUUID' in crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older environments without randomUUID
  const bytes = new Uint8Array(16);
  (crypto as Crypto).getRandomValues(bytes);
  // Set version (4) and variant (RFC4122)
  const b6 = bytes[6]!;
  const b8 = bytes[8]!;
  bytes[6] = (b6 & 0x0f) | 0x40;
  bytes[8] = (b8 & 0x3f) | 0x80;
  // Convert to hex string with dashes
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Generic database type that works with both Node.js and React Native.
 * This is a Drizzle SQLite database with our schema.
 */
export type GenericAgentDatabase = BaseSQLiteDatabase<"sync" | "async", unknown, Schema>;

/**
 * Options for creating a SessionManager.
 */
export interface SessionManagerOptions {
  /** Custom ID generator function. Defaults to Web Crypto API randomUUID. */
  generateId?: () => string;
}

export interface CreateSessionOptions {
  id?: string;
  parentId?: string;
  userId?: string;
  workingDirectory: string;
  title?: string;
  provider: string;
  model: string;
  systemPrompt?: string;
  compactionEnabled?: boolean;
  compactionModel?: string;
  compactionTokenThreshold?: number;
}

export interface CreateMessageOptions {
  id?: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallData[];
  toolResults?: ToolResultData[];
  isCompactionSummary?: boolean;
  tokenCount?: number;
  sequence: number;
}

export interface UpdateSessionOptions {
  title?: string;
  workingDirectory?: string;
  tokenEstimate?: number;
  messageCount?: number;
  compactionEnabled?: boolean;
  compactionModel?: string;
  compactionTokenThreshold?: number;
}

export interface SearchSessionsOptions {
  query?: string;
  provider?: string;
  model?: string;
  workingDirectory?: string;
  includeMessages?: boolean;
  rootOnly?: boolean;
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'updatedAt' | 'messageCount' | 'tokenEstimate';
  orderDirection?: 'asc' | 'desc';
}

export interface SearchSessionResult {
  session: SessionRow;
  matchingMessages?: MessageRow[];
}

export interface SearchMessagesOptions {
  query: string;
  sessionId?: string;
  role?: 'user' | 'assistant';
  limit?: number;
  offset?: number;
}

export interface SearchMessageResult {
  message: MessageRow;
  session: SessionRow;
  snippet: string;
}

/**
 * Session manager for CRUD operations on sessions and messages.
 */
export class SessionManager {
  private generateId: () => string;

  constructor(private db: GenericAgentDatabase, options: SessionManagerOptions = {}) {
    this.generateId = options.generateId ?? generateUUID;
  }

  // ==================== Sessions ====================

  /**
   * Create a new session.
   */
  async createSession(options: CreateSessionOptions): Promise<SessionRow> {
    const now = new Date();
    const insert: SessionInsert = {
      id: options.id ?? this.generateId(),
      parentId: options.parentId ?? null,
      userId: options.userId ?? null,
      workingDirectory: options.workingDirectory,
      title: options.title ?? null,
      provider: options.provider,
      model: options.model,
      systemPrompt: options.systemPrompt ?? null,
      compactionEnabled: options.compactionEnabled ?? true,
      compactionModel: options.compactionModel ?? null,
      compactionTokenThreshold: options.compactionTokenThreshold ?? null,
      tokenEstimate: 0,
      messageCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      estimatedCost: 0,
      requestCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(sessions).values(insert);
    const created = await this.getSession(insert.id!);
    if (!created) {
      throw new Error(`Failed to create session ${insert.id}`);
    }
    return created;
  }

  /**
   * Get a session by ID.
   */
  async getSession(id: string): Promise<SessionRow | null> {
    const result = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);
    return result[0] ?? null;
  }

  /**
   * Get all root sessions (no parent).
   */
  async getRootSessions(limit = 50): Promise<SessionRow[]> {
    return this.db
      .select()
      .from(sessions)
      .where(isNull(sessions.parentId))
      .orderBy(desc(sessions.updatedAt))
      .limit(limit);
  }

  /**
   * Get child sessions of a parent.
   */
  async getChildSessions(parentId: string): Promise<SessionRow[]> {
    return this.db
      .select()
      .from(sessions)
      .where(eq(sessions.parentId, parentId))
      .orderBy(desc(sessions.createdAt));
  }

  /**
   * Update a session.
   */
  async updateSession(id: string, options: UpdateSessionOptions): Promise<SessionRow | null> {
    const updates: Partial<SessionInsert> = {
      ...options,
      updatedAt: new Date(),
    };

    await this.db
      .update(sessions)
      .set(updates)
      .where(eq(sessions.id, id));
    
    return this.getSession(id);
  }

  /**
   * Delete a session and all its messages.
   */
  async deleteSession(id: string): Promise<boolean> {
    const result = await this.db
      .delete(sessions)
      .where(eq(sessions.id, id));
    return true;
  }

  /**
   * Delete all sessions (and their messages via cascade).
   * Returns the number of sessions deleted.
   */
  async deleteAllSessions(): Promise<number> {
    const allSessions = await this.db.select().from(sessions);
    const count = allSessions.length;
    await this.db.delete(sessions);
    return count;
  }

  // ==================== Token Usage ====================

  /**
   * Atomically increment the token usage stats for a session.
   * Uses SQL `column = column + ?` pattern for safe concurrent accumulation.
   */
  async incrementTokenUsage(sessionId: string, usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    estimatedCost: number;
  }): Promise<void> {
    await this.db
      .update(sessions)
      .set({
        promptTokens: sql`${sessions.promptTokens} + ${usage.promptTokens}`,
        completionTokens: sql`${sessions.completionTokens} + ${usage.completionTokens}`,
        totalTokens: sql`${sessions.totalTokens} + ${usage.totalTokens}`,
        cacheCreationInputTokens: sql`${sessions.cacheCreationInputTokens} + ${usage.cacheCreationInputTokens ?? 0}`,
        cacheReadInputTokens: sql`${sessions.cacheReadInputTokens} + ${usage.cacheReadInputTokens ?? 0}`,
        estimatedCost: sql`${sessions.estimatedCost} + ${usage.estimatedCost}`,
        requestCount: sql`${sessions.requestCount} + 1`,
        updatedAt: new Date(),
      } as any)
      .where(eq(sessions.id, sessionId));
  }

  /**
   * Get the stored token usage stats for a session.
   * Returns null if the session doesn't exist.
   */
  async getTokenUsage(sessionId: string): Promise<{
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    estimatedCost: number;
    requestCount: number;
  } | null> {
    const session = await this.getSession(sessionId);
    if (!session) return null;
    return {
      promptTokens: session.promptTokens ?? 0,
      completionTokens: session.completionTokens ?? 0,
      totalTokens: session.totalTokens ?? 0,
      cacheCreationInputTokens: session.cacheCreationInputTokens ?? 0,
      cacheReadInputTokens: session.cacheReadInputTokens ?? 0,
      estimatedCost: session.estimatedCost ?? 0,
      requestCount: session.requestCount ?? 0,
    };
  }

  /**
   * Get the most recent session.
   */
  async getMostRecentSession(): Promise<SessionRow | null> {
    const result = await this.db
      .select()
      .from(sessions)
      .orderBy(desc(sessions.updatedAt))
      .limit(1);
    return result[0] ?? null;
  }

  // ==================== Messages ====================

  /**
   * Add a message to a session.
   */
  async addMessage(options: CreateMessageOptions): Promise<MessageRow> {
    const now = new Date();
    const insert: MessageInsert = {
      id: options.id ?? this.generateId(),
      sessionId: options.sessionId,
      role: options.role,
      content: options.content,
      toolCalls: options.toolCalls ?? null,
      toolResults: options.toolResults ?? null,
      isCompactionSummary: options.isCompactionSummary ?? false,
      tokenCount: options.tokenCount ?? null,
      sequence: options.sequence,
      createdAt: now,
    };

    await this.db.insert(messages).values(insert);
    
    // Update session message count
    const session = await this.getSession(options.sessionId);
    if (session) {
      await this.updateSession(options.sessionId, {
        messageCount: (session.messageCount ?? 0) + 1,
        tokenEstimate: (session.tokenEstimate ?? 0) + (options.tokenCount ?? 0),
      });
    }
    
    const created = await this.getMessage(insert.id!);
    if (!created) {
      throw new Error(`Failed to create message ${insert.id}`);
    }
    return created;
  }

  /**
   * Get a message by ID.
   */
  async getMessage(id: string): Promise<MessageRow | null> {
    const result = await this.db
      .select()
      .from(messages)
      .where(eq(messages.id, id))
      .limit(1);
    return result[0] ?? null;
  }

  /**
   * Get all messages for a session, ordered by sequence.
   */
  async getSessionMessages(sessionId: string): Promise<MessageRow[]> {
    return this.db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.sequence);
  }

  /**
   * Get the most recent messages for a session, with optional cursor-based pagination.
   * Returns messages in ascending sequence order (oldest first).
   *
   * @param sessionId - The session ID
   * @param limit - Max number of messages to return
   * @param beforeSequence - If provided, only return messages with sequence < this value (for loading older pages)
   * @returns Messages and a flag indicating if there are more older messages
   */
  async getSessionMessagesPaginated(
    sessionId: string,
    limit: number,
    beforeSequence?: number,
  ): Promise<{ messages: MessageRow[]; hasMore: boolean }> {
    const conditions = [eq(messages.sessionId, sessionId)];
    if (beforeSequence !== undefined) {
      conditions.push(lt(messages.sequence, beforeSequence));
    }

    // Fetch limit+1 to know if there are more pages
    const rows = await this.db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.sequence))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    // Reverse to ascending order (oldest first)
    page.reverse();
    return { messages: page, hasMore };
  }

  /**
   * Get the next sequence number for a session.
   */
  async getNextSequence(sessionId: string): Promise<number> {
    const result = await this.db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(desc(messages.sequence))
      .limit(1);
    
    return result[0] ? result[0].sequence + 1 : 0;
  }

  // ==================== Compaction History ====================

  /**
   * Record a compaction event.
   */
  async recordCompaction(options: {
    sessionId: string;
    summary: string;
    originalTokens: number;
    compactedTokens: number;
    messagesPruned: number;
    fromSequence: number;
    toSequence: number;
  }): Promise<CompactionHistoryRow> {
    const insert: CompactionHistoryInsert = {
      id: this.generateId(),
      sessionId: options.sessionId,
      summary: options.summary,
      originalTokens: options.originalTokens,
      compactedTokens: options.compactedTokens,
      messagesPruned: options.messagesPruned,
      fromSequence: options.fromSequence,
      toSequence: options.toSequence,
      createdAt: new Date(),
    };

    await this.db.insert(compactionHistory).values(insert);
    
    const result = await this.db
      .select()
      .from(compactionHistory)
      .where(eq(compactionHistory.id, insert.id))
      .limit(1);
    
    return result[0]!;
  }

  /**
   * Get compaction history for a session.
   */
  async getCompactionHistory(sessionId: string): Promise<CompactionHistoryRow[]> {
    return this.db
      .select()
      .from(compactionHistory)
      .where(eq(compactionHistory.sessionId, sessionId))
      .orderBy(desc(compactionHistory.createdAt));
  }

  // ==================== Search ====================

  /**
   * Search sessions with optional filters.
   */
  async searchSessions(options: SearchSessionsOptions): Promise<SearchSessionResult[]> {
    const {
      query,
      provider,
      model,
      workingDirectory,
      includeMessages = false,
      rootOnly = false,
      limit = 50,
      offset = 0,
      orderBy = 'updatedAt',
      orderDirection = 'desc',
    } = options;

    // Build conditions
    const conditions = [];
    
    if (rootOnly) {
      conditions.push(isNull(sessions.parentId));
    }
    
    if (provider) {
      conditions.push(eq(sessions.provider, provider));
    }
    
    if (model) {
      conditions.push(eq(sessions.model, model));
    }
    
    if (workingDirectory) {
      conditions.push(eq(sessions.workingDirectory, workingDirectory));
    }
    
    if (query) {
      conditions.push(
        or(
          like(sessions.title, `%${query}%`),
          like(sessions.workingDirectory, `%${query}%`)
        )
      );
    }

    // Build order clause
    const orderColumn = {
      createdAt: sessions.createdAt,
      updatedAt: sessions.updatedAt,
      messageCount: sessions.messageCount,
      tokenEstimate: sessions.tokenEstimate,
    }[orderBy] ?? sessions.updatedAt;

    const orderFn = orderDirection === 'asc' ? asc : desc;

    // Execute query
    let queryBuilder = this.db
      .select()
      .from(sessions);
    
    if (conditions.length > 0) {
      queryBuilder = queryBuilder.where(and(...conditions)) as typeof queryBuilder;
    }
    
    const sessionResults = await queryBuilder
      .orderBy(orderFn(orderColumn))
      .limit(limit)
      .offset(offset);

    // If searching with query and includeMessages, also search message content
    const results: SearchSessionResult[] = [];
    
    for (const session of sessionResults) {
      const result: SearchSessionResult = { session };
      
      if (includeMessages && query) {
        // Search messages for this session
        const matchingMsgs = await this.db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.sessionId, session.id),
              like(messages.content, `%${query}%`)
            )
          )
          .orderBy(messages.sequence);
        
        if (matchingMsgs.length > 0) {
          result.matchingMessages = matchingMsgs;
        }
      }
      
      results.push(result);
    }

    // If searching with query and includeMessages, also find sessions that have matching messages
    // but weren't found by title/workingDirectory search
    if (includeMessages && query) {
      const existingIds = new Set(results.map(r => r.session.id));
      
      // Find messages matching the query
      const matchingMessages = await this.db
        .select()
        .from(messages)
        .where(like(messages.content, `%${query}%`));
      
      // Get unique session IDs not already in results
      const additionalSessionIds = [...new Set(
        matchingMessages
          .map(m => m.sessionId)
          .filter(id => !existingIds.has(id))
      )];
      
      // Fetch those sessions and add them with their matching messages
      for (const sessionId of additionalSessionIds) {
        const session = await this.getSession(sessionId);
        if (session) {
          // Check if session matches other filters
          if (provider && session.provider !== provider) continue;
          if (model && session.model !== model) continue;
          if (workingDirectory && session.workingDirectory !== workingDirectory) continue;
          if (rootOnly && session.parentId !== null) continue;
          
          const sessionMsgs = matchingMessages.filter(m => m.sessionId === sessionId);
          results.push({
            session,
            matchingMessages: sessionMsgs,
          });
        }
      }
    }

    return results.slice(0, limit);
  }

  /**
   * Search messages across all sessions.
   */
  async searchMessages(options: SearchMessagesOptions): Promise<SearchMessageResult[]> {
    const {
      query,
      sessionId,
      role,
      limit = 100,
      offset = 0,
    } = options;

    // Build conditions
    const conditions = [like(messages.content, `%${query}%`)];
    
    if (sessionId) {
      conditions.push(eq(messages.sessionId, sessionId));
    }
    
    if (role) {
      conditions.push(eq(messages.role, role));
    }

    // Execute query
    const messageResults = await this.db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.createdAt))
      .limit(limit)
      .offset(offset);

    // Fetch session info for each message and create snippets
    const results: SearchMessageResult[] = [];
    
    for (const message of messageResults) {
      const session = await this.getSession(message.sessionId);
      if (!session) continue;
      
      // Create snippet with context around the match
      const snippet = this.createSnippet(message.content, query);
      
      results.push({
        message,
        session,
        snippet,
      });
    }

    return results;
  }

  /**
   * Create a snippet with context around a search match.
   */
  private createSnippet(content: string, query: string, contextLength = 50): string {
    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerContent.indexOf(lowerQuery);
    
    if (index === -1) {
      return content.slice(0, contextLength * 2) + (content.length > contextLength * 2 ? '...' : '');
    }
    
    const start = Math.max(0, index - contextLength);
    const end = Math.min(content.length, index + query.length + contextLength);
    
    let snippet = '';
    if (start > 0) snippet += '...';
    snippet += content.slice(start, end);
    if (end < content.length) snippet += '...';
    
    return snippet;
  }
}
