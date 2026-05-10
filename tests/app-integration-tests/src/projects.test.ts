import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ServerHarness, type ServerInfo } from './server-harness.js';

describe('Project Management', () => {
  let harness: ServerHarness;
  let server: ServerInfo;

  beforeAll(async () => {
    harness = new ServerHarness();
    server = await harness.start();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  describe('POST /projects', () => {
    it('should create a new project', async () => {
      const project = await harness.createProject('test-project-1');
      
      expect(project.id).toBeDefined();
      expect(project.name).toBe('test-project-1');
      expect(project.workingDirectory).toContain('test-project-1');
    });

    it('should create multiple projects', async () => {
      const project1 = await harness.createProject('project-a');
      const project2 = await harness.createProject('project-b');
      
      expect(project1.id).not.toBe(project2.id);
    });
  });

  describe('GET /projects', () => {
    it('should list all projects', async () => {
      // Create a project first
      await harness.createProject('list-test-project');
      
      const response = await harness.fetch('/projects');
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      // API returns { projects: [...] }
      expect(data.projects).toBeDefined();
      expect(Array.isArray(data.projects)).toBe(true);
      expect(data.projects.length).toBeGreaterThan(0);
      
      // Find our project
      const found = data.projects.find((p: { name: string }) => p.name === 'list-test-project');
      expect(found).toBeDefined();
    });
  });

  describe('GET /projects/:id', () => {
    it('should get a specific project by ID', async () => {
      const created = await harness.createProject('get-test-project');
      
      const response = await harness.fetch(`/projects/${created.id}`);
      expect(response.ok).toBe(true);
      
      const project = await response.json();
      expect(project.id).toBe(created.id);
      expect(project.name).toBe('get-test-project');
    });

    it('should return 404 for non-existent project', async () => {
      const response = await harness.fetch('/projects/non-existent-id');
      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /projects/:id', () => {
    it('should update project name', async () => {
      const created = await harness.createProject('update-test-project');
      
      const response = await harness.fetch(`/projects/${created.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'renamed-project' }),
      });
      
      expect(response.ok).toBe(true);
      
      // Verify the update
      const getResponse = await harness.fetch(`/projects/${created.id}`);
      const project = await getResponse.json();
      expect(project.name).toBe('renamed-project');
    });
  });

  describe('DELETE /projects/:id', () => {
    it('should delete a project', async () => {
      const created = await harness.createProject('delete-test-project');
      
      const response = await harness.fetch(`/projects/${created.id}`, {
        method: 'DELETE',
      });
      
      expect(response.ok).toBe(true);
      
      // Verify it's gone
      const getResponse = await harness.fetch(`/projects/${created.id}`);
      expect(getResponse.status).toBe(404);
    });
  });
});
