import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { timingSafeEqual } from 'crypto';
import type { ProjectManager } from '../services/project-manager.js';
import type { TerminalManager, TerminalData } from '../services/terminal-manager.js';
import type { UserManager } from '../services/user-manager.js';
import { parseBody, parseBodyOptional } from '../utils/validation.js';
import { CreateTerminalSchema, ResizeTerminalSchema } from '../schemas/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('terminals');

export interface TerminalRouteDeps {
  projectManager: ProjectManager;
  terminalManager: TerminalManager;
  upgradeWebSocket: any;
  /** Shared server secret (single-user mode) */
  secret?: string;
  /** User manager for per-user token validation (multi-user mode) */
  userManager?: UserManager;
}

export function createTerminalRoutes(deps: TerminalRouteDeps) {
  const { projectManager, terminalManager, upgradeWebSocket, secret, userManager } = deps;
  const app = new Hono();

  app.get('/:projectId/terminals', async (c) => {
    const projectId = c.req.param('projectId');
    const project = await projectManager.getProject(projectId);
    
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const sessions = terminalManager.getSessionsByProject(projectId);
    return c.json({
      sessions: sessions.map(session => ({
        id: session.id,
        projectId: session.projectId,
        workingDirectory: session.workingDirectory,
        createdAt: session.createdAt.toISOString(),
        lastActivity: session.lastActivity.toISOString(),
      }))
    });
  });

  app.post('/:projectId/terminals', async (c) => {
    const projectId = c.req.param('projectId');
    const project = await projectManager.getProject(projectId);
    
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const body = await parseBodyOptional(c, CreateTerminalSchema, {});
    const { shell, workingDirectory } = body;

    const sessionWorkingDir = workingDirectory || project.workingDirectory;
    const sessionId = terminalManager.createSession(projectId, sessionWorkingDir, shell);

    return c.json({
      sessionId,
      projectId,
      workingDirectory: sessionWorkingDir,
      createdAt: new Date().toISOString(),
    });
  });

  app.get('/:projectId/terminals/:sessionId', async (c) => {
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');
    
    const project = await projectManager.getProject(projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const session = terminalManager.getSession(sessionId);
    if (!session || session.projectId !== projectId) {
      return c.json({ error: 'Terminal session not found' }, 404);
    }

    return c.json({
      id: session.id,
      projectId: session.projectId,
      workingDirectory: session.workingDirectory,
      createdAt: session.createdAt.toISOString(),
      lastActivity: session.lastActivity.toISOString(),
    });
  });

  app.delete('/:projectId/terminals/:sessionId', async (c) => {
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');
    
    const project = await projectManager.getProject(projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const session = terminalManager.getSession(sessionId);
    if (!session || session.projectId !== projectId) {
      return c.json({ error: 'Terminal session not found' }, 404);
    }

    const killed = terminalManager.killSession(sessionId);
    if (!killed) {
      return c.json({ error: 'Failed to kill terminal session' }, 500);
    }

    return c.json({ success: true });
  });

  app.post('/:projectId/terminals/:sessionId/resize', async (c) => {
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');
    
    const project = await projectManager.getProject(projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const session = terminalManager.getSession(sessionId);
    if (!session || session.projectId !== projectId) {
      return c.json({ error: 'Terminal session not found' }, 404);
    }

    const body = await parseBody(c, ResizeTerminalSchema);
    const { cols, rows } = body;

    const resized = terminalManager.resizeSession(sessionId, cols, rows);
    if (!resized) {
      return c.json({ error: 'Failed to resize terminal' }, 500);
    }

    return c.json({ success: true });
  });

  app.get('/:projectId/terminals/:sessionId/ws', 
    upgradeWebSocket((c: any) => {
      const projectId = c.req.param('projectId');
      const sessionId = c.req.param('sessionId');
      // Extract token from query parameter for WebSocket auth
      const url = new URL(c.req.url);
      const token = url.searchParams.get('token') || '';
      
      return {
        async onOpen(event: any, ws: any) {
          // Verify authentication token
          // WebSocket connections bypass HTTP middleware, so we must verify here.
          if (secret) {
            // Single-user mode: validate shared server secret
            try {
              const tokenBuffer = Buffer.from(token);
              const secretBuffer = Buffer.from(secret);
              if (tokenBuffer.length !== secretBuffer.length || 
                  !timingSafeEqual(tokenBuffer, secretBuffer)) {
                log.warn(`WebSocket auth failed for terminal session ${sessionId}`);
                ws.close(1008, 'Unauthorized');
                return;
              }
            } catch {
              ws.close(1008, 'Unauthorized');
              return;
            }
          } else if (userManager) {
            // Multi-user mode: validate per-user token
            const user = await userManager.validateToken(token);
            if (!user) {
              log.warn(`WebSocket auth failed for terminal session ${sessionId} (invalid user token)`);
              ws.close(1008, 'Unauthorized');
              return;
            }
          }

          const project = await projectManager.getProject(projectId);
          if (!project) {
            ws.close(1008, 'Project not found');
            return;
          }

          const session = terminalManager.getSession(sessionId);
          if (!session || session.projectId !== projectId) {
            ws.close(1008, 'Terminal session not found');
            return;
          }

          const dataListener = (data: TerminalData) => {
            if (data.sessionId === sessionId) {
              ws.send(JSON.stringify({
                type: 'data',
                data: data.data,
                timestamp: data.timestamp.toISOString(),
              }));
            }
          };

          const exitListener = (exitData: any) => {
            if (exitData.sessionId === sessionId) {
              ws.send(JSON.stringify({
                type: 'exit',
                exitCode: exitData.exitCode,
                signal: exitData.signal,
                timestamp: exitData.timestamp.toISOString(),
              }));
              ws.close(1000, 'Terminal session ended');
            }
          };

          terminalManager.on('data', dataListener);
          terminalManager.on('exit', exitListener);

          (ws as any)._dataListener = dataListener;
          (ws as any)._exitListener = exitListener;

          log.debug(`WebSocket connected for terminal session ${sessionId}`);
        },

        onMessage(event: any, ws: any) {
          try {
            const message = JSON.parse(event.data.toString());
            
            switch (message.type) {
              case 'input':
                terminalManager.writeToSession(sessionId, message.data);
                break;
              case 'resize':
                terminalManager.resizeSession(sessionId, message.cols, message.rows);
                break;
              default:
                log.warn('Unknown message type:', message.type);
            }
          } catch (error) {
            log.error('Error processing WebSocket message:', error);
          }
        },

        onClose(event: any, ws: any) {
          if ((ws as any)._dataListener) {
            terminalManager.removeListener('data', (ws as any)._dataListener);
          }
          if ((ws as any)._exitListener) {
            terminalManager.removeListener('exit', (ws as any)._exitListener);
          }
          
          log.debug(`WebSocket disconnected for terminal session ${sessionId}`);
        },

        onError(event: any, ws: any) {
          log.error('WebSocket error for terminal session', sessionId, ':', event);
        },
      };
    })
  );

  return app;
}
