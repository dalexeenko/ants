import { useEffect, useCallback } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { useUIStore } from '../store/uiStore';
import { createLogger } from '../utils/logger';

const log = createLogger('useAgent');
import type {
  AgentEvent,
  SendOptions,
  CreateSessionOptions,
  PermissionResponse,
  QuestionResponsePayload,
  Session,
} from '../agent/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: any;

function getAgentBridge() {
  if (typeof window !== 'undefined' && window.agentBridge) {
    return window.agentBridge;
  }
  throw new Error('Agent bridge not available');
}

export function useAgent(projectId: string | undefined) {
  const {
    sessionsByProject,
    currentSessionId,
    messagesBySession,
    processingBySession,
    pendingPermissionsBySession,
    pendingQuestionsBySession,
    subagentsBySession,
    setSessions,
    addSession,
    addMessage,
    updateMessage,
    setProcessing,
    setPendingPermission,
    setPendingQuestion,
    setError,
    setDone,
    setCurrentSession,
    updateSession,
    addSubagent,
    updateSubagent,
  } = useSessionStore();

  const { addToast } = useUIStore();

  const sessions = projectId ? sessionsByProject[projectId] || [] : [];
  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const messages = currentSession
    ? messagesBySession[currentSession.id] || []
    : [];
  const isProcessing = currentSessionId
    ? processingBySession[currentSessionId] || false
    : false;
  const pendingPermission = currentSessionId
    ? pendingPermissionsBySession[currentSessionId] || null
    : null;
  const pendingQuestion = currentSessionId
    ? pendingQuestionsBySession[currentSessionId] || null
    : null;

  const { compactingBySession, contextUsageBySession } = useSessionStore();
  const isCompacting = currentSessionId
    ? compactingBySession[currentSessionId] || false
    : false;
  const contextUsage = currentSessionId
    ? contextUsageBySession[currentSessionId] || null
    : null;

  // Subscribe to agent events
  useEffect(() => {
    if (!projectId) return;

    let unsubscribe: (() => void) | undefined;

    try {
      const bridge = getAgentBridge();
      unsubscribe = bridge.subscribeToProject(projectId, (event: AgentEvent) => {
        handleAgentEvent(event, projectId);
      });
    } catch (e) {
      // Bridge not available (e.g., during SSR or in non-Electron environment)
      log.warn('Agent bridge not available for event subscription');
    }

    return () => {
      unsubscribe?.();
    };
  }, [projectId]);

  const handleAgentEvent = useCallback(
    (event: AgentEvent, _projId: string) => {
      switch (event.type) {
        case 'message.start':
          setProcessing(event.sessionId, true);
          setError(event.sessionId, null); // Clear previous error on new activity
          setDone(event.sessionId, false); // Clear done on new activity
          addMessage(event.sessionId, {
            id: event.messageId,
            role: 'assistant',
            content: '',
            createdAt: Date.now(),
          });
          break;

        case 'message.delta':
          updateMessage(event.sessionId, event.messageId, (msg) => ({
            content: msg.content + event.delta,
          }));
          break;

        case 'message.complete':
          updateMessage(event.sessionId, event.messageId, {
            content: event.content,
          });
          // Update context usage if provided
          if (event.contextUsage) {
            useSessionStore.getState().setContextUsage(event.sessionId, event.contextUsage);
          }
          break;

        case 'tool.start':
          updateMessage(event.sessionId, event.messageId, (msg) => ({
            toolCalls: [
              ...(msg.toolCalls || []),
              {
                id: event.toolCall.id,
                name: event.toolCall.name,
                arguments: event.toolCall.arguments,
                status: 'running' as const,
                startedAt: Date.now(),
              },
            ],
          }));
          break;

        case 'tool.complete':
          updateMessage(event.sessionId, event.messageId, (msg) => ({
            toolCalls: msg.toolCalls?.map((tc) =>
              tc.id === event.toolResult.id
                ? { ...tc, result: event.toolResult.result, status: 'complete' as const, completedAt: Date.now() }
                : tc
            ),
          }));
          break;

        case 'tool.permission.request': {
          // Attach subagent source info to the tool call so the UI can show
          // which subagent originated the permission request.
          const toolCallWithSource = event.subagentSessionId
            ? {
                ...event.toolCall,
                subagentSessionId: event.subagentSessionId,
                subagentDescription: event.subagentDescription,
              }
            : event.toolCall;

          // Set pending permission on the target session
          setPendingPermission(event.sessionId, toolCallWithSource);

          // If the request is from a subagent, also propagate it to the
          // parent session so the main chat tab shows the permission banner.
          // The parent session is the current session (event.sessionId is
          // the parent because the event was emitted on the parent agent).
          // We also track it keyed by the subagent's sessionId so the
          // subagent tab shows the status.
          if (event.subagentSessionId) {
            setPendingPermission(event.subagentSessionId, toolCallWithSource);
          }
          break;
        }

        case 'tool.permission.granted':
        case 'tool.permission.denied': {
          // Check if the pending permission was from a subagent so we can
          // clear both the parent and subagent entries.
          const currentPending = useSessionStore.getState().pendingPermissionsBySession[event.sessionId];
          const subagentSid = currentPending?.subagentSessionId;

          setPendingPermission(event.sessionId, null);

          // Also clear the subagent's pending permission entry
          if (subagentSid) {
            setPendingPermission(subagentSid, null);
          }
          break;
        }

        case 'question.request':
          setPendingQuestion(event.sessionId, {
            questionId: event.questionId,
            question: event.question,
            options: event.options,
            multiple: event.multiple,
            allowFreeform: event.allowFreeform,
          });
          break;

        case 'subagent.start':
          addSubagent(event.parentSessionId, {
            sessionId: event.sessionId,
            parentSessionId: event.parentSessionId,
            description: event.description,
            status: 'running',
            startedAt: Date.now(),
            async: event.async,
          });
          // Auto-open a tab for the subagent without switching focus
          useUIStore.getState().openSubagentTab(event.sessionId, event.description, false);
          break;

        case 'subagent.complete':
          updateSubagent(event.parentSessionId, event.sessionId, {
            status: 'completed',
            completedAt: Date.now(),
            result: event.result,
          });
          break;

        case 'subagent.error':
          updateSubagent(event.parentSessionId, event.sessionId, {
            status: 'failed',
            completedAt: Date.now(),
            error: event.error,
          });
          break;

        case 'session.title.updated':
          if (projectId) {
            updateSession(projectId, event.sessionId, { title: event.title });
          }
          break;

        case 'todos.updated':
          useSessionStore.getState().setTodos(event.sessionId, event.todos);
          break;

        case 'phases.updated':
          useSessionStore.getState().setPhases(event.sessionId, event.phases);
          break;

        case 'compaction.start': {
          const store = useSessionStore.getState();
          store.setCompacting(event.sessionId, true);
          // Create a placeholder compaction summary message that we'll stream into
          const compactionMsgId = `compaction-${Date.now()}`;
          store.setCompactionMessageId(event.sessionId, compactionMsgId);
          addMessage(event.sessionId, {
            id: compactionMsgId,
            role: 'user',
            content: '',
            isCompactionSummary: true,
            createdAt: Date.now(),
          });
          break;
        }

        case 'compaction.delta': {
          const store = useSessionStore.getState();
          const compactionMsgId = store.compactionMessageIdBySession[event.sessionId];
          if (compactionMsgId) {
            updateMessage(event.sessionId, compactionMsgId, (msg) => ({
              content: msg.content + event.delta,
            }));
          }
          break;
        }

        case 'compaction.complete': {
          const store = useSessionStore.getState();
          store.setCompacting(event.sessionId, false);
          store.setCompactionMessageId(event.sessionId, null);
          if (event.contextUsage) {
            store.setContextUsage(event.sessionId, event.contextUsage);
          }
          break;
        }

        case 'compaction.error': {
          const store = useSessionStore.getState();
          store.setCompacting(event.sessionId, false);
          store.setCompactionMessageId(event.sessionId, null);
          addToast({
            message: `Summarization failed: ${event.error}`,
            type: 'error',
          });
          break;
        }

        case 'done': {
          // Update todos/phases from the done event (final snapshot)
          if (event.todos) {
            useSessionStore.getState().setTodos(event.sessionId, event.todos);
          }
          if (event.phases) {
            useSessionStore.getState().setPhases(event.sessionId, event.phases);
          }
          setProcessing(event.sessionId, false);
          if (event.sessionId !== useSessionStore.getState().currentSessionId) {
            setDone(event.sessionId, true);
          }

          // Auto-complete: if enabled and there are open todos/phases, auto-send continuation
          const store = useSessionStore.getState();
          const isAutoComplete = store.autoCompleteBySession[event.sessionId] ?? false;
          const hasWork = event.hasOpenTodos || event.hasOpenPhases;
          
          if (isAutoComplete && hasWork && projectId) {
            const maxLoops = 25; // Safety cap
            const currentLoop = store.incrementAutoCompleteLoop(event.sessionId);
            
            if (currentLoop <= maxLoops) {
              log.info(`Auto-complete loop ${currentLoop}/${maxLoops} for session ${event.sessionId} (open todos: ${event.openTodoCount ?? '?'}, open phases: ${event.openPhaseCount ?? '?'})`);
              
              // Small delay to let UI update before sending next message
              setTimeout(async () => {
                try {
                  const bridge = getAgentBridge();
                  // Add user message for the continuation
                  addMessage(event.sessionId, {
                    id: `user-${Date.now()}`,
                    role: 'user',
                    content: 'Continue working on the remaining tasks.',
                    createdAt: Date.now(),
                  });
                  setProcessing(event.sessionId, true);
                  await bridge.sendMessage(projectId, event.sessionId, 'Continue working on the remaining tasks.');
                } catch (e) {
                  log.error('Auto-complete send failed:', e);
                  // Disable auto-complete on error
                  useSessionStore.getState().setAutoComplete(event.sessionId, false);
                  useSessionStore.getState().resetAutoCompleteLoop(event.sessionId);
                }
              }, 500);
            } else {
              log.warn(`Auto-complete reached max loops (${maxLoops}) for session ${event.sessionId}, disabling`);
              store.setAutoComplete(event.sessionId, false);
              store.resetAutoCompleteLoop(event.sessionId);
              addToast({
                message: 'Auto-complete reached maximum loops and was disabled.',
                type: 'warning',
              });
            }
          } else if (!hasWork && isAutoComplete) {
            // All tasks complete, turn off auto-complete and reset counter
            log.info(`Auto-complete: all tasks complete for session ${event.sessionId}, disabling`);
            store.setAutoComplete(event.sessionId, false);
            store.resetAutoCompleteLoop(event.sessionId);
            addToast({
              message: 'All tasks completed! Auto-complete disabled.',
              type: 'success',
            });
          }
          break;
        }

        case 'aborted':
          // User-initiated abort — just stop processing, no error toast
          if (event.sessionId) {
            setProcessing(event.sessionId, false);
          }
          break;

        case 'error':
          if (event.sessionId) {
            setProcessing(event.sessionId, false);
            setError(event.sessionId, event.error);
          }
          addToast({
            message: event.error,
            type: 'error',
          });
          break;

        // Setup events (e.g., browser downloading)
        case 'setup.start':
          addToast({ 
            id: `setup-${event.component}`,
            message: event.message, 
            type: 'info',
          });
          break;

        case 'setup.progress': {
          const uiStore = useUIStore.getState();
          uiStore.updateToast(`setup-${event.component}`, {
            message: event.progress !== undefined 
              ? `${event.message} (${Math.round(event.progress * 100)}%)`
              : event.message,
          });
          break;
        }

        case 'setup.complete': {
          const uiStore = useUIStore.getState();
          uiStore.removeToast(`setup-${event.component}`);
          addToast({ 
            message: event.message, 
            type: 'success',
          });
          break;
        }

        case 'setup.error': {
          const uiStore = useUIStore.getState();
          uiStore.removeToast(`setup-${event.component}`);
          addToast({ 
            message: `Setup error: ${event.error}`, 
            type: 'error',
          });
          break;
        }
      }
    },
    [
      projectId,
      setProcessing,
      setError,
      setDone,
      addMessage,
      updateMessage,
      updateSession,
      setPendingPermission,
      setPendingQuestion,
      addSubagent,
      updateSubagent,
      addToast,
    ]
  );

  // Load sessions on mount
  useEffect(() => {
    if (!projectId) return;

    const loadSessions = async () => {
      try {
        const bridge = getAgentBridge();
        const loadedSessions = await bridge.listSessions(projectId);
        setSessions(projectId, loadedSessions);
      } catch (e) {
        log.warn('Failed to load sessions:', e);
      }
    };

    loadSessions();
  }, [projectId, setSessions]);

  const sendMessage = useCallback(
    async (content: string, options?: SendOptions) => {
      if (!projectId || !currentSession) return;

      // Add user message immediately for optimistic UI
      addMessage(currentSession.id, {
        id: `user-${Date.now()}`,
        role: 'user',
        content,
        createdAt: Date.now(),
      });

      try {
        const bridge = getAgentBridge();
        await bridge.sendMessage(projectId, currentSession.id, content, options);
      } catch (e) {
        addToast({
          message: `Failed to send message: ${e}`,
          type: 'error',
        });
      }
    },
    [projectId, currentSession, addMessage, addToast]
  );

  const createSession = useCallback(
    async (options?: CreateSessionOptions): Promise<Session | undefined> => {
      if (!projectId) return;

      try {
        const bridge = getAgentBridge();
        const session = await bridge.createSession(projectId, options);
        addSession(projectId, session);
        setCurrentSession(session.id);
        return session;
      } catch (e) {
        addToast({
          message: `Failed to create session: ${e}`,
          type: 'error',
        });
      }
    },
    [projectId, addSession, setCurrentSession, addToast]
  );

  const selectSession = useCallback(
    async (sessionId: string) => {
      if (!projectId) return;

      setCurrentSession(sessionId);
      useSessionStore.getState().setDone(sessionId, false); // Clear done indicator on select

      // Load messages for the session if not already loaded
      const existingMessages = messagesBySession[sessionId];
      if (!existingMessages) {
        try {
          const bridge = getAgentBridge();
          const messages = await bridge.getMessages(projectId, sessionId);
          useSessionStore.getState().setMessages(sessionId, messages);
        } catch (e) {
          log.warn('Failed to load messages:', e);
        }
      }
    },
    [projectId, messagesBySession, setCurrentSession]
  );

  const respondToPermission = useCallback(
    async (response: PermissionResponse) => {
      if (!projectId || !currentSessionId || !pendingPermission) return;

      try {
        const bridge = getAgentBridge();
        await bridge.respondToPermission(projectId, currentSessionId, pendingPermission.id, response);
        setPendingPermission(currentSessionId, null);
      } catch (e) {
        addToast({
          message: `Failed to respond to permission: ${e}`,
          type: 'error',
        });
      }
    },
    [projectId, currentSessionId, pendingPermission, setPendingPermission, addToast]
  );

  const respondToQuestion = useCallback(
    async (response: QuestionResponsePayload) => {
      if (!projectId || !currentSessionId || !pendingQuestion) return;

      try {
        const bridge = getAgentBridge();
        await bridge.respondToQuestion(projectId, currentSessionId, pendingQuestion.questionId, response);
        setPendingQuestion(currentSessionId, null);
      } catch (e) {
        addToast({
          message: `Failed to respond to question: ${e}`,
          type: 'error',
        });
      }
    },
    [projectId, currentSessionId, pendingQuestion, setPendingQuestion, addToast]
  );

  const cancelMessage = useCallback(async () => {
    if (!projectId || !currentSessionId) return;

    try {
      const bridge = getAgentBridge();
      await bridge.cancelMessage(projectId);
      setProcessing(currentSessionId, false);
    } catch (e) {
      log.warn('Failed to cancel message:', e);
    }
  }, [projectId, currentSessionId, setProcessing]);

  const subagents = currentSession
    ? subagentsBySession[currentSession.id] || []
    : [];

  return {
    sessions,
    currentSession,
    messages,
    isProcessing,
    isCompacting,
    contextUsage,
    pendingPermission,
    pendingQuestion,
    subagents,
    sendMessage,
    createSession,
    selectSession,
    respondToPermission,
    respondToQuestion,
    cancelMessage,
  };
}
