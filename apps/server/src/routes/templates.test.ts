import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createTemplateRoutes } from './templates.js';
import type { TemplateManager } from '../services/template-manager.js';

describe('template routes', () => {
  let app: Hono;
  let mockTemplateManager: Partial<TemplateManager>;

  const testTemplate = {
    id: 'tpl-1',
    name: 'Web App Template',
    slug: 'web-app',
    description: 'A web app template',
    category: 'web',
    content: 'template content here',
    builtIn: false,
    createdAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    mockTemplateManager = {
      listTemplates: vi.fn().mockReturnValue([testTemplate]),
      getTemplate: vi.fn().mockReturnValue(testTemplate),
      createTemplate: vi.fn().mockReturnValue({ ...testTemplate, id: 'tpl-new' }),
      updateTemplate: vi.fn().mockReturnValue({ ...testTemplate, name: 'Updated' }),
      deleteTemplate: vi.fn().mockReturnValue(true),
      createProjectFromTemplate: vi.fn().mockResolvedValue({
        id: 'proj-new',
        name: 'New Project',
        workingDirectory: '/home/user/new',
      }),
      importFromHub: vi.fn().mockReturnValue({ ...testTemplate, id: 'tpl-imported' }),
    };

    app = new Hono();
    const routes = createTemplateRoutes(mockTemplateManager as TemplateManager);
    app.route('/templates', routes);
  });

  describe('GET /templates', () => {
    it('should list all templates', async () => {
      const res = await app.request('/templates');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.templates).toHaveLength(1);
      expect(body.templates[0].name).toBe('Web App Template');
    });

    it('should filter by category', async () => {
      await app.request('/templates?category=web');

      expect(mockTemplateManager.listTemplates).toHaveBeenCalledWith('web');
    });

    it('should pass undefined when no category', async () => {
      await app.request('/templates');

      expect(mockTemplateManager.listTemplates).toHaveBeenCalledWith(undefined);
    });
  });

  describe('GET /templates/:idOrSlug', () => {
    it('should get a template by id', async () => {
      const res = await app.request('/templates/tpl-1');

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe('tpl-1');
    });

    it('should get a template by slug', async () => {
      const res = await app.request('/templates/web-app');

      expect(res.status).toBe(200);
      expect(mockTemplateManager.getTemplate).toHaveBeenCalledWith('web-app');
    });

    it('should return 404 when template not found', async () => {
      (mockTemplateManager.getTemplate as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await app.request('/templates/non-existent');

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Template not found');
    });
  });

  describe('POST /templates', () => {
    it('should create a template', async () => {
      // Make getTemplate return null so no duplicate slug is found
      (mockTemplateManager.getTemplate as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await app.request('/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Template',
          slug: 'new-template',
          content: 'content',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBe('tpl-new');
    });

    it('should return 400 when name is missing', async () => {
      const res = await app.request('/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'test' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('name is required');
    });

    it('should return 400 when slug is missing', async () => {
      const res = await app.request('/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('slug is required');
    });

    it('should return 400 for invalid slug format', async () => {
      const res = await app.request('/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', slug: '-bad-slug-' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('slug must be lowercase');
    });

    it('should return 409 for duplicate slug', async () => {
      // getTemplate returns existing template (duplicate found)
      const res = await app.request('/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', slug: 'web-app', content: 'content' }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe('A template with this slug already exists');
    });

    it('should return 500 when createTemplate throws', async () => {
      (mockTemplateManager.getTemplate as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (mockTemplateManager.createTemplate as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('DB error');
      });

      const res = await app.request('/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', slug: 'test', content: 'content' }),
      });

      expect(res.status).toBe(500);
    });
  });

  describe('PATCH /templates/:id', () => {
    it('should update a template', async () => {
      const res = await app.request('/templates/tpl-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(200);
    });

    it('should return 404 when template not found', async () => {
      (mockTemplateManager.updateTemplate as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const res = await app.request('/templates/non-existent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Template not found');
    });
  });

  describe('DELETE /templates/:id', () => {
    it('should delete a template', async () => {
      const res = await app.request('/templates/tpl-1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it('should return 404 when template not found', async () => {
      (mockTemplateManager.deleteTemplate as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const res = await app.request('/templates/non-existent', { method: 'DELETE' });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Template not found');
    });
  });

  describe('POST /templates/:idOrSlug/create-project', () => {
    it('should create a project from a template', async () => {
      const res = await app.request('/templates/web-app/create-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'My Web App',
          workingDirectory: '/home/user/my-web-app',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBe('proj-new');
      expect(mockTemplateManager.createProjectFromTemplate).toHaveBeenCalledWith(
        'web-app',
        'My Web App',
        '/home/user/my-web-app',
        'system',
      );
    });

    it('should return 400 when name is missing', async () => {
      const res = await app.request('/templates/web-app/create-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workingDirectory: '/home/user' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('name is required');
    });

    it('should return 400 when workingDirectory is missing', async () => {
      const res = await app.request('/templates/web-app/create-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My App' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('workingDirectory is required');
    });

    it('should return 500 when createProjectFromTemplate throws', async () => {
      (mockTemplateManager.createProjectFromTemplate as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Template not found'),
      );

      const res = await app.request('/templates/non-existent/create-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'App', workingDirectory: '/home' }),
      });

      expect(res.status).toBe(500);
    });
  });

  describe('POST /templates/import', () => {
    it('should import a template from Hub', async () => {
      const res = await app.request('/templates/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'hub-1',
          name: 'Hub Template',
          slug: 'hub-template',
          content: 'template content',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBe('tpl-imported');
    });

    it('should return 400 when required fields are missing', async () => {
      const res = await app.request('/templates/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'hub-1', name: 'Hub Template' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('slug is required');
      expect(body.error).toContain('content is required');
    });

    it('should return 500 when importFromHub throws', async () => {
      (mockTemplateManager.importFromHub as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Import failed');
      });

      const res = await app.request('/templates/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'hub-1',
          name: 'Hub Template',
          slug: 'hub-template',
          content: 'template content',
        }),
      });

      expect(res.status).toBe(500);
    });
  });
});
