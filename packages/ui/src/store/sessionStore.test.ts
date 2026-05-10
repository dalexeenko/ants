import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore, selectSessionsForProject, selectCurrentSession, selectMessagesForSession, selectIsProcessing, selectPendingPermission, selectError, selectIsCompacting, selectContextUsage } from './sessionStore';
import type { Session, Message, ToolCall } from '../agent/types';

describe('useSessionStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useSessionStore.setState({
      sessionsByProject: {},
      currentSessionId: null,
      messagesBySession: {},
      processingBySession: {},
      pendingPermissionsBySession: {},
      pendingQuestionsBySession: {},
      errorBySession: {},
      doneBySession: {},
    });
  });

  describe('session management', () => {
    const mockSession: Session = {
      id: 'session-1',
      title: 'Test Session',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    it('should set sessions for a project', () => {
      useSessionStore.getState().setSessions('project-1', [mockSession]);
      
      const state = useSessionStore.getState();
      expect(state.sessionsByProject['project-1']).toHaveLength(1);
      expect(state.sessionsByProject['project-1'][0].id).toBe('session-1');
    });

    it('should add a session to a project', () => {
      useSessionStore.getState().setSessions('project-1', [mockSession]);
      
      const newSession: Session = {
        id: 'session-2',
        title: 'New Session',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      
      useSessionStore.getState().addSession('project-1', newSession);
      
      const sessions = useSessionStore.getState().sessionsByProject['project-1'];
      expect(sessions).toHaveLength(2);
      expect(sessions[1].id).toBe('session-2');
    });

    it('should add session to new project', () => {
      useSessionStore.getState().addSession('new-project', mockSession);
      
      const sessions = useSessionStore.getState().sessionsByProject['new-project'];
      expect(sessions).toHaveLength(1);
    });

    it('should remove a session', () => {
      const session2: Session = { ...mockSession, id: 'session-2' };
      useSessionStore.getState().setSessions('project-1', [mockSession, session2]);
      
      useSessionStore.getState().removeSession('project-1', 'session-1');
      
      const sessions = useSessionStore.getState().sessionsByProject['project-1'];
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('session-2');
    });

    it('should clear currentSessionId when removing current session', () => {
      useSessionStore.getState().setSessions('project-1', [mockSession]);
      useSessionStore.getState().setCurrentSession('session-1');
      
      useSessionStore.getState().removeSession('project-1', 'session-1');
      
      expect(useSessionStore.getState().currentSessionId).toBeNull();
    });

    it('should not clear currentSessionId when removing different session', () => {
      const session2: Session = { ...mockSession, id: 'session-2' };
      useSessionStore.getState().setSessions('project-1', [mockSession, session2]);
      useSessionStore.getState().setCurrentSession('session-1');
      
      useSessionStore.getState().removeSession('project-1', 'session-2');
      
      expect(useSessionStore.getState().currentSessionId).toBe('session-1');
    });

    it('should update a session', () => {
      useSessionStore.getState().setSessions('project-1', [mockSession]);
      
      useSessionStore.getState().updateSession('project-1', 'session-1', {
        title: 'Updated Title',
      });
      
      const sessions = useSessionStore.getState().sessionsByProject['project-1'];
      expect(sessions[0].title).toBe('Updated Title');
    });

    it('should set current session', () => {
      useSessionStore.getState().setCurrentSession('session-1');
      expect(useSessionStore.getState().currentSessionId).toBe('session-1');
    });

    it('should clear current session', () => {
      useSessionStore.getState().setCurrentSession('session-1');
      useSessionStore.getState().setCurrentSession(null);
      expect(useSessionStore.getState().currentSessionId).toBeNull();
    });
  });

  describe('message management', () => {
    const mockMessage: Message = {
      id: 'message-1',
      role: 'user',
      content: 'Hello',
      createdAt: Date.now(),
    };

    it('should set messages for a session', () => {
      useSessionStore.getState().setMessages('session-1', [mockMessage]);
      
      const messages = useSessionStore.getState().messagesBySession['session-1'];
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Hello');
    });

    it('should add a message to a session', () => {
      useSessionStore.getState().setMessages('session-1', [mockMessage]);
      
      const newMessage: Message = {
        id: 'message-2',
        role: 'assistant',
        content: 'Hi there!',
        createdAt: Date.now(),
      };
      
      useSessionStore.getState().addMessage('session-1', newMessage);
      
      const messages = useSessionStore.getState().messagesBySession['session-1'];
      expect(messages).toHaveLength(2);
      expect(messages[1].role).toBe('assistant');
    });

    it('should add message to new session', () => {
      useSessionStore.getState().addMessage('new-session', mockMessage);
      
      const messages = useSessionStore.getState().messagesBySession['new-session'];
      expect(messages).toHaveLength(1);
    });

    it('should not add duplicate message with same ID', () => {
      useSessionStore.getState().setMessages('session-1', [mockMessage]);
      
      // Try to add the same message again (e.g., from SSE replay)
      useSessionStore.getState().addMessage('session-1', { ...mockMessage, content: 'Different content' });
      
      const messages = useSessionStore.getState().messagesBySession['session-1'];
      expect(messages).toHaveLength(1);
      // Original content should be preserved
      expect(messages[0].content).toBe('Hello');
    });

    it('should update a message with partial object', () => {
      useSessionStore.getState().setMessages('session-1', [mockMessage]);
      
      useSessionStore.getState().updateMessage('session-1', 'message-1', {
        content: 'Updated content',
      });
      
      const messages = useSessionStore.getState().messagesBySession['session-1'];
      expect(messages[0].content).toBe('Updated content');
    });

    it('should update a message with updater function', () => {
      useSessionStore.getState().setMessages('session-1', [mockMessage]);
      
      useSessionStore.getState().updateMessage('session-1', 'message-1', (msg) => ({
        content: msg.content + ' World',
      }));
      
      const messages = useSessionStore.getState().messagesBySession['session-1'];
      expect(messages[0].content).toBe('Hello World');
    });

    it('should remove messages when removing session', () => {
      const session: Session = {
        id: 'session-1',
        title: 'Test',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      useSessionStore.getState().setSessions('project-1', [session]);
      useSessionStore.getState().setMessages('session-1', [mockMessage]);
      
      useSessionStore.getState().removeSession('project-1', 'session-1');
      
      expect(useSessionStore.getState().messagesBySession['session-1']).toBeUndefined();
    });
  });

  describe('processing state', () => {
    it('should set processing state for a session', () => {
      useSessionStore.getState().setProcessing('session-1', true);
      
      expect(useSessionStore.getState().processingBySession['session-1']).toBe(true);
    });

    it('should clear processing state', () => {
      useSessionStore.getState().setProcessing('session-1', true);
      useSessionStore.getState().setProcessing('session-1', false);
      
      expect(useSessionStore.getState().processingBySession['session-1']).toBe(false);
    });

    it('should clean up processing state when removing session', () => {
      const session: Session = { id: 'session-1', title: 'Test', createdAt: Date.now(), updatedAt: Date.now() };
      useSessionStore.getState().setSessions('project-1', [session]);
      useSessionStore.getState().setProcessing('session-1', true);
      
      useSessionStore.getState().removeSession('project-1', 'session-1');
      
      expect(useSessionStore.getState().processingBySession['session-1']).toBeUndefined();
    });
  });

  describe('pending permissions', () => {
    const mockToolCall: ToolCall = {
      id: 'tool-1',
      name: 'write_file',
      arguments: { path: '/test.txt', content: 'hello' },
      status: 'pending',
    };

    it('should set pending permission for a session', () => {
      useSessionStore.getState().setPendingPermission('session-1', mockToolCall);
      
      expect(useSessionStore.getState().pendingPermissionsBySession['session-1']).toEqual(mockToolCall);
    });

    it('should clear pending permission', () => {
      useSessionStore.getState().setPendingPermission('session-1', mockToolCall);
      useSessionStore.getState().setPendingPermission('session-1', null);
      
      expect(useSessionStore.getState().pendingPermissionsBySession['session-1']).toBeNull();
    });

    it('should clean up pending permission when removing session', () => {
      const session: Session = { id: 'session-1', title: 'Test', createdAt: Date.now(), updatedAt: Date.now() };
      useSessionStore.getState().setSessions('project-1', [session]);
      useSessionStore.getState().setPendingPermission('session-1', mockToolCall);
      
      useSessionStore.getState().removeSession('project-1', 'session-1');
      
      expect(useSessionStore.getState().pendingPermissionsBySession['session-1']).toBeUndefined();
    });
  });

  describe('error state', () => {
    it('should set error for a session', () => {
      useSessionStore.getState().setError('session-1', 'Something failed');
      
      expect(useSessionStore.getState().errorBySession['session-1']).toBe('Something failed');
    });

    it('should clear error for a session', () => {
      useSessionStore.getState().setError('session-1', 'Something failed');
      useSessionStore.getState().setError('session-1', null);
      
      expect(useSessionStore.getState().errorBySession['session-1']).toBeNull();
    });

    it('should clean up error when removing session', () => {
      const session: Session = { id: 'session-1', title: 'Test', createdAt: Date.now(), updatedAt: Date.now() };
      useSessionStore.getState().setSessions('project-1', [session]);
      useSessionStore.getState().setError('session-1', 'Some error');
      
      useSessionStore.getState().removeSession('project-1', 'session-1');
      
      expect(useSessionStore.getState().errorBySession['session-1']).toBeUndefined();
    });
  });

  describe('done state', () => {
    it('should set done for a session', () => {
      useSessionStore.getState().setDone('session-1', true);
      
      expect(useSessionStore.getState().doneBySession['session-1']).toBe(true);
    });

    it('should clear done for a session', () => {
      useSessionStore.getState().setDone('session-1', true);
      useSessionStore.getState().setDone('session-1', false);
      
      expect(useSessionStore.getState().doneBySession['session-1']).toBe(false);
    });

    it('should clean up done when removing session', () => {
      const session: Session = { id: 'session-1', title: 'Test', createdAt: Date.now(), updatedAt: Date.now() };
      useSessionStore.getState().setSessions('project-1', [session]);
      useSessionStore.getState().setDone('session-1', true);
      
      useSessionStore.getState().removeSession('project-1', 'session-1');
      
      expect(useSessionStore.getState().doneBySession['session-1']).toBeUndefined();
    });
  });

  describe('compaction state', () => {
    it('should set compacting state for a session', () => {
      useSessionStore.getState().setCompacting('session-1', true);
      expect(useSessionStore.getState().compactingBySession['session-1']).toBe(true);
    });

    it('should clear compacting state', () => {
      useSessionStore.getState().setCompacting('session-1', true);
      useSessionStore.getState().setCompacting('session-1', false);
      expect(useSessionStore.getState().compactingBySession['session-1']).toBe(false);
    });

    it('should set compaction message ID', () => {
      useSessionStore.getState().setCompactionMessageId('session-1', 'compaction-123');
      expect(useSessionStore.getState().compactionMessageIdBySession['session-1']).toBe('compaction-123');
    });

    it('should clear compaction message ID', () => {
      useSessionStore.getState().setCompactionMessageId('session-1', 'compaction-123');
      useSessionStore.getState().setCompactionMessageId('session-1', null);
      expect(useSessionStore.getState().compactionMessageIdBySession['session-1']).toBeNull();
    });

    it('should track compacting state per session independently', () => {
      useSessionStore.getState().setCompacting('session-1', true);
      useSessionStore.getState().setCompacting('session-2', false);
      expect(useSessionStore.getState().compactingBySession['session-1']).toBe(true);
      expect(useSessionStore.getState().compactingBySession['session-2']).toBe(false);
    });
  });

  describe('context usage state', () => {
    it('should set context usage for a session', () => {
      useSessionStore.getState().setContextUsage('session-1', { currentTokens: 5000, maxTokens: 200000 });
      const usage = useSessionStore.getState().contextUsageBySession['session-1'];
      expect(usage).toEqual({ currentTokens: 5000, maxTokens: 200000 });
    });

    it('should update context usage', () => {
      useSessionStore.getState().setContextUsage('session-1', { currentTokens: 5000, maxTokens: 200000 });
      useSessionStore.getState().setContextUsage('session-1', { currentTokens: 10000, maxTokens: 200000 });
      const usage = useSessionStore.getState().contextUsageBySession['session-1'];
      expect(usage).toEqual({ currentTokens: 10000, maxTokens: 200000 });
    });

    it('should track context usage per session independently', () => {
      useSessionStore.getState().setContextUsage('session-1', { currentTokens: 5000, maxTokens: 200000 });
      useSessionStore.getState().setContextUsage('session-2', { currentTokens: 15000, maxTokens: 128000 });

      expect(useSessionStore.getState().contextUsageBySession['session-1']?.currentTokens).toBe(5000);
      expect(useSessionStore.getState().contextUsageBySession['session-2']?.currentTokens).toBe(15000);
    });
  });

  describe('compaction selectors', () => {
    it('selectIsCompacting returns compacting state', () => {
      useSessionStore.getState().setCompacting('session-1', true);
      const state = useSessionStore.getState();
      expect(selectIsCompacting(state, 'session-1')).toBe(true);
    });

    it('selectIsCompacting returns false for unknown session', () => {
      const state = useSessionStore.getState();
      expect(selectIsCompacting(state, 'unknown')).toBe(false);
    });

    it('selectContextUsage returns context usage', () => {
      useSessionStore.getState().setContextUsage('session-1', { currentTokens: 5000, maxTokens: 200000 });
      const state = useSessionStore.getState();
      const usage = selectContextUsage(state, 'session-1');
      expect(usage).toEqual({ currentTokens: 5000, maxTokens: 200000 });
    });

    it('selectContextUsage returns null for unknown session', () => {
      const state = useSessionStore.getState();
      expect(selectContextUsage(state, 'unknown')).toBeNull();
    });
  });

  describe('clearProjectData', () => {
    it('should clear all data for a project', () => {
      const session: Session = {
        id: 'session-1',
        title: 'Test',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const message: Message = {
        id: 'message-1',
        role: 'user',
        content: 'Hello',
        createdAt: Date.now(),
      };
      const toolCall: ToolCall = {
        id: 'tool-1',
        name: 'test',
        arguments: {},
        status: 'pending',
      };

      useSessionStore.getState().setSessions('project-1', [session]);
      useSessionStore.getState().setMessages('session-1', [message]);
      useSessionStore.getState().setProcessing('session-1', true);
      useSessionStore.getState().setPendingPermission('session-1', toolCall);
      useSessionStore.getState().setError('session-1', 'Some error');
      useSessionStore.getState().setDone('session-1', true);

      useSessionStore.getState().clearProjectData('project-1');

      const state = useSessionStore.getState();
      expect(state.sessionsByProject['project-1']).toBeUndefined();
      expect(state.messagesBySession['session-1']).toBeUndefined();
      expect(state.processingBySession['session-1']).toBeUndefined();
      expect(state.pendingPermissionsBySession['session-1']).toBeUndefined();
      expect(state.errorBySession['session-1']).toBeUndefined();
      expect(state.doneBySession['session-1']).toBeUndefined();
    });

    it('should not affect other projects', () => {
      const session1: Session = { id: 's1', title: 'S1', createdAt: 0, updatedAt: 0 };
      const session2: Session = { id: 's2', title: 'S2', createdAt: 0, updatedAt: 0 };

      useSessionStore.getState().setSessions('project-1', [session1]);
      useSessionStore.getState().setSessions('project-2', [session2]);

      useSessionStore.getState().clearProjectData('project-1');

      expect(useSessionStore.getState().sessionsByProject['project-1']).toBeUndefined();
      expect(useSessionStore.getState().sessionsByProject['project-2']).toHaveLength(1);
    });
  });

  describe('selectors', () => {
    const mockSession: Session = {
      id: 'session-1',
      title: 'Test Session',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const mockMessage: Message = {
      id: 'message-1',
      role: 'user',
      content: 'Hello',
      createdAt: Date.now(),
    };

    const mockToolCall: ToolCall = {
      id: 'tool-1',
      name: 'test',
      arguments: {},
      status: 'pending',
    };

    it('selectSessionsForProject returns sessions for project', () => {
      useSessionStore.getState().setSessions('project-1', [mockSession]);
      
      const state = useSessionStore.getState();
      const sessions = selectSessionsForProject(state, 'project-1');
      
      expect(sessions).toHaveLength(1);
    });

    it('selectSessionsForProject returns empty array for unknown project', () => {
      const state = useSessionStore.getState();
      const sessions = selectSessionsForProject(state, 'unknown');
      
      expect(sessions).toEqual([]);
    });

    it('selectCurrentSession returns current session', () => {
      useSessionStore.getState().setSessions('project-1', [mockSession]);
      useSessionStore.getState().setCurrentSession('session-1');
      
      const state = useSessionStore.getState();
      const session = selectCurrentSession(state, 'project-1');
      
      expect(session?.id).toBe('session-1');
    });

    it('selectCurrentSession returns undefined when no current session', () => {
      useSessionStore.getState().setSessions('project-1', [mockSession]);
      
      const state = useSessionStore.getState();
      const session = selectCurrentSession(state, 'project-1');
      
      expect(session).toBeUndefined();
    });

    it('selectMessagesForSession returns messages', () => {
      useSessionStore.getState().setMessages('session-1', [mockMessage]);
      
      const state = useSessionStore.getState();
      const messages = selectMessagesForSession(state, 'session-1');
      
      expect(messages).toHaveLength(1);
    });

    it('selectMessagesForSession returns empty array for unknown session', () => {
      const state = useSessionStore.getState();
      const messages = selectMessagesForSession(state, 'unknown');
      
      expect(messages).toEqual([]);
    });

    it('selectIsProcessing returns processing state', () => {
      useSessionStore.getState().setProcessing('session-1', true);
      
      const state = useSessionStore.getState();
      expect(selectIsProcessing(state, 'session-1')).toBe(true);
    });

    it('selectIsProcessing returns false for unknown session', () => {
      const state = useSessionStore.getState();
      expect(selectIsProcessing(state, 'unknown')).toBe(false);
    });

    it('selectPendingPermission returns pending permission', () => {
      useSessionStore.getState().setPendingPermission('session-1', mockToolCall);
      
      const state = useSessionStore.getState();
      expect(selectPendingPermission(state, 'session-1')).toEqual(mockToolCall);
    });

    it('selectPendingPermission returns null for unknown session', () => {
      const state = useSessionStore.getState();
      expect(selectPendingPermission(state, 'unknown')).toBeNull();
    });

    it('selectError returns error message', () => {
      useSessionStore.getState().setError('session-1', 'Something failed');
      
      const state = useSessionStore.getState();
      expect(selectError(state, 'session-1')).toBe('Something failed');
    });

    it('selectError returns null for unknown session', () => {
      const state = useSessionStore.getState();
      expect(selectError(state, 'unknown')).toBeNull();
    });
  });
});
