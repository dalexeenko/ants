import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ServerHarness, type ServerInfo } from './server-harness.js';

describe('Session Management', () => {
  let harness: ServerHarness;
  let server: ServerInfo;
  let projectId: string;

  beforeAll(async () => {
    harness = new ServerHarness();
    server = await harness.start();
    
    // Create a project for session tests
    const project = await harness.createProject('session-test-project');
    projectId = project.id;
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  describe('Sessions', () => {
    describe('POST /projects/:id/sessions', () => {
      it('should create a new session', async () => {
        const response = await harness.fetch(`/projects/${projectId}/sessions`, {
          method: 'POST',
          body: JSON.stringify({ title: 'Test Session' }),
        });
        
        expect(response.ok).toBe(true);
        
        const session = await response.json();
        expect(session.id).toBeDefined();
      });

      it('should create session without title', async () => {
        const response = await harness.fetch(`/projects/${projectId}/sessions`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        
        expect(response.ok).toBe(true);
        
        const session = await response.json();
        expect(session.id).toBeDefined();
      });
    });

    describe('GET /projects/:id/sessions/:sessionId', () => {
      it('should get session details', async () => {
        // Create a session first
        const createResponse = await harness.fetch(`/projects/${projectId}/sessions`, {
          method: 'POST',
          body: JSON.stringify({ title: 'Get Test Session' }),
        });
        const created = await createResponse.json();
        
        // Get the session
        const response = await harness.fetch(`/projects/${projectId}/sessions/${created.id}`);
        
        expect(response.ok).toBe(true);
        
        const session = await response.json();
        expect(session.id).toBe(created.id);
      });

      it('should return 404 for non-existent session', async () => {
        const response = await harness.fetch(`/projects/${projectId}/sessions/non-existent`);
        
        expect(response.status).toBe(404);
      });
    });

    describe('DELETE /projects/:id/sessions/:sessionId', () => {
      it('should delete a session', async () => {
        // Create a session
        const createResponse = await harness.fetch(`/projects/${projectId}/sessions`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        const created = await createResponse.json();
        
        // Delete it
        const response = await harness.fetch(`/projects/${projectId}/sessions/${created.id}`, {
          method: 'DELETE',
        });
        
        expect(response.ok).toBe(true);
        
        // Verify it's gone
        const getResponse = await harness.fetch(`/projects/${projectId}/sessions/${created.id}`);
        expect(getResponse.status).toBe(404);
      });
    });

    describe('GET /projects/:id/sessions/:sessionId/messages', () => {
      it('should return empty messages for new session', async () => {
        // Create a session
        const createResponse = await harness.fetch(`/projects/${projectId}/sessions`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        const session = await createResponse.json();
        
        // Get messages
        const response = await harness.fetch(`/projects/${projectId}/sessions/${session.id}/messages`);
        
        expect(response.ok).toBe(true);
        
        // API returns array directly, not { messages: [...] }
        const messages = await response.json();
        expect(Array.isArray(messages)).toBe(true);
        expect(messages.length).toBe(0);
      });
    });

    describe('GET /projects/:id/providers', () => {
      it('should return providers list', async () => {
        const response = await harness.fetch(`/projects/${projectId}/providers`);
        
        expect(response.ok).toBe(true);
        
        // API returns array directly, not { providers: [...] }
        const providers = await response.json();
        expect(Array.isArray(providers)).toBe(true);
        expect(providers.length).toBeGreaterThan(0);
      });
    });
  });
});
