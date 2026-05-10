/**
 * Memory/Knowledge Base routes.
 *
 * Proxies memory operations to the project's MemoryStorage instance.
 * The @ants/agent-memory package provides the storage backend.
 */

import { Hono } from 'hono';
import type { ProjectManager } from '../services/project-manager.js';
import { getErrorMessage } from '../utils/errors.js';
import { parseBody } from '../utils/validation.js';
import { createLogger } from '../utils/logger.js';
import { z } from 'zod';

const log = createLogger('memories');

// Lazy import of agent-memory to avoid hard dependency
let MemoryStorage: typeof import('@ants/agent-memory').MemoryStorage | null = null;
const storageInstances = new Map<string, InstanceType<typeof import('@ants/agent-memory').MemoryStorage>>();

async function getMemoryStorage(projectDir: string) {
  if (!MemoryStorage) {
    try {
      const mod = await import('@ants/agent-memory');
      MemoryStorage = mod.MemoryStorage;
    } catch {
      throw new Error('agent-memory package not available');
    }
  }
  let storage = storageInstances.get(projectDir);
  if (!storage) {
    storage = new MemoryStorage(projectDir);
    storageInstances.set(projectDir, storage);
  }
  return storage;
}

const CreateMemorySchema = z.object({
  content: z.string(),
  scope: z.string().optional(),
  tags: z.array(z.string()).optional(),
  author: z.string().optional(),
});

const UpdateMemorySchema = z.object({
  content: z.string().optional(),
  scope: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export function createMemoryRoutes(projectManager: ProjectManager) {
  const app = new Hono();

  // List memories
  app.get('/:projectId/memories', async (c) => {
    const projectId = c.req.param('projectId');
    const project = await projectManager.getProject(projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);

    try {
      const storage = await getMemoryStorage(project.workingDirectory);
      const scope = c.req.query('scope');
      const tags = c.req.query('tags')?.split(',').filter(Boolean);
      const limit = parseInt(c.req.query('limit') || '50', 10);
      const offset = parseInt(c.req.query('offset') || '0', 10);

      const memories = await storage.list({ scope, tags, limit, offset });
      const total = await storage.count();

      return c.json({ memories, total });
    } catch (e) {
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  });

  // Search memories
  app.get('/:projectId/memories/search', async (c) => {
    const projectId = c.req.param('projectId');
    const project = await projectManager.getProject(projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);

    try {
      const storage = await getMemoryStorage(project.workingDirectory);
      const query = c.req.query('query') || '';
      const scope = c.req.query('scope');
      const tags = c.req.query('tags')?.split(',').filter(Boolean);
      const limit = parseInt(c.req.query('limit') || '10', 10);

      if (!query) {
        return c.json({ results: [] });
      }

      const results = await storage.search({ query, scope, tags, limit });
      return c.json({ results });
    } catch (e) {
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  });

  // Get embedding status
  app.get('/:projectId/memories/status', async (c) => {
    const projectId = c.req.param('projectId');
    const project = await projectManager.getProject(projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);

    try {
      const storage = await getMemoryStorage(project.workingDirectory);
      const status = await storage.checkEmbeddingsStatus();
      return c.json(status);
    } catch (e) {
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  });

  // Create memory
  app.post('/:projectId/memories', async (c) => {
    const projectId = c.req.param('projectId');
    const project = await projectManager.getProject(projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);

    try {
      const body = await parseBody(c, CreateMemorySchema);
      const storage = await getMemoryStorage(project.workingDirectory);
      const memory = await storage.create(body);
      return c.json(memory, 201);
    } catch (e) {
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  });

  // Update memory
  app.patch('/:projectId/memories/:memoryId', async (c) => {
    const projectId = c.req.param('projectId');
    const memoryId = c.req.param('memoryId');
    const project = await projectManager.getProject(projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);

    try {
      const body = await parseBody(c, UpdateMemorySchema);
      const storage = await getMemoryStorage(project.workingDirectory);
      const memory = await storage.update(memoryId, body);
      if (!memory) return c.json({ error: 'Memory not found' }, 404);
      return c.json(memory);
    } catch (e) {
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  });

  // Delete memory
  app.delete('/:projectId/memories/:memoryId', async (c) => {
    const projectId = c.req.param('projectId');
    const memoryId = c.req.param('memoryId');
    const project = await projectManager.getProject(projectId);
    if (!project) return c.json({ error: 'Project not found' }, 404);

    try {
      const storage = await getMemoryStorage(project.workingDirectory);
      const deleted = await storage.delete(memoryId);
      if (!deleted) return c.json({ error: 'Memory not found' }, 404);
      return c.json({ success: true });
    } catch (e) {
      return c.json({ error: getErrorMessage(e) }, 500);
    }
  });

  return app;
}
