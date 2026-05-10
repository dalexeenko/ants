/**
 * Agent Communication Service
 * Enables cross-project agent-to-agent messaging.
 * 
 * Agents can send requests to other agents (code review, questions, task delegation)
 * and receive responses. Messages are persisted and processed asynchronously.
 */

import { eq, and, desc, or } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { agentMessages } from '../db/schema.js';
import type { DrizzleDB } from '../db/index.js';
import type { ProjectManager } from './project-manager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('agent-comms');

export interface SendAgentMessageInput {
  fromProjectId: string;
  toProjectId: string;
  type: 'request' | 'response' | 'notification';
  action: string;
  subject?: string;
  content: string;
  metadata?: Record<string, unknown>;
  parentMessageId?: string;
}

export interface AgentMessageResult {
  id: string;
  status: string;
  responseContent?: string;
}

export class AgentCommsService {
  private db: DrizzleDB;
  private projectManager: ProjectManager;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(db: DrizzleDB, projectManager: ProjectManager) {
    this.db = db;
    this.projectManager = projectManager;
  }

  /**
   * Start the message processor
   */
  start(): void {
    this.pollInterval = setInterval(() => this.processPendingMessages(), 2000);
    log.info('Message processor started');
  }

  /**
   * Stop the message processor
   */
  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Send a message from one agent to another
   */
  sendMessage(input: SendAgentMessageInput): AgentMessageResult {
    const id = uuid();
    const now = new Date();

    this.db.insert(agentMessages).values({
      id,
      fromProjectId: input.fromProjectId,
      toProjectId: input.toProjectId,
      type: input.type,
      action: input.action,
      subject: input.subject ?? null,
      content: input.content,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      parentMessageId: input.parentMessageId ?? null,
      status: 'pending',
      createdAt: now,
    }).run();

    return { id, status: 'pending' };
  }

  /**
   * Get messages for a project (inbox)
   */
  getInbox(projectId: string, options?: { status?: string; limit?: number }): unknown[] {
    const conditions = [eq(agentMessages.toProjectId, projectId)];
    if (options?.status) {
      conditions.push(eq(agentMessages.status, options.status));
    }

    return this.db.select()
      .from(agentMessages)
      .where(and(...conditions))
      .orderBy(desc(agentMessages.createdAt))
      .limit(options?.limit ?? 50)
      .all();
  }

  /**
   * Get sent messages from a project (outbox)
   */
  getOutbox(projectId: string, limit?: number): unknown[] {
    return this.db.select()
      .from(agentMessages)
      .where(eq(agentMessages.fromProjectId, projectId))
      .orderBy(desc(agentMessages.createdAt))
      .limit(limit ?? 50)
      .all();
  }

  /**
   * Get a conversation thread
   */
  getThread(messageId: string): unknown[] {
    // Get the root message and all replies
    const rootMessage = this.db.select()
      .from(agentMessages)
      .where(eq(agentMessages.id, messageId))
      .get();

    if (!rootMessage) return [];

    const replies = this.db.select()
      .from(agentMessages)
      .where(eq(agentMessages.parentMessageId, messageId))
      .orderBy(agentMessages.createdAt)
      .all();

    return [rootMessage, ...replies];
  }

  /**
   * Get a single message
   */
  getMessage(messageId: string): unknown {
    return this.db.select()
      .from(agentMessages)
      .where(eq(agentMessages.id, messageId))
      .get();
  }

  /**
   * Process pending messages - delivers them to target agents
   */
  private async processPendingMessages(): Promise<void> {
    const pending = this.db.select()
      .from(agentMessages)
      .where(eq(agentMessages.status, 'pending'))
      .limit(5)
      .all();

    for (const msg of pending) {
      try {
        // Mark as processing
        this.db.update(agentMessages)
          .set({ status: 'processing' })
          .where(eq(agentMessages.id, msg.id))
          .run();

        // Get the target project's agent client
        const client = await this.projectManager.getClient(msg.toProjectId);
        if (!client) {
          this.db.update(agentMessages)
            .set({ status: 'failed', responseContent: 'Target project agent is not running' })
            .where(eq(agentMessages.id, msg.id))
            .run();
          continue;
        }

        // Compose the prompt for the target agent
        const fromProject = await this.projectManager.getProject(msg.fromProjectId);
        const prompt = this.composePrompt(msg, fromProject?.name ?? msg.fromProjectId);

        // Create a session for this inter-agent communication
        const session = await client.createSession({
          title: `Agent Message: ${msg.subject || msg.action}`,
        }) as { id: string };

        // Send the prompt
        const result = await client.sendPromptAsync(session.id, prompt) as { message?: string };

        // Store the response
        this.db.update(agentMessages)
          .set({
            status: 'completed',
            responseContent: result.message ?? null,
            sessionId: session.id,
            processedAt: new Date(),
          })
          .where(eq(agentMessages.id, msg.id))
          .run();

        // If this was a request, automatically send the response back
        if (msg.type === 'request' && result.message) {
          this.sendMessage({
            fromProjectId: msg.toProjectId,
            toProjectId: msg.fromProjectId,
            type: 'response',
            action: msg.action,
            subject: `Re: ${msg.subject || msg.action}`,
            content: result.message,
            parentMessageId: msg.id,
          });
        }
      } catch (error) {
        log.error(`Failed to process message ${msg.id}:`, error);
        this.db.update(agentMessages)
          .set({
            status: 'failed',
            responseContent: error instanceof Error ? error.message : 'Unknown error',
          })
          .where(eq(agentMessages.id, msg.id))
          .run();
      }
    }
  }

  /**
   * Compose a prompt from an agent message
   */
  private composePrompt(msg: typeof agentMessages.$inferSelect, fromProjectName: string): string {
    const parts = [`You received a message from the agent managing project "${fromProjectName}".`];
    parts.push(`\nMessage type: ${msg.type}`);
    parts.push(`Action: ${msg.action}`);
    if (msg.subject) parts.push(`Subject: ${msg.subject}`);
    parts.push(`\n---\n${msg.content}`);
    parts.push(`\n---\nPlease respond appropriately to this ${msg.action} request.`);
    return parts.join('\n');
  }
}
