import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { ProjectManager } from '../services/project-manager.js';
import type { DrizzleDB } from '../db/index.js';
import { projectAccess } from '../db/schema.js';
import type { AuthUser } from '../auth/provider.js';
import { parseBody } from '../utils/validation.js';
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  AgentConfigBodySchema,
} from '../schemas/index.js';

export function createProjectRoutes(projectManager: ProjectManager, db: DrizzleDB) {
  const app = new Hono();
  
  app.get('/', async (c) => {
    const user = (c as any).get('user') as AuthUser | undefined;
    let projects = await projectManager.listProjects();

    // In multi-user mode, non-admin users only see projects they have access to
    if (user && user.role !== 'admin') {
      const accessRows = db
        .select()
        .from(projectAccess)
        .where(eq(projectAccess.userId, user.id))
        .all();
      const accessibleProjectIds = new Set(accessRows.map((r) => r.projectId));
      projects = projects.filter((p) => accessibleProjectIds.has(p.id));
    }

    return c.json({ projects });
  });
  
  app.post('/', async (c) => {
    const user = (c as any).get('user') as AuthUser | undefined;
    const body = await parseBody(c, CreateProjectSchema);

    const project = await projectManager.createProject(body, user?.id || 'system');
    return c.json(project, 201);
  });
  
  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const project = await projectManager.getProject(id);
    
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }
    
    return c.json(project);
  });
  
  app.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const body = await parseBody(c, UpdateProjectSchema);
    
    const project = await projectManager.updateProject(id, body);
    
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }
    
    return c.json(project);
  });
  
  app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const deleted = await projectManager.deleteProject(id);
    
    if (!deleted) {
      return c.json({ error: 'Project not found' }, 404);
    }
    
    return c.json({ success: true });
  });
  
  app.post('/:id/restart', async (c) => {
    const id = c.req.param('id');
    const result = await projectManager.restartServer(id);
    
    if (!result) {
      return c.json({ error: 'Project not found' }, 404);
    }
    
    return c.json({ port: result.port, pid: result.pid });
  });
  
  // Agent configuration endpoints
  app.get('/:id/config', async (c) => {
    const id = c.req.param('id');
    const config = await projectManager.getAgentConfig(id);
    
    if (config === null) {
      return c.json({ error: 'Project not found' }, 404);
    }
    
    return c.json({ config });
  });
  
  app.put('/:id/config', async (c) => {
    const id = c.req.param('id');
    const body = await parseBody(c, AgentConfigBodySchema);
    
    const success = await projectManager.updateAgentConfig(id, body);
    
    if (!success) {
      return c.json({ error: 'Project not found' }, 404);
    }
    
    return c.json({ success: true });
  });
  
  return app;
}
