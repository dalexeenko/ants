/**
 * LocalTerminalManager - Manages local terminal sessions for desktop projects
 * using node-pty. Provides a WebSocket server so the renderer's RemoteTerminal
 * component can connect the same way it does with remote server terminals.
 */

import { EventEmitter } from 'events';
import { createServer } from 'http';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '@ants/ui';

const log = createLogger('LocalTerminalManager');

// Lazy-load native modules to avoid crashing the app if they're not available
// (e.g., ABI mismatch with Electron, missing prebuild, etc.)
let nodePty: typeof import('node-pty') | null = null;
let wsModule: typeof import('ws') | null = null;
type IPty = import('node-pty').IPty;
type WebSocketServerType = import('ws').WebSocketServer;
type WebSocketType = import('ws').WebSocket;

try {
  nodePty = require('node-pty');
} catch (err) {
  log.warn('node-pty not available — local terminal sessions will be disabled:', err);
}

try {
  wsModule = require('ws');
} catch (err) {
  log.warn('ws not available — local terminal sessions will be disabled:', err);
}

interface LocalTerminalSession {
  id: string;
  projectId: string;
  pty: IPty;
  workingDirectory: string;
  createdAt: Date;
  lastActivity: Date;
  /** Connected WebSocket clients for this session */
  clients: Set<any>; // WebSocket instances
}

export class LocalTerminalManager extends EventEmitter {
  private sessions = new Map<string, LocalTerminalSession>();
  private wss: WebSocketServerType | null = null;
  private httpServer: ReturnType<typeof createServer> | null = null;
  private port = 0;
  /** Auth token for WebSocket connections */
  private readonly token: string;
  /** Whether native terminal modules are available */
  readonly available: boolean;

  constructor() {
    super();
    this.token = uuidv4();
    this.available = nodePty !== null && wsModule !== null;
    if (!this.available) {
      log.warn('LocalTerminalManager created but native modules are unavailable');
    }
  }

  /**
   * Start the local WebSocket server. Must be called before using terminals.
   * Returns the port the server is listening on.
   */
  async start(): Promise<number> {
    if (!this.available) {
      log.warn('Cannot start terminal server: native modules not available');
      return 0;
    }
    if (this.wss) return this.port;

    const { WebSocketServer } = wsModule!;

    return new Promise((resolve, reject) => {
      this.httpServer = createServer();
      this.wss = new WebSocketServer({ server: this.httpServer });

      this.wss.on('connection', (ws, req) => {
        this.handleConnection(ws, req);
      });

      // Listen on a random available port (use 'localhost' not '127.0.0.1'
      // to match the renderer CSP which allows ws://localhost:*)
      this.httpServer.listen(0, 'localhost', () => {
        const addr = this.httpServer!.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
          log.info(`Local terminal WebSocket server listening on port ${this.port}`);
          resolve(this.port);
        } else {
          reject(new Error('Failed to get server address'));
        }
      });

      this.httpServer.on('error', (err) => {
        log.error('Local terminal server error:', err);
        reject(err);
      });
    });
  }

  private handleConnection(ws: any, req: any) {
    const url = new URL(req.url || '/', `http://localhost:${this.port}`);
    const token = url.searchParams.get('token');
    
    // Verify auth token
    if (token !== this.token) {
      log.warn('Unauthorized WebSocket connection attempt');
      ws.close(1008, 'Unauthorized');
      return;
    }

    // Parse session ID from URL path: /terminals/{sessionId}
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts.length < 2 || pathParts[0] !== 'terminals') {
      ws.close(1008, 'Invalid path');
      return;
    }
    const sessionId = pathParts[1];

    const session = this.sessions.get(sessionId);
    if (!session) {
      ws.close(1008, 'Terminal session not found');
      return;
    }

    session.clients.add(ws);
    log.debug(`WebSocket client connected to terminal session ${sessionId}`);

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        switch (message.type) {
          case 'input':
            session.pty.write(message.data);
            session.lastActivity = new Date();
            break;
          case 'resize':
            session.pty.resize(message.cols, message.rows);
            session.lastActivity = new Date();
            break;
          default:
            log.warn('Unknown message type:', message.type);
        }
      } catch (e) {
        log.error('Error processing WebSocket message:', e);
      }
    });

    ws.on('close', () => {
      session.clients.delete(ws);
      log.debug(`WebSocket client disconnected from terminal session ${sessionId}`);
    });
  }

  createSession(projectId: string, workingDirectory: string, shell?: string): string {
    if (!this.available || !nodePty) {
      throw new Error('Local terminal is not available: native modules not loaded');
    }

    const sessionId = uuidv4();
    const defaultShell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
    const shellCommand = shell || defaultShell;

    const pty = nodePty.spawn(shellCommand, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: workingDirectory,
      env: process.env as Record<string, string>,
    });

    const session: LocalTerminalSession = {
      id: sessionId,
      projectId,
      pty,
      workingDirectory,
      createdAt: new Date(),
      lastActivity: new Date(),
      clients: new Set(),
    };

    // Forward pty data to all connected WebSocket clients
    pty.onData((data) => {
      session.lastActivity = new Date();
      const message = JSON.stringify({
        type: 'data',
        data,
        timestamp: new Date().toISOString(),
      });
      const WS_OPEN = wsModule?.WebSocket?.OPEN ?? 1;
      for (const client of session.clients) {
        if (client.readyState === WS_OPEN) {
          client.send(message);
        }
      }
    });

    pty.onExit(({ exitCode, signal }) => {
      const message = JSON.stringify({
        type: 'exit',
        exitCode,
        signal,
        timestamp: new Date().toISOString(),
      });
      const WS_OPEN = wsModule?.WebSocket?.OPEN ?? 1;
      for (const client of session.clients) {
        if (client.readyState === WS_OPEN) {
          client.send(message);
          client.close(1000, 'Terminal session ended');
        }
      }
      this.sessions.delete(sessionId);
    });

    this.sessions.set(sessionId, session);
    log.info(`Created local terminal session ${sessionId} for project ${projectId} in ${workingDirectory}`);

    return sessionId;
  }

  getSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return {
      id: session.id,
      projectId: session.projectId,
      workingDirectory: session.workingDirectory,
      createdAt: session.createdAt.toISOString(),
      lastActivity: session.lastActivity.toISOString(),
    };
  }

  getSessionsByProject(projectId: string) {
    return Array.from(this.sessions.values())
      .filter((s) => s.projectId === projectId)
      .map((s) => ({
        id: s.id,
        projectId: s.projectId,
        workingDirectory: s.workingDirectory,
        createdAt: s.createdAt.toISOString(),
        lastActivity: s.lastActivity.toISOString(),
      }));
  }

  resizeSession(sessionId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.pty.resize(cols, rows);
    return true;
  }

  killSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    
    // Close all WebSocket clients
    for (const client of session.clients) {
      client.close(1000, 'Terminal session killed');
    }
    
    session.pty.kill();
    this.sessions.delete(sessionId);
    return true;
  }

  getWebSocketUrl(sessionId: string): string | null {
    if (!this.wss || this.port === 0) return null;
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return `ws://localhost:${this.port}/terminals/${sessionId}?token=${encodeURIComponent(this.token)}`;
  }

  async shutdown(): Promise<void> {
    // Kill all terminal sessions
    for (const session of this.sessions.values()) {
      for (const client of session.clients) {
        client.close(1000, 'Shutting down');
      }
      session.pty.kill();
    }
    this.sessions.clear();

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
    this.port = 0;
  }
}
