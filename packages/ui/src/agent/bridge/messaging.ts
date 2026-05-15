/**
 * Messaging bridge methods — getMessages, syncRemoteMessages, sendMessage,
 * cancelMessage, and all SSE event processing logic.
 */

import type { Message, AgentEvent, AgentBridge, SessionStatusInfo, ContentBlock } from '../types';
import type { PlatformSSEHandler, SSEEvent } from '../BridgeCore';
import type { BridgeDeps } from './types';
import {
  parseSSEEventData,
  isKnownSSEEventType,
  type SSEEventType,
} from '../schemas/sse-events';
import { createLogger } from '../../utils/logger';

const log = createLogger('messaging');

/** Options for resolving screenshot image URLs when building history blocks. */
export interface HistoryBlockOptions {
  /** Project ID for resolving screenshot file paths. */
  projectId?: string;
  /** Platform-specific resolver: turns a relative path into a displayable URL. */
  resolveScreenshotUrl?: (projectId: string, path: string) => string;
}

/**
 * Resolve an image metadata object to a displayable URL.
 * Supports both inline data URLs (live streaming) and file paths (persisted).
 * @internal Exported for testing.
 */
export function resolveImageUrl(
  image: { dataUrl?: string; path?: string; width?: number; height?: number },
  opts?: HistoryBlockOptions,
): string | undefined {
  if (image.dataUrl) return image.dataUrl;
  if (image.path && opts?.projectId && opts?.resolveScreenshotUrl) {
    return opts.resolveScreenshotUrl(opts.projectId, image.path);
  }
  return undefined;
}

/**
 * Build contentBlocks for a historical message, injecting inline image blocks
 * for tool calls that have image metadata.
 * @internal Exported for testing.
 */
export function buildContentBlocksFromHistory(msg: Message, opts?: HistoryBlockOptions): ContentBlock[] | undefined {
  if (!msg.toolCalls || msg.toolCalls.length === 0) return undefined;

  const blocks: ContentBlock[] = [];

  // Add leading text if present
  if (msg.content) {
    blocks.push({ type: 'text', text: msg.content });
  }

  for (const tc of msg.toolCalls) {
    blocks.push({ type: 'tool_call', toolCall: tc });

    // If this tool call has image metadata, add an inline image block
    const image = tc.metadata?.image as { dataUrl?: string; path?: string; width?: number; height?: number } | undefined;
    if (image) {
      const url = resolveImageUrl(image, opts);
      if (url) {
        blocks.push({
          type: 'image',
          dataUrl: url,
          width: image.width ?? 0,
          height: image.height ?? 0,
          alt: typeof tc.result === 'string' ? tc.result : `Screenshot from ${tc.name}`,
        });
      }
    }
  }

  return blocks.length > 0 ? blocks : undefined;
}

type MessagingMethods = Pick<
  AgentBridge,
  | 'getMessages'
  | 'getMessagesPaginated'
  | 'syncRemoteMessages'
  | 'sendMessage'
  | 'cancelMessage'
  | 'getSessionStatus'
  | 'subscribeToSessionEvents'
  | 'subscribeToProject'
>;

// ========== SSE stream state ==========

interface SSEStreamState {
  messageId: string;
  assistantMessage: string;
  messageStartEmitted: boolean;
  /** Set to true when an 'aborted' event is received, suppressing the trailing done event */
  aborted?: boolean;
  /** Captured done event fields (todo/phase status) from the server */
  doneData?: {
    hasOpenTodos?: boolean;
    hasOpenPhases?: boolean;
    openTodoCount?: number;
    openPhaseCount?: number;
    todos?: Array<{ id: string; content: string; status: string; priority: string }>;
    phases?: Array<{ id: string; content: string; status: string }>;
  };
}

// ========== Module factory ==========

