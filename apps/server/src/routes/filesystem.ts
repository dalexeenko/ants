/**
 * Filesystem Routes
 * 
 * Provides filesystem browsing capabilities for directory selection.
 * Unlike file routes (which are scoped to a project), these routes
 * allow browsing the server filesystem for project directory selection.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { readdir, stat, mkdir } from 'fs/promises';
import { join, dirname, basename, resolve } from 'path';
import { homedir } from 'os';
import type { ServerConfig } from '../config.js';
import { parseBody } from '../utils/validation.js';
import { MkdirSchema } from '../schemas/index.js';
import { pathExists } from '../utils/fs.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('filesystem');

export function createFilesystemRoutes(config: ServerConfig) {
  const app = new Hono();

  /**
   * Get home directory and common paths
   */
  app.get('/home', async (c) => {
    const home = homedir();
    
    const commonPaths = [
      { name: 'Home', path: home },
      { name: 'Workspaces', path: config.workspacesDir },
      { name: 'Documents', path: join(home, 'Documents') },
      { name: 'Projects', path: join(home, 'Projects') },
      { name: 'Development', path: join(home, 'Development') },
      { name: 'Code', path: join(home, 'code') },
      { name: 'Sites', path: join(home, 'Sites') },
    ];

    const existingPaths = await Promise.all(
      commonPaths.map(async (p) => ({ ...p, exists: await pathExists(p.path) }))
    );

    return c.json({
      home,
      workspaces: config.workspacesDir,
      common: existingPaths.filter(p => p.exists).map(({ exists, ...rest }) => rest),
    });
  });

  /**
   * List directory contents
   * Query params:
   * - path: The directory path to list (default: home directory)
   * - showHidden: Whether to show hidden files (default: false)
   */
  app.get('/list', async (c) => {
    const requestedPath = c.req.query('path') || homedir();
    const showHidden = c.req.query('showHidden') === 'true';

    // Resolve and normalize the path
    const fullPath = resolve(requestedPath);

    if (!await pathExists(fullPath)) {
      return c.json({ error: 'Path not found', path: fullPath }, 404);
    }

    try {
      const stats = await stat(fullPath);
      if (!stats.isDirectory()) {
        return c.json({ error: 'Path is not a directory', path: fullPath }, 400);
      }

      const entries = await readdir(fullPath);
      const items = (await Promise.all(
        entries
          .filter(name => showHidden || !name.startsWith('.'))
          .map(async (name) => {
            const entryPath = join(fullPath, name);
            try {
              const entryStats = await stat(entryPath);
              return {
                name,
                path: entryPath,
                isDirectory: entryStats.isDirectory(),
                isFile: entryStats.isFile(),
                size: entryStats.size,
                modifiedAt: entryStats.mtime.toISOString(),
              };
            } catch {
              // If we can't stat the entry, skip it
              return null;
            }
          })
      )).filter((item): item is NonNullable<typeof item> => item !== null);

      // Sort: directories first, then alphabetically
      items.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });

      // Get parent directory info
      const parent = dirname(fullPath);
      const isRoot = fullPath === '/' || fullPath === parent;

      return c.json({
        path: fullPath,
        name: basename(fullPath) || '/',
        parent: isRoot ? null : parent,
        isRoot,
        entries: items,
        count: {
          total: items.length,
          directories: items.filter(i => i.isDirectory).length,
          files: items.filter(i => i.isFile).length,
        },
      });
    } catch (err) {
      log.error('Filesystem list error:', err);
      return c.json({ 
        error: 'Failed to read directory',
        message: err instanceof Error ? err.message : 'Unknown error',
      }, 500);
    }
  });

  /**
   * Check if a path exists and get info
   */
  app.get('/stat', async (c) => {
    const requestedPath = c.req.query('path');

    if (!requestedPath) {
      return c.json({ error: 'path query parameter is required' }, 400);
    }

    const fullPath = resolve(requestedPath);

    if (!await pathExists(fullPath)) {
      return c.json({ 
        exists: false, 
        path: fullPath,
      });
    }

    try {
      const stats = await stat(fullPath);
      return c.json({
        exists: true,
        path: fullPath,
        name: basename(fullPath) || '/',
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        createdAt: stats.ctime.toISOString(),
      });
    } catch (err) {
      return c.json({ 
        error: 'Failed to stat path',
        message: err instanceof Error ? err.message : 'Unknown error',
      }, 500);
    }
  });

  /**
   * Resolve a path (handles ~, relative paths, etc.)
   */
  app.get('/resolve', async (c) => {
    const requestedPath = c.req.query('path');

    if (!requestedPath) {
      return c.json({ error: 'path query parameter is required' }, 400);
    }

    // Handle ~ for home directory
    let resolvedPath = requestedPath;
    if (resolvedPath.startsWith('~')) {
      resolvedPath = resolvedPath.replace(/^~/, homedir());
    }

    // Resolve to absolute path
    resolvedPath = resolve(resolvedPath);

    return c.json({
      original: requestedPath,
      resolved: resolvedPath,
      exists: await pathExists(resolvedPath),
    });
  });

  /**
   * Create a new directory
   * Body:
   * - parentPath: The parent directory path
   * - name: The name of the new directory
   */
  app.post('/mkdir', async (c) => {
    const body = await parseBody(c, MkdirSchema);

    // Validate the name (no path separators, not . or ..)
    const name = body.name.trim();
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
      return c.json({ error: 'Invalid directory name' }, 400);
    }

    const parentPath = resolve(body.parentPath);
    const newPath = join(parentPath, name);

    // Check parent exists
    if (!await pathExists(parentPath)) {
      return c.json({ error: 'Parent directory does not exist', path: parentPath }, 404);
    }

    // Check parent is a directory
    try {
      const parentStats = await stat(parentPath);
      if (!parentStats.isDirectory()) {
        return c.json({ error: 'Parent path is not a directory', path: parentPath }, 400);
      }
    } catch (err) {
      return c.json({ error: 'Failed to check parent directory' }, 500);
    }

    // Check if target already exists
    if (await pathExists(newPath)) {
      return c.json({ error: 'A file or directory with that name already exists', path: newPath }, 409);
    }

    // Create the directory
    try {
      await mkdir(newPath);
      const stats = await stat(newPath);
      return c.json({
        path: newPath,
        name,
        isDirectory: true,
        createdAt: stats.ctime.toISOString(),
      }, 201);
    } catch (err) {
      log.error('Filesystem mkdir error:', err);
      return c.json({
        error: 'Failed to create directory',
        message: err instanceof Error ? err.message : 'Unknown error',
      }, 500);
    }
  });

  return app;
}
