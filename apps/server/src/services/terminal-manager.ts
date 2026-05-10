import { spawn } from 'node-pty';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import type { IPty } from 'node-pty';
import { createLogger } from '../utils/logger.js';

const log = createLogger('TerminalManager');

export interface TerminalSession {
  id: string;
  projectId: string;
  pty: IPty;
  workingDirectory: string;
  createdAt: Date;
  lastActivity: Date;
}

export interface TerminalData {
  sessionId: string;
  data: string;
  timestamp: Date;
}

export interface TerminalResize {
  sessionId: string;
  cols: number;
  rows: number;
}

export class TerminalManager extends EventEmitter {
  private sessions = new Map<string, TerminalSession>();
  private cleanupInterval: NodeJS.Timeout;
  private readonly SESSION_TIMEOUT = 30 * 60 * 1000;

  constructor() {
    super();
    
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveSessions();
    }, 5 * 60 * 1000);
  }

  createSession(projectId: string, workingDirectory: string, shell?: string): string {
    const sessionId = uuidv4();
    
    const defaultShell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash';
    const shellCommand = shell || defaultShell;
    
    const pty = spawn(shellCommand, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: workingDirectory,
      env: process.env,
    });

    const session: TerminalSession = {
      id: sessionId,
      projectId,
      pty,
      workingDirectory,
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    pty.onData((data) => {
      session.lastActivity = new Date();
      this.emit('data', {
        sessionId,
        data,
        timestamp: new Date(),
      } as TerminalData);
    });

    pty.onExit(({ exitCode, signal }) => {
      this.emit('exit', {
        sessionId,
        exitCode,
        signal,
        timestamp: new Date(),
      });
      this.sessions.delete(sessionId);
    });

    this.sessions.set(sessionId, session);
    
    return sessionId;
  }

  getSession(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionsByProject(projectId: string): TerminalSession[] {
    return Array.from(this.sessions.values()).filter(
      session => session.projectId === projectId
    );
  }

  writeToSession(sessionId: string, data: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.lastActivity = new Date();
    session.pty.write(data);
    return true;
  }

  resizeSession(sessionId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.lastActivity = new Date();
    session.pty.resize(cols, rows);
    return true;
  }

  killSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.pty.kill();
    this.sessions.delete(sessionId);
    return true;
  }

  killSessionsByProject(projectId: string): number {
    const sessions = this.getSessionsByProject(projectId);
    sessions.forEach(session => {
      session.pty.kill();
      this.sessions.delete(session.id);
    });
    return sessions.length;
  }

  listSessions(): Array<{
    id: string;
    projectId: string;
    workingDirectory: string;
    createdAt: string;
    lastActivity: string;
  }> {
    return Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      projectId: session.projectId,
      workingDirectory: session.workingDirectory,
      createdAt: session.createdAt.toISOString(),
      lastActivity: session.lastActivity.toISOString(),
    }));
  }

  private cleanupInactiveSessions(): void {
    const now = new Date();
    const sessionsToCleanup: string[] = [];

    for (const [sessionId, session] of this.sessions) {
      const timeSinceLastActivity = now.getTime() - session.lastActivity.getTime();
      if (timeSinceLastActivity > this.SESSION_TIMEOUT) {
        sessionsToCleanup.push(sessionId);
      }
    }

    sessionsToCleanup.forEach(sessionId => {
      log.info(`Cleaning up inactive terminal session: ${sessionId}`);
      this.killSession(sessionId);
    });
  }

  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    for (const session of this.sessions.values()) {
      session.pty.kill();
    }
    this.sessions.clear();
  }
}
