/**
 * Analytics Service
 * Tracks usage events, aggregates daily metrics, and provides query APIs.
 */

import { eq, and, gte, lte, desc, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { analyticsEvents, analyticsDaily } from '../db/schema.js';
import type { DrizzleDB } from '../db/index.js';

export interface TrackEventInput {
  projectId?: string;
  sessionId?: string;
  eventType: 'prompt' | 'tool_call' | 'task_run' | 'error' | 'agent_start' | 'agent_stop';
  provider?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  estimatedCostUsd?: number; // in microdollars
  durationMs?: number;
  toolName?: string;
  success?: boolean;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface AnalyticsQuery {
  projectId?: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  eventType?: string;
  limit?: number;
}

export interface DashboardSummary {
  totalPrompts: number;
  totalToolCalls: number;
  totalTaskRuns: number;
  taskSuccessRate: number;
  totalTokens: number;
  totalCostUsd: number; // in real dollars
  avgResponseMs: number;
  uniqueSessions: number;
  topModels: { model: string; count: number; costUsd: number }[];
  topTools: { tool: string; count: number; avgDurationMs: number }[];
  dailyMetrics: {
    date: string;
    prompts: number;
    tokens: number;
    costUsd: number;
    errors: number;
  }[];
  recentErrors: {
    id: string;
    projectId?: string | null;
    sessionId?: string | null;
    errorMessage?: string | null;
    createdAt: Date;
  }[];
}

export class AnalyticsService {
  constructor(private db: DrizzleDB) {}

  /**
   * Track a single analytics event
   */
  trackEvent(input: TrackEventInput): void {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];

    // Insert the event
    this.db.insert(analyticsEvents).values({
      id: uuid(),
      projectId: input.projectId ?? null,
      sessionId: input.sessionId ?? null,
      eventType: input.eventType,
      provider: input.provider ?? null,
      model: input.model ?? null,
      promptTokens: input.promptTokens ?? null,
      completionTokens: input.completionTokens ?? null,
      totalTokens: input.totalTokens ?? null,
      cacheCreationInputTokens: input.cacheCreationInputTokens ?? null,
      cacheReadInputTokens: input.cacheReadInputTokens ?? null,
      estimatedCostUsd: input.estimatedCostUsd ?? null,
      durationMs: input.durationMs ?? null,
      toolName: input.toolName ?? null,
      success: input.success ?? null,
      errorMessage: input.errorMessage ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt: now,
    }).run();

    // Update daily aggregation
    this.updateDailyAggregation(input, dateStr);
  }

  /**
   * Update daily aggregation table
   */
  private updateDailyAggregation(input: TrackEventInput, dateStr: string): void {
    const projectId = input.projectId ?? '__global__';

    // Try to get existing record
    const existing = this.db.select()
      .from(analyticsDaily)
      .where(and(
        eq(analyticsDaily.projectId, projectId),
        eq(analyticsDaily.date, dateStr)
      ))
      .get();

    if (!existing) {
      // Create new daily record
      this.db.insert(analyticsDaily).values({
        id: uuid(),
        projectId,
        date: dateStr,
        totalPrompts: input.eventType === 'prompt' ? 1 : 0,
        totalToolCalls: input.eventType === 'tool_call' ? 1 : 0,
        totalTaskRuns: input.eventType === 'task_run' ? 1 : 0,
        successfulTaskRuns: input.eventType === 'task_run' && input.success ? 1 : 0,
        failedTaskRuns: input.eventType === 'task_run' && input.success === false ? 1 : 0,
        totalPromptTokens: input.promptTokens ?? 0,
        totalCompletionTokens: input.completionTokens ?? 0,
        totalTokens: input.totalTokens ?? 0,
        totalCacheCreationInputTokens: input.cacheCreationInputTokens ?? 0,
        totalCacheReadInputTokens: input.cacheReadInputTokens ?? 0,
        totalCostUsd: input.estimatedCostUsd ?? 0,
        totalErrors: input.eventType === 'error' ? 1 : 0,
        avgResponseMs: input.durationMs ?? null,
        uniqueSessions: input.sessionId ? 1 : 0,
      }).run();
    } else {
      // Update existing record
      const updates: Record<string, unknown> = {};

      if (input.eventType === 'prompt') {
        updates.totalPrompts = sql`${analyticsDaily.totalPrompts} + 1`;
      }
      if (input.eventType === 'tool_call') {
        updates.totalToolCalls = sql`${analyticsDaily.totalToolCalls} + 1`;
      }
      if (input.eventType === 'task_run') {
        updates.totalTaskRuns = sql`${analyticsDaily.totalTaskRuns} + 1`;
        if (input.success) {
          updates.successfulTaskRuns = sql`${analyticsDaily.successfulTaskRuns} + 1`;
        } else if (input.success === false) {
          updates.failedTaskRuns = sql`${analyticsDaily.failedTaskRuns} + 1`;
        }
      }
      if (input.eventType === 'error') {
        updates.totalErrors = sql`${analyticsDaily.totalErrors} + 1`;
      }
      if (input.promptTokens) {
        updates.totalPromptTokens = sql`${analyticsDaily.totalPromptTokens} + ${input.promptTokens}`;
      }
      if (input.completionTokens) {
        updates.totalCompletionTokens = sql`${analyticsDaily.totalCompletionTokens} + ${input.completionTokens}`;
      }
      if (input.totalTokens) {
        updates.totalTokens = sql`${analyticsDaily.totalTokens} + ${input.totalTokens}`;
      }
      if (input.cacheCreationInputTokens) {
        updates.totalCacheCreationInputTokens = sql`${analyticsDaily.totalCacheCreationInputTokens} + ${input.cacheCreationInputTokens}`;
      }
      if (input.cacheReadInputTokens) {
        updates.totalCacheReadInputTokens = sql`${analyticsDaily.totalCacheReadInputTokens} + ${input.cacheReadInputTokens}`;
      }
      if (input.estimatedCostUsd) {
        updates.totalCostUsd = sql`${analyticsDaily.totalCostUsd} + ${input.estimatedCostUsd}`;
      }

      if (Object.keys(updates).length > 0) {
        this.db.update(analyticsDaily)
          .set(updates)
          .where(eq(analyticsDaily.id, existing.id))
          .run();
      }
    }
  }

  /**
   * Get dashboard summary
   */
  getDashboard(query: AnalyticsQuery): DashboardSummary {
    const conditions = [];
    if (query.projectId) {
      conditions.push(eq(analyticsDaily.projectId, query.projectId));
    }
    if (query.startDate) {
      conditions.push(gte(analyticsDaily.date, query.startDate));
    }
    if (query.endDate) {
      conditions.push(lte(analyticsDaily.date, query.endDate));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Aggregate daily metrics
    const dailyRows = this.db.select()
      .from(analyticsDaily)
      .where(whereClause)
      .orderBy(desc(analyticsDaily.date))
      .limit(query.limit ?? 30)
      .all();

    // Calculate totals
    let totalPrompts = 0;
    let totalToolCalls = 0;
    let totalTaskRuns = 0;
    let successfulTaskRuns = 0;
    let failedTaskRuns = 0;
    let totalTokens = 0;
    let totalCostMicro = 0;
    let totalErrors = 0;
    let totalResponseMs = 0;
    let responseCount = 0;
    let uniqueSessions = 0;

    for (const row of dailyRows) {
      totalPrompts += row.totalPrompts;
      totalToolCalls += row.totalToolCalls;
      totalTaskRuns += row.totalTaskRuns;
      successfulTaskRuns += row.successfulTaskRuns;
      failedTaskRuns += row.failedTaskRuns;
      totalTokens += row.totalTokens;
      totalCostMicro += row.totalCostUsd;
      totalErrors += row.totalErrors;
      if (row.avgResponseMs) {
        totalResponseMs += row.avgResponseMs;
        responseCount++;
      }
      uniqueSessions += row.uniqueSessions;
    }

    // Get top models from events
    const eventConditions = [];
    if (query.projectId) {
      eventConditions.push(eq(analyticsEvents.projectId, query.projectId));
    }
    if (query.startDate) {
      eventConditions.push(gte(analyticsEvents.createdAt, new Date(query.startDate)));
    }
    if (query.endDate) {
      eventConditions.push(lte(analyticsEvents.createdAt, new Date(query.endDate + 'T23:59:59Z')));
    }

    const eventWhereClause = eventConditions.length > 0 ? and(...eventConditions) : undefined;

    const topModelsRaw = this.db.select({
      model: analyticsEvents.model,
      count: sql<number>`count(*)`,
      costUsd: sql<number>`coalesce(sum(${analyticsEvents.estimatedCostUsd}), 0)`,
    })
      .from(analyticsEvents)
      .where(and(
        eventWhereClause,
        eq(analyticsEvents.eventType, 'prompt'),
        sql`${analyticsEvents.model} IS NOT NULL`
      ))
      .groupBy(analyticsEvents.model)
      .orderBy(sql`count(*) DESC`)
      .limit(10)
      .all();

    const topModels = topModelsRaw.map(r => ({
      model: r.model!,
      count: r.count,
      costUsd: r.costUsd / 1_000_000,
    }));

    // Get top tools
    const topToolsRaw = this.db.select({
      tool: analyticsEvents.toolName,
      count: sql<number>`count(*)`,
      avgDurationMs: sql<number>`avg(${analyticsEvents.durationMs})`,
    })
      .from(analyticsEvents)
      .where(and(
        eventWhereClause,
        eq(analyticsEvents.eventType, 'tool_call'),
        sql`${analyticsEvents.toolName} IS NOT NULL`
      ))
      .groupBy(analyticsEvents.toolName)
      .orderBy(sql`count(*) DESC`)
      .limit(10)
      .all();

    const topTools = topToolsRaw.map(r => ({
      tool: r.tool!,
      count: r.count,
      avgDurationMs: Math.round(r.avgDurationMs ?? 0),
    }));

    // Get recent errors
    const recentErrors = this.db.select({
      id: analyticsEvents.id,
      projectId: analyticsEvents.projectId,
      sessionId: analyticsEvents.sessionId,
      errorMessage: analyticsEvents.errorMessage,
      createdAt: analyticsEvents.createdAt,
    })
      .from(analyticsEvents)
      .where(and(
        eventWhereClause,
        eq(analyticsEvents.eventType, 'error'),
      ))
      .orderBy(desc(analyticsEvents.createdAt))
      .limit(20)
      .all();

    return {
      totalPrompts,
      totalToolCalls,
      totalTaskRuns,
      taskSuccessRate: totalTaskRuns > 0 ? successfulTaskRuns / totalTaskRuns : 0,
      totalTokens,
      totalCostUsd: totalCostMicro / 1_000_000,
      avgResponseMs: responseCount > 0 ? Math.round(totalResponseMs / responseCount) : 0,
      uniqueSessions,
      topModels,
      topTools,
      dailyMetrics: dailyRows.reverse().map(r => ({
        date: r.date,
        prompts: r.totalPrompts,
        tokens: r.totalTokens,
        costUsd: r.totalCostUsd / 1_000_000,
        errors: r.totalErrors,
      })),
      recentErrors,
    };
  }

  /**
   * Get raw events with filtering
   */
  getEvents(query: AnalyticsQuery & { eventType?: string }): unknown[] {
    const conditions = [];
    if (query.projectId) {
      conditions.push(eq(analyticsEvents.projectId, query.projectId));
    }
    if (query.eventType) {
      conditions.push(eq(analyticsEvents.eventType, query.eventType));
    }
    if (query.startDate) {
      conditions.push(gte(analyticsEvents.createdAt, new Date(query.startDate)));
    }
    if (query.endDate) {
      conditions.push(lte(analyticsEvents.createdAt, new Date(query.endDate + 'T23:59:59Z')));
    }

    return this.db.select()
      .from(analyticsEvents)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(analyticsEvents.createdAt))
      .limit(query.limit ?? 100)
      .all();
  }

  /**
   * Get cost breakdown by project
   */
  getCostBreakdown(startDate?: string, endDate?: string): { projectId: string; totalCostUsd: number; totalTokens: number; promptCount: number }[] {
    const conditions = [];
    if (startDate) {
      conditions.push(gte(analyticsDaily.date, startDate));
    }
    if (endDate) {
      conditions.push(lte(analyticsDaily.date, endDate));
    }

    const rows = this.db.select({
      projectId: analyticsDaily.projectId,
      totalCostUsd: sql<number>`sum(${analyticsDaily.totalCostUsd})`,
      totalTokens: sql<number>`sum(${analyticsDaily.totalTokens})`,
      promptCount: sql<number>`sum(${analyticsDaily.totalPrompts})`,
    })
      .from(analyticsDaily)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(analyticsDaily.projectId)
      .orderBy(sql`sum(${analyticsDaily.totalCostUsd}) DESC`)
      .all();

    return rows.map(r => ({
      projectId: r.projectId!,
      totalCostUsd: (r.totalCostUsd ?? 0) / 1_000_000,
      totalTokens: r.totalTokens ?? 0,
      promptCount: r.promptCount ?? 0,
    }));
  }

  /**
   * Cleanup old events (keep daily aggregations)
   */
  cleanupOldEvents(olderThanDays: number): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);

    const result = this.db.delete(analyticsEvents)
      .where(lte(analyticsEvents.createdAt, cutoff))
      .run();

    return result.changes;
  }
}
