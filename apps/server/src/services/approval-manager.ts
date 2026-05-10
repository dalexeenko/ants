/**
 * Approval Manager
 * Manages approval rules and processes approval requests for dangerous operations.
 * 
 * When a tool call matches a rule:
 * - 'require_approval': Pauses execution and creates an approval request
 * - 'dry_run': Lets the tool describe what it would do without executing
 * - 'block': Prevents the tool from running entirely
 * 
 * Approval requests can be reviewed via the API or push notifications.
 */

import { eq, and, desc, lte } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { approvalRules, approvalRequests } from '../db/schema.js';
import type { DrizzleDB } from '../db/index.js';
import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';

const log = createLogger('approval-manager');

export interface ApprovalRuleInput {
  projectId?: string; // null = global rule
  name: string;
  description?: string;
  toolPattern: string; // e.g., 'bash', 'write', 'edit', 'git*'
  argPatterns?: Record<string, string>; // e.g., { command: '*rm*', path: '/etc/*' }
  action: 'require_approval' | 'dry_run' | 'block';
  priority?: number;
}

export interface CheckResult {
  allowed: boolean;
  action: 'allow' | 'require_approval' | 'dry_run' | 'block';
  rule?: typeof approvalRules.$inferSelect;
  requestId?: string;
}

const DEFAULT_RULES: Omit<ApprovalRuleInput, 'projectId'>[] = [
  {
    name: 'Dangerous shell commands',
    description: 'Requires approval for bash commands containing rm -rf, sudo, chmod, or dd',
    toolPattern: 'bash',
    argPatterns: { command: '*rm -rf*' },
    action: 'require_approval',
    priority: 100,
  },
  {
    name: 'Sudo commands',
    description: 'Requires approval for bash commands using sudo',
    toolPattern: 'bash',
    argPatterns: { command: '*sudo*' },
    action: 'require_approval',
    priority: 100,
  },
  {
    name: 'Chmod commands',
    description: 'Requires approval for bash commands using chmod',
    toolPattern: 'bash',
    argPatterns: { command: '*chmod*' },
    action: 'require_approval',
    priority: 90,
  },
  {
    name: 'DD commands',
    description: 'Requires approval for bash commands using dd',
    toolPattern: 'bash',
    argPatterns: { command: '*dd *' },
    action: 'require_approval',
    priority: 90,
  },
  {
    name: 'Write to env files',
    description: 'Requires approval for writing to .env files',
    toolPattern: 'write',
    argPatterns: { path: '*.env*' },
    action: 'require_approval',
    priority: 80,
  },
  {
    name: 'Edit env files',
    description: 'Requires approval for editing .env files',
    toolPattern: 'edit',
    argPatterns: { path: '*.env*' },
    action: 'require_approval',
    priority: 80,
  },
  {
    name: 'Write to credentials files',
    description: 'Requires approval for writing to credential or secret files',
    toolPattern: 'write',
    argPatterns: { path: '*credentials*' },
    action: 'require_approval',
    priority: 80,
  },
  {
    name: 'Edit credentials files',
    description: 'Requires approval for editing credential or secret files',
    toolPattern: 'edit',
    argPatterns: { path: '*credentials*' },
    action: 'require_approval',
    priority: 80,
  },
  {
    name: 'Write to secret files',
    description: 'Requires approval for writing to secret files',
    toolPattern: 'write',
    argPatterns: { path: '*secret*' },
    action: 'require_approval',
    priority: 80,
  },
  {
    name: 'Edit secret files',
    description: 'Requires approval for editing secret files',
    toolPattern: 'edit',
    argPatterns: { path: '*secret*' },
    action: 'require_approval',
    priority: 80,
  },
  {
    name: 'Force flag operations',
    description: 'Requires approval for any tool call with --force argument',
    toolPattern: '*',
    argPatterns: { command: '*--force*' },
    action: 'require_approval',
    priority: 70,
  },
  {
    name: 'No-verify flag operations',
    description: 'Requires approval for any tool call with --no-verify argument',
    toolPattern: '*',
    argPatterns: { command: '*--no-verify*' },
    action: 'require_approval',
    priority: 70,
  },
];

