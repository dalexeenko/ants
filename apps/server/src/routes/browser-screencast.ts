/**
 * Browser screencast WebSocket proxy route.
 *
 * Proxies WebSocket connections from the client to the agent-server's
 * screencast endpoint, forwarding all messages bidirectionally.
 *
 * Client URL:
 *   /projects/:projectId/sessions/:sessionId/browser/:browserId/screencast?token=<secret>
 *
 * Upstream (agent-server) URL:
 *   ws://127.0.0.1:<agentPort>/session/:sessionId/browser/:browserId/screencast
 *
 * Authentication is done via query parameter `token` (same pattern as terminal WS).
 */
import { Hono } from 'hono';
import { timingSafeEqual } from 'crypto';
import WebSocket from 'ws';
import type { ProjectManager } from '../services/project-manager.js';
import type { OpenMgrAgentManager } from '../services/openmgr-agent-manager.js';
import type { UserManager } from '../services/user-manager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('browser-screencast');

export interface ScreencastRouteDeps {
  projectManager: ProjectManager;
  agentManager: OpenMgrAgentManager;
  upgradeWebSocket: any;
  /** Shared server secret (single-user mode) */
  secret?: string;
  /** User manager for per-user token validation (multi-user mode) */
  userManager?: UserManager;
}

export function createBrowserScreencastRoutes(deps: ScreencastRouteDeps) {
  const { projectManager, agentManager, upgradeWebSocket, secret, userManager } = deps;
  const app = new Hono();

  /**
   * WebSocket proxy for screencast streaming.
   *
   * Connects the client to the agent-server's screencast WebSocket,
   * forwarding all messages (binary frames + JSON control) bidirectionally.
   */
  app.get(
    '/:projectId/sessions/:sessionId/browser/:browserId/screencast',
    upgradeWebSocket((c: any) => {
      const projectId = c.req.param('projectId');
      const sessionId = c.req.param('sessionId');
      const browserId = c.req.param('browserId');
      const url = new URL(c.req.url);
      const token = url.searchParams.get('token') || '';

      let upstream: WebSocket | null = null;

      return {
        async onOpen(_event: any, ws: any) {
          // Authenticate via query token.
          if (secret) {
            // Single-user mode: validate shared server secret
            try {
              const tokenBuffer = Buffer.from(token);
              const secretBuffer = Buffer.from(secret);
              if (
                tokenBuffer.length !== secretBuffer.length ||
                !timingSafeEqual(tokenBuffer, secretBuffer)
              ) {
                log.warn(`Screencast WS auth failed for project=${projectId} session=${sessionId}`);
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
              log.warn(`Screencast WS auth failed for project=${projectId} session=${sessionId} (invalid user token)`);
              ws.close(1008, 'Unauthorized');
              return;
            }
          }

          // Resolve project to get the agent-server port
          const project = await projectManager.getProject(projectId);
          if (!project) {
            ws.close(1008, 'Project not found');
            return;
          }

          const port = agentManager.getServerPort(project.workingDirectory);
          if (!port) {
            ws.close(1008, 'Agent server not running');
            return;
          }

          // Connect to the agent-server's screencast WebSocket
          const upstreamUrl = `ws://127.0.0.1:${port}/session/${sessionId}/browser/${browserId}/screencast`;
          log.debug(`Connecting to upstream screencast: ${upstreamUrl}`);

          upstream = new WebSocket(upstreamUrl);

          upstream.on('open', () => {
            log.debug(`Upstream screencast connected for browser=${browserId}`);
          });

          // Forward upstream messages to client (preserving binary vs text)
          upstream.on('message', (data: Buffer | string, isBinary: boolean) => {
            try {
              if (isBinary) {
                // Binary frame data — forward as-is
                ws.send(data);
              } else {
                // JSON control message — forward as string
                ws.send(typeof data === 'string' ? data : data.toString('utf-8'));
              }
            } catch (err) {
              log.error('Error forwarding upstream message to client:', err);
            }
          });

          upstream.on('close', (code: number, reason: Buffer) => {
            log.debug(`Upstream screencast closed: ${code} ${reason.toString()}`);
            try {
              ws.close(code, reason.toString());
            } catch {
              // Client may already be closed
            }
          });

          upstream.on('error', (err: Error) => {
            log.error('Upstream screencast error:', err.message);
            try {
              ws.close(1011, 'Upstream error');
            } catch {
              // Client may already be closed
            }
          });
        },

        onMessage(event: any, _ws: any) {
          // Forward client messages to upstream agent-server
          if (!upstream || upstream.readyState !== WebSocket.OPEN) return;
          try {
            upstream.send(event.data);
          } catch (err) {
            log.error('Error forwarding client message to upstream:', err);
          }
        },

        onClose(_event: any, _ws: any) {
          log.debug(`Client screencast WS closed for browser=${browserId}`);
          if (upstream) {
            try {
              upstream.close(1000, 'Client disconnected');
            } catch {
              // Already closed
            }
            upstream = null;
          }
        },

        onError(event: any, _ws: any) {
          log.error('Client screencast WS error:', event);
          if (upstream) {
            try {
              upstream.close(1011, 'Client error');
            } catch {
              // Already closed
            }
            upstream = null;
          }
        },
      };
    }),
  );

  /**
   * REST: List browser instances for a session.
   * Proxies to agent-server GET /session/:sessionId/browser
   */
  app.get('/:projectId/sessions/:sessionId/browser', async (c) => {
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');

    const client = await projectManager.getClient(projectId);
    if (!client) {
      return c.json({ browsers: [] });
    }

    try {
      // Use the agent client's request method if available, otherwise raw fetch
      const project = await projectManager.getProject(projectId);
      if (!project) return c.json({ browsers: [] });

      const port = agentManager.getServerPort(project.workingDirectory);
      if (!port) return c.json({ browsers: [] });

      const response = await fetch(
        `http://127.0.0.1:${port}/session/${sessionId}/browser`,
      );
      if (!response.ok) return c.json({ browsers: [] });

      const data = await response.json();
      return c.json(data);
    } catch {
      return c.json({ browsers: [] });
    }
  });

  /**
   * REST: Get a specific browser instance.
   * Proxies to agent-server GET /session/:sessionId/browser/:browserId
   */
  app.get('/:projectId/sessions/:sessionId/browser/:browserId', async (c) => {
    const projectId = c.req.param('projectId');
    const sessionId = c.req.param('sessionId');
    const browserId = c.req.param('browserId');

    const project = await projectManager.getProject(projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const port = agentManager.getServerPort(project.workingDirectory);
    if (!port) return c.json({ error: 'Agent server not running' }, 503);

    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/session/${sessionId}/browser/${browserId}`,
      );
      if (!response.ok) {
        return c.json({ error: 'Browser not found' }, response.status as any);
      }
      const data = await response.json();
      return c.json(data);
    } catch (err) {
      return c.json({ error: 'Failed to reach agent server' }, 503);
    }
  });

  return app;
}
