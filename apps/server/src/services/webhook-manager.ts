/**
 * WebhookManager - Manages webhook endpoints and processes deliveries
 *
 * Supports:
 * - GitHub webhooks (push, pull_request, issues, check_run, workflow_run)
 * - GitLab webhooks (token-based verification)
 * - Bitbucket webhooks
 * - Generic JSON webhooks
 * - CI/CD event webhooks
 *
 * Template variables: {{event}}, {{source}}, {{payload}}, {{payload.field}}, {{summary}}
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { eq, and, desc } from 'drizzle-orm';
import type { DrizzleDB } from '../db/index.js';
import { webhookEndpoints, webhookDeliveries } from '../db/schema.js';
import type { WebhookEndpoint, WebhookDelivery } from '../db/schema.js';
import type { ProjectManager } from './project-manager.js';
import { getErrorMessage } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('WebhookManager');

// ============================================================================
// Types
// ============================================================================

export interface CreateWebhookEndpointInput {
  projectId: string;
  name: string;
  slug: string;
  secret?: string;
  enabled?: boolean;
  source: string;
  eventFilter?: string[];
  promptTemplate: string;
  sessionMode?: 'newEachRun' | 'dedicated';
  dedicatedSessionId?: string;
}

export interface UpdateWebhookEndpointInput {
  name?: string;
  slug?: string;
  secret?: string;
  enabled?: boolean;
  source?: string;
  eventFilter?: string[];
  promptTemplate?: string;
  sessionMode?: 'newEachRun' | 'dedicated';
  dedicatedSessionId?: string;
}

export interface ParsedEvent {
  eventType: string;
  summary: string;
  payload: Record<string, unknown>;
}

export interface WebhookResult {
  status: number;
  deliveryId?: string;
  message?: string;
}

export interface DeliveryListOptions {
  limit?: number;
  status?: string;
}

// ============================================================================
// WebhookManager
// ============================================================================

export class WebhookManager {
  private db: DrizzleDB;
  private projectManager: ProjectManager;
  private running = false;
  private pollTimeout: NodeJS.Timeout | null = null;
  private pollIntervalMs = 2000;

  constructor(db: DrizzleDB, projectManager: ProjectManager) {
    this.db = db;
    this.projectManager = projectManager;
  }

  // ==========================================================================
  // CRUD
  // ==========================================================================

  createEndpoint(input: CreateWebhookEndpointInput, createdBy?: string): WebhookEndpoint {
    const id = uuidv4();
    const now = new Date();

    const row: typeof webhookEndpoints.$inferInsert = {
      id,
      projectId: input.projectId,
      name: input.name,
      slug: input.slug,
      secret: input.secret ?? null,
      enabled: input.enabled ?? true,
      source: input.source,
      eventFilter: input.eventFilter ? JSON.stringify(input.eventFilter) : null,
      promptTemplate: input.promptTemplate,
      sessionMode: input.sessionMode ?? 'newEachRun',
      dedicatedSessionId: input.dedicatedSessionId ?? null,
      createdBy: createdBy || null,
      createdAt: now,
      updatedAt: now,
    };

    this.db.insert(webhookEndpoints).values(row).run();

    return this.db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id)).get()!;
  }

  getEndpoint(id: string): WebhookEndpoint | null {
    return this.db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id)).get() ?? null;
  }

  getEndpointBySlug(projectId: string, slug: string): WebhookEndpoint | null {
    return this.db.select().from(webhookEndpoints)
      .where(and(
        eq(webhookEndpoints.projectId, projectId),
        eq(webhookEndpoints.slug, slug),
      ))
      .get() ?? null;
  }

  listEndpoints(projectId: string): WebhookEndpoint[] {
    return this.db.select().from(webhookEndpoints)
      .where(eq(webhookEndpoints.projectId, projectId))
      .all();
  }

  updateEndpoint(id: string, updates: UpdateWebhookEndpointInput): WebhookEndpoint | null {
    const existing = this.getEndpoint(id);
    if (!existing) return null;

    const now = new Date();
    const updateData: Partial<typeof webhookEndpoints.$inferInsert> = {
      updatedAt: now,
    };

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.slug !== undefined) updateData.slug = updates.slug;
    if (updates.secret !== undefined) updateData.secret = updates.secret;
    if (updates.enabled !== undefined) updateData.enabled = updates.enabled;
    if (updates.source !== undefined) updateData.source = updates.source;
    if (updates.eventFilter !== undefined) updateData.eventFilter = JSON.stringify(updates.eventFilter);
    if (updates.promptTemplate !== undefined) updateData.promptTemplate = updates.promptTemplate;
    if (updates.sessionMode !== undefined) updateData.sessionMode = updates.sessionMode;
    if (updates.dedicatedSessionId !== undefined) updateData.dedicatedSessionId = updates.dedicatedSessionId;

    this.db.update(webhookEndpoints).set(updateData).where(eq(webhookEndpoints.id, id)).run();

    return this.getEndpoint(id);
  }

  deleteEndpoint(id: string): boolean {
    const existing = this.getEndpoint(id);
    if (!existing) return false;

    this.db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, id)).run();
    return true;
  }

  // ==========================================================================
  // Webhook Processing
  // ==========================================================================

  /**
   * Handle an incoming webhook request
   */
  handleWebhook(
    projectId: string,
    slug: string,
    headers: Record<string, string>,
    body: string
  ): WebhookResult {
    const endpoint = this.getEndpointBySlug(projectId, slug);
    if (!endpoint) {
      return { status: 404, message: 'Webhook endpoint not found' };
    }

    if (!endpoint.enabled) {
      return { status: 200, message: 'Webhook endpoint is disabled' };
    }

    // Verify signature
    if (endpoint.secret && !this.verifySignature(endpoint, headers, body)) {
      return { status: 401, message: 'Invalid signature' };
    }

    // Parse the event
    let parsedPayload: Record<string, unknown>;
    try {
      parsedPayload = JSON.parse(body);
    } catch {
      return { status: 400, message: 'Invalid JSON payload' };
    }

    const event = this.parseEvent(endpoint.source, headers, parsedPayload);

    // Check event filter
    if (endpoint.eventFilter) {
      const allowedEvents: string[] = JSON.parse(endpoint.eventFilter);
      if (allowedEvents.length > 0 && !allowedEvents.includes(event.eventType)) {
        // Create delivery but mark as ignored
        const deliveryId = this.createDelivery(endpoint, event, body, 'ignored');
        return { status: 200, deliveryId, message: 'Event type not in filter' };
      }
    }

    // Create delivery record
    const deliveryId = this.createDelivery(endpoint, event, body, 'pending');

    return { status: 202, deliveryId, message: 'Webhook accepted' };
  }

  /**
   * Verify the webhook signature based on source type
   */
  verifySignature(
    endpoint: WebhookEndpoint,
    headers: Record<string, string>,
    body: string
  ): boolean {
    if (!endpoint.secret) return true;

    const source = endpoint.source.toLowerCase();

    switch (source) {
      case 'github': {
        const signature = headers['x-hub-signature-256'] || headers['X-Hub-Signature-256'];
        if (!signature) return false;
        const expected = 'sha256=' + createHmac('sha256', endpoint.secret).update(body, 'utf8').digest('hex');
        try {
          return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
        } catch {
          return false;
        }
      }

      case 'gitlab': {
        const token = headers['x-gitlab-token'] || headers['X-Gitlab-Token'];
        if (!token) return false;
        try {
          return timingSafeEqual(Buffer.from(token), Buffer.from(endpoint.secret));
        } catch {
          return false;
        }
      }

      case 'bitbucket': {
        // Bitbucket Cloud doesn't send a signature by default but some setups use HMAC
        const signature = headers['x-hub-signature'] || headers['X-Hub-Signature'];
        if (!signature) return true; // Bitbucket doesn't always sign
        const expected = 'sha256=' + createHmac('sha256', endpoint.secret).update(body, 'utf8').digest('hex');
        try {
          return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
        } catch {
          return false;
        }
      }

      case 'generic':
      case 'ci':
      default: {
        // Generic HMAC-SHA256 verification using X-Webhook-Signature header
        const signature = headers['x-webhook-signature'] || headers['X-Webhook-Signature'];
        if (!signature) return false;
        const expected = createHmac('sha256', endpoint.secret).update(body, 'utf8').digest('hex');
        const sigValue = signature.startsWith('sha256=') ? signature.slice(7) : signature;
        try {
          return timingSafeEqual(Buffer.from(sigValue), Buffer.from(expected));
        } catch {
          return false;
        }
      }
    }
  }

  /**
   * Parse event information from headers and payload based on source
   */
  parseEvent(
    source: string,
    headers: Record<string, string>,
    payload: Record<string, unknown>
  ): ParsedEvent {
    const sourceLower = source.toLowerCase();

    switch (sourceLower) {
      case 'github':
        return this.parseGitHubEvent(headers, payload);
      case 'gitlab':
        return this.parseGitLabEvent(headers, payload);
      case 'bitbucket':
        return this.parseBitbucketEvent(headers, payload);
      case 'ci':
        return this.parseCIEvent(headers, payload);
      case 'generic':
      default:
        return this.parseGenericEvent(headers, payload);
    }
  }

  private parseGitHubEvent(
    headers: Record<string, string>,
    payload: Record<string, unknown>
  ): ParsedEvent {
    const eventType = headers['x-github-event'] || headers['X-GitHub-Event'] || 'unknown';
    let summary = '';

    switch (eventType) {
      case 'push': {
        const ref = payload.ref as string || '';
        const commits = payload.commits as Array<Record<string, unknown>> || [];
        const pusher = payload.pusher as Record<string, unknown> || {};
        const branch = ref.replace('refs/heads/', '');
        summary = `Push to ${branch} by ${pusher.name || 'unknown'}: ${commits.length} commit(s)`;
        if (commits.length > 0) {
          const first = commits[0];
          summary += ` - "${first.message}"`;
        }
        break;
      }
      case 'pull_request': {
        const action = payload.action as string || '';
        const pr = payload.pull_request as Record<string, unknown> || {};
        const number = pr.number || '';
        const title = pr.title || '';
        const user = pr.user as Record<string, unknown> || {};
        summary = `PR #${number} ${action}: "${title}" by ${user.login || 'unknown'}`;
        break;
      }
      case 'issues': {
        const action = payload.action as string || '';
        const issue = payload.issue as Record<string, unknown> || {};
        const number = issue.number || '';
        const title = issue.title || '';
        summary = `Issue #${number} ${action}: "${title}"`;
        break;
      }
      case 'check_run': {
        const action = payload.action as string || '';
        const checkRun = payload.check_run as Record<string, unknown> || {};
        const name = checkRun.name || '';
        const conclusion = checkRun.conclusion || '';
        summary = `Check run "${name}" ${action}${conclusion ? ` (${conclusion})` : ''}`;
        break;
      }
      case 'workflow_run': {
        const action = payload.action as string || '';
        const workflowRun = payload.workflow_run as Record<string, unknown> || {};
        const name = workflowRun.name || '';
        const conclusion = workflowRun.conclusion || '';
        summary = `Workflow "${name}" ${action}${conclusion ? ` (${conclusion})` : ''}`;
        break;
      }
      default:
        summary = `GitHub event: ${eventType}`;
    }

    return { eventType, summary, payload };
  }

  private parseGitLabEvent(
    headers: Record<string, string>,
    payload: Record<string, unknown>
  ): ParsedEvent {
    const eventType = (headers['x-gitlab-event'] || headers['X-Gitlab-Event'] || 'unknown').toLowerCase().replace(/ /g, '_');
    const objectKind = payload.object_kind as string || eventType;
    let summary = '';

    switch (objectKind) {
      case 'push': {
        const ref = payload.ref as string || '';
        const commits = payload.commits as Array<Record<string, unknown>> || [];
        const userName = payload.user_name as string || 'unknown';
        const branch = ref.replace('refs/heads/', '');
        summary = `Push to ${branch} by ${userName}: ${commits.length} commit(s)`;
        break;
      }
      case 'merge_request': {
        const attrs = payload.object_attributes as Record<string, unknown> || {};
        const action = attrs.action as string || '';
        const title = attrs.title || '';
        const iid = attrs.iid || '';
        summary = `MR !${iid} ${action}: "${title}"`;
        break;
      }
      case 'issue': {
        const attrs = payload.object_attributes as Record<string, unknown> || {};
        const action = attrs.action as string || '';
        const title = attrs.title || '';
        const iid = attrs.iid || '';
        summary = `Issue #${iid} ${action}: "${title}"`;
        break;
      }
      default:
        summary = `GitLab event: ${objectKind}`;
    }

    return { eventType: objectKind, summary, payload };
  }

  private parseBitbucketEvent(
    headers: Record<string, string>,
    payload: Record<string, unknown>
  ): ParsedEvent {
    const eventType = headers['x-event-key'] || headers['X-Event-Key'] || 'unknown';
    let summary = `Bitbucket event: ${eventType}`;

    if (eventType.startsWith('repo:push')) {
      const push = payload.push as Record<string, unknown> || {};
      const changes = push.changes as Array<Record<string, unknown>> || [];
      summary = `Push: ${changes.length} change(s)`;
    } else if (eventType.startsWith('pullrequest:')) {
      const pr = payload.pullrequest as Record<string, unknown> || {};
      const title = pr.title || '';
      const id = pr.id || '';
      const action = eventType.replace('pullrequest:', '');
      summary = `PR #${id} ${action}: "${title}"`;
    }

    return { eventType, summary, payload };
  }

  private parseCIEvent(
    _headers: Record<string, string>,
    payload: Record<string, unknown>
  ): ParsedEvent {
    const eventType = (payload.event as string) || (payload.type as string) || 'ci_event';
    const status = payload.status as string || '';
    const pipelineName = payload.pipeline as string || payload.name as string || '';
    const summary = pipelineName
      ? `CI: "${pipelineName}" ${status || eventType}`
      : `CI event: ${eventType}${status ? ` (${status})` : ''}`;

    return { eventType, summary, payload };
  }

  private parseGenericEvent(
    _headers: Record<string, string>,
    payload: Record<string, unknown>
  ): ParsedEvent {
    const eventType = (payload.event as string) || (payload.type as string) || 'generic';
    const message = (payload.message as string) || (payload.summary as string) || '';
    const summary = message || `Generic webhook event: ${eventType}`;

    return { eventType, summary, payload };
  }

  /**
   * Render a prompt template with event data
   */
  renderPromptTemplate(template: string, data: {
    event: string;
    source: string;
    summary: string;
    payload: Record<string, unknown>;
  }): string {
    let result = template;

    result = result.replace(/\{\{event\}\}/g, data.event);
    result = result.replace(/\{\{source\}\}/g, data.source);
    result = result.replace(/\{\{summary\}\}/g, data.summary);
    result = result.replace(/\{\{payload\}\}/g, JSON.stringify(data.payload, null, 2));

    // Handle {{payload.field}} - supports nested dot notation
    result = result.replace(/\{\{payload\.([^}]+)\}\}/g, (_match, path: string) => {
      const parts = path.split('.');
      let current: unknown = data.payload;
      for (const part of parts) {
        if (current === null || current === undefined || typeof current !== 'object') {
          return '';
        }
        current = (current as Record<string, unknown>)[part];
      }
      if (current === null || current === undefined) {
        return '';
      }
      if (typeof current === 'object') {
        return JSON.stringify(current);
      }
      return String(current);
    });

    return result;
  }

  // ==========================================================================
  // Delivery Management
  // ==========================================================================

  private createDelivery(
    endpoint: WebhookEndpoint,
    event: ParsedEvent,
    rawPayload: string,
    status: string
  ): string {
    const id = uuidv4();
    const now = new Date();

    let prompt: string | null = null;
    if (status !== 'ignored') {
      prompt = this.renderPromptTemplate(endpoint.promptTemplate, {
        event: event.eventType,
        source: endpoint.source,
        summary: event.summary,
        payload: event.payload,
      });
    }

    this.db.insert(webhookDeliveries).values({
      id,
      endpointId: endpoint.id,
      source: endpoint.source,
      eventType: event.eventType,
      payload: rawPayload,
      status,
      prompt,
      createdAt: now,
    }).run();

    return id;
  }

  getDeliveries(endpointId: string, options?: DeliveryListOptions): WebhookDelivery[] {
    const limit = options?.limit ?? 50;

    if (options?.status) {
      return this.db.select().from(webhookDeliveries)
        .where(and(
          eq(webhookDeliveries.endpointId, endpointId),
          eq(webhookDeliveries.status, options.status),
        ))
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(limit)
        .all();
    }

    return this.db.select().from(webhookDeliveries)
      .where(eq(webhookDeliveries.endpointId, endpointId))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(limit)
      .all();
  }

  /**
   * Process a single pending delivery - sends prompt to the project's agent
   */
  async processDelivery(delivery: WebhookDelivery): Promise<void> {
    if (!delivery.prompt) {
      this.db.update(webhookDeliveries).set({
        status: 'failed',
        errorMessage: 'No prompt to process',
        processedAt: new Date(),
      }).where(eq(webhookDeliveries.id, delivery.id)).run();
      return;
    }

    // Mark as processing
    this.db.update(webhookDeliveries).set({
      status: 'processing',
    }).where(eq(webhookDeliveries.id, delivery.id)).run();

    try {
      // Get the endpoint to know which project
      const endpoint = this.getEndpoint(delivery.endpointId);
      if (!endpoint) {
        throw new Error('Webhook endpoint not found');
      }

      // Get the agent client for this project
      const client = await this.projectManager.getClient(endpoint.projectId);
      if (!client) {
        throw new Error('Could not get agent client for project');
      }

      const project = await this.projectManager.getProject(endpoint.projectId);
      if (!project) {
        throw new Error('Project not found');
      }

      let sessionId: string;

      if (endpoint.sessionMode === 'dedicated' && endpoint.dedicatedSessionId) {
        sessionId = endpoint.dedicatedSessionId;
      } else {
        // Create a new session
        const session = (await client.createSession({
          workingDirectory: project.workingDirectory,
          title: `Webhook: ${endpoint.name} - ${delivery.eventType || 'event'}`,
        })) as { id: string };
        sessionId = session.id;
      }

      // Send the prompt
      const response = await client.sendPromptAsync(sessionId, delivery.prompt);
      const responseContent = typeof response === 'string'
        ? response
        : response && typeof response === 'object'
          ? JSON.stringify(response)
          : null;

      // Mark as completed
      this.db.update(webhookDeliveries).set({
        status: 'completed',
        sessionId,
        responseContent,
        processedAt: new Date(),
      }).where(eq(webhookDeliveries.id, delivery.id)).run();

    } catch (error) {
      const errorMessage = getErrorMessage(error, 'Unknown error processing delivery');
      log.error(`Error processing webhook delivery ${delivery.id}:`, errorMessage);

      this.db.update(webhookDeliveries).set({
        status: 'failed',
        errorMessage,
        processedAt: new Date(),
      }).where(eq(webhookDeliveries.id, delivery.id)).run();
    }
  }

  // ==========================================================================
  // Background Processor
  // ==========================================================================

  /**
   * Start the background delivery processor
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    log.info('Started');
    this.poll();
  }

  /**
   * Stop the background delivery processor
   */
  stop(): void {
    this.running = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
    log.info('Stopped');
  }

  /**
   * Poll for pending deliveries and process them
   */
  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      const pendingDeliveries = this.db.select().from(webhookDeliveries)
        .where(eq(webhookDeliveries.status, 'pending'))
        .orderBy(webhookDeliveries.createdAt)
        .limit(5)
        .all();

      for (const delivery of pendingDeliveries) {
        await this.processDelivery(delivery);
      }
    } catch (error) {
      log.error('Error in poll:', error);
    }

    this.pollTimeout = setTimeout(() => this.poll(), this.pollIntervalMs);
  }
}
