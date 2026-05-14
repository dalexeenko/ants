/**
 * Route registration — mounts every route group onto the Hono app.
 *
 * All API routes live under /api/beta/ to avoid collisions with the
 * SPA's client-side routes (e.g. /projects). The version prefix
 * ("beta") signals that the API surface may have breaking changes.
 *
 * Takes the app instance, config, all services, and the websocket upgrader
 * so that src/index.ts stays focused on bootstrapping.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ServerConfig } from '../config.js';
import type { Services } from '../services/container.js';
import {
  createAuthMiddleware,
  BearerAuthProvider,
  UserTokenAuthProvider,
  CloudflareAccessAuthProvider,
  CookieAuthProvider,
} from '../auth/index.js';
import type { AuthProvider, AuthUser } from '../auth/index.js';
import { SYSTEM_USER_ID } from '../services/system-user.js';
import { createHealthRoutes, createAuthenticatedHealthRoutes } from './health.js';
import { createProjectRoutes } from './projects.js';
import { createFileRoutes } from './files.js';
import { createTaskRoutes } from './tasks.js';
import { createProviderRoutes } from './providers.js';
import { createSystemRoutes } from './system.js';
import { createTerminalRoutes, type TerminalRouteDeps } from './terminals.js';
import { createSearchRoutes } from './search.js';
import { createSessionRoutes } from './sessions.js';
import { createSessionStreamingRoutes } from './session-streaming.js';
import { createFilesystemRoutes } from './filesystem.js';
import { createToolsRoutes } from './tools.js';
import { createPluginRoutes } from './plugins.js';
import { createAgentTypeRoutes } from './agent-types.js';
import { createPermissionRoutes } from './permissions.js';
import { createUsageRoutes } from './usage.js';
import { createMcpRoutes } from './mcp.js';
import { createFileWatchRoutes } from './file-watch.js';
import { createChannelRoutes, createChannelWebhookRoutes } from './channels.js';
import { createAnalyticsRoutes } from './analytics.js';
import { createAgentCommsRoutes } from './agent-comms.js';
import { createApprovalRoutes } from './approvals.js';
import { createWebhookRoutes, createWebhookIngestRoutes } from './webhooks.js';
import { createUserRoutes } from './users.js';
import { createTemplateRoutes } from './templates.js';
import { createNotificationRoutes } from './notifications.js';
import { createGroupRoutes } from './groups.js';
import { createUserNotificationRoutes } from './user-notifications.js';
import { createDockerRoutes } from './docker.js';
import { createMemoryRoutes } from './memories.js';
import { createBrowserScreencastRoutes } from './browser-screencast.js';
import { createScreenshotRoutes } from './screenshots.js';

import { createAuthRoutes } from './auth.js';
import { createOAuthRoutes } from './oauth.js';
import { createSetupRoutes } from './setup.js';
import { existsSync, readFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { pathExists } from '../utils/fs.js';
import { createLogger } from '../utils/logger.js';
import { hasValidWebUiSession } from '../utils/web-app-session-gate.js';

const log = createLogger('routes');

/** The versioned API prefix for all API routes. */
export const API_PREFIX = '/api/beta';

