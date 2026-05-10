import { Hono } from 'hono';
import type { ServerConfig } from '../config.js';
import type { OpenMgrAgentManager } from '../services/openmgr-agent-manager.js';

const serverVersion = process.env.OPENMGR_SERVER_VERSION || undefined;

export function createHealthRoutes(config: ServerConfig, agentManager: OpenMgrAgentManager) {
  const app = new Hono();
  
  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      ...(serverVersion ? { version: serverVersion } : {}),
    });
  });
  
  app.get('/info', async (c) => {
    const agentInstalled = await agentManager.isInstalled();
    const agentVersion = agentInstalled ? await agentManager.getVersion() : null;
    const dockerStatus = await agentManager.getDockerManager().checkAvailability();
    
    return c.json({
      ...(serverVersion ? { version: serverVersion } : {}),
      agentInstalled,
      agentVersion,
      dataDir: config.dataDir,
      workspacesDir: config.workspacesDir,
      docker: {
        available: dockerStatus.available,
        version: dockerStatus.version,
        insideDocker: dockerStatus.insideDocker,
        dindAvailable: dockerStatus.dindAvailable,
      },
    });
  });
  
  return app;
}

/**
 * Creates an authenticated health check endpoint.
 * This validates the bearer token in addition to checking server reachability,
 * so the app can verify that both the URL and credentials are correct.
 */
export function createAuthenticatedHealthRoutes(config: ServerConfig, agentManager: OpenMgrAgentManager) {
  const app = new Hono();
  
  app.get('/', async (c) => {
    const agentInstalled = await agentManager.isInstalled();
    const agentVersion = agentInstalled ? await agentManager.getVersion() : null;
    const dockerStatus = await agentManager.getDockerManager().checkAvailability();
    
    return c.json({
      status: 'ok',
      ...(serverVersion ? { version: serverVersion } : {}),
      agentInstalled,
      agentVersion,
      docker: {
        available: dockerStatus.available,
        version: dockerStatus.version,
      },
    });
  });
  
  return app;
}
