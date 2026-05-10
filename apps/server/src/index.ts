#!/usr/bin/env node

import 'dotenv/config';

import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { cors } from 'hono/cors';
import { loadConfig } from './config.js';
import { maskSecret } from './services/encryption.js';
import { DatabaseService } from './db/index.js';
import { createServices } from './services/container.js';
import { registerRoutes } from './routes/index.js';
import { createLogger, banner } from './utils/logger.js';
import { createHostValidation } from './utils/host-validation.js';

const log = createLogger('server');

async function main() {
  // ── Config & database ──────────────────────────────────────────────
  const config = loadConfig();
  const databaseService = new DatabaseService({
    dataDir: config.dataDir,
    sqliteJournalMode: config.sqliteJournalMode,
  });

  // ── Services ───────────────────────────────────────────────────────
  const services = await createServices(config, databaseService.db);

  // ── Clean up orphaned agent processes from previous server runs ────
  await services.agentManager.cleanupOrphanedProcesses();

  // ── Agent installation check ───────────────────────────────────────
  if (config.autoInstallAgent) {
    log.info('Checking Ants Agent installation...');
    const agentInstalled = await services.agentManager.isInstalled();

    if (!agentInstalled) {
      log.info('Ants Agent not found. Installing...');
      try {
        await services.agentManager.install();
        const agentVersion = await services.agentManager.getVersion();
        log.info(`Ants Agent installed successfully (${agentVersion})`);
      } catch (e) {
        log.error('Failed to install Ants Agent:', e instanceof Error ? e.message : e);
        log.error('Agent features will not be available. Install manually or check your network.');
      }
    } else {
      const agentVersion = await services.agentManager.getVersion();
      log.info(`Ants Agent found: ${agentVersion}`);
    }
  }

  // ── Hono app + WebSocket ───────────────────────────────────────────
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  // ── Global error handler ──────────────────────────────────────────
  // Ensures unhandled errors (e.g. database corruption) return a proper
  // HTTP response instead of hanging the request until timeout.
  // HTTPExceptions (e.g. ValidationError 400) return their attached
  // response directly. Re-throwing would work with app.request() but
  // causes @hono/node-server to return 500 because the re-throw
  // propagates out of compose() as a rejected promise.
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return err.getResponse();
    }
    log.error('Unhandled request error:', err);
    return c.json(
      { error: 'Internal server error' },
      500,
    );
  });

  // ── Host validation ─────────────────────────────────────────────────
  const hostValidation = createHostValidation(config.allowedHosts);
  if (hostValidation) {
    app.use('*', hostValidation);
  }

  // CORS
  const corsOrigin = config.corsOrigins.includes('*')
    ? '*'
    : (origin: string) => config.corsOrigins.includes(origin) ? origin : null;

  app.use('*', cors({
    origin: corsOrigin,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
  }));

  // Request logging — logs every request with method, path, status, and
  // duration. Non-success responses (4xx/5xx) are logged at warn/error
  // level with the response body for debugging.
  app.use('*', async (c, next) => {
    const start = Date.now();
    const method = c.req.method;
    const path = c.req.path;

    await next();

    const duration = Date.now() - start;
    const status = c.res.status;

    if (status >= 500) {
      // Clone the response so we can read the body without consuming it
      const cloned = c.res.clone();
      const body = await cloned.text().catch(() => '');
      log.error(`${method} ${path} ${status} ${duration}ms - ${body}`);
    } else if (status >= 400) {
      const cloned = c.res.clone();
      const body = await cloned.text().catch(() => '');
      log.warn(`${method} ${path} ${status} ${duration}ms - ${body}`);
    } else {
      log.info(`${method} ${path} ${status} ${duration}ms`);
    }
  });

  // ── Routes ─────────────────────────────────────────────────────────
  registerRoutes(app, config, services, upgradeWebSocket);

  // ── Background services ────────────────────────────────────────────
  services.taskScheduler.start();
  services.messageProcessor.start();
  services.agentComms.start();
  services.webhookManager.start();
  services.approvalManager.start();
  await services.fileWatcherManager.startAllWatchers();
  await services.channelManager.initialize();

  // Banner printing is deferred into the serve callback so we can
  // display the actual bound port (important when config.port is 0).
  const printBanner = (actualPort: number) => {
    banner('');
    banner('  Ants Remote Server');
    banner('  =====================');
    banner('');
    banner(`  Server:     http://${config.host}:${actualPort}`);
    banner(`  Web UI:     http://${config.host}:${actualPort}`);
    banner(`  Data Dir:   ${config.dataDir}`);
    banner(`  Workspaces: ${config.workspacesDir}`);
    banner('');
    // Auth providers
    const authMethods: string[] = [];
    if (config.multiUser) {
      authMethods.push('Password + User Tokens');
    }
    if (config.cfAccessTeamDomain && config.cfAccessAud) {
      authMethods.push('Cloudflare Access');
    }
    if (config.secret) {
      authMethods.push('Bearer Token');
    }
    banner(`  Auth:       ${authMethods.join(', ')}`);

    if (config.secret) {
      banner(`  Secret:     ${maskSecret(config.secret)}`);
    }
    banner(`  Config:     ${config.dataDir}/config.json`);
    banner('');
    if (config.multiUser) {
      banner('  Multi-User: Enabled');
      if (services.userManager?.needsSetup()) {
        banner('');
        banner('  ┌─────────────────────────────────────────────────┐');
        banner('  │  SETUP REQUIRED                                 │');
        banner('  │                                                 │');
        banner('  │  No admin account exists yet.                   │');
        banner('  │  Create one via POST /setup or the web UI.      │');
        if (config.setupToken) {
          banner('  │  A setup token is required (ANTS_SETUP_TOKEN)│');
        }
        banner('  └─────────────────────────────────────────────────┘');
      } else {
        banner('  Login:      POST /users/login');
      }
      banner('');
    }
    if (config.secret) {
      banner('  The full secret is stored in the config file above.');
      banner('  Use it as the Bearer token for authentication.');
    } else if (!config.multiUser) {
      banner('  Authentication is handled by Cloudflare Access.');
      banner('  No bearer token secret is configured.');
    }
    banner('');

    // Channel warning
    if ((config.host === '127.0.0.1' || config.host === 'localhost') && services.channelManager.hasEnabledChannels()) {
      banner('  WARNING: Server is bound to localhost but has messaging channels configured.');
      banner('  External platforms (Slack, Discord, etc.) will not be able to send webhooks.');
      banner('  To receive webhooks, either:');
      banner('    - Bind to 0.0.0.0 and expose the server publicly');
      banner('    - Use a tunnel (ngrok, cloudflare tunnel) to expose the server');
      banner('  See docs/slack-setup.md for more information.');
      banner('');
    }
  };

  // ── Start ──────────────────────────────────────────────────────────
  const server = serve({
    fetch: app.fetch,
    port: config.port,
    hostname: config.host,
  }, (info) => {
    // Print banner with the actual bound port (resolves port 0 to real port)
    printBanner(info.port);
  });

  injectWebSocket(server);

  // ── Shutdown handler ───────────────────────────────────────────────
  const shutdown = async () => {
    log.info('Shutting down...');
    // Close the HTTP server first so the port is released immediately,
    // preventing EADDRINUSE when the next process tries to bind.
    server.close();
    services.approvalManager.stop();
    services.webhookManager.stop();
    services.fileWatcherManager.shutdown();
    services.agentComms.stop();
    services.messageProcessor.stop();
    await services.channelManager.shutdown();
    services.terminalManager.shutdown();
    await services.agentManager.shutdown();
    databaseService.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  log.error('Fatal error:', e);
  process.exit(1);
});
