import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ServerHarness, type ServerInfo } from './server-harness.js';

describe('File Operations', () => {
  let harness: ServerHarness;
  let server: ServerInfo;
  let projectId: string;
  let projectDir: string;

  beforeAll(async () => {
    harness = new ServerHarness();
    server = await harness.start();
    
    // Create a project for file tests
    const project = await harness.createProject('file-test-project');
    projectId = project.id;
    projectDir = project.workingDirectory;
    
    // Create some test files in the project directory
    mkdirSync(join(projectDir, 'subdir'), { recursive: true });
    writeFileSync(join(projectDir, 'test.txt'), 'Hello, World!');
    writeFileSync(join(projectDir, 'data.json'), JSON.stringify({ key: 'value' }));
    writeFileSync(join(projectDir, 'subdir', 'nested.txt'), 'Nested content');
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  describe('GET /projects/:id/files', () => {
    it('should list files in project root', async () => {
      const response = await harness.fetch(`/projects/${projectId}/files?path=.`);
      
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      // API returns { files: [...], path: {...}, total: N }
      expect(data.files).toBeDefined();
      expect(Array.isArray(data.files)).toBe(true);
      
      const fileNames = data.files.map((f: { name: string }) => f.name);
      expect(fileNames).toContain('test.txt');
      expect(fileNames).toContain('data.json');
      expect(fileNames).toContain('subdir');
    });

    it('should list files in subdirectory', async () => {
      const response = await harness.fetch(`/projects/${projectId}/files?path=subdir`);
      
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      const fileNames = data.files.map((f: { name: string }) => f.name);
      expect(fileNames).toContain('nested.txt');
    });

    it('should indicate directories vs files', async () => {
      const response = await harness.fetch(`/projects/${projectId}/files?path=.`);
      const data = await response.json();
      
      const subdir = data.files.find((f: { name: string }) => f.name === 'subdir');
      const testFile = data.files.find((f: { name: string }) => f.name === 'test.txt');
      
      expect(subdir.isDirectory).toBe(true);
      expect(testFile.isDirectory).toBe(false);
    });
  });

  describe('GET /projects/:id/files/content', () => {
    it('should read file content', async () => {
      const response = await harness.fetch(
        `/projects/${projectId}/files/content?path=test.txt`
      );
      
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data.content).toBe('Hello, World!');
    });

    it('should read nested file content', async () => {
      const response = await harness.fetch(
        `/projects/${projectId}/files/content?path=subdir/nested.txt`
      );
      
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data.content).toBe('Nested content');
    });

    it('should return 404 for non-existent file', async () => {
      const response = await harness.fetch(
        `/projects/${projectId}/files/content?path=nonexistent.txt`
      );
      
      expect(response.status).toBe(404);
    });
  });

  describe('PUT /projects/:id/files/content', () => {
    it('should write file content', async () => {
      const response = await harness.fetch(
        `/projects/${projectId}/files/content?path=new-file.txt`,
        {
          method: 'PUT',
          body: JSON.stringify({ content: 'New file content' }),
        }
      );
      
      expect(response.ok).toBe(true);
      
      // Verify the file was written
      const readResponse = await harness.fetch(
        `/projects/${projectId}/files/content?path=new-file.txt`
      );
      const data = await readResponse.json();
      expect(data.content).toBe('New file content');
    });

    it('should overwrite existing file', async () => {
      // Write initial content
      await harness.fetch(
        `/projects/${projectId}/files/content?path=overwrite-test.txt`,
        {
          method: 'PUT',
          body: JSON.stringify({ content: 'Initial content' }),
        }
      );
      
      // Overwrite
      await harness.fetch(
        `/projects/${projectId}/files/content?path=overwrite-test.txt`,
        {
          method: 'PUT',
          body: JSON.stringify({ content: 'Updated content' }),
        }
      );
      
      // Verify
      const readResponse = await harness.fetch(
        `/projects/${projectId}/files/content?path=overwrite-test.txt`
      );
      const data = await readResponse.json();
      expect(data.content).toBe('Updated content');
    });
  });

  describe('POST /projects/:id/files/directory', () => {
    it('should create a directory', async () => {
      const response = await harness.fetch(
        `/projects/${projectId}/files/directory`,
        {
          method: 'POST',
          body: JSON.stringify({ path: 'new-directory' }),
        }
      );
      
      expect(response.ok).toBe(true);
      
      // Verify the directory exists
      const listResponse = await harness.fetch(`/projects/${projectId}/files?path=.`);
      const data = await listResponse.json();
      const newDir = data.files.find((f: { name: string }) => f.name === 'new-directory');
      
      expect(newDir).toBeDefined();
      expect(newDir.isDirectory).toBe(true);
    });

    it('should create nested directories', async () => {
      const response = await harness.fetch(
        `/projects/${projectId}/files/directory`,
        {
          method: 'POST',
          // Need recursive: true for nested directories
          body: JSON.stringify({ path: 'deep/nested/path', recursive: true }),
        }
      );
      
      expect(response.ok).toBe(true);
      
      // Verify we can list files in the nested directory
      const listResponse = await harness.fetch(`/projects/${projectId}/files?path=deep/nested`);
      expect(listResponse.ok).toBe(true);
    });
  });

  describe('DELETE /projects/:id/files', () => {
    it('should delete a file', async () => {
      // Create a file to delete
      await harness.fetch(
        `/projects/${projectId}/files/content?path=to-delete.txt`,
        {
          method: 'PUT',
          body: JSON.stringify({ content: 'Delete me' }),
        }
      );
      
      // Delete it
      const response = await harness.fetch(
        `/projects/${projectId}/files?path=to-delete.txt`,
        { method: 'DELETE' }
      );
      
      expect(response.ok).toBe(true);
      
      // Verify it's gone
      const readResponse = await harness.fetch(
        `/projects/${projectId}/files/content?path=to-delete.txt`
      );
      expect(readResponse.status).toBe(404);
    });
  });

  describe('GET /projects/:id/files/stat', () => {
    it('should return file stats', async () => {
      const response = await harness.fetch(
        `/projects/${projectId}/files/stat?path=test.txt`
      );
      
      expect(response.ok).toBe(true);
      
      const stat = await response.json();
      expect(stat.size).toBeDefined();
      expect(stat.isDirectory).toBe(false);
    });

    it('should return directory stats', async () => {
      const response = await harness.fetch(
        `/projects/${projectId}/files/stat?path=subdir`
      );
      
      expect(response.ok).toBe(true);
      
      const stat = await response.json();
      expect(stat.isDirectory).toBe(true);
    });
  });
});
