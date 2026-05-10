/**
 * MessageProcessor - Background processor for the channel message queue
 * 
 * Handles:
 * - Processing inbound messages (triggering agent sessions)
 * - Processing outbound messages (sending to platforms)
 * - Managing typing indicators
 */

import { v4 as uuidv4 } from 'uuid';
import type { ChannelManager } from './channel-manager.js';
import type { MessageQueueService } from './message-queue.js';
import type { ProjectManager } from './project-manager.js';
import type { 
  QueuedMessage, 
  InboundMessage, 
  OutboundMessage,
  ChannelProjectBinding,
} from '../channels/types.js';
import type { ChannelAdapter } from '../channels/adapter.js';
import { getErrorMessage } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('MessageProcessor');
// ============================================================================
// Types
// ============================================================================

interface ProcessorOptions {
  pollIntervalMs?: number;
  batchSize?: number;
}

// ============================================================================
// MessageProcessor
// ============================================================================

export class MessageProcessor {
  private channelManager: ChannelManager;
  private messageQueue: MessageQueueService;
  private projectManager: ProjectManager;
  private options: Required<ProcessorOptions>;
  private running = false;
  private pollTimeout: NodeJS.Timeout | null = null;

  constructor(
    channelManager: ChannelManager,
    messageQueue: MessageQueueService,
    projectManager: ProjectManager,
    options?: ProcessorOptions
  ) {
    this.channelManager = channelManager;
    this.messageQueue = messageQueue;
    this.projectManager = projectManager;
    this.options = {
      pollIntervalMs: options?.pollIntervalMs ?? 1000,
      batchSize: options?.batchSize ?? 5,
    };
  }

  /**
   * Start the message processor
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    log.info('Message processor started');
    this.poll();
  }

  /**
   * Stop the message processor
   */
  stop(): void {
    this.running = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
    log.info('Message processor stopped');
  }

  /**
   * Poll for messages and process them
   */
  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      // Process inbound messages
      const inboundMessages = this.messageQueue.dequeueBatch(this.options.batchSize, 'inbound');
      for (const message of inboundMessages) {
        await this.processInbound(message);
      }

