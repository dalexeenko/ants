import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ProjectManager } from '../services/project-manager.js';
import type { ApprovalManager } from '../services/approval-manager.js';
import type { PushNotificationService } from '../services/push-notification.js';
import type { AuthUser } from '../auth/provider.js';
import { getErrorMessage } from '../utils/errors.js';
import { SessionEventBuffer } from '../services/session-event-buffer.js';
import { parseBody } from '../utils/validation.js';
import { PromptSchema } from '../schemas/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('session-streaming');

/**
 * Session streaming routes — SSE streaming, event subscription, status, and abort.
 *
 * Split from sessions.ts so that CRUD stays separate from streaming concerns.
 * The SessionEventBuffer is shared across streaming routes to enable:
 * - Disconnected clients to reconnect and replay missed events
 * - Multiple clients to subscribe to the same session's events simultaneously
 */
export function createSessionStreamingRoutes(
  projectManager: ProjectManager,
  approvalManager: ApprovalManager,
  pushService?: PushNotificationService,
) {
  const app = new Hono();

  // Shared event buffer for all sessions managed by this server
  const eventBuffer = new SessionEventBuffer();

  // ==========================================================================
  // Session status endpoint
  // Clients can poll this to check if a session is actively processing,
  // and get the event index for reconnection.
  // ==========================================================================
  app.get('/:projectId/sessions/:sessionId/status', async (c) => {
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');

    try {
      // Verify session exists on agent-server
      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) {
        return c.json({ error: 'Agent server not available' }, 503);
      }

      try {
        await agentClient.getSession(sessionId);
      } catch (e) {
        const msg = getErrorMessage(e);
        if (msg.includes('404')) {
          return c.json({ error: 'Session not found' }, 404);
        }
        throw e;
      }

      const streamInfo = eventBuffer.getSessionInfo(sessionId);
      return c.json({
        sessionId,
        stream: streamInfo,
      });
    } catch (e) {
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  });

  // ==========================================================================
  // Event subscribe endpoint (SSE)
  // Clients can subscribe to a session's events. If the session is active,
  // they get live events. If they pass ?lastEventIndex=N, they replay from
  // that index first.
  // This enables:
  // - Reconnecting after disconnect (replay missed events + get live events)
  // - Multiple clients watching the same session
  // ==========================================================================
  app.get('/:projectId/sessions/:sessionId/events', async (c) => {
    const sessionId = c.req.param('sessionId');
    const lastEventIndexStr = c.req.query('lastEventIndex');
    const lastEventIndex = lastEventIndexStr !== undefined ? parseInt(lastEventIndexStr, 10) : undefined;

    const streamInfo = eventBuffer.getSessionInfo(sessionId);

    // If session is idle (never started or buffer expired), return 204 No Content
    if (streamInfo.status === 'idle') {
      return c.json({ error: 'No active or recent stream for this session' }, 404);
    }

    // If session already completed/errored/aborted and client has all events, return status
    if ((streamInfo.status === 'completed' || streamInfo.status === 'error' || streamInfo.status === 'aborted') &&
        lastEventIndex !== undefined && lastEventIndex >= streamInfo.eventCount) {
      return c.json({
        status: streamInfo.status,
        message: streamInfo.finalMessage,
        error: streamInfo.error,
      });
    }

    const encoder = new TextEncoder();
    // Store unsubscribe in closure so cancel() can access it
    let unsubscribeFn: (() => void) | null = null;

    return c.body(
      new ReadableStream({
        start(controller) {
          const sendSSE = (eventType: string, data: unknown, index: number) => {
            const payload = JSON.stringify({ ...data as object, _eventIndex: index });
            controller.enqueue(encoder.encode(`event: ${eventType}\ndata: ${payload}\n\n`));
          };

          // Subscribe to events. The buffer replays from lastEventIndex if provided.
          const fromIndex = lastEventIndex !== undefined ? lastEventIndex : 0;
          const unsubscribe = eventBuffer.subscribe(
            sessionId,
            (event) => {
              try {
                sendSSE(event.type, event.data, event.index);

                // If this is a terminal event, close the stream after sending
                if (event.type === 'done' || event.type === 'error' || event.type === 'aborted') {
                  // Small delay to ensure the event is flushed
                  setTimeout(() => {
                    try {
                      controller.close();
                    } catch {
                      // Already closed
                    }
                  }, 100);
                }
              } catch {
                // Controller may be closed if client disconnected
              }
            },
            fromIndex,
          );

          // If subscription failed (session not found in buffer), close immediately
          if (!unsubscribe) {
            try {
              controller.close();
            } catch {
              // Already closed
            }
            return;
          }

          // Store for cleanup on cancel
          unsubscribeFn = unsubscribe;

          // If session is already completed/errored/aborted and replay already sent all events
          // (including 'done'/'error'/'aborted'), close after replay
          const currentInfo = eventBuffer.getSessionInfo(sessionId);
          if (currentInfo.status === 'completed' || currentInfo.status === 'error' || currentInfo.status === 'aborted') {
            if (currentInfo.eventCount === 0) {
              try {
                controller.close();
              } catch {
                // Already closed
              }
            }
          }
        },
        cancel() {
          // Client disconnected - unsubscribe from live events
          if (unsubscribeFn) {
            unsubscribeFn();
            unsubscribeFn = null;
          }
        },
      }),
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      }
    );
  });

  // ==========================================================================
  // Send prompt with SSE streaming
  // Proxies the SSE stream from the agent server to the client AND
  // buffers all events in the SessionEventBuffer. The agent-server handles
  // message storage; the openmgr server does not duplicate it.
  // ==========================================================================
  app.post('/:projectId/sessions/:sessionId/prompt/stream', async (c) => {
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');
    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = () => new Date().toISOString().split('T')[1];
    
    log.info(`#${requestId} prompt/stream START for session ${sessionId}`);

    // Check if this session is already processing (using the event buffer)
    if (eventBuffer.isActive(sessionId)) {
      log.info(`#${requestId} Session ${sessionId} is already processing, returning 409`);
      return c.json({ error: 'Session is already processing a prompt' }, 409);
    }
    
    // Mark session as active in the event buffer
    eventBuffer.startSession(sessionId);

    try {
      const body = await parseBody(c, PromptSchema);

      // Get the project
      const project = await projectManager.getProject(projectId);
      if (!project) {
        eventBuffer.errorSession(sessionId, 'Project not found');
        return c.json({ error: 'Project not found' }, 404);
      }

      // Get the agent client
      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) {
        eventBuffer.errorSession(sessionId, 'Failed to start agent server');
        return c.json({ error: 'Failed to start agent server' }, 500);
      }

      // Ensure session exists on agent server
      try {
        await agentClient.getSession(sessionId);
      } catch {
        const streamUser = (c as any).get('user') as AuthUser | undefined;
        log.info(`#${requestId} Creating session on agent server...`);
        await agentClient.createSession({
          id: sessionId,
          workingDirectory: project.workingDirectory,
          userId: streamUser?.id || 'system',
        });
      }

      // Get the streaming URL and proxy the request
      const streamUrl = (agentClient as { getPromptStreamUrl?: (id: string) => string }).getPromptStreamUrl?.(sessionId);
      if (!streamUrl) {
        eventBuffer.errorSession(sessionId, 'Streaming not supported');
        return c.json({ error: 'Streaming not supported' }, 501);
      }

      // Make streaming request to agent server
      const response = await fetch(streamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: body.prompt }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        eventBuffer.errorSession(sessionId, `Agent server error: ${errorText}`);
        const status = response.status as 400 | 401 | 403 | 404 | 500;
        return c.json({ error: `Agent server error: ${errorText}` }, status);
      }

      // Consume the upstream agent stream in the background.
      // This runs independently of the client connection so that:
      // 1. Events are buffered even if the original client disconnects
      // 2. Other clients can subscribe to the same session events
      // Message storage is handled by the agent-server, not here.
      const reader = response.body?.getReader();
      if (!reader) {
        eventBuffer.errorSession(sessionId, 'No response body');
        return c.json({ error: 'No response body' }, 500);
      }
      
      // Consume upstream in background - does NOT depend on client connection
      const consumeUpstream = async () => {
        let assistantMessage = '';
        let sseBuffer = '';
        
        try {
          while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
              eventBuffer.completeSession(sessionId, assistantMessage);
              // Send push notification for session completion
              if (pushService) {
                pushService.notifySessionCompleted(projectId, sessionId, assistantMessage).catch((e) => {
                  log.warn('Failed to send session completion push notification:', e);
                });
              }
              return;
            }
            
            const text = new TextDecoder().decode(value);
            sseBuffer += text;
            
            // Parse complete SSE events
            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop() || '';
            
            let currentEventType = '';
            for (const line of lines) {
              if (line.startsWith('event: ')) {
                currentEventType = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  const eventType = currentEventType || data.type || 'unknown';
                  
                  // Buffer the event for all subscribers
                  eventBuffer.pushEvent(sessionId, eventType, data);

                  // Check tool calls against approval rules
                  if (eventType === 'tool.start' && data.toolCall) {
                    const toolName = (data.toolCall as { name?: string }).name;
                    const toolArgs = (data.toolCall as { arguments?: Record<string, unknown> }).arguments || {};
                    if (toolName) {
                      try {
                        const checkResult = approvalManager.checkToolCall(projectId, toolName, toolArgs, sessionId);
                        if (!checkResult.allowed) {
                          log.info(`Tool "${toolName}" matched approval rule: ${checkResult.rule?.name} (action: ${checkResult.action})`);
                          eventBuffer.pushEvent(sessionId, 'approval.required', {
                            requestId: checkResult.requestId || null,
                            toolName,
                            toolArgs,
                            action: checkResult.action,
                            ruleName: (checkResult.rule as { name?: string })?.name || null,
                          });
                        }
                      } catch (approvalErr) {
                        log.warn('Approval check failed for tool', toolName, ':', approvalErr);
                      }
                    }
                  }
                  
                  if (data.message) {
                    assistantMessage = data.message;
                  }
                } catch {
                  // Ignore parse errors
                }
                currentEventType = '';
              }
            }
          }
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          log.error(`#${requestId} Upstream consumption error:`, errorMsg);
          eventBuffer.errorSession(sessionId, errorMsg);
          // Send push notification for agent error
          if (pushService) {
            pushService.notifyAgentError(projectId, errorMsg, sessionId).catch((err) => {
              log.warn('Failed to send agent error push notification:', err);
            });
          }
        }
      };
      
      // Start consuming upstream (fire and forget)
      consumeUpstream();
      
      // Return an SSE stream to the requesting client that subscribes to the event buffer.
      const encoder = new TextEncoder();
      let clientUnsubscribe: (() => void) | null = null;
      
      return c.body(
        new ReadableStream({
          start(controller) {
            const unsub = eventBuffer.subscribe(
              sessionId,
              (event) => {
                try {
                  const payload = JSON.stringify({ ...event.data as object, _eventIndex: event.index });
                  controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${payload}\n\n`));
                  
                  if (event.type === 'done' || event.type === 'error' || event.type === 'aborted') {
                    setTimeout(() => {
                      try { controller.close(); } catch { /* already closed */ }
                    }, 100);
                  }
                } catch {
                  // Client may have disconnected
                }
              },
              0,
            );
            
            if (!unsub) {
              try { controller.close(); } catch { /* already closed */ }
              return;
            }
            clientUnsubscribe = unsub;
          },
          cancel() {
            // Client disconnected - upstream consumption continues independently
            if (clientUnsubscribe) {
              clientUnsubscribe();
              clientUnsubscribe = null;
            }
          },
        }),
        {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        }
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const message = getErrorMessage(e);
      log.error(`#${requestId} Failed to stream prompt:`, message);
      eventBuffer.errorSession(sessionId, message);
      return c.json({ error: message }, 500);
    }
  });

  // Abort session - stops the agent if it's running
  app.post('/:projectId/sessions/:sessionId/abort', async (c) => {
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');

    try {
      const project = await projectManager.getProject(projectId);
      if (!project) {
        return c.json({ error: 'Project not found' }, 404);
      }

      // Immediately transition the event buffer out of 'active' so a new
      // prompt can be sent without waiting for the upstream stream to unwind.
      eventBuffer.abortSession(sessionId);

      const agentClient = await projectManager.getClient(projectId);
      if (!agentClient) {
        return c.json({ success: true });
      }
      const result = await agentClient.abortSession(sessionId);
      
      return c.json(result);
    } catch (e) {
      return c.json({ success: true });
    }
  });

  return app;
}
