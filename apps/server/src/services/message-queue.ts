/**
 * MessageQueueService - Persistent message queue for reliable channel message processing
 */

import { v4 as uuidv4 } from 'uuid';
import { eq, and, or, lt, asc } from 'drizzle-orm';
import type { DrizzleDB } from '../db/index.js';
import { channelMessageQueue } from '../db/schema.js';
import type {
  QueuedMessage,
  InboundMessage,
  OutboundMessage,
  MessageDirection,
  MessageStatus,
} from '../channels/types.js';

// ============================================================================
// Types
// ============================================================================

export interface EnqueueInboundInput {
  channelId: string;
  bindingId?: string;
  payload: InboundMessage;
  platformRef?: string;
}

export interface EnqueueOutboundInput {
  channelId: string;
  payload: OutboundMessage;
  sessionId?: string;
  platformRef?: string;
}

export interface ProcessingResult {
  success: boolean;
  error?: string;
  sessionId?: string;
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}

// ============================================================================
// MessageQueueService
// ============================================================================

export class MessageQueueService {
  private db: DrizzleDB;
  private processingTimeoutMs: number;
  private maxRetries: number;

  constructor(
    db: DrizzleDB,
    options?: {
      processingTimeoutMs?: number;
      maxRetries?: number;
    }
  ) {
    this.db = db;
    this.processingTimeoutMs = options?.processingTimeoutMs ?? 60000; // 1 minute
    this.maxRetries = options?.maxRetries ?? 3;
  }

  // ==========================================================================
  // Enqueue Operations
  // ==========================================================================

  /**
   * Enqueue an inbound message for processing
   */
  enqueueInbound(input: EnqueueInboundInput): QueuedMessage {
    const id = uuidv4();
    const now = new Date();

    this.db.insert(channelMessageQueue).values({
      id,
      channelId: input.channelId,
      bindingId: input.bindingId ?? null,
      direction: 'inbound',
      status: 'pending',
      payload: JSON.stringify(input.payload),
      platformRef: input.platformRef ?? null,
      sessionId: null,
      attempts: 0,
      lastError: null,
      createdAt: now,
      processedAt: null,
    }).run();

    return this.getMessage(id)!;
  }

  /**
   * Enqueue an outbound message for delivery
   */
  enqueueOutbound(input: EnqueueOutboundInput): QueuedMessage {
    const id = uuidv4();
    const now = new Date();

    this.db.insert(channelMessageQueue).values({
      id,
      channelId: input.channelId,
      bindingId: null,
      direction: 'outbound',
      status: 'pending',
      payload: JSON.stringify(input.payload),
      platformRef: input.platformRef ?? null,
      sessionId: input.sessionId ?? null,
      attempts: 0,
      lastError: null,
      createdAt: now,
      processedAt: null,
    }).run();

    return this.getMessage(id)!;
  }

  // ==========================================================================
  // Dequeue Operations
  // ==========================================================================

  /**
   * Get the next pending message for processing
   * Marks it as 'processing' atomically
   */
  dequeue(direction?: MessageDirection): QueuedMessage | null {
    // First, recover any stuck messages (processing for too long)
    this.recoverStuckMessages();

    // Build query conditions
    const conditions = [
      eq(channelMessageQueue.status, 'pending'),
      lt(channelMessageQueue.attempts, this.maxRetries),
    ];

    if (direction) {
      conditions.push(eq(channelMessageQueue.direction, direction));
    }

    // Get oldest pending message
    const rows = this.db
      .select()
      .from(channelMessageQueue)
      .where(and(...conditions))
      .orderBy(asc(channelMessageQueue.createdAt))
      .limit(1)
      .all();

    if (rows.length === 0) return null;

    const row = rows[0];

    // Mark as processing
    this.db
      .update(channelMessageQueue)
      .set({
        status: 'processing',
        attempts: row.attempts + 1,
      })
      .where(eq(channelMessageQueue.id, row.id))
      .run();

    return this.rowToMessage({ ...row, status: 'processing', attempts: row.attempts + 1 });
  }

  /**
   * Get multiple pending messages (batch processing)
   */
  dequeueBatch(limit: number, direction?: MessageDirection): QueuedMessage[] {
    this.recoverStuckMessages();

    const conditions = [
      eq(channelMessageQueue.status, 'pending'),
      lt(channelMessageQueue.attempts, this.maxRetries),
    ];

    if (direction) {
      conditions.push(eq(channelMessageQueue.direction, direction));
    }

    const rows = this.db
      .select()
      .from(channelMessageQueue)
      .where(and(...conditions))
      .orderBy(asc(channelMessageQueue.createdAt))
      .limit(limit)
      .all();

    const messages: QueuedMessage[] = [];

    for (const row of rows) {
      this.db
        .update(channelMessageQueue)
        .set({
          status: 'processing',
          attempts: row.attempts + 1,
        })
        .where(eq(channelMessageQueue.id, row.id))
        .run();

      messages.push(this.rowToMessage({ ...row, status: 'processing', attempts: row.attempts + 1 }));
    }

    return messages;
  }

  // ==========================================================================
  // Status Updates
  // ==========================================================================

  /**
   * Mark a message as completed
   */
  markCompleted(id: string, sessionId?: string): void {
    this.db
      .update(channelMessageQueue)
      .set({
        status: 'completed',
        processedAt: new Date(),
        sessionId: sessionId ?? null,
      })
      .where(eq(channelMessageQueue.id, id))
      .run();
  }

