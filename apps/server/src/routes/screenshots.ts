/**
 * Screenshot serving route — serves screenshot image files stored by the
 * storage plugin in <projectDir>/.ants/screenshots/.
 */

import { Hono } from 'hono';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import type { ProjectManager } from '../services/project-manager.js';
import { pathExists } from '../utils/fs.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('screenshots');

const MIME_TYPES: Record<string, string> = {
  'png': 'image/png',
  'jpeg': 'image/jpeg',
  'webp': 'image/webp',
};

export function createScreenshotRoutes(projectManager: ProjectManager) {
  const app = new Hono();

  // GET /projects/:projectId/screenshots/:filename
  app.get('/:projectId/screenshots/:filename', async (c) => {
    const projectId = c.req.param('projectId');
    const filename = c.req.param('filename');

    // Security: only allow safe filenames (UUID + image extension)
    if (!/^[a-zA-Z0-9\-]+\.(png|jpeg|webp)$/.test(filename)) {
      return c.json({ error: 'Invalid filename' }, 400);
    }

    try {
      const project = await projectManager.getProject(projectId);
      if (!project) {
        return c.json({ error: 'Project not found' }, 404);
      }

      const screenshotsDir = join(project.workingDirectory, '.ants', 'screenshots');
      const filePath = resolve(screenshotsDir, filename);

      // Path traversal check
      if (!filePath.startsWith(resolve(screenshotsDir) + '/') && filePath !== resolve(screenshotsDir)) {
        return c.json({ error: 'Invalid path' }, 400);
      }

      if (!await pathExists(filePath)) {
        return c.json({ error: 'Screenshot not found' }, 404);
      }

      const content = await readFile(filePath);
      const ext = filename.split('.').pop() || 'png';
      const contentType = MIME_TYPES[ext] || 'image/png';

      return new Response(content, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    } catch (e) {
      log.error('Failed to serve screenshot:', e);
      return c.json({ error: 'Failed to serve screenshot' }, 500);
    }
  });

  return app;
}
