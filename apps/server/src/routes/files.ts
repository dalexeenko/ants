import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { readFile, writeFile, readdir, stat, mkdir, rm, rename, cp } from 'fs/promises';
import { join, basename, dirname, extname, relative, resolve } from 'path';
import type { ProjectManager } from '../services/project-manager.js';
import { parseBody } from '../utils/validation.js';
import { pathExists } from '../utils/fs.js';
import {
  WriteFileContentSchema,
  CreateDirectorySchema,
  MovePathSchema,
  CopyPathSchema,
} from '../schemas/index.js';

/**
 * Safely resolve a path within a base directory, preventing path traversal attacks.
 * Returns null if the resolved path would escape the base directory.
 */
function safeResolvePath(baseDir: string, userPath: string): string | null {
  // Resolve both paths to absolute paths
  const resolvedBase = resolve(baseDir);
  const resolvedFull = resolve(baseDir, userPath);
  
  // Ensure the resolved path starts with the base directory
  // Add path separator to prevent matching partial directory names
  // e.g., /home/user vs /home/username
  if (!resolvedFull.startsWith(resolvedBase + '/') && resolvedFull !== resolvedBase) {
    return null;
  }
  
  return resolvedFull;
}

export function createFileRoutes(projectManager: ProjectManager) {
  const app = new Hono();
  
  app.get('/:projectId/files', async (c) => {
    const projectId = c.req.param('projectId');
    const path = c.req.query('path') || '.';
    const showHidden = c.req.query('showHidden') === 'true';
    const project = await projectManager.getProject(projectId);
    
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }
    
    const fullPath = path === '.' || path === '' 
      ? project.workingDirectory 
      : safeResolvePath(project.workingDirectory, path);
    
    if (!fullPath) {
      return c.json({ error: 'Path traversal not allowed' }, 403);
    }
    
    if (!await pathExists(fullPath)) {
      return c.json({ error: 'Path not found' }, 404);
    }
    
    try {
      const stats = await stat(fullPath);
      if (!stats.isDirectory()) {
        return c.json({ error: 'Path is not a directory' }, 400);
      }

      const entries = await readdir(fullPath);
      const files = (await Promise.all(
        entries
          .filter(name => showHidden || !name.startsWith('.'))
          .map(async (name) => {
            const entryPath = join(fullPath, name);
            const stats = await stat(entryPath);
            const relativePath = path === '.' || path === '' ? name : join(path, name);
            
            return {
              name,
              path: relativePath,
              absolutePath: entryPath,
              isDirectory: stats.isDirectory(),
              isFile: stats.isFile(),
              isSymbolicLink: stats.isSymbolicLink(),
              size: stats.size,
              mtime: stats.mtime.toISOString(),
              ctime: stats.ctime.toISOString(),
              mode: stats.mode,
              isHidden: name.startsWith('.'),
              isIgnored: name.startsWith('.') || name === 'node_modules' || name === '.git',
              extension: stats.isFile() ? extname(name) : null,
            };
          })
      ));
      
      files.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });

      const parentPath = path === '.' || path === '' ? null : dirname(path);
      const currentPathInfo = {
        current: path === '.' || path === '' ? '/' : path,
        parent: parentPath,
        absolute: fullPath,
        relative: relative(project.workingDirectory, fullPath) || '.',
      };
      
      return c.json({ 
        path: currentPathInfo,
        files,
        total: files.length,
        directories: files.filter(f => f.isDirectory).length,
        regularFiles: files.filter(f => f.isFile).length,
      });
    } catch (err) {
      return c.json({ error: 'Failed to read directory' }, 500);
    }
  });
  
  app.get('/:projectId/files/content', async (c) => {
    const projectId = c.req.param('projectId');
    const path = c.req.query('path');
    const project = await projectManager.getProject(projectId);
    
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }
    
    if (!path) {
      return c.json({ error: 'path query parameter is required' }, 400);
    }
    
    const fullPath = safeResolvePath(project.workingDirectory, path);
    
    if (!fullPath) {
      return c.json({ error: 'Path traversal not allowed' }, 403);
    }
    
    if (!await pathExists(fullPath)) {
      return c.json({ error: 'File not found' }, 404);
    }
    
    try {
      const content = await readFile(fullPath, 'utf-8');
      return c.json({ content, path, name: basename(fullPath) });
    } catch (err) {
      return c.json({ error: 'Failed to read file' }, 500);
    }
  });
  
  app.put('/:projectId/files/content', async (c) => {
    const projectId = c.req.param('projectId');
    const path = c.req.query('path');
    const project = await projectManager.getProject(projectId);
    
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }
    
    if (!path) {
      return c.json({ error: 'path query parameter is required' }, 400);
    }
    
    const body = await parseBody(c, WriteFileContentSchema);
    
    const fullPath = safeResolvePath(project.workingDirectory, path);
    
    if (!fullPath) {
      return c.json({ error: 'Path traversal not allowed' }, 403);
    }
    
    try {
      const parentDir = dirname(fullPath);
      if (!await pathExists(parentDir)) {
        await mkdir(parentDir, { recursive: true });
      }
      
      await writeFile(fullPath, body.content, 'utf-8');
      const stats = await stat(fullPath);
      
      return c.json({ 
        success: true, 
        path,
        size: stats.size,
        mtime: stats.mtime.toISOString(),
      });
    } catch (err) {
      return c.json({ error: 'Failed to write file' }, 500);
    }
  });

  app.post('/:projectId/files/directory', async (c) => {
    const projectId = c.req.param('projectId');
    const project = await projectManager.getProject(projectId);
    
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }
    
    const body = await parseBody(c, CreateDirectorySchema);
    
    const fullPath = safeResolvePath(project.workingDirectory, body.path);
    
    if (!fullPath) {
      return c.json({ error: 'Path traversal not allowed' }, 403);
    }
    
    try {
      await mkdir(fullPath, { recursive: body.recursive ?? false });
      const stats = await stat(fullPath);
      
      return c.json({
        success: true,
        path: body.path,
        absolutePath: fullPath,
        created: stats.ctime.toISOString(),
      });
    } catch (err) {
      return c.json({ error: 'Failed to create directory' }, 500);
    }
  });

  app.delete('/:projectId/files', async (c) => {
    const projectId = c.req.param('projectId');
    const path = c.req.query('path');
    const recursive = c.req.query('recursive') === 'true';
    const project = await projectManager.getProject(projectId);
    
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }
    
    if (!path) {
      return c.json({ error: 'path query parameter is required' }, 400);
    }
    
    const fullPath = safeResolvePath(project.workingDirectory, path);
    
    if (!fullPath) {
      return c.json({ error: 'Path traversal not allowed' }, 403);
    }
    
    if (!await pathExists(fullPath)) {
      return c.json({ error: 'Path not found' }, 404);
    }
    
    try {
      await rm(fullPath, { recursive, force: true });
      
      return c.json({ success: true, path });
    } catch (err) {
      return c.json({ error: 'Failed to delete path' }, 500);
    }
  });

  app.post('/:projectId/files/move', async (c) => {
    const projectId = c.req.param('projectId');
    const project = await projectManager.getProject(projectId);
    
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }
    
    const body = await parseBody(c, MovePathSchema);

    const fromPath = safeResolvePath(project.workingDirectory, body.from);
    const toPath = safeResolvePath(project.workingDirectory, body.to);
    
    if (!fromPath || !toPath) {
      return c.json({ error: 'Path traversal not allowed' }, 403);
    }
    
    if (!await pathExists(fromPath)) {
      return c.json({ error: 'Source path not found' }, 404);
    }
    
    try {
      const toDir = dirname(toPath);
      if (!await pathExists(toDir)) {
        await mkdir(toDir, { recursive: true });
      }
      
      await rename(fromPath, toPath);
      
      return c.json({
        success: true,
        from: body.from,
        to: body.to,
      });
    } catch (err) {
      return c.json({ error: 'Failed to move path' }, 500);
    }
  });

  app.post('/:projectId/files/copy', async (c) => {
    const projectId = c.req.param('projectId');
    const project = await projectManager.getProject(projectId);
    
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }
    
    const body = await parseBody(c, CopyPathSchema);
    
    const fromPath = safeResolvePath(project.workingDirectory, body.from);
    const toPath = safeResolvePath(project.workingDirectory, body.to);
    
    if (!fromPath || !toPath) {
      return c.json({ error: 'Path traversal not allowed' }, 403);
    }
    
    if (!await pathExists(fromPath)) {
      return c.json({ error: 'Source path not found' }, 404);
    }
    
    try {
      const toDir = dirname(toPath);
      if (!await pathExists(toDir)) {
        await mkdir(toDir, { recursive: true });
      }
      
      await cp(fromPath, toPath, { recursive: body.recursive ?? true });
      
      return c.json({
        success: true,
        from: body.from,
        to: body.to,
      });
    } catch (err) {
      return c.json({ error: 'Failed to copy path' }, 500);
    }
  });

  app.get('/:projectId/files/stat', async (c) => {
    const projectId = c.req.param('projectId');
    const path = c.req.query('path');
    const project = await projectManager.getProject(projectId);
    
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }
    
    if (!path) {
      return c.json({ error: 'path query parameter is required' }, 400);
    }
    
    const fullPath = safeResolvePath(project.workingDirectory, path);
    
    if (!fullPath) {
      return c.json({ error: 'Path traversal not allowed' }, 403);
    }
    
    if (!await pathExists(fullPath)) {
      return c.json({ error: 'Path not found' }, 404);
    }
    
    try {
      const stats = await stat(fullPath);
      
      return c.json({
        path,
        absolutePath: fullPath,
        name: basename(fullPath),
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        isSymbolicLink: stats.isSymbolicLink(),
        size: stats.size,
        mtime: stats.mtime.toISOString(),
        ctime: stats.ctime.toISOString(),
        atime: stats.atime.toISOString(),
        mode: stats.mode,
        uid: stats.uid,
        gid: stats.gid,
        extension: stats.isFile() ? extname(fullPath) : null,
      });
    } catch (err) {
      return c.json({ error: 'Failed to get file stats' }, 500);
    }
  });
  
  return app;
}