export class ApprovalManager extends EventEmitter {
  private db: DrizzleDB;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(db: DrizzleDB) {
    super();
    this.db = db;
  }

  start(): void {
    // Clean up expired requests every 5 minutes
    this.cleanupInterval = setInterval(() => this.expireOldRequests(), 5 * 60 * 1000);
    log.info('Started');
  }

  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Create default safety rules if none exist yet.
   * Called on first startup.
   */
  createDefaultRules(): void {
    const existing = this.db.select()
      .from(approvalRules)
      .all();

    if (existing.length > 0) {
      return; // Rules already exist, don't recreate defaults
    }

    log.info('Creating default safety rules...');
    for (const rule of DEFAULT_RULES) {
      this.createRule(rule);
    }
    log.info(`Created ${DEFAULT_RULES.length} default rules`);
  }

  // ---- Rule CRUD ----

  createRule(input: ApprovalRuleInput, createdBy?: string): unknown {
    const id = uuid();
    const now = new Date();

    this.db.insert(approvalRules).values({
      id,
      projectId: input.projectId ?? null,
      name: input.name,
      description: input.description ?? null,
      toolPattern: input.toolPattern,
      argPatterns: input.argPatterns ? JSON.stringify(input.argPatterns) : null,
      action: input.action,
      enabled: true,
      priority: input.priority ?? 0,
      createdBy: createdBy || null,
      createdAt: now,
      updatedAt: now,
    }).run();

    return this.getRule(id);
  }

  getRule(id: string): unknown {
    return this.db.select()
      .from(approvalRules)
      .where(eq(approvalRules.id, id))
      .get();
  }

  listRules(projectId?: string): unknown[] {
    if (projectId) {
      // Return project-specific and global rules
      return this.db.select()
        .from(approvalRules)
        .where(and(
          eq(approvalRules.enabled, true),
        ))
        .orderBy(desc(approvalRules.priority))
        .all()
        .filter(r => r.projectId === projectId || r.projectId === null);
    }
    return this.db.select()
      .from(approvalRules)
      .orderBy(desc(approvalRules.priority))
      .all();
  }

  updateRule(id: string, updates: Partial<ApprovalRuleInput> & { enabled?: boolean }): unknown {
    const existing = this.getRule(id);
    if (!existing) return null;

    const setValues: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.name !== undefined) setValues.name = updates.name;
    if (updates.description !== undefined) setValues.description = updates.description;
    if (updates.toolPattern !== undefined) setValues.toolPattern = updates.toolPattern;
    if (updates.argPatterns !== undefined) setValues.argPatterns = JSON.stringify(updates.argPatterns);
    if (updates.action !== undefined) setValues.action = updates.action;
    if (updates.priority !== undefined) setValues.priority = updates.priority;
    if (updates.enabled !== undefined) setValues.enabled = updates.enabled;

    this.db.update(approvalRules)
      .set(setValues)
      .where(eq(approvalRules.id, id))
      .run();