export function registerRoutes(
  app: Hono,
  config: ServerConfig,
  services: Services,
  upgradeWebSocket: TerminalRouteDeps['upgradeWebSocket'],
) {
  const {
    db,
    agentManager,
    projectManager,
    taskScheduler,
    terminalManager,
    channelManager,
    messageQueue,
    analytics,
    agentComms,
    webhookManager,
    fileWatcherManager,
    approvalManager,
    templateManager,
    pushService,
    apiKeyManager,
    userManager,
    auditLogger,
    webSessionService,
    authCodeService,
    groupManager,
    oauthService,
    pluginRegistry,
  } = services;

  // ── Build auth middleware ───────────────────────────────────────────
  const authProviders: AuthProvider[] = [];

  {
    const systemUserRecord: AuthUser = {
      id: SYSTEM_USER_ID,
      username: 'system',
      displayName: 'System',
      email: null,
      role: 'admin',
      enabled: true,
      lastLoginAt: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };

    const lookupUser = async (userId: string): Promise<AuthUser | null> => {
      if (userManager) {
        return userManager.getUser(userId);
      }
      if (userId === SYSTEM_USER_ID) {
        return systemUserRecord;
      }
      return null;
    };
    authProviders.push(new CookieAuthProvider(webSessionService, lookupUser));
  }

  if (config.cfAccessTeamDomain && config.cfAccessAud) {
    authProviders.push(new CloudflareAccessAuthProvider({
      teamDomain: config.cfAccessTeamDomain,
      aud: config.cfAccessAud,
      setIdentity: config.cfAccessSetIdentity,
    }));
  }

  if (config.multiUser && userManager) {
    authProviders.push(new UserTokenAuthProvider(userManager));
  } else if (config.secret) {
    authProviders.push(new BearerAuthProvider(config.secret));
  }

  const authMiddleware = createAuthMiddleware(authProviders, {
    systemUserEnabled: !config.multiUser,
  });

  // ══════════════════════════════════════════════════════════════════════
  // ── API sub-app (/api/beta) ──────────────────────────────────────────
  // All API routes are mounted here, keeping them separate from the
  // SPA's client-side routes and static file serving.
  // ══════════════════════════════════════════════════════════════════════
  const apiApp = new Hono();

  // ── Public API routes (no auth) ─────────────────────────────────────
  apiApp.route('/', createHealthRoutes(config, agentManager));

  // VAPID key endpoint is public (needed for service worker registration before auth)
  apiApp.get('/notifications/vapid-key', (c) => {
    return c.json({ publicKey: pushService.getPublicKey() });
  });

  // ── Auth routes (public — they handle their own authentication) ─────
  apiApp.route('/auth', createAuthRoutes({
    config,
    webSessionService,
    authCodeService,
    userManager,
    auditLogger,
    oauthService,
  }));

  // ── OAuth routes (public — social auth initiation/callback + provider list) ──
  apiApp.route('/auth', createOAuthRoutes({
    config,
    oauthService,
    webSessionService,
    authCodeService,
    auditLogger,
  }));

  // ── Setup routes (public — initial admin creation in multi-user mode) ──
  if (userManager && auditLogger) {
    apiApp.route('/setup', createSetupRoutes({
      config,
      userManager,
      auditLogger,
      webSessionService,
    }));
  }

  // ── WebSocket ?token= → Authorization header promotion ─────────────
  apiApp.use('/projects/*/terminals/*/ws', async (c, next) => {
    const token = c.req.query('token');
    if (token && !c.req.header('Authorization')) {
      c.req.raw.headers.set('Authorization', `Bearer ${token}`);
    }
    await next();
  });
  apiApp.use('/projects/*/browser-screencast/*/ws', async (c, next) => {
    const token = c.req.query('token');
    if (token && !c.req.header('Authorization')) {
      c.req.raw.headers.set('Authorization', `Bearer ${token}`);
    }
    await next();
  });

  // ── Auth middleware (applied to API sub-app paths) ──────────────────
  apiApp.use('/projects/*', authMiddleware);
  apiApp.use('/providers/*', authMiddleware);
  apiApp.use('/system/*', authMiddleware);
  apiApp.use('/search/*', authMiddleware);
  apiApp.use('/filesystem/*', authMiddleware);
  apiApp.use('/channels/*', authMiddleware);
  apiApp.use('/analytics/*', authMiddleware);
  apiApp.use('/agent-comms/*', authMiddleware);
  apiApp.use('/approvals/*', authMiddleware);
  apiApp.use('/templates/*', authMiddleware);
  apiApp.use('/notifications/*', authMiddleware);
  apiApp.use('/docker/*', authMiddleware);
  apiApp.use('/groups/*', authMiddleware);
  apiApp.use('/health/auth', authMiddleware);

  // ── Multi-user routes (only when enabled) ────────────────────────────
  if (userManager && auditLogger) {
    const userRoutes = createUserRoutes(userManager, auditLogger);
    apiApp.post('/users/login', async (c) => {
      const body = await c.req.json();
      const { username, password } = body as { username: string; password: string };
      if (!username || !password) {
        return c.json({ error: 'username and password are required' }, 400);
      }
      const result = await userManager!.authenticatePassword(username, password);
      if (!result) {
        auditLogger!.log({
          username,
          action: 'user.login_failed',
          ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || undefined,
        });
        return c.json({ error: 'Invalid username or password' }, 401);
      }
      auditLogger!.log({
        userId: result.user.id,
        username: result.user.username,
        action: 'user.login',
        ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || undefined,
      });
      return c.json({ user: result.user, token: result.token });
    });

    apiApp.use('/users/*', authMiddleware);
    apiApp.route('/users', userRoutes);

    apiApp.route('/groups', createGroupRoutes(groupManager, auditLogger));
  }

  // ── User self-service routes (current user info + notification prefs) ─
  {
    const userNotificationRoutes = createUserNotificationRoutes(pushService);
    apiApp.use('/me', authMiddleware);
    apiApp.use('/me/*', authMiddleware);
    apiApp.route('/me', userNotificationRoutes);
  }

  // ── Project-scoped routes ────────────────────────────────────────────
  apiApp.route('/projects', createProjectRoutes(projectManager, db));
  apiApp.route('/projects', createFileRoutes(projectManager));
  apiApp.route('/projects', createTaskRoutes(taskScheduler));
  apiApp.route('/projects', createSessionRoutes(projectManager));
  apiApp.route('/projects', createSessionStreamingRoutes(projectManager, approvalManager, pushService));
  apiApp.route('/projects', createToolsRoutes(projectManager));
  apiApp.route('/projects', createPluginRoutes(projectManager, pluginRegistry));
  apiApp.route('/projects', createAgentTypeRoutes(projectManager));
  apiApp.route('/projects', createPermissionRoutes(projectManager));
  apiApp.route('/projects', createUsageRoutes(projectManager));
  apiApp.route('/projects', createMcpRoutes(projectManager));
  apiApp.route('/projects', createFileWatchRoutes(projectManager));
  apiApp.route('/projects', createTerminalRoutes({
    projectManager, terminalManager, upgradeWebSocket,
    secret: config.secret, userManager,
  }));
  apiApp.route('/projects', createWebhookRoutes(webhookManager, fileWatcherManager));
  apiApp.route('/projects', createMemoryRoutes(projectManager));
  apiApp.route('/projects', createScreenshotRoutes(projectManager));
  apiApp.route('/projects', createBrowserScreencastRoutes({
    projectManager, agentManager, upgradeWebSocket,
    secret: config.secret, userManager,
  }));

  // ── Other authenticated routes ───────────────────────────────────────
  apiApp.route('/providers', createProviderRoutes(apiKeyManager));
  apiApp.route('/system', createSystemRoutes(config, agentManager, apiKeyManager, pluginRegistry));
  apiApp.route('/search', createSearchRoutes(projectManager));
  apiApp.route('/filesystem', createFilesystemRoutes(config));
  apiApp.route('/channels', createChannelRoutes(channelManager, messageQueue));
  apiApp.route('/analytics', createAnalyticsRoutes(analytics));
  apiApp.route('/agent-comms', createAgentCommsRoutes(agentComms));
  apiApp.route('/approvals', createApprovalRoutes(approvalManager));
  apiApp.route('/templates', createTemplateRoutes(templateManager));
  apiApp.route('/notifications', createNotificationRoutes(pushService));
  apiApp.route('/docker', createDockerRoutes(agentManager, projectManager));

  // Authenticated health check
  apiApp.route('/health/auth', createAuthenticatedHealthRoutes(config, agentManager));

  // ── Unauthenticated webhook routes ───────────────────────────────────
  const channelWebhookRoutes = createChannelWebhookRoutes(channelManager, messageQueue);
  apiApp.route('/webhooks/channels', channelWebhookRoutes);
  apiApp.route('/hooks', createWebhookIngestRoutes(webhookManager));

  // ── Mount API sub-app at versioned prefix ────────────────────────────
  app.route(API_PREFIX, apiApp);

  // ══════════════════════════════════════════════════════════════════════
  // ── Static / UI routes (NOT under /api/beta) ─────────────────────────
  // ══════════════════════════════════════════════════════════════════════

  const serverRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

  // ── Web App UI (static files, gated by ANTS_WEB_APP) ─────────────
  if (config.webApp) {
    const appDistCandidates = [
      join(serverRoot, 'node_modules', '@ants', 'app-ui', 'dist'),
      join(serverRoot, 'dist', 'app'),
    ];
    const appDistDir = appDistCandidates.find(d => existsSync(d)) ?? appDistCandidates[0];

    if (existsSync(appDistDir)) {
      const APP_MIME_TYPES: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
      };

      app.get('/app/assets/*', async (c) => {
        const assetPath = c.req.path.replace(/^\/app/, '');
        const filePath = join(appDistDir, assetPath);
        if (await pathExists(filePath)) {
          const ext = extname(filePath);
          const contentType = APP_MIME_TYPES[ext] || 'application/octet-stream';
          const content = await readFile(filePath);
          return new Response(content, {
            headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000, immutable' },
          });
        }
        return c.notFound();
      });

      const appIndexHtml = readFileSync(join(appDistDir, 'index.html'), 'utf-8');
      const serveAppIndex = async (c: Context) => {
        try {
          if (!hasValidWebUiSession(c, webSessionService)) {
            return c.redirect('/login?redirect=' + encodeURIComponent('/app/'));
          }
          return c.html(appIndexHtml);
        } catch {
          return c.redirect('/login?redirect=' + encodeURIComponent('/app/'));
        }
      };

      app.get('/app', serveAppIndex);
      app.get('/app/', serveAppIndex);
      app.get('/app/*', async (c) => {
        const reqPath = c.req.path.replace(/^\/app/, '');
        const filePath = join(appDistDir, reqPath);
        if (await pathExists(filePath) && !filePath.endsWith('/')) {
          const ext = extname(filePath);
          const contentType = APP_MIME_TYPES[ext] || 'application/octet-stream';
          const content = await readFile(filePath);
          return new Response(content, {
            headers: { 'Content-Type': contentType },
          });
        }
        return serveAppIndex(c);
      });
    }
  }

  // ── Server Web UI (static files) ─────────────────────────────────────
  const uiDistCandidates = [
    join(serverRoot, 'node_modules', '@ants', 'server-ui', 'dist'),
    join(serverRoot, 'dist', 'ui'),
  ];
  const uiDistDir = uiDistCandidates.find(d => existsSync(d)) ?? uiDistCandidates[0];
  log.info(`Serving UI from: ${uiDistDir}`);
  if (existsSync(uiDistDir)) {
    const MIME_TYPES: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
    };

    app.get('/assets/*', async (c) => {
      const filePath = join(uiDistDir, c.req.path);
      if (await pathExists(filePath)) {
        const ext = extname(filePath);
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const content = await readFile(filePath);
        return new Response(content, {
          headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000, immutable' },
        });
      }
      return c.notFound();
    });

    app.get('/sw.js', async (c) => {
      const swPath = join(uiDistDir, 'sw.js');
      if (await pathExists(swPath)) {
        return new Response(await readFile(swPath), {
          headers: { 'Content-Type': 'text/javascript', 'Service-Worker-Allowed': '/' },
        });
      }
      return c.notFound();
    });

    const indexHtml = readFileSync(join(uiDistDir, 'index.html'), 'utf-8');

    // Root catch-all — must be the very last route
    app.get('*', (c) => {
      return c.html(indexHtml);
    });
  }
}
