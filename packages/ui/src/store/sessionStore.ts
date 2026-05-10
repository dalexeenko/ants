import { create } from 'zustand';
import type { Session, Message, ToolCall, SubagentInfo, QuestionRequest, TodoItem, PhaseItem } from '../agent/types';

interface SessionState {
  // Sessions keyed by projectId
  sessionsByProject: Record<string, Session[]>;
  currentSessionId: string | null;

  // Messages keyed by sessionId
  messagesBySession: Record<string, Message[]>;

  // Processing state keyed by sessionId
  processingBySession: Record<string, boolean>;

  // Pending permission requests keyed by sessionId
  pendingPermissionsBySession: Record<string, ToolCall | null>;

  // Pending question requests keyed by sessionId
  pendingQuestionsBySession: Record<string, QuestionRequest | null>;

  // Last error keyed by sessionId (persists until cleared by new activity)
  errorBySession: Record<string, string | null>;

  // Whether the agent finished its turn and is ready for input (cleared on session select)
  doneBySession: Record<string, boolean>;

  // Active subagents keyed by sessionId (parent session)
  subagentsBySession: Record<string, SubagentInfo[]>;

  // Todos and phases keyed by sessionId (synced from agent via SSE)
  todosBySession: Record<string, TodoItem[]>;
  phasesBySession: Record<string, PhaseItem[]>;

  // Token usage keyed by sessionId
  tokenUsageBySession: Record<string, { promptTokens: number; completionTokens: number; totalTokens: number; estimatedCost: number }>;

  // Context window usage keyed by sessionId
  contextUsageBySession: Record<string, { currentTokens: number; maxTokens: number }>;

  // Whether compaction is in progress keyed by sessionId
  compactingBySession: Record<string, boolean>;

  // The message ID of the in-progress compaction summary (so we can stream deltas to it)
  compactionMessageIdBySession: Record<string, string | null>;

  // Auto-complete state keyed by sessionId
  autoCompleteBySession: Record<string, boolean>;
  autoCompleteLoopBySession: Record<string, number>;

  // Actions
  setSessions: (projectId: string, sessions: Session[]) => void;
  addSession: (projectId: string, session: Session) => void;
  removeSession: (projectId: string, sessionId: string) => void;
  setCurrentSession: (sessionId: string | null) => void;
  updateSession: (projectId: string, sessionId: string, updates: Partial<Session>) => void;

  setMessages: (sessionId: string, messages: Message[]) => void;
  addMessage: (sessionId: string, message: Message) => void;
  updateMessage: (
    sessionId: string,
    messageId: string,
    updater: Partial<Message> | ((message: Message) => Partial<Message>)
  ) => void;

  setProcessing: (sessionId: string, processing: boolean) => void;
  setPendingPermission: (sessionId: string, toolCall: ToolCall | null) => void;
  setPendingQuestion: (sessionId: string, question: QuestionRequest | null) => void;
  setError: (sessionId: string, error: string | null) => void;
  setDone: (sessionId: string, done: boolean) => void;

  // Subagent tracking
  addSubagent: (parentSessionId: string, info: SubagentInfo) => void;
  updateSubagent: (parentSessionId: string, subagentSessionId: string, updates: Partial<SubagentInfo>) => void;

  // Todos and phases
  setTodos: (sessionId: string, todos: TodoItem[]) => void;
  setPhases: (sessionId: string, phases: PhaseItem[]) => void;

  // Token usage
  setTokenUsage: (sessionId: string, usage: { promptTokens: number; completionTokens: number; totalTokens: number; cacheCreationInputTokens?: number; cacheReadInputTokens?: number; estimatedCost: number }) => void;

  // Context window usage
  setContextUsage: (sessionId: string, usage: { currentTokens: number; maxTokens: number }) => void;

  // Compaction state
  setCompacting: (sessionId: string, compacting: boolean) => void;
  setCompactionMessageId: (sessionId: string, messageId: string | null) => void;

  // Auto-complete
  setAutoComplete: (sessionId: string, enabled: boolean) => void;
  getAutoComplete: (sessionId: string) => boolean;
  incrementAutoCompleteLoop: (sessionId: string) => number;
  resetAutoCompleteLoop: (sessionId: string) => void;
  getAutoCompleteLoop: (sessionId: string) => number;

  // Clear all data for a project
  clearProjectData: (projectId: string) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessionsByProject: {},
  currentSessionId: null,
  messagesBySession: {},
  processingBySession: {},
  pendingPermissionsBySession: {},
  pendingQuestionsBySession: {},
  errorBySession: {},
  doneBySession: {},
  subagentsBySession: {},
  todosBySession: {},
  phasesBySession: {},
  tokenUsageBySession: {},
  contextUsageBySession: {},
  compactingBySession: {},
  compactionMessageIdBySession: {},
  autoCompleteBySession: {},
  autoCompleteLoopBySession: {},

