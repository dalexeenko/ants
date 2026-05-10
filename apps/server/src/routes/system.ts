import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readdir, stat, rm, readFile } from 'fs/promises';
import { join } from 'path';
import type { ServerConfig } from '../config.js';
import type { AntsAgentManager } from '../services/ants-agent-manager.js';
import type { ApiKeyManager } from '../services/api-key-manager.js';
import type { PluginRegistry } from '../services/plugin-registry.js';
import { generateAuthorizationUrl, exchangeCodeForTokens } from '@ants/agent-auth-anthropic';
import { getErrorMessage } from '../utils/errors.js';
import { parseBody, parseBodyOptional } from '../utils/validation.js';
import { pathExists } from '../utils/fs.js';
import { createLogger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

const log = createLogger('system');
import {
  CreateCustomEnvVarSchema,
  UpdateCustomEnvVarSchema,
  SetProviderKeysSchema,
  SetOAuthCredentialsSchema,
  OAuthCodeExchangeSchema,
  RegisterPluginSchema,
  UpdatePluginSchema,
  CleanupSessionsSchema,
} from '../schemas/index.js';
import { OAUTH_VERIFIER_TTL_MS } from '../constants.js';

// Store pending OAuth verifiers (in production, use a proper session store)
const pendingOAuthVerifiers = new Map<string, { verifier: string; createdAt: number }>();

// Clean up old verifiers
function cleanupOldVerifiers() {
  const cutoff = Date.now() - OAUTH_VERIFIER_TTL_MS;
  for (const [key, value] of pendingOAuthVerifiers.entries()) {
    if (value.createdAt < cutoff) {
      pendingOAuthVerifiers.delete(key);
    }
  }
}

interface DiskUsage {
  dataDir: { path: string; sizeBytes: number; sizeHuman: string };
  workspacesDir: { path: string; sizeBytes: number; sizeHuman: string };
  total: { sizeBytes: number; sizeHuman: string };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function getDirectorySize(dirPath: string): Promise<number> {
  if (!await pathExists(dirPath)) return 0;

  try {
    // Use `du` for performance — the Node.js recursive stat approach is
    // far too slow for large directory trees (e.g. workspaces with
    // node_modules).  `du -sk` works on both macOS and Linux and returns
    // size in kilobytes.
    const { stdout } = await execFileAsync('du', ['-sk', dirPath], { timeout: 10_000 });
    const sizeKB = parseInt(stdout.trim().split(/\s+/)[0], 10);
    if (!isNaN(sizeKB)) {
      return sizeKB * 1024;
    }
  } catch {
    // Fall through to manual walk if du fails (e.g. Windows)
  }

  // Fallback: manual recursive walk (kept for platforms without du)
  let totalSize = 0;
  try {
    const items = await readdir(dirPath);
    for (const item of items) {
      const itemPath = join(dirPath, item);
      try {
        const s = await stat(itemPath);
        if (s.isDirectory()) {
          totalSize += await getDirectorySize(itemPath);
        } else {
          totalSize += s.size;
        }
      } catch {
        continue;
      }
    }
  } catch {
    return 0;
  }
  return totalSize;
}

export function createSystemRoutes(
  config: ServerConfig, 
  agentManager: AntsAgentManager,
  apiKeyManager: ApiKeyManager,
  pluginRegistry: PluginRegistry,
) {
  const app = new Hono();
  
  app.get('/agent', async (c) => {
    const installed = await agentManager.isInstalled();
    const version = installed ? await agentManager.getVersion() : null;
    
    return c.json({
      installed,
      version,
      path: installed ? await agentManager.getAgentPath() : null,
    });
  });
  
  app.post('/agent/install', async (c) => {
    const installed = await agentManager.isInstalled();
    if (installed) {
      const version = await agentManager.getVersion();
      return c.json({ 
        success: true, 
        message: 'Ants Agent is already installed',
        version,
      });
    }
    
    try {
      await agentManager.install();
      const version = await agentManager.getVersion();
      return c.json({ 
        success: true, 
        message: 'Ants Agent installed successfully',
        version,
      });
    } catch (error) {
      return c.json({ 
        success: false, 
        error: getErrorMessage(error, 'Installation failed'),
      }, 500);
    }
  });
  
  app.get('/disk', async (c) => {
    const dataDirSize = await getDirectorySize(config.dataDir);
    const workspacesDirSize = await getDirectorySize(config.workspacesDir);
    const totalSize = dataDirSize + workspacesDirSize;
    
    const usage: DiskUsage = {
      dataDir: {
        path: config.dataDir,
        sizeBytes: dataDirSize,
        sizeHuman: formatBytes(dataDirSize),
      },
      workspacesDir: {
        path: config.workspacesDir,
        sizeBytes: workspacesDirSize,
        sizeHuman: formatBytes(workspacesDirSize),
      },
      total: {
        sizeBytes: totalSize,
        sizeHuman: formatBytes(totalSize),
      },
    };
    
    return c.json(usage);
  });
  
  app.get('/uptime', async (c) => {
    const uptimeSeconds = process.uptime();
    const uptimeHours = Math.floor(uptimeSeconds / 3600);
    const uptimeMinutes = Math.floor((uptimeSeconds % 3600) / 60);
    const uptimeSecs = Math.floor(uptimeSeconds % 60);
    
    return c.json({
      uptimeSeconds,
      uptimeHuman: `${uptimeHours}h ${uptimeMinutes}m ${uptimeSecs}s`,
      memoryUsage: process.memoryUsage(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    });
  });
  
  app.get('/api-keys', async (c) => {
    const result = await apiKeyManager.listApiKeys();
    return c.json(result);
  });

  // Custom env vars routes - must come before :providerId routes
  app.get('/api-keys/custom', async (c) => {
    const result = await apiKeyManager.listCustomEnvVars();
    return c.json({ custom: result });
  });

  app.post('/api-keys/custom', async (c) => {
    const body = await parseBody(c, CreateCustomEnvVarSchema);

    try {
      const result = await apiKeyManager.createCustomEnvVar(body.name, body.envVar, body.value);
      return c.json(result, 201);
    } catch (error) {
      return c.json({ error: getErrorMessage(error, 'Failed to create custom env var') }, 400);
    }
  });

  app.put('/api-keys/custom/:id', async (c) => {
    const id = c.req.param('id');
    const body = await parseBody(c, UpdateCustomEnvVarSchema);

    const result = await apiKeyManager.updateCustomEnvVar(id, body);
    if (!result) {
      return c.json({ error: 'Custom env var not found' }, 404);
    }
    return c.json(result);
  });

  app.delete('/api-keys/custom/:id', async (c) => {
    const id = c.req.param('id');
    const deleted = await apiKeyManager.deleteCustomEnvVar(id);
    if (!deleted) {
      return c.json({ error: 'Custom env var not found' }, 404);
    }
    return c.json({ success: true, pendingRestart: apiKeyManager.pendingRestart });
  });

  app.get('/api-keys/:providerId', async (c) => {
    const providerId = c.req.param('providerId');
    const result = await apiKeyManager.getProviderKeys(providerId);
    if (!result) {
      return c.json({ error: 'Provider not found' }, 404);
    }
    return c.json(result);
  });

  app.put('/api-keys/:providerId', async (c) => {
    const providerId = c.req.param('providerId');
    const body = await parseBody(c, SetProviderKeysSchema);

    try {
      const result = await apiKeyManager.setProviderKeys(providerId, body.values);
      return c.json(result);
    } catch (error) {
      return c.json({ error: getErrorMessage(error, 'Failed to set keys') }, 400);
    }
  });

  app.delete('/api-keys/:providerId', async (c) => {
    const providerId = c.req.param('providerId');
    const deleted = await apiKeyManager.deleteProviderKeys(providerId);
    if (!deleted) {
      return c.json({ error: 'Provider not found or no keys configured' }, 404);
    }
    return c.json({ success: true, pendingRestart: apiKeyManager.pendingRestart });
  });

  app.put('/api-keys/:providerId/oauth', async (c) => {
    const providerId = c.req.param('providerId');
    const body = await parseBody(c, SetOAuthCredentialsSchema);

    try {
      const result = await apiKeyManager.setOAuthCredentials(providerId, body);
      return c.json({ ...result, pendingRestart: apiKeyManager.pendingRestart });
    } catch (error) {
      return c.json({ error: getErrorMessage(error, 'Failed to set OAuth credentials') }, 400);
    }
  });

  app.delete('/api-keys/:providerId/oauth', async (c) => {
    const providerId = c.req.param('providerId');
    const deleted = await apiKeyManager.deleteOAuthCredentials(providerId);
    if (!deleted) {
      return c.json({ error: 'No OAuth credentials found for provider' }, 404);
    }
    return c.json({ success: true, pendingRestart: apiKeyManager.pendingRestart });
  });

  app.post('/api-keys/:providerId/oauth/refresh', async (c) => {
    const providerId = c.req.param('providerId');
    try {
      const result = await apiKeyManager.refreshOAuthToken(providerId);
      if (!result.success) {
        return c.json({ error: 'Failed to refresh OAuth token' }, 400);
      }
      return c.json({ ...result, pendingRestart: apiKeyManager.pendingRestart });
    } catch (error) {
      return c.json({ error: getErrorMessage(error, 'Failed to refresh token') }, 500);
    }
  });

  // Generate OAuth authorization URL for Anthropic
  // Returns the URL to open in browser and a session ID to use when exchanging the code
  app.get('/api-keys/anthropic/oauth/url', async (c) => {
    cleanupOldVerifiers();
    
    const { url, verifier } = await generateAuthorizationUrl();
    
    // Generate a session ID to associate with this verifier
    const sessionId = crypto.randomUUID();
    pendingOAuthVerifiers.set(sessionId, { verifier, createdAt: Date.now() });
    
    log.debug(`Generated OAuth URL with session: ${sessionId}`);
    log.debug(`Total pending OAuth sessions: ${pendingOAuthVerifiers.size}`);
    
    return c.json({ url, sessionId });
  });

  // Exchange OAuth code for tokens
  // The code is the string the user copies from the browser after authorizing
  app.post('/api-keys/anthropic/oauth/code', async (c) => {
    const body = await parseBody(c, OAuthCodeExchangeSchema);
    
    log.debug(`Exchanging OAuth code for session: ${body.sessionId}`);
    log.debug(`Pending sessions: ${Array.from(pendingOAuthVerifiers.keys()).join(', ') || 'none'}`);
    
    const pending = pendingOAuthVerifiers.get(body.sessionId);
    if (!pending) {
      log.debug(`OAuth session ${body.sessionId} not found in pending verifiers`);
      return c.json({ error: 'Invalid or expired session. Please generate a new OAuth URL.' }, 400);
    }
    
    // Remove the verifier so it can't be reused
    pendingOAuthVerifiers.delete(body.sessionId);
    
    try {
      const tokens = await exchangeCodeForTokens(body.code, pending.verifier);
      
      // Store the tokens using the existing OAuth credentials system
      log.debug(`Storing OAuth tokens - expires at: ${new Date(tokens.expiresAt).toISOString()}`);
      await apiKeyManager.setOAuthCredentials('anthropic', {
        refresh: tokens.refreshToken,
        access: tokens.accessToken,
        expires: tokens.expiresAt,
      });
      
      log.debug(`OAuth tokens stored successfully`);
      
      return c.json({ 
        success: true, 
        expiresAt: tokens.expiresAt,
        pendingRestart: apiKeyManager.pendingRestart,
      });
    } catch (error) {
      return c.json({ error: getErrorMessage(error, 'Failed to exchange code for tokens') }, 400);
    }
  });

  // ============================================================================
  // Plugin Management (server-level, backed by DB)
  // ============================================================================

  /** List all registered plugins. */
  app.get('/plugins', (c) => {
    const plugins = pluginRegistry.listPlugins();
    return c.json({ plugins });
  });

  /** Get a single plugin by ID. */
  app.get('/plugins/:pluginId', (c) => {
    const plugin = pluginRegistry.getPlugin(c.req.param('pluginId'));
    if (!plugin) {
      return c.json({ error: 'Plugin not found' }, 404);
    }
    return c.json(plugin);
  });

  /** Register a new plugin (records intent; actual npm install happens in agents). */
  app.post('/plugins', async (c) => {
    const body = await parseBody(c, RegisterPluginSchema);

    try {
      const plugin = pluginRegistry.addPlugin(body.packageName, body.packageSpec, body.version);
      return c.json(plugin, 201);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ error: message }, 400);
    }
  });

  /** Update a plugin (change spec, version, or enabled state). */
  app.patch('/plugins/:pluginId', async (c) => {
    const body = await parseBody(c, UpdatePluginSchema);
    const plugin = pluginRegistry.updatePlugin(c.req.param('pluginId'), body);
    if (!plugin) {
      return c.json({ error: 'Plugin not found' }, 404);
    }
    return c.json(plugin);
  });

  /** Remove a plugin from the registry. */
  app.delete('/plugins/:pluginId', (c) => {
    const removed = pluginRegistry.removePlugin(c.req.param('pluginId'));
    if (!removed) {
      return c.json({ error: 'Plugin not found' }, 404);
    }
    return c.json({ success: true });
  });

  app.post('/restart-all-projects', async (c) => {
    const { restarted, failed } = await agentManager.restartAllServers();
    apiKeyManager.clearPendingRestart();
    return c.json({
      success: failed.length === 0,
      restarted,
      failed,
      pendingRestart: false,
    });
  });

  app.post('/cleanup/sessions', async (c) => {
    const body = await parseBodyOptional(c, CleanupSessionsSchema, {});
    const olderThanDays = body.olderThanDays ?? 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    
    let deletedCount = 0;
    let freedBytes = 0;
    
    const projectsDir = join(config.dataDir, 'projects');
    if (!await pathExists(projectsDir)) {
      return c.json({ deletedSessions: 0, freedBytes: 0, freedHuman: '0 B', olderThanDays });
    }
    
    const allFiles = await readdir(projectsDir);
    const projectFiles = allFiles.filter(f => f.endsWith('.json'));
    
    for (const projectFile of projectFiles) {
      try {
        const projectPath = join(projectsDir, projectFile);
        const projectContent = await readFile(projectPath, 'utf-8');
        const project = JSON.parse(projectContent);
        
        if (!project.workingDirectory || !await pathExists(project.workingDirectory)) {
          continue;
        }
        
        const agentDir = join(project.workingDirectory, '.ants');
        const sessionsDir = join(agentDir, 'sessions');
        
        if (!await pathExists(sessionsDir)) {
          continue;
        }
        
        const sessions = await readdir(sessionsDir);
        for (const sessionId of sessions) {
          const sessionPath = join(sessionsDir, sessionId);
          try {
            const s = await stat(sessionPath);
            if (s.isDirectory() && s.mtime < cutoffDate) {
              const sessionSize = await getDirectorySize(sessionPath);
              await rm(sessionPath, { recursive: true, force: true });
              deletedCount++;
              freedBytes += sessionSize;
            }
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }
    
    return c.json({
      deletedSessions: deletedCount,
      freedBytes,
      freedHuman: formatBytes(freedBytes),
      olderThanDays,
    });
  });
  
  return app;
}