  /**
   * Mark a message as failed
   */
  markFailed(id: string, error: string): void {
    const row = this.db
      .select()
      .from(channelMessageQueue)
      .where(eq(channelMessageQueue.id, id))
      .all()[0];

    if (!row) return;

    // If we've exceeded max retries, mark as failed permanently
    // Otherwise, mark as pending to retry
    const newStatus: MessageStatus = row.attempts >= this.maxRetries ? 'failed' : 'pending';

    this.db
      .update(channelMessageQueue)
      .set({
        status: newStatus,
        lastError: error,
        processedAt: newStatus === 'failed' ? new Date() : null,
      })
      .where(eq(channelMessageQueue.id, id))
      .run();
  }

  /**
   * Update the binding ID for a message (after trigger matching)
   */
  updateBindingId(id: string, bindingId: string): void {
    this.db
      .update(channelMessageQueue)
      .set({ bindingId })
      .where(eq(channelMessageQueue.id, id))
      .run();
  }

  // ==========================================================================
  // Query Operations
  // ==========================================================================

  /**
   * Get a message by ID
   */
  getMessage(id: string): QueuedMessage | null {
    const rows = this.db
      .select()
      .from(channelMessageQueue)
      .where(eq(channelMessageQueue.id, id))
      .all();

    if (rows.length === 0) return null;
    return this.rowToMessage(rows[0]);
  }

  /**
   * List messages for a channel
   */
  listMessages(
    channelId: string,
    options?: {
      direction?: MessageDirection;
      status?: MessageStatus;
      limit?: number;
    }
  ): QueuedMessage[] {
    const conditions = [eq(channelMessageQueue.channelId, channelId)];

    if (options?.direction) {
      conditions.push(eq(channelMessageQueue.direction, options.direction));
    }
    if (options?.status) {
      conditions.push(eq(channelMessageQueue.status, options.status));
    }

    let query = this.db
      .select()
      .from(channelMessageQueue)
      .where(and(...conditions))
      .orderBy(asc(channelMessageQueue.createdAt));

    if (options?.limit) {
      query = query.limit(options.limit) as typeof query;
    }

    const rows = query.all();
    return rows.map((row) => this.rowToMessage(row));
  }

  /**
   * Get queue statistics
   */
  getStats(channelId?: string): QueueStats {
    const conditions = channelId ? [eq(channelMessageQueue.channelId, channelId)] : [];

    const rows = this.db
      .select()
      .from(channelMessageQueue)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .all();

    const stats: QueueStats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      total: rows.length,
    };

    for (const row of rows) {
      switch (row.status) {
        case 'pending':
          stats.pending++;
          break;
        case 'processing':
          stats.processing++;
          break;
        case 'completed':
          stats.completed++;
          break;
        case 'failed':
          stats.failed++;
          break;
      }
    }

    return stats;
  }

  /**
   * Check if there are pending messages
   */
  hasPendingMessages(direction?: MessageDirection): boolean {
    const conditions = [eq(channelMessageQueue.status, 'pending')];

    if (direction) {
      conditions.push(eq(channelMessageQueue.direction, direction));
    }

    const rows = this.db
      .select()
      .from(channelMessageQueue)
      .where(and(...conditions))
      .limit(1)
      .all();

    return rows.length > 0;
  }

  // ==========================================================================
  // Cleanup Operations
  // ==========================================================================

  /**
   * Recover messages stuck in 'processing' state
   */
  private recoverStuckMessages(): void {
    const cutoff = new Date(Date.now() - this.processingTimeoutMs);

    // Find processing messages that started before cutoff
    const stuckRows = this.db
      .select()
      .from(channelMessageQueue)
      .where(
        and(
          eq(channelMessageQueue.status, 'processing'),
          lt(channelMessageQueue.createdAt, cutoff)
        )
      )
      .all();

    for (const row of stuckRows) {
      // Reset to pending if under max retries, otherwise fail
      const newStatus: MessageStatus = row.attempts >= this.maxRetries ? 'failed' : 'pending';

      this.db
        .update(channelMessageQueue)
        .set({
          status: newStatus,
          lastError: 'Processing timeout - message stuck',
          processedAt: newStatus === 'failed' ? new Date() : null,
        })
        .where(eq(channelMessageQueue.id, row.id))
        .run();
    }
  }

  /**
   * Delete old completed/failed messages
   */
  cleanup(olderThanDays: number = 7): number {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

    const result = this.db
      .delete(channelMessageQueue)
      .where(
        and(
          or(
            eq(channelMessageQueue.status, 'completed'),
            eq(channelMessageQueue.status, 'failed')
          ),
          lt(channelMessageQueue.createdAt, cutoff)
        )
      )
      .run();

    return result.changes;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private rowToMessage(row: typeof channelMessageQueue.$inferSelect): QueuedMessage {
    return {
      id: row.id,
      channelId: row.channelId,
      bindingId: row.bindingId ?? undefined,
      direction: row.direction as MessageDirection,
      status: row.status as MessageStatus,
      payload: JSON.parse(row.payload),
      platformRef: row.platformRef ?? undefined,
      sessionId: row.sessionId ?? undefined,
      attempts: row.attempts,
      lastError: row.lastError ?? undefined,
      createdAt: row.createdAt,
      processedAt: row.processedAt ?? undefined,
    };
  }
}
