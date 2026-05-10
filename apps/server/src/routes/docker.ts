/**
 * Docker management routes.
 *
 * Provides endpoints for Docker status, agent image resolution,
 * and container status for projects running agents in Docker.
 */

import { Hono } from 'hono';
import { platform } from 'os';
import type { AntsAgentManager } from '../services/ants-agent-manager.js';
import type { ProjectManager } from '../services/project-manager.js';
import { getErrorMessage } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('docker-routes');

export function createDockerRoutes(
  agentManager: AntsAgentManager,
  projectManager: ProjectManager,
) {
  const app = new Hono();
  const dockerManager = agentManager.getDockerManager();

  // Get Docker availability status (includes platform info for install guidance)
  app.get('/status', async (c) => {
    try {
      const status = await dockerManager.checkAvailability();
      return c.json({
        ...status,
        platform: platform(),  // 'darwin', 'linux', 'win32', etc.
      });
    } catch (e) {
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  });

  // Get the resolved agent image name and whether it's available locally
  app.get('/agent-image', async (c) => {
    try {
      const imageInfo = await dockerManager.resolveAgentImage();
      const exists = await dockerManager.imageExists(imageInfo.image);
      return c.json({
        ...imageInfo,
        exists,
      });
    } catch (e) {
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  });

  // Check if a specific image exists locally (query param: ?image=)
  app.get('/image-status', async (c) => {
    try {
      const image = c.req.query('image');
      const exists = await dockerManager.imageExists(image);
      const resolved = image || (await dockerManager.resolveAgentImage()).image;
      return c.json({ exists, image: resolved });
    } catch (e) {
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  });

  // List all running Docker agent containers
  app.get('/containers', (c) => {
    const containers = dockerManager.listContainers();
    return c.json(containers);
  });

  // Get container status for a specific project
  app.get('/containers/:projectId', async (c) => {
    const projectId = c.req.param('projectId');
    try {
      const project = await projectManager.getProject(projectId);
      if (!project) {
        return c.json({ error: 'Project not found' }, 404);
      }

      const stats = await dockerManager.getContainerStats(project.workingDirectory);
      if (!stats) {
        return c.json({ error: 'No Docker container for this project' }, 404);
      }

      return c.json(stats);
    } catch (e) {
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  });

  return app;
}
