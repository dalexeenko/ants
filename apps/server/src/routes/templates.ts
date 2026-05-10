import { Hono } from 'hono';
import type { TemplateManager } from '../services/template-manager.js';
import type { AuthUser } from '../auth/provider.js';
import { parseBody } from '../utils/validation.js';
import {
  CreateTemplateSchema,
  UpdateTemplateSchema,
  CreateProjectFromTemplateSchema,
  ImportTemplateSchema,
} from '../schemas/index.js';

export function createTemplateRoutes(templateManager: TemplateManager) {
  const app = new Hono();

  // GET /templates - list all templates (optional ?category= filter)
  app.get('/', async (c) => {
    const category = c.req.query('category');
    const templates = templateManager.listTemplates(category || undefined);
    return c.json({ templates });
  });

  // GET /templates/:idOrSlug - get a single template
  app.get('/:idOrSlug', async (c) => {
    const idOrSlug = c.req.param('idOrSlug');
    const template = templateManager.getTemplate(idOrSlug);

    if (!template) {
      return c.json({ error: 'Template not found' }, 404);
    }

    return c.json(template);
  });

  // POST /templates - create a custom template
  app.post('/', async (c) => {
    const user = (c as any).get('user') as AuthUser | undefined;
    const body = await parseBody(c, CreateTemplateSchema);

    // Validate slug format
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(body.slug)) {
      return c.json({ error: 'slug must be lowercase alphanumeric with hyphens, cannot start/end with hyphen' }, 400);
    }

    // Check for duplicate slug
    const existing = templateManager.getTemplate(body.slug);
    if (existing) {
      return c.json({ error: 'A template with this slug already exists' }, 409);
    }

    try {
      const template = templateManager.createTemplate(body, user?.id || 'system');
      return c.json(template, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Failed to create template' }, 500);
    }
  });

  // PATCH /templates/:id - update a template
  app.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const body = await parseBody(c, UpdateTemplateSchema);

    const updated = templateManager.updateTemplate(id, body);

    if (!updated) {
      return c.json({ error: 'Template not found' }, 404);
    }

    return c.json(updated);
  });

  // DELETE /templates/:id - delete a template
  app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const deleted = templateManager.deleteTemplate(id);

    if (!deleted) {
      return c.json({ error: 'Template not found' }, 404);
    }

    return c.json({ success: true });
  });

  // POST /templates/:idOrSlug/create-project - create a project from a template
  app.post('/:idOrSlug/create-project', async (c) => {
    const user = (c as any).get('user') as AuthUser | undefined;
    const idOrSlug = c.req.param('idOrSlug');
    const body = await parseBody(c, CreateProjectFromTemplateSchema);

    try {
      const result = await templateManager.createProjectFromTemplate(
        idOrSlug,
        body.name,
        body.workingDirectory,
        user?.id || 'system',
      );
      return c.json(result, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Failed to create project from template' }, 500);
    }
  });

  // POST /templates/import - import a template from the Hub
  app.post('/import', async (c) => {
    const body = await parseBody(c, ImportTemplateSchema);

    try {
      const template = templateManager.importFromHub(body);
      return c.json(template, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Failed to import template' }, 500);
    }
  });

  return app;
}