      // Process outbound messages
      const outboundMessages = this.messageQueue.dequeueBatch(this.options.batchSize, 'outbound');
      for (const message of outboundMessages) {
        await this.processOutbound(message);
      }
    } catch (error) {
      log.error('Error in message processor poll:', error);
    }

    // Schedule next poll
    this.pollTimeout = setTimeout(() => this.poll(), this.options.pollIntervalMs);
  }

  /**
   * Process an inbound message
   */
  private async processInbound(queued: QueuedMessage): Promise<void> {
    const message = queued.payload as InboundMessage;
    log.info(`Processing inbound message ${queued.id} from channel ${queued.channelId}`);

    try {
      // Get channel
      const channel = this.channelManager.getChannel(queued.channelId);
      if (!channel) {
        this.messageQueue.markFailed(queued.id, 'Channel not found');
        return;
      }

      // Find matching bindings
      const bindings = this.channelManager.findMatchingBindings(message);
      if (bindings.length === 0) {
        // No bindings match - this is not an error, just no action needed
        log.debug(`No matching bindings for message ${queued.id}`);
        this.messageQueue.markCompleted(queued.id);
        return;
      }

      // Use the highest priority binding
      const binding = bindings[0];
      this.messageQueue.updateBindingId(queued.id, binding.id);

      // Get or create thread session
      const adapter = this.channelManager.getAdapter(channel.type);
      const threadId = adapter?.getThreadId(message) || message.platformThreadId || message.platformMessageId;
      
      const threadSession = this.channelManager.getOrCreateThreadSession(
        channel.id,
        binding.projectId,
        threadId,
        () => uuidv4()
      );

      // Add typing indicator
      await this.addTypingIndicator(channel.id, message.platformChannelId, message.platformMessageId);

      // Send to agent
      const response = await this.sendToAgent(binding, message, threadSession.sessionId);

      // Remove typing indicator and add completion indicator
      await this.removeTypingIndicator(channel.id, message.platformChannelId, message.platformMessageId);
      await this.addCompletionIndicator(channel.id, message.platformChannelId, message.platformMessageId);

      // Queue response for sending
      if (response) {
        const outbound: OutboundMessage = {
          channelId: channel.id,
          projectId: binding.projectId,
          sessionId: threadSession.sessionId,
          targetChannelId: message.platformChannelId,
          targetThreadId: threadId,
          content: response,
        };

        this.messageQueue.enqueueOutbound({
          channelId: channel.id,
          payload: outbound,
          sessionId: threadSession.sessionId,
          platformRef: threadId,
        });
      }

      this.messageQueue.markCompleted(queued.id, threadSession.sessionId);
    } catch (error) {
      log.error(`Error processing inbound message ${queued.id}:`, error);
      this.messageQueue.markFailed(queued.id, getErrorMessage(error, 'Unknown error'));
    }
  }

  /**
   * Process an outbound message
   */
  private async processOutbound(queued: QueuedMessage): Promise<void> {
    const message = queued.payload as OutboundMessage;
    log.info(`Processing outbound message ${queued.id} to channel ${queued.channelId}`);

    try {
      // Get channel
      const channel = this.channelManager.getChannel(queued.channelId);
      if (!channel) {
        this.messageQueue.markFailed(queued.id, 'Channel not found');
        return;
      }

      // Get adapter and initialize with channel
      const adapter = this.channelManager.getAdapter(channel.type);
      if (!adapter) {
        this.messageQueue.markFailed(queued.id, 'Adapter not found');
        return;
      }

      await adapter.initialize(channel);

      // Send message
      const result = await adapter.sendMessage(message);

      if (result.success) {
        this.messageQueue.markCompleted(queued.id);
      } else {
        this.messageQueue.markFailed(queued.id, result.error || 'Send failed');
      }
    } catch (error) {
      log.error(`Error processing outbound message ${queued.id}:`, error);
      this.messageQueue.markFailed(queued.id, getErrorMessage(error, 'Unknown error'));
    }
  }

  /**
   * Send a message to the agent and get response
   */
  private async sendToAgent(
    binding: ChannelProjectBinding,
    message: InboundMessage,
    sessionId: string
  ): Promise<string | null> {
    try {
      // Get project
      const project = await this.projectManager.getProject(binding.projectId);
      if (!project) {
        throw new Error(`Project not found: ${binding.projectId}`);
      }

      // Check if project has a running server
      if (!project.serverPort) {
        // Try to start the server
        const result = await this.projectManager.restartServer(binding.projectId);
        if (!result) {
          throw new Error('Failed to start project agent server');
        }
        // Refresh project info
        const updatedProject = await this.projectManager.getProject(binding.projectId);
        if (!updatedProject?.serverPort) {
          throw new Error('Failed to start project agent server');
        }
        Object.assign(project, updatedProject);
      }

      // Send prompt to agent
      // The agent API expects: POST /sessions/:sessionId/prompt
      const agentUrl = `http://127.0.0.1:${project.serverPort}`;
      
      // First, ensure session exists
      const sessionResponse = await fetch(`${agentUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId }),
      });

      if (!sessionResponse.ok && sessionResponse.status !== 409) {
        // 409 means session already exists, which is fine
        const error = await sessionResponse.text();
        throw new Error(`Failed to create session: ${error}`);
      }

      // Send prompt
      const promptResponse = await fetch(`${agentUrl}/sessions/${sessionId}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: message.content,
          stream: false,
        }),
      });

      if (!promptResponse.ok) {
        const error = await promptResponse.text();
        throw new Error(`Agent prompt failed: ${error}`);
      }

      const result = await promptResponse.json() as { 
        response?: string; 
        content?: string;
        message?: string;
      };
      
      return result.response || result.content || result.message || null;
    } catch (error) {
      log.error('Error sending to agent:', error);
      throw error;
    }
  }

  /**
   * Execute an operation with an initialized adapter for a channel.
   * Silently catches and logs errors since adapter operations are non-critical.
   */
  private async withAdapter(
    channelId: string,
    operation: string,
    fn: (adapter: ChannelAdapter) => Promise<void>
  ): Promise<void> {
    try {
      const channel = this.channelManager.getChannel(channelId);
      if (!channel) return;

      const adapter = this.channelManager.getAdapter(channel.type);
      if (!adapter) return;

      await adapter.initialize(channel);
      await fn(adapter);
    } catch (error) {
      log.debug(`Failed to ${operation}:`, error);
    }
  }

  /**
   * Add typing indicator (eyes emoji)
   */
  private async addTypingIndicator(
    channelId: string,
    platformChannelId: string,
    messageId: string
  ): Promise<void> {
    await this.withAdapter(channelId, 'add typing indicator', async (adapter) => {
      if (adapter.addReaction) {
        await adapter.addReaction(platformChannelId, messageId, 'eyes');
      }
    });
  }

  /**
   * Remove typing indicator
   */
  private async removeTypingIndicator(
    channelId: string,
    platformChannelId: string,
    messageId: string
  ): Promise<void> {
    await this.withAdapter(channelId, 'remove typing indicator', async (adapter) => {
      if (adapter.removeReaction) {
        await adapter.removeReaction(platformChannelId, messageId, 'eyes');
      }
    });
  }

  /**
   * Add completion indicator (checkmark emoji)
   */
  private async addCompletionIndicator(
    channelId: string,
    platformChannelId: string,
    messageId: string
  ): Promise<void> {
    await this.withAdapter(channelId, 'add completion indicator', async (adapter) => {
      if (adapter.addReaction) {
        await adapter.addReaction(platformChannelId, messageId, 'white_check_mark');
      }
    });
  }
}
