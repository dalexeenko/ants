import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Session, Message, ToolCall, QuestionRequest, TodoItem } from '../agent/types';
import { getPersistStorage } from './persistStorage';

interface DirectorState {
  // Sessions
  sessions: Session[];
  currentSessionId: string | null;

  // Messages keyed by sessionId
  messagesBySession: Record<string, Message[]>;

  // Processing state keyed by sessionId
  processingBySession: Record<string, boolean>;

  // Pending permissions keyed by sessionId
  pendingPermissionsBySession: Record<string, ToolCall | null>;

  // Pending questions keyed by sessionId
  pendingQuestionsBySession: Record<string, QuestionRequest | null>;

  // Errors keyed by sessionId
  errorBySession: Record<string, string | null>;

  // Done state keyed by sessionId
  doneBySession: Record<string, boolean>;

  // Todos keyed by sessionId
  todosBySession: Record<string, TodoItem[]>;

  // Actions
  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  removeSession: (sessionId: string) => void;
  setCurrentSession: (sessionId: string | null) => void;
  updateSession: (sessionId: string, updates: Partial<Session>) => void;

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
  setTodos: (sessionId: string, todos: TodoItem[]) => void;
}

export const useDirectorStore = create<DirectorState>()(
  persist(
    (set) => ({
      sessions: [],
      currentSessionId: null,
      messagesBySession: {},
      processingBySession: {},
      pendingPermissionsBySession: {},
      pendingQuestionsBySession: {},
      errorBySession: {},
      doneBySession: {},
      todosBySession: {},

      setSessions: (sessions) => set({ sessions }),

      addSession: (session) =>
        set((state) => ({
          sessions: [session, ...state.sessions],
        })),

      removeSession: (sessionId) =>
        set((state) => {
          const { [sessionId]: _, ...restMessages } = state.messagesBySession;
          const { [sessionId]: __, ...restProcessing } = state.processingBySession;
          const { [sessionId]: ___, ...restPermissions } = state.pendingPermissionsBySession;
          const { [sessionId]: ____, ...restQuestions } = state.pendingQuestionsBySession;
          const { [sessionId]: _____, ...restErrors } = state.errorBySession;
          const { [sessionId]: ______, ...restDone } = state.doneBySession;
          const { [sessionId]: _______, ...restTodos } = state.todosBySession;

          return {
            sessions: state.sessions.filter((s) => s.id !== sessionId),
            messagesBySession: restMessages,
            processingBySession: restProcessing,
            pendingPermissionsBySession: restPermissions,
            pendingQuestionsBySession: restQuestions,
            errorBySession: restErrors,
            doneBySession: restDone,
            todosBySession: restTodos,
            currentSessionId:
              state.currentSessionId === sessionId ? null : state.currentSessionId,
          };
        }),

      setCurrentSession: (sessionId) => set({ currentSessionId: sessionId }),

      updateSession: (sessionId, updates) =>
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId ? { ...s, ...updates } : s
          ),
        })),

      setMessages: (sessionId, messages) =>
        set((state) => ({
          messagesBySession: { ...state.messagesBySession, [sessionId]: messages },
        })),

      addMessage: (sessionId, message) =>
        set((state) => ({
          messagesBySession: {
            ...state.messagesBySession,
            [sessionId]: [...(state.messagesBySession[sessionId] || []), message],
          },
        })),

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

      setTodos: (sessionId, todos) =>
        set((state) => ({
          todosBySession: {
            ...state.todosBySession,
            [sessionId]: todos,
          },
        })),
    }),
    {
      name: 'openmgr-director-store',
      version: 1,
      storage: getPersistStorage(),
      partialize: (state) => ({
        currentSessionId: state.currentSessionId,
      }),
    }
  )
);

// Selectors
export const selectDirectorSessions = (state: DirectorState) => state.sessions;
export const selectDirectorCurrentSessionId = (state: DirectorState) => state.currentSessionId;
export const selectDirectorMessages = (state: DirectorState, sessionId: string) =>
  state.messagesBySession[sessionId] || [];
export const selectDirectorProcessing = (state: DirectorState, sessionId: string) =>
  state.processingBySession[sessionId] || false;
export const selectDirectorError = (state: DirectorState, sessionId: string) =>
  state.errorBySession[sessionId] || null;
export const selectDirectorPendingPermission = (state: DirectorState, sessionId: string) =>
  state.pendingPermissionsBySession[sessionId] || null;
export const selectDirectorPendingQuestion = (state: DirectorState, sessionId: string) =>
  state.pendingQuestionsBySession[sessionId] || null;
