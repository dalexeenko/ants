/**
 * Audit Logger Service
 * Records user actions for security and compliance auditing.
 */

import { randomBytes } from 'crypto';
import { eq, and, lt, desc, sql } from 'drizzle-orm';
import { auditLog } from '../db/schema.js';
import type { AuditLog, NewAuditLog } from '../db/schema.js';
import type { DrizzleDB } from '../db/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('audit-logger');

function generateId(): string {
  return randomBytes(16).toString('hex');
}

export interface AuditLogEntry {
  userId?: string | null;
  username?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  details?: string | null;
  ipAddress?: string | null;
}

export interface AuditLogQueryOptions {
  userId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  limit?: number;
  offset?: number;
}

export class AuditLogger {
  private db: DrizzleDB;

  constructor(db: DrizzleDB) {
    this.db = db;
  }

  log(entry: AuditLogEntry): void {
    const newEntry: NewAuditLog = {
      id: generateId(),
      userId: entry.userId ?? null,
      username: entry.username ?? null,
      action: entry.action,
      resourceType: entry.resourceType ?? null,
      resourceId: entry.resourceId ?? null,
      details: entry.details ?? null,
      ipAddress: entry.ipAddress ?? null,
      createdAt: new Date(),
    };

    try {
      this.db.insert(auditLog).values(newEntry).run();
    } catch (error) {
      // Audit logging should never crash the server
      log.error('Failed to write audit log entry:', error);
    }
  }

  getAuditLog(options: AuditLogQueryOptions = {}): AuditLog[] {
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    // Build conditions dynamically
    const conditions: ReturnType<typeof eq>[] = [];

    if (options.userId) {
      conditions.push(eq(auditLog.userId, options.userId));
    }
    if (options.action) {
      conditions.push(eq(auditLog.action, options.action));
    }
    if (options.resourceType) {
      conditions.push(eq(auditLog.resourceType, options.resourceType));
    }
    if (options.resourceId) {
      conditions.push(eq(auditLog.resourceId, options.resourceId));
    }

    let query = this.db
      .select()
      .from(auditLog)
      .orderBy(desc(auditLog.createdAt))
      .limit(limit)
      .offset(offset);

    if (conditions.length === 1) {
      query = query.where(conditions[0]) as typeof query;
    } else if (conditions.length > 1) {
      query = query.where(and(...conditions)) as typeof query;
    }

    return query.all();
  }

  /**
   * Clean up audit log entries older than the specified number of days.
   * Returns the number of deleted entries.
   */
  cleanup(olderThanDays: number): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);

    const result = this.db
      .delete(auditLog)
      .where(lt(auditLog.createdAt, cutoff))
      .run();

    return result.changes;
  }
}
