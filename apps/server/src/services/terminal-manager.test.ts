import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock node-pty before importing TerminalManager
const mockPtyWrite = vi.fn();
const mockPtyResize = vi.fn();
const mockPtyKill = vi.fn();
const mockOnData = vi.fn();
const mockOnExit = vi.fn();

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => ({
    write: mockPtyWrite,
    resize: mockPtyResize,
    kill: mockPtyKill,
    onData: mockOnData,
    onExit: mockOnExit,
  })),
}));

let uuidCounter = 0;
vi.mock('uuid', () => ({
  v4: vi.fn(() => `test-uuid-${++uuidCounter}`),
}));

import { TerminalManager } from './terminal-manager.js';
import { spawn } from 'node-pty';
import { v4 as uuidV4 } from 'uuid';

const mockedUuidV4 = vi.mocked(uuidV4);

describe('TerminalManager', () => {
  let manager: TerminalManager;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    vi.useFakeTimers();
    manager = new TerminalManager();
  });

  afterEach(() => {
    manager.shutdown();
    vi.useRealTimers();
  });

  // ========================================================================
  // Session creation
  // ========================================================================

  describe('createSession', () => {
    it('should spawn a pty and return a session id', () => {
      const sessionId = manager.createSession('proj-1', '/tmp/workspace');

      expect(sessionId).toBe('test-uuid-1');
      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        [],
        expect.objectContaining({
          name: 'xterm-color',
          cols: 80,
          rows: 24,
          cwd: '/tmp/workspace',
        }),
      );
    });

    it('should use custom shell when provided', () => {
      manager.createSession('proj-1', '/tmp', '/bin/zsh');

      expect(spawn).toHaveBeenCalledWith(
        '/bin/zsh',
        [],
        expect.objectContaining({ cwd: '/tmp' }),
      );
    });

    it('should register onData and onExit callbacks', () => {
      manager.createSession('proj-1', '/tmp');
      expect(mockOnData).toHaveBeenCalledTimes(1);
      expect(mockOnExit).toHaveBeenCalledTimes(1);
    });

    it('should emit data event when pty outputs data', () => {
      const dataHandler = vi.fn();
      manager.on('data', dataHandler);

      const sessionId = manager.createSession('proj-1', '/tmp');

      // Get the onData callback and invoke it
      const onDataCb = mockOnData.mock.calls[0][0];
      onDataCb('some output');

      expect(dataHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId,
          data: 'some output',
        }),
      );
    });

    it('should emit exit event and remove session on pty exit', () => {
      const exitHandler = vi.fn();
      manager.on('exit', exitHandler);

      const sessionId = manager.createSession('proj-1', '/tmp');

      // Get the onExit callback and invoke it
      const onExitCb = mockOnExit.mock.calls[0][0];
      onExitCb({ exitCode: 0, signal: 0 });

      expect(exitHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId,
          exitCode: 0,
        }),
      );

      expect(manager.getSession(sessionId)).toBeUndefined();
    });
  });

  // ========================================================================
  // Session retrieval
  // ========================================================================

  describe('getSession', () => {
    it('should return undefined for non-existent session', () => {
      expect(manager.getSession('nope')).toBeUndefined();
    });

    it('should return session after creation', () => {
      const id = manager.createSession('proj-1', '/tmp');
      const session = manager.getSession(id);

      expect(session).toBeDefined();
      expect(session!.id).toBe(id);
      expect(session!.projectId).toBe('proj-1');
      expect(session!.workingDirectory).toBe('/tmp');
    });
  });

  describe('getSessionsByProject', () => {
    it('should return empty array when no sessions for project', () => {
      expect(manager.getSessionsByProject('proj-1')).toEqual([]);
    });

    it('should return sessions for a specific project', () => {
      manager.createSession('proj-1', '/tmp/a');
      manager.createSession('proj-1', '/tmp/b');
      manager.createSession('proj-2', '/tmp/c');

      const sessions = manager.getSessionsByProject('proj-1');
      expect(sessions).toHaveLength(2);
    });
  });

  // ========================================================================
  // Writing to session
  // ========================================================================

  describe('writeToSession', () => {
    it('should return false for non-existent session', () => {
      expect(manager.writeToSession('nope', 'ls\n')).toBe(false);
    });

    it('should write data to pty', () => {
      const id = manager.createSession('proj-1', '/tmp');
      const result = manager.writeToSession(id, 'ls\n');

      expect(result).toBe(true);
      expect(mockPtyWrite).toHaveBeenCalledWith('ls\n');
    });
  });

  // ========================================================================
  // Resize
  // ========================================================================

  describe('resizeSession', () => {
    it('should return false for non-existent session', () => {
      expect(manager.resizeSession('nope', 120, 40)).toBe(false);
    });

    it('should resize the pty', () => {
      const id = manager.createSession('proj-1', '/tmp');
      const result = manager.resizeSession(id, 120, 40);

      expect(result).toBe(true);
      expect(mockPtyResize).toHaveBeenCalledWith(120, 40);
    });
  });

  // ========================================================================
  // Kill session
  // ========================================================================

  describe('killSession', () => {
    it('should return false for non-existent session', () => {
      expect(manager.killSession('nope')).toBe(false);
    });

    it('should kill the pty and remove from map', () => {
      const id = manager.createSession('proj-1', '/tmp');
      const result = manager.killSession(id);

      expect(result).toBe(true);
      expect(mockPtyKill).toHaveBeenCalled();
      expect(manager.getSession(id)).toBeUndefined();
    });
  });

  describe('killSessionsByProject', () => {
    it('should kill all sessions for a project', () => {
      manager.createSession('proj-1', '/tmp/a');
      manager.createSession('proj-1', '/tmp/b');

      const count = manager.killSessionsByProject('proj-1');
      expect(count).toBe(2);
      expect(mockPtyKill).toHaveBeenCalledTimes(2);
    });

    it('should return 0 when no sessions for project', () => {
      expect(manager.killSessionsByProject('proj-1')).toBe(0);
    });
  });

  // ========================================================================
  // List sessions
  // ========================================================================

  describe('listSessions', () => {
    it('should return empty array when no sessions', () => {
      expect(manager.listSessions()).toEqual([]);
    });

    it('should return session info', () => {
      const id = manager.createSession('proj-1', '/tmp/workspace');

      const list = manager.listSessions();
      expect(list).toHaveLength(1);
      expect(list[0]).toEqual(
        expect.objectContaining({
          id,
          projectId: 'proj-1',
          workingDirectory: '/tmp/workspace',
        }),
      );
      expect(list[0].createdAt).toBeDefined();
      expect(list[0].lastActivity).toBeDefined();
    });
  });

  // ========================================================================
  // Shutdown
  // ========================================================================

  describe('shutdown', () => {
    it('should kill all sessions and clear the map', () => {
      manager.createSession('proj-1', '/tmp/a');
      manager.createSession('proj-2', '/tmp/b');

      manager.shutdown();

      expect(mockPtyKill).toHaveBeenCalledTimes(2);
      expect(manager.listSessions()).toEqual([]);
    });
  });

  // ========================================================================
  // Cleanup inactive sessions
  // ========================================================================

  describe('cleanupInactiveSessions', () => {
    it('should clean up sessions after timeout', () => {
      const id = manager.createSession('proj-1', '/tmp');

      // Verify session exists
      expect(manager.getSession(id)).toBeDefined();

      // Advance time past the cleanup interval (5 min) and session timeout (30 min)
      // The cleanup runs every 5 min, so at 35 min the session (30 min timeout) should be cleaned
      vi.advanceTimersByTime(35 * 60 * 1000);

      // Session should have been cleaned up via killSession which calls pty.kill
      expect(mockPtyKill).toHaveBeenCalled();
      expect(manager.getSession(id)).toBeUndefined();
    });
  });
});