  setSessions: (projectId, sessions) =>
    set((state) => ({
      sessionsByProject: { ...state.sessionsByProject, [projectId]: sessions },
    })),

  addSession: (projectId, session) =>
    set((state) => ({
      sessionsByProject: {
        ...state.sessionsByProject,
        [projectId]: [...(state.sessionsByProject[projectId] || []), session],
      },
    })),

  removeSession: (projectId, sessionId) =>
    set((state) => {
      const sessions = state.sessionsByProject[projectId] || [];
      const newSessions = sessions.filter((s) => s.id !== sessionId);
      const { [sessionId]: _, ...restMessages } = state.messagesBySession;
      const { [sessionId]: __, ...restProcessing } = state.processingBySession;
      const { [sessionId]: ___, ...restPermissions } = state.pendingPermissionsBySession;
      const { [sessionId]: ____, ...restQuestions } = state.pendingQuestionsBySession;
      const { [sessionId]: _____, ...restErrors } = state.errorBySession;
      const { [sessionId]: ______, ...restDone } = state.doneBySession;
      
      return {
        sessionsByProject: {
          ...state.sessionsByProject,
          [projectId]: newSessions,
        },
        messagesBySession: restMessages,
        processingBySession: restProcessing,
        pendingPermissionsBySession: restPermissions,
        pendingQuestionsBySession: restQuestions,
        errorBySession: restErrors,
        doneBySession: restDone,
        currentSessionId:
          state.currentSessionId === sessionId ? null : state.currentSessionId,
      };
    }),

  setCurrentSession: (sessionId) => set({ currentSessionId: sessionId }),

  updateSession: (projectId, sessionId, updates) =>
    set((state) => ({
      sessionsByProject: {
        ...state.sessionsByProject,
        [projectId]: (state.sessionsByProject[projectId] || []).map((s) =>
          s.id === sessionId ? { ...s, ...updates } : s
        ),
      },
    })),

  setMessages: (sessionId, messages) =>
    set((state) => ({
      messagesBySession: { ...state.messagesBySession, [sessionId]: messages },
    })),