export function createMessagingMethods(deps: BridgeDeps): MessagingMethods {
  const { config, state, helpers } = deps;
  const {
    projects,
    localAgents,
    remoteMessages,
    sessionModelOverrides,
    remoteEventSubscribers,
    remoteActiveSessionIds,
    activeSSEStreams,
  } = state;
  const {
    generateId,
    emitEvent,
    emitRemoteEvent,
    getRemoteServerForProject,
    remoteFetch,
    toUIMessage,
    updateServerLastSeen,
  } = helpers;
  const sseHandler: PlatformSSEHandler | undefined = config.sseHandler;

  // ---------- Screenshot URL helper ----------
  const resolveScreenshotUrl = config.resolveScreenshotUrl;
  const historyBlockOpts = (projectId: string): HistoryBlockOptions => ({
    projectId,
    resolveScreenshotUrl,
  });

  // ---------- SSE helpers ----------

  const handleMessageStart = (
    data: Record<string, unknown>,
    projectId: string,
    sessionId: string,
    sseState: SSEStreamState,
  ): void => {
    if (sseState.messageStartEmitted) {
      emitRemoteEvent(projectId, {
        type: 'message.complete',
        sessionId,
        messageId: sseState.messageId,
        content: sseState.assistantMessage,
      });
    }

    const newMessageId = (data.messageId as string) || generateId();
    sseState.messageId = newMessageId;
    sseState.assistantMessage = '';
    sseState.messageStartEmitted = true;

    emitRemoteEvent(projectId, {
      type: 'message.start',
      sessionId,
      messageId: newMessageId,
    });
  };

  const ensureMessageStarted = (
    data: Record<string, unknown>,
    projectId: string,
    sessionId: string,
    sseState: SSEStreamState,
  ): void => {
    if (!sseState.messageStartEmitted) {
      handleMessageStart(data, projectId, sessionId, sseState);
    }
  };

  const processSSEEventData = (
    eventType: string,
    data: Record<string, unknown>,
    projectId: string,
    sessionId: string,
    sseState: SSEStreamState,
  ): void => {
    const type = eventType || (data.type as string);

    if (type === 'message.start') {
      handleMessageStart(data, projectId, sessionId, sseState);
      return;
    }

    if (type === 'message.delta') {
      ensureMessageStarted(data, projectId, sessionId, sseState);
      const parsed = parseSSEEventData('message.delta', data);
      const delta = parsed.delta || parsed.text || '';
      sseState.assistantMessage += delta;
      emitRemoteEvent(projectId, {
        type: 'message.delta',
        sessionId,
        messageId: sseState.messageId,
        delta,
      });
    } else if (type === 'message.complete') {
      const parsed = parseSSEEventData('message.complete', data);
      sseState.assistantMessage = parsed.content || parsed.message || sseState.assistantMessage;
    } else if (type === 'tool.start') {
      ensureMessageStarted(data, projectId, sessionId, sseState);
      const parsed = parseSSEEventData('tool.start', data);
      const tc = parsed.toolCall;
      emitRemoteEvent(projectId, {
        type: 'tool.start',
        sessionId,
        messageId: sseState.messageId,
        toolCall: {
          id: tc?.id || parsed.id || generateId(),
          name: tc?.name || parsed.name || 'unknown',
          arguments: tc?.arguments || parsed.arguments || {},
          status: 'running',
        },
      });
    } else if (type === 'tool.complete') {
      ensureMessageStarted(data, projectId, sessionId, sseState);
      const parsed = parseSSEEventData('tool.complete', data);
      const tr = parsed.toolResult;
      const toolMetadata = tr?.metadata || parsed.metadata;
      emitRemoteEvent(projectId, {
        type: 'tool.complete',
        sessionId,
        messageId: sseState.messageId,
        toolResult: {
          id: tr?.id || parsed.id || '',
          result: parsed.result ?? tr?.result,
          ...(toolMetadata ? { metadata: toolMetadata } : {}),
        },
      });
    } else if (type === 'tool.permission.request') {
      const parsed = parseSSEEventData('tool.permission.request', data);
      const tc = parsed.toolCall;
      emitRemoteEvent(projectId, {
        type: 'tool.permission.request',
        sessionId,
        messageId: parsed.messageId || sseState.messageId,
        toolCall: {
          id: tc?.id || parsed.id || generateId(),
          name: tc?.name || parsed.name || 'unknown',
          arguments: tc?.arguments || parsed.arguments || {},
          status: 'pending',
          // Propagate subagent context if present
          ...(parsed.subagentSessionId ? { subagentSessionId: parsed.subagentSessionId } : {}),
          ...(parsed.subagentDescription ? { subagentDescription: parsed.subagentDescription } : {}),
        },
        // Also set at event level for the useAgent handler
        ...(parsed.subagentSessionId ? { subagentSessionId: parsed.subagentSessionId } : {}),
        ...(parsed.subagentDescription ? { subagentDescription: parsed.subagentDescription } : {}),
      });
    } else if (type === 'tool.permission.granted') {
      const parsed = parseSSEEventData('tool.permission.granted', data);
      emitRemoteEvent(projectId, {
        type: 'tool.permission.granted',
        sessionId,
        messageId: parsed.messageId || sseState.messageId,
        toolName: parsed.toolName || '',
      });
    } else if (type === 'tool.permission.denied') {
      const parsed = parseSSEEventData('tool.permission.denied', data);
      emitRemoteEvent(projectId, {
        type: 'tool.permission.denied',
        sessionId,
        messageId: parsed.messageId || sseState.messageId,
        toolName: parsed.toolName || '',
      });
    } else if (type === 'question.request') {
      const parsed = parseSSEEventData('question.request', data);
      const options = parsed.options || [];
      emitRemoteEvent(projectId, {
        type: 'question.request',
        sessionId,
        questionId: parsed.questionId || generateId(),
        question: parsed.question || '',
        options: options.map(o => ({ label: o.label, description: o.description })),
        multiple: parsed.multiple || false,
        allowFreeform: true as const,
      });
    } else if (type === 'subagent.start') {
      const parsed = parseSSEEventData('subagent.start', data);
      emitRemoteEvent(projectId, {
        type: 'subagent.start',
        sessionId: parsed.sessionId || sessionId,
        parentSessionId: parsed.parentSessionId || sessionId,
        description: parsed.description || '',
        async: parsed.async || false,
      });
    } else if (type === 'subagent.complete') {
      const parsed = parseSSEEventData('subagent.complete', data);
      emitRemoteEvent(projectId, {
        type: 'subagent.complete',
        sessionId: parsed.sessionId || sessionId,
        parentSessionId: parsed.parentSessionId || sessionId,
        result: parsed.result || '',
      });
    } else if (type === 'subagent.error') {
      const parsed = parseSSEEventData('subagent.error', data);
      emitRemoteEvent(projectId, {
        type: 'subagent.error',
        sessionId: parsed.sessionId || sessionId,
        parentSessionId: parsed.parentSessionId || sessionId,
        error: parsed.error || 'Unknown error',
      });
    } else if (type === 'session.title.updated') {
      const parsed = parseSSEEventData('session.title.updated', data);
      emitRemoteEvent(projectId, {
        type: 'session.title.updated',
        sessionId: parsed.sessionId || sessionId,
        title: parsed.title || '',
      });
    } else if (type === 'todos.updated') {
      const parsed = parseSSEEventData('todos.updated', data);
      if (parsed.todos) {
        emitRemoteEvent(projectId, {
          type: 'todos.updated',
          sessionId,
          todos: parsed.todos,
        });
      }
    } else if (type === 'phases.updated') {
      const parsed = parseSSEEventData('phases.updated', data);
      if (parsed.phases) {
        emitRemoteEvent(projectId, {
          type: 'phases.updated',
          sessionId,
          phases: parsed.phases,
        });
      }
    } else if (type === 'compaction.start') {
      const parsed = parseSSEEventData('compaction.start', data);
      emitRemoteEvent(projectId, {
        type: 'compaction.start',
        sessionId,
        stats: {
          currentTokens: parsed.stats?.currentTokens ?? 0,
          threshold: parsed.stats?.threshold ?? 0,
          messagesToCompact: parsed.stats?.messagesToCompact ?? 0,
        },
      });
    } else if (type === 'compaction.delta') {
      const parsed = parseSSEEventData('compaction.delta', data);
      emitRemoteEvent(projectId, {
        type: 'compaction.delta',
        sessionId,
        delta: parsed.delta || '',
      });
    } else if (type === 'compaction.complete') {
      const parsed = parseSSEEventData('compaction.complete', data);
      emitRemoteEvent(projectId, {
        type: 'compaction.complete',
        sessionId,
        compactionId: parsed.compactionId || '',
        stats: {
          originalTokens: parsed.stats?.originalTokens ?? 0,
          compactedTokens: parsed.stats?.compactedTokens ?? 0,
          messagesPruned: parsed.stats?.messagesPruned ?? 0,
          compressionRatio: parsed.stats?.compressionRatio ?? 0,
        },
        contextUsage: parsed.contextUsage,
      });
    } else if (type === 'compaction.error') {
      const parsed = parseSSEEventData('compaction.error', data);
      emitRemoteEvent(projectId, {
        type: 'compaction.error',
        sessionId,
        error: parsed.error || 'Compaction failed',
      });
    } else if (type === 'error') {
      const parsed = parseSSEEventData('error', data);
      emitRemoteEvent(projectId, {
        type: 'error',
        sessionId,
        error: parsed.error || 'Unknown error',
      });
    } else if (type === 'aborted') {
      // User-initiated abort — emit as aborted so the UI can handle it cleanly
      sseState.aborted = true;
      emitRemoteEvent(projectId, {
        type: 'aborted',
        sessionId,
      });
    } else if (type === 'done') {
      const parsed = parseSSEEventData('done', data);
      if (parsed.message) {
        sseState.assistantMessage = parsed.message;
      }
      // Capture todo/phase status from the done event for forwarding
      sseState.doneData = {
        hasOpenTodos: parsed.hasOpenTodos,
        hasOpenPhases: parsed.hasOpenPhases,
        openTodoCount: parsed.openTodoCount,
        openPhaseCount: parsed.openPhaseCount,
        todos: parsed.todos,
        phases: parsed.phases,
      };
    } else if (data.message) {
      sseState.assistantMessage = data.message as string;
    }
  };

  // Parse SSE stream using fetch ReadableStream (browser/Node)
  const parseSSEStreamWithFetch = async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    projectId: string,
    sessionId: string,
    onComplete: (message: string) => void,
  ) => {
    const decoder = new TextDecoder();
    let buffer = '';
    const sseState: SSEStreamState = {
      messageId: generateId(),
      assistantMessage: '',
      messageStartEmitted: false,
    };

    let chunkCount = 0;
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          log.debug(`parseSSEStream: Stream done after ${chunkCount} chunks, ${totalBytes} bytes, assistantMessage=${sseState.assistantMessage.length} chars`);
          break;
        }

        chunkCount++;
        totalBytes += value?.length ?? 0;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              processSSEEventData(eventType, data, projectId, sessionId, sseState);
            } catch {
              // Ignore JSON parse errors
            }
            eventType = '';
          }
        }
      }
    } catch (error) {
      // If the stream was aborted by the user, the read error is expected.
      // Don't emit an error event — the aborted event was already sent.
      if (!sseState.aborted) {
        log.error('parseSSEStreamWithFetch: Error reading stream:', error);
        emitRemoteEvent(projectId, {
          type: 'error',
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // If aborted, the aborted event was already emitted by processSSEEventData.
    // Don't emit a trailing done event.
    if (!sseState.aborted) {
      if (sseState.messageStartEmitted) {
        emitRemoteEvent(projectId, {
          type: 'message.complete',
          sessionId,
          messageId: sseState.messageId,
          content: sseState.assistantMessage,
        });
      }

      emitRemoteEvent(projectId, {
        type: 'done',
        sessionId,
        ...sseState.doneData,
      });
    }
    onComplete(sseState.assistantMessage);
  };

  // Stream using platform SSE handler (React Native)
  const streamWithPlatformHandler = (
    url: string,
    headers: Record<string, string>,
    body: string,
    projectId: string,
    sessionId: string,
    onComplete: (message: string) => void,
  ): Promise<void> => {
    const timestamp = () => new Date().toISOString().split('T')[1];
    log.debug(`streamWithPlatformHandler ${timestamp()}: START`);

    return new Promise((resolve, reject) => {
      if (!sseHandler) {
        reject(new Error('No SSE handler provided'));
        return;
      }

      const sseState: SSEStreamState = {
        messageId: generateId(),
        assistantMessage: '',
        messageStartEmitted: false,
      };

      log.debug(`streamWithPlatformHandler ${timestamp()}: Calling sseHandler.connect`);
      const abort = sseHandler.connect(
        url,
        { method: 'POST', headers, body },
        (event: SSEEvent) => {
          try {
            const data = JSON.parse(event.data);
            processSSEEventData(event.type, data, projectId, sessionId, sseState);
          } catch {
            // Ignore JSON parse errors
          }
        },
        (error: Error) => {
          // If aborted, the error is expected — don't emit an error event
          if (!sseState.aborted) {
            log.error(`streamWithPlatformHandler ${timestamp()}: onError callback: ${error.message}`);
            emitRemoteEvent(projectId, { type: 'error', sessionId, error: error.message });
          }
          reject(error);
        },
        () => {
          log.debug(`streamWithPlatformHandler ${timestamp()}: onComplete callback`);
          // If aborted, the aborted event was already emitted. Don't emit trailing done.
          if (!sseState.aborted) {
            if (sseState.messageStartEmitted) {
              emitRemoteEvent(projectId, {
                type: 'message.complete',
                sessionId,
                messageId: sseState.messageId,
                content: sseState.assistantMessage,
              });
            }

            emitRemoteEvent(projectId, {
              type: 'done',
              sessionId,
              ...sseState.doneData,
            });
          }
          onComplete(sseState.assistantMessage);
          log.debug(`streamWithPlatformHandler ${timestamp()}: Calling resolve()`);
          resolve();
        },
      );

      void abort;
    });
  };

  // We need a reference to the bridge's syncRemoteMessages for the sendMessage fallback.
  // We'll capture it via a lazy ref that the composition layer sets after construction.
  let selfSyncRemoteMessages: ((projectId: string, sessionId: string) => Promise<void>) | null = null;

  const methods: MessagingMethods & { _setSelfSync: (fn: (projectId: string, sessionId: string) => Promise<void>) => void } = {
    // Allows the composition layer to inject a self-reference
    _setSelfSync(fn) {
      selfSyncRemoteMessages = fn;
    },

    async getMessages(projectId, sessionId) {
      const server = getRemoteServerForProject(projectId);
      if (server) {
        return remoteMessages.get(sessionId) || [];
      }

      const managed = localAgents.get(projectId);
      if (!managed) return [];

      const messages = await managed.sessionManager.getSessionMessages(sessionId);

      // Filter out tool-result messages (user messages that just carry tool
      // results back to the agent) — same as the remote path does.
      const visibleMessages = messages.filter(m => {
        if (m.role === 'user' && m.toolResults && m.toolResults.length > 0) {
          return false;
        }
        return true;
      });

      // Build a map of tool results so we can attach them to tool calls
      const toolResultsMap = new Map<string, { content: unknown; isError?: boolean; metadata?: Record<string, unknown> }>();
      for (const m of messages) {
        if (m.toolResults) {
          for (const tr of m.toolResults) {
            toolResultsMap.set(tr.toolCallId, { content: tr.content, isError: tr.isError, metadata: (tr as any).metadata });
          }
        }
      }

      return visibleMessages.map(m => {
        const msg = toUIMessage(m);
        // Attach tool results to their corresponding tool calls
        if (msg.toolCalls) {
          msg.toolCalls = msg.toolCalls.map(tc => {
            const result = toolResultsMap.get(tc.id);
            if (result) {
              return { ...tc, result: result.content, metadata: result.metadata, status: 'complete' as const };
            }
            return tc;
          });
        }
        // Build content blocks with inline images from tool metadata
        msg.contentBlocks = buildContentBlocksFromHistory(msg, historyBlockOpts(projectId));
        return msg;
      });
    },

    async getMessagesPaginated(projectId, sessionId, limit, beforeSequence?) {
      const server = getRemoteServerForProject(projectId);
      if (server) {
        // Use server-side paginated API
        try {
          const qs = new URLSearchParams({ limit: String(limit) });
          if (beforeSequence !== undefined) {
            qs.set('beforeSequence', String(beforeSequence));
          }
          const response = await remoteFetch(
            server,
            `/projects/${projectId}/sessions/${sessionId}/messages?${qs.toString()}`,
          );
          if (!response.ok) {
            log.error('getMessagesPaginated remote: HTTP', response.status);
            return { messages: [], hasMore: false };
          }
          const data = await response.json();
          const rawMessages: any[] = data.messages || [];
          const hasMore: boolean = data.hasMore ?? false;

          // Build tool results map from the page itself
          const toolResultsMap = new Map<string, any>();
          for (const m of rawMessages) {
            if (m.toolResults) {
              for (const tr of m.toolResults) {
                toolResultsMap.set(tr.toolCallId, tr);
              }
            }
          }

          // Filter out tool-result-only messages and build UI messages
          const visibleMessages = rawMessages.filter((m: any) => {
            if (m.role === 'user' && m.toolResults && m.toolResults.length > 0) {
              return false;
            }
            return true;
          });

          const messages: Message[] = visibleMessages.map((m: any) => {
            const msg: Message = {
              id: m.id,
              role: m.role,
              content: m.content,
              isCompactionSummary: m.isCompactionSummary ?? (m.content?.startsWith('[Conversation Summary]') || undefined),
              toolCalls: m.toolCalls?.map((tc: any) => {
                const result = toolResultsMap.get(tc.id);
                return {
                  id: tc.id,
                  name: tc.name,
                  arguments: tc.arguments || {},
                  status: 'complete' as const,
                  result: result ? (result.isError ? `Error: ${result.content}` : result.content) : tc.result,
                  metadata: result?.metadata,
                };
              }),
              sequence: m.sequence,
              createdAt: m.createdAt ? new Date(m.createdAt).getTime() : Date.now(),
            };
            msg.contentBlocks = buildContentBlocksFromHistory(msg, historyBlockOpts(projectId));
            return msg;
          });

          return { messages, hasMore };
        } catch (e) {
          log.error('getMessagesPaginated remote error:', e);
          return { messages: [], hasMore: false };
        }
      }

      const managed = localAgents.get(projectId);
      if (!managed) return { messages: [], hasMore: false };

      const result = await managed.sessionManager.getSessionMessagesPaginated(
        sessionId,
        limit,
        beforeSequence,
      );

      // Collect all tool-call IDs from the page that need results
      const neededToolCallIds = new Set<string>();
      for (const m of result.messages) {
        if (m.toolCalls) {
          for (const tc of m.toolCalls) {
            neededToolCallIds.add(tc.id);
          }
        }
      }

      // Build tool results map from tool-result messages within the page.
      // Tool results are stored as messages with role='user' and toolResults array.
      // They typically follow the assistant message containing the tool calls,
      // so they should be in the same page or a nearby one.
      const toolResultsMap = new Map<string, { content: unknown; isError?: boolean; metadata?: Record<string, unknown> }>();
      for (const m of result.messages) {
        if (m.toolResults) {
          for (const tr of m.toolResults) {
            if (neededToolCallIds.has(tr.toolCallId)) {
              toolResultsMap.set(tr.toolCallId, { content: tr.content, isError: tr.isError, metadata: (tr as any).metadata });
            }
          }
        }
      }

      // If any tool calls still lack results (the tool-result message is outside
      // the page), fetch just those results from the full message list.
      // This is a targeted lookup, not a full scan.
      const missingIds = [...neededToolCallIds].filter(id => !toolResultsMap.has(id));
      if (missingIds.length > 0) {
        const allMsgs = await managed.sessionManager.getSessionMessages(sessionId);
        for (const m of allMsgs) {
          if (m.toolResults) {
            for (const tr of m.toolResults) {
              if (missingIds.includes(tr.toolCallId)) {
                toolResultsMap.set(tr.toolCallId, { content: tr.content, isError: tr.isError, metadata: (tr as any).metadata });
              }
            }
          }
        }
      }

      // Filter out tool-result messages and attach results to tool calls
      const visibleMessages = result.messages.filter(m => {
        if (m.role === 'user' && m.toolResults && m.toolResults.length > 0) {
          return false;
        }
        return true;
      });

      const uiMessages = visibleMessages.map(m => {
        const msg = toUIMessage(m);
        if (msg.toolCalls) {
          msg.toolCalls = msg.toolCalls.map(tc => {
            const tr = toolResultsMap.get(tc.id);
            if (tr) {
              return { ...tc, result: tr.content, metadata: tr.metadata, status: 'complete' as const };
            }
            return tc;
          });
        }
        // Build content blocks with inline images from tool metadata
        msg.contentBlocks = buildContentBlocksFromHistory(msg, historyBlockOpts(projectId));
        return msg;
      });

      return { messages: uiMessages, hasMore: result.hasMore };
    },

    async syncRemoteMessages(projectId, sessionId) {
      const server = getRemoteServerForProject(projectId);
      if (!server) {
        log.debug('syncRemoteMessages: Not a remote project:', projectId);
        return;
      }

      try {
        log.debug('syncRemoteMessages: Fetching messages for session:', sessionId);
        const response = await remoteFetch(server, `/projects/${projectId}/sessions/${sessionId}/messages`);

        if (response.ok) {
          const data = await response.json();
          const rawMessages = Array.isArray(data) ? data : data.messages || [];

          const visibleMessages = rawMessages.filter((m: any) => {
            if (m.role === 'user' && m.toolResults && m.toolResults.length > 0) {
              return false;
            }
            return true;
          });

          const toolResultsMap = new Map<string, any>();
          for (const m of rawMessages) {
            if (m.toolResults) {
              for (const tr of m.toolResults) {
                toolResultsMap.set(tr.toolCallId, tr);
              }
            }
          }

          const messages: Message[] = visibleMessages.map((m: any) => {
            const msg: Message = {
              id: m.id,
              role: m.role,
              content: m.content,
              toolCalls: m.toolCalls?.map((tc: any) => {
                const result = toolResultsMap.get(tc.id);
                return {
                  id: tc.id,
                  name: tc.name,
                  arguments: tc.arguments || {},
                  status: 'complete' as const,
                  result: result ? (result.isError ? `Error: ${result.content}` : result.content) : tc.result,
                  metadata: result?.metadata,
                };
              }),
              createdAt: m.createdAt ? new Date(m.createdAt).getTime() : Date.now(),
            };
            msg.contentBlocks = buildContentBlocksFromHistory(msg, historyBlockOpts(projectId));
            return msg;
          });

          log.debug('syncRemoteMessages: Got', messages.length, 'messages (from', rawMessages.length, 'raw)');
          remoteMessages.set(sessionId, messages);
        } else {
          log.error('syncRemoteMessages: Failed:', response.status);
        }
      } catch (e) {
        log.error('syncRemoteMessages: Error:', e);
      }
    },

    async sendMessage(projectId, sessionId, content, _options) {
      const timestamp = () => new Date().toISOString().split('T')[1];
      log.debug(`sendMessage ${timestamp()}: START projectId: ${projectId}, sessionId: ${sessionId}`);

      const sessionOverride = sessionModelOverrides.get(sessionId);
      if (sessionOverride) {
        log.debug(`sendMessage ${timestamp()}: Session model override:`, sessionOverride);
      }

      // Remote projects — streaming
      const server = getRemoteServerForProject(projectId);
      if (server) {
        log.debug(`sendMessage ${timestamp()}: Found remote server, using streaming`);
        remoteActiveSessionIds.set(projectId, sessionId);
        activeSSEStreams.add(sessionId);

        const streamUrl = `${server.url}/api/beta/projects/${projectId}/sessions/${sessionId}/prompt/stream`;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (server.token) {
          headers['Authorization'] = `Bearer ${server.token}`;
        }
        const bodyObj: { prompt: string; provider?: string; model?: string } = { prompt: content };
        if (sessionOverride) {
          bodyObj.provider = sessionOverride.provider;
          bodyObj.model = sessionOverride.model;
        }
        const body = JSON.stringify(bodyObj);

        const onStreamComplete = (_assistantMessage: string) => {
          log.debug(`sendMessage ${timestamp()}: onStreamComplete callback fired`);
        };

        try {
          if (sseHandler) {
            log.debug(`sendMessage ${timestamp()}: Calling streamWithPlatformHandler...`);
            await streamWithPlatformHandler(streamUrl, headers, body, projectId, sessionId, onStreamComplete);
            updateServerLastSeen(server.id);
            log.debug(`sendMessage ${timestamp()}: streamWithPlatformHandler returned`);
          } else {
            log.debug('sendMessage: Using fetch streaming');
            const response = await fetch(streamUrl, { method: 'POST', headers, body });

            if (!response.ok) {
              const errorText = await response.text();
              let friendly = errorText;
              try {
                const parsed = JSON.parse(errorText) as { error?: string };
                if (parsed?.error) friendly = parsed.error;
              } catch {
                // not JSON, use raw text
              }
              throw new Error(friendly);
            }

            updateServerLastSeen(server.id);

            const reader = response.body?.getReader();
            if (!reader) {
              throw new Error('No response body - streaming not supported on this platform');
            }

            await parseSSEStreamWithFetch(reader, projectId, sessionId, onStreamComplete);
          }
        } catch (error) {
          log.error(`sendMessage ${timestamp()}: Streaming error:`, error);
          emitRemoteEvent(projectId, {
            type: 'error',
            sessionId,
            error: error instanceof Error ? error.message : String(error),
          });

          if (selfSyncRemoteMessages) {
            await selfSyncRemoteMessages(projectId, sessionId);
          }
        } finally {
          activeSSEStreams.delete(sessionId);
        }

        log.debug(`sendMessage ${timestamp()}: END (remote path)`);
        return;
      }

      // Local projects
      const managed = localAgents.get(projectId);
      if (!managed) {
        log.warn('sendMessage: Project not found:', projectId);
        throw new Error(`Project not found: ${projectId}`);
      }
      log.debug('sendMessage: Found managed agent, workingDirectory:', managed.workingDirectory);

      managed.currentSessionId = sessionId;
      managed.agent.setSessionContext({ sessionId });

      const existingMessages = await managed.sessionManager.getSessionMessages(sessionId);
      log.debug('sendMessage: Loaded', existingMessages.length, 'existing messages');
      managed.agent.setMessages(existingMessages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls,
        toolResults: m.toolResults?.map(tr => ({
          id: tr.toolCallId,
          name: '',
          result: tr.content,
          isError: tr.isError,
        })),
      })));

      // Hydrate the usage tracker with persisted token stats so the
      // TokenUsageBar widget shows cumulative usage across session reloads.
      if (managed.agent.getUsageTracker && managed.sessionManager.getTokenUsage) {
        try {
          const storedUsage = await managed.sessionManager.getTokenUsage(sessionId);
          if (storedUsage && storedUsage.requestCount > 0) {
            const session = await managed.sessionManager.getSession(sessionId);
            const config = managed.agent.getModel();
            managed.agent.getUsageTracker().hydrate(
              sessionId,
              (session as any)?.model ?? config.model,
              (session as any)?.provider ?? config.provider,
              storedUsage,
              (session as any)?.parentId ?? undefined,
            );
          }
        } catch (err) {
          log.warn('sendMessage: Failed to hydrate token usage:', err);
        }
      }

      managed.agent.clearToolPermissions();

      if (sessionOverride) {
        managed.agent.setModel(sessionOverride.provider, sessionOverride.model);
      }

      try {
        log.debug('sendMessage: Calling agent.prompt with:', content.substring(0, 50));
        const priorMessageCount = existingMessages.length;
        const response = await managed.agent.prompt(content);
        log.debug('sendMessage: Got response:', response.content?.substring(0, 50));

        // If the agent has incremental persistence (via the storage plugin's
        // onMessageAdded hook), messages are already saved to disk as they
        // were produced during prompt(). Otherwise fall back to saving them
        // in a batch here.
        if (!managed.hasIncrementalPersistence) {
          const allAgentMessages = managed.agent.getMessages();
          const newMessages = allAgentMessages.slice(priorMessageCount);
          log.debug('sendMessage: Storing', newMessages.length, 'new messages (prior:', priorMessageCount, ')');

          let seq = await managed.sessionManager.getNextSequence(sessionId);
          for (const msg of newMessages) {
            const msgContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            await managed.sessionManager.addMessage({
              sessionId,
              role: msg.role,
              content: msgContent,
              toolCalls: msg.toolCalls?.map(tc => ({
                id: tc.id,
                name: tc.name,
                arguments: tc.arguments,
              })),
              toolResults: msg.toolResults?.map(tr => ({
                toolCallId: tr.id,
                content: tr.result,
                isError: tr.isError,
              })),
              sequence: seq++,
            });
          }
        } else {
          log.debug('sendMessage: Incremental persistence active, skipping batch save');
        }

        // Include todo/phase status for auto-complete feature
        const todos = managed.agent.getTodos?.() ?? [];
        const phases = managed.agent.getPhases?.() ?? [];
        const hasOpenTodos = todos.some((t: { status: string }) => t.status === 'pending' || t.status === 'in_progress');
        const hasOpenPhases = phases.some((p: { status: string }) => p.status === 'pending' || p.status === 'in_progress');
        emitEvent(projectId, {
          type: 'done',
          sessionId,
          hasOpenTodos,
          hasOpenPhases,
          openTodoCount: todos.filter((t: { status: string }) => t.status === 'pending' || t.status === 'in_progress').length,
          openPhaseCount: phases.filter((p: { status: string }) => p.status === 'pending' || p.status === 'in_progress').length,
          todos: todos as any,
          phases: phases as any,
        });

        // Generate session title if not already set (fire-and-forget)
        if (managed.agent.generateSessionTitle && !managed.hasIncrementalPersistence) {
          const session = await managed.sessionManager.getSession(sessionId);
          const title = session?.title;
          if (!title || title === 'New conversation' || title.toLowerCase() === 'untitled') {
            const allMessages = managed.agent.getMessages();
            managed.agent.generateSessionTitle(
              allMessages.map(m => ({
                role: m.role,
                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
              })),
            ).then(async (newTitle) => {
              if (newTitle && managed.sessionManager.updateSessionTitle) {
                await managed.sessionManager.updateSessionTitle(sessionId, newTitle);
                emitEvent(projectId, {
                  type: 'session.title.updated',
                  sessionId,
                  title: newTitle,
                } as AgentEvent);
                log.debug('sendMessage: Generated session title:', newTitle);
              }
            }).catch((e) => {
              log.warn('sendMessage: Title generation failed:', e);
            });
          }
        }
      } catch (error) {
        // Check if this was a user-initiated abort (AbortError from fetch/signal)
        const isAbort = error instanceof DOMException && error.name === 'AbortError'
          || (error instanceof Error && error.message.includes('aborted'));
        if (isAbort) {
          emitEvent(projectId, {
            type: 'aborted',
            sessionId,
            status: 'aborted',
          });
        } else {
          emitEvent(projectId, {
            type: 'error',
            sessionId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },

    async cancelMessage(projectId) {
      const server = getRemoteServerForProject(projectId);
      if (server) {
        // Remote project: call the abort endpoint on the server
        try {
          // Find the active session for this project from the active SSE streams
          const activeSessionId = remoteActiveSessionIds.get(projectId);
          if (activeSessionId) {
            await remoteFetch(server, `/projects/${projectId}/sessions/${activeSessionId}/abort`, {
              method: 'POST',
            });
          }
        } catch (e) {
          log.error(`Failed to cancel remote message for project ${projectId}:`, e);
        }
        return;
      }

      const managed = localAgents.get(projectId);
      if (managed) {
        managed.agent.cancel();
      }
    },

    // ============ Session Status & Reconnection ============

    async getSessionStatus(projectId, sessionId) {
      const server = getRemoteServerForProject(projectId);
      if (!server) return null;

      try {
        const response = await remoteFetch(server, `/projects/${projectId}/sessions/${sessionId}/status`);
        if (response.ok) {
          return await response.json();
        }
        return null;
      } catch (e) {
        log.error('getSessionStatus: Error:', e);
        return null;
      }
    },

    async subscribeToSessionEvents(projectId, sessionId, lastEventIndex) {
      const server = getRemoteServerForProject(projectId);
      if (!server) return null;

      // If there's already an active SSE stream for this session (e.g. sendMessage
      // is still consuming the prompt/stream), skip subscribing to avoid duplicate events.
      if (activeSSEStreams.has(sessionId)) {
        log.debug('subscribeToSessionEvents: Skipping — active SSE stream already exists for session:', sessionId);
        return null;
      }

      remoteActiveSessionIds.set(projectId, sessionId);
      activeSSEStreams.add(sessionId);

      const eventsUrl = `${server.url}/api/beta/projects/${projectId}/sessions/${sessionId}/events${lastEventIndex !== undefined ? `?lastEventIndex=${lastEventIndex}` : ''}`;
      const headers: Record<string, string> = {};
      if (server.token) {
        headers['Authorization'] = `Bearer ${server.token}`;
      }

      let aborted = false;
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

      const sseState: SSEStreamState = {
        messageId: generateId(),
        assistantMessage: '',
        messageStartEmitted: false,
      };

      const consume = async () => {
        try {
          log.debug(`subscribeToSessionEvents: Connecting to ${eventsUrl}`);
          const response = await fetch(eventsUrl, { headers });

          if (!response.ok) {
            log.warn(`subscribeToSessionEvents: Response not ok: ${response.status}`);
            return;
          }

          reader = response.body?.getReader() || null;
          if (!reader) return;

          updateServerLastSeen(server.id);

          const decoder = new TextDecoder();
          let buffer = '';

          while (!aborted) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            let eventType = '';
            for (const line of lines) {
              if (line.startsWith('event: ')) {
                eventType = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  processSSEEventData(eventType, data, projectId, sessionId, sseState);
                } catch {
                  // Ignore parse errors
                }
                eventType = '';
              }
            }
          }

          if (sseState.messageStartEmitted && !sseState.aborted) {
            emitRemoteEvent(projectId, {
              type: 'message.complete',
              sessionId,
              messageId: sseState.messageId,
              content: sseState.assistantMessage,
            });
          }
        } catch (e) {
          if (!aborted && !sseState.aborted) {
            log.error('subscribeToSessionEvents: Stream error:', e);
            emitRemoteEvent(projectId, {
              type: 'error',
              sessionId,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        } finally {
          activeSSEStreams.delete(sessionId);
        }
      };

      consume();

      return () => {
        aborted = true;
        activeSSEStreams.delete(sessionId);
        if (reader) {
          try {
            reader.cancel();
          } catch {
            // Reader may already be closed
          }
        }
      };
    },

    // ============ Events ============

    subscribeToProject(projectId, callback) {
      const project = projects.get(projectId);

      if (project?.providerType === 'remote') {
        let subscribers = remoteEventSubscribers.get(projectId);
        if (!subscribers) {
          subscribers = new Set();
          remoteEventSubscribers.set(projectId, subscribers);
        }
        subscribers.add(callback);

        log.debug('subscribeToProject: Added subscriber for remote project:', projectId, 'total:', subscribers.size);

        return () => {
          const subs = remoteEventSubscribers.get(projectId);
          if (subs) {
            subs.delete(callback);
            log.debug('subscribeToProject: Removed subscriber for remote project:', projectId, 'remaining:', subs.size);
            if (subs.size === 0) {
              remoteEventSubscribers.delete(projectId);
            }
          }
        };
      }

      return () => {};
    },
  };

  return methods;
}