    return this.getRule(id);
  }

  deleteRule(id: string): boolean {
    const result = this.db.delete(approvalRules)
      .where(eq(approvalRules.id, id))
      .run();
    return result.changes > 0;
  }

  // ---- Tool Call Checking ----

  /**
   * Check if a tool call requires approval
   */
  checkToolCall(projectId: string, toolName: string, toolArgs: Record<string, unknown>, sessionId?: string): CheckResult {
    const rules = this.listRules(projectId) as any[];

    for (const rule of rules) {
      if (!rule.enabled) continue;

      // Check tool pattern match
      if (!this.matchGlob(rule.toolPattern, toolName)) continue;

      // Check argument patterns if specified
      if (rule.argPatterns) {
        const argPatterns = typeof rule.argPatterns === 'string'
          ? JSON.parse(rule.argPatterns) as Record<string, string>
          : rule.argPatterns as Record<string, string>;
        let argMatch = true;
        for (const [argName, pattern] of Object.entries(argPatterns)) {
          const argValue = String(toolArgs[argName] ?? '');
          if (!this.matchGlob(pattern, argValue)) {
            argMatch = false;
            break;
          }
        }
        if (!argMatch) continue;
      }

      // Rule matches
      if (rule.action === 'block') {
        return { allowed: false, action: 'block', rule };
      }

      if (rule.action === 'dry_run') {
        return { allowed: false, action: 'dry_run', rule };
      }

      if (rule.action === 'require_approval') {
        // Create an approval request
        const requestId = this.createRequest(projectId, sessionId || '', rule.id, toolName, toolArgs);
        return { allowed: false, action: 'require_approval', rule, requestId };
      }
    }

    return { allowed: true, action: 'allow' };
  }

  // ---- Approval Request Management ----

  createRequest(projectId: string, sessionId: string, ruleId: string | null, toolName: string, toolArgs: Record<string, unknown>): string {
    const id = uuid();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000); // 30 min expiry

    this.db.insert(approvalRequests).values({
      id,
      projectId,
      sessionId,
      ruleId: ruleId ?? null,
      toolName,
      toolArgs: JSON.stringify(toolArgs),
      status: 'pending',
      expiresAt,
      createdAt: now,
    }).run();

    // Emit event for push notifications
    this.emit('approval:requested', {
      id,
      projectId,
      sessionId,
      toolName,
      toolArgs,
      expiresAt,
    });

    return id;
  }

  getRequest(id: string): unknown {
    return this.db.select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, id))
      .get();
  }

  listRequests(projectId?: string, status?: string): unknown[] {
    const conditions = [];
    if (projectId) conditions.push(eq(approvalRequests.projectId, projectId));
    if (status) conditions.push(eq(approvalRequests.status, status));

    return this.db.select()
      .from(approvalRequests)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(approvalRequests.createdAt))
      .limit(100)
      .all();
  }

  /**
   * Approve or deny a request
   */
  reviewRequest(id: string, decision: 'approved' | 'denied', reviewedBy?: string, note?: string): unknown {
    const request = this.getRequest(id) as any;
    if (!request) return null;
    if (request.status !== 'pending') return null;

    this.db.update(approvalRequests)
      .set({
        status: decision,
        reviewedBy: reviewedBy ?? null,
        reviewNote: note ?? null,
        reviewedAt: new Date(),
      })
      .where(eq(approvalRequests.id, id))
      .run();

    // Emit event
    this.emit(`approval:${decision}`, {
      id,
      projectId: request.projectId,
      sessionId: request.sessionId,
      toolName: request.toolName,
    });

    return this.getRequest(id);
  }

  /**
   * Wait for a request to be reviewed (with timeout)
   */
  async waitForReview(id: string, timeoutMs: number = 30 * 60 * 1000): Promise<'approved' | 'denied' | 'expired'> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.removeListener('approval:approved', onApproved);
        this.removeListener('approval:denied', onDenied);
        resolve('expired');
      }, timeoutMs);

      const onApproved = (data: { id: string }) => {
        if (data.id === id) {
          clearTimeout(timeout);
          this.removeListener('approval:denied', onDenied);
          resolve('approved');
        }
      };

      const onDenied = (data: { id: string }) => {
        if (data.id === id) {
          clearTimeout(timeout);
          this.removeListener('approval:approved', onApproved);
          resolve('denied');
        }
      };

      this.on('approval:approved', onApproved);
      this.on('approval:denied', onDenied);

      // Check if already reviewed
      const current = this.getRequest(id) as any;
      if (current && current.status !== 'pending') {
        clearTimeout(timeout);
        this.removeListener('approval:approved', onApproved);
        this.removeListener('approval:denied', onDenied);
        resolve(current.status as any);
      }
    });
  }

  // ---- Helpers ----

  private expireOldRequests(): void {
    const now = new Date();
    this.db.update(approvalRequests)
      .set({ status: 'expired' })
      .where(and(
        eq(approvalRequests.status, 'pending'),
        lte(approvalRequests.expiresAt, now),
      ))
      .run();
  }

  private matchGlob(pattern: string, text: string): boolean {
    const regex = new RegExp(
      '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    return regex.test(text);
  }
}