  addMessage: (sessionId, message) =>
    set((state) => {
      const existing = state.messagesBySession[sessionId] || [];
      // Skip if a message with this ID already exists (dedup for SSE replays)
      if (existing.some((m) => m.id === message.id)) {
        return state;
      }
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: [...existing, message],
        },
      };
    }),

  updateMessage: (sessionId, messageId, updater) =>
    set((state) => {
      const messages = state.messagesBySession[sessionId] || [];
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: messages.map((m) => {
            if (m.id !== messageId) return m;
            const updates =
              typeof updater === 'function' ? updater(m) : updater;
            return { ...m, ...updates };
          }),
        },
      };
    }),

  setProcessing: (sessionId, processing) =>
    set((state) => ({
      processingBySession: {
        ...state.processingBySession,
        [sessionId]: processing,
      },
    })),

  setPendingPermission: (sessionId, toolCall) =>
    set((state) => ({
      pendingPermissionsBySession: {
        ...state.pendingPermissionsBySession,
        [sessionId]: toolCall,
      },
    })),

  setPendingQuestion: (sessionId, question) =>
    set((state) => ({
      pendingQuestionsBySession: {
        ...state.pendingQuestionsBySession,
        [sessionId]: question,
      },
    })),

  setError: (sessionId, error) =>
    set((state) => ({
      errorBySession: {
        ...state.errorBySession,
        [sessionId]: error,
      },
    })),

  setDone: (sessionId, done) =>
    set((state) => ({
      doneBySession: {
        ...state.doneBySession,
        [sessionId]: done,
      },
    })),

  addSubagent: (parentSessionId, info) =>
    set((state) => ({
      subagentsBySession: {
        ...state.subagentsBySession,
        [parentSessionId]: [...(state.subagentsBySession[parentSessionId] || []), info],
      },
    })),

  updateSubagent: (parentSessionId, subagentSessionId, updates) =>
    set((state) => ({
      subagentsBySession: {
        ...state.subagentsBySession,
        [parentSessionId]: (state.subagentsBySession[parentSessionId] || []).map((s) =>
          s.sessionId === subagentSessionId ? { ...s, ...updates } : s
        ),
      },
    })),

  setTodos: (sessionId, todos) =>
    set((state) => ({
      todosBySession: {
        ...state.todosBySession,
        [sessionId]: todos,
      },
    })),

  setPhases: (sessionId, phases) =>
    set((state) => ({
      phasesBySession: {
        ...state.phasesBySession,
        [sessionId]: phases,
      },
    })),

  setTokenUsage: (sessionId, usage) =>
    set((state) => ({
      tokenUsageBySession: {
        ...state.tokenUsageBySession,
        [sessionId]: usage,
      },
    })),

  setContextUsage: (sessionId, usage) =>
    set((state) => ({
      contextUsageBySession: {
        ...state.contextUsageBySession,
        [sessionId]: usage,
      },
    })),

  setCompacting: (sessionId, compacting) =>
    set((state) => ({
      compactingBySession: {
        ...state.compactingBySession,
        [sessionId]: compacting,
      },
    })),

  setCompactionMessageId: (sessionId, messageId) =>
    set((state) => ({
      compactionMessageIdBySession: {
        ...state.compactionMessageIdBySession,
        [sessionId]: messageId,
      },
    })),

  setAutoComplete: (sessionId, enabled) =>
    set((state) => ({
      autoCompleteBySession: {
        ...state.autoCompleteBySession,
        [sessionId]: enabled,
      },
    })),

  getAutoComplete: (sessionId) => {
    return useSessionStore.getState().autoCompleteBySession[sessionId] ?? false;
  },

  incrementAutoCompleteLoop: (sessionId) => {
    const current = useSessionStore.getState().autoCompleteLoopBySession[sessionId] ?? 0;
    const next = current + 1;
    useSessionStore.setState((state) => ({
      autoCompleteLoopBySession: {
        ...state.autoCompleteLoopBySession,
        [sessionId]: next,
      },
    }));
    return next;
  },

  resetAutoCompleteLoop: (sessionId) =>
    set((state) => ({
      autoCompleteLoopBySession: {
        ...state.autoCompleteLoopBySession,
        [sessionId]: 0,
      },
    })),

  getAutoCompleteLoop: (sessionId) => {
    return useSessionStore.getState().autoCompleteLoopBySession[sessionId] ?? 0;
  },

  clearProjectData: (projectId) =>
    set((state) => {
      const { [projectId]: _, ...restSessions } = state.sessionsByProject;
      
      // Also remove messages, processing, permissions, and questions for sessions in this project
      const sessionIds = (state.sessionsByProject[projectId] || []).map(s => s.id);
      const newMessagesBySession = { ...state.messagesBySession };
      const newProcessingBySession = { ...state.processingBySession };
      const newPermissionsBySession = { ...state.pendingPermissionsBySession };
      const newQuestionsBySession = { ...state.pendingQuestionsBySession };
      const newErrorBySession = { ...state.errorBySession };
      const newDoneBySession = { ...state.doneBySession };
      sessionIds.forEach(id => {
        delete newMessagesBySession[id];
        delete newProcessingBySession[id];
        delete newPermissionsBySession[id];
        delete newQuestionsBySession[id];
        delete newErrorBySession[id];
        delete newDoneBySession[id];
      });
      
      return {
        sessionsByProject: restSessions,
        processingBySession: newProcessingBySession,
        pendingPermissionsBySession: newPermissionsBySession,
        pendingQuestionsBySession: newQuestionsBySession,
        errorBySession: newErrorBySession,
        doneBySession: newDoneBySession,
        messagesBySession: newMessagesBySession,
      };
    }),
}));

// Selectors
export const selectSessionsForProject = (state: SessionState, projectId: string) =>
  state.sessionsByProject[projectId] || [];

export const selectCurrentSession = (state: SessionState, projectId: string) => {
  const sessions = state.sessionsByProject[projectId] || [];
  return sessions.find((s) => s.id === state.currentSessionId);
};

export const selectMessagesForSession = (state: SessionState, sessionId: string) =>
  state.messagesBySession[sessionId] || [];

export const selectIsProcessing = (state: SessionState, sessionId: string) =>
  state.processingBySession[sessionId] || false;

export const selectPendingPermission = (state: SessionState, sessionId: string) =>
  state.pendingPermissionsBySession[sessionId] || null;

export const selectPendingQuestion = (state: SessionState, sessionId: string) =>
  state.pendingQuestionsBySession[sessionId] || null;

export const selectError = (state: SessionState, sessionId: string) =>
  state.errorBySession[sessionId] || null;

export const selectIsCompacting = (state: SessionState, sessionId: string) =>
  state.compactingBySession[sessionId] || false;

export const selectContextUsage = (state: SessionState, sessionId: string) =>
  state.contextUsageBySession[sessionId] || null;
