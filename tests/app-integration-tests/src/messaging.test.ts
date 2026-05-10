import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ServerHarness, type ServerInfo } from './server-harness.js';

describe('Messaging', () => {
  let harness: ServerHarness;
  let server: ServerInfo;
  let projectId: string;

  beforeAll(async () => {
    harness = new ServerHarness();
    server = await harness.start();
    
    // Create a project for messaging tests
    const project = await harness.createProject('messaging-test-project');
    projectId = project.id;
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  describe('Session Messaging', () => {
    describe('POST /projects/:id/sessions/:sessionId/prompt', () => {
      it('should send a prompt and receive a response', async () => {
        // Create a session
        const sessionResponse = await harness.fetch(`/projects/${projectId}/sessions`, {
          method: 'POST',
          body: JSON.stringify({ title: 'Messaging Test' }),
        });
        const session = await sessionResponse.json();
        
        // Send a prompt
        const promptResponse = await harness.fetch(
          `/projects/${projectId}/sessions/${session.id}/prompt`,
          {
            method: 'POST',
            body: JSON.stringify({ prompt: 'Hello, how are you?' }),
          }
        );
        
        expect(promptResponse.ok).toBe(true);
        
        const result = await promptResponse.json();
        expect(result.status).toBeDefined();
      });

      it('should return 400 when prompt is missing', async () => {
        // Create a session
        const sessionResponse = await harness.fetch(`/projects/${projectId}/sessions`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        const session = await sessionResponse.json();
        
        // Send empty prompt
        const promptResponse = await harness.fetch(
          `/projects/${projectId}/sessions/${session.id}/prompt`,
          {
            method: 'POST',
            body: JSON.stringify({}),
          }
        );
        
        expect(promptResponse.status).toBe(400);
        
        const error = await promptResponse.json();
        expect(error.error).toBe('prompt is required');
      });

      it('should store messages in session history', async () => {
        // Create a session
        const sessionResponse = await harness.fetch(`/projects/${projectId}/sessions`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        const session = await sessionResponse.json();
        
        // Send a prompt
        await harness.fetch(
          `/projects/${projectId}/sessions/${session.id}/prompt`,
          {
            method: 'POST',
            body: JSON.stringify({ prompt: 'Test message for history' }),
          }
        );
        
        // Get messages - API returns array directly
        const messagesResponse = await harness.fetch(
          `/projects/${projectId}/sessions/${session.id}/messages`
        );
        
        expect(messagesResponse.ok).toBe(true);
        
        const messages = await messagesResponse.json();
        expect(messages.length).toBeGreaterThanOrEqual(2); // user + assistant
        
        // Verify user message
        const userMessage = messages.find((m: { role: string }) => m.role === 'user');
        expect(userMessage).toBeDefined();
        expect(userMessage.content).toBe('Test message for history');
        
        // Verify assistant message
        const assistantMessage = messages.find((m: { role: string }) => m.role === 'assistant');
        expect(assistantMessage).toBeDefined();
        expect(assistantMessage.content).toBeDefined();
      });

      it('should handle multiple messages in a conversation', async () => {
        // Create a session
        const sessionResponse = await harness.fetch(`/projects/${projectId}/sessions`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        const session = await sessionResponse.json();
        
        // Send first message
        await harness.fetch(
          `/projects/${projectId}/sessions/${session.id}/prompt`,
          {
            method: 'POST',
            body: JSON.stringify({ prompt: 'First message' }),
          }
        );
        
        // Send second message
        await harness.fetch(
          `/projects/${projectId}/sessions/${session.id}/prompt`,
          {
            method: 'POST',
            body: JSON.stringify({ prompt: 'Second message' }),
          }
        );
        
        // Get messages - API returns array directly
        const messagesResponse = await harness.fetch(
          `/projects/${projectId}/sessions/${session.id}/messages`
        );
        
        const messages = await messagesResponse.json();
        
        // Should have at least 4 messages (2 user + 2 assistant)
        expect(messages.length).toBeGreaterThanOrEqual(4);
        
        // Verify both user messages are present
        const userMessages = messages.filter((m: { role: string }) => m.role === 'user');
        expect(userMessages.length).toBe(2);
      });
    });

    describe('POST /projects/:id/sessions/:sessionId/abort', () => {
      it('should abort an active session', async () => {
        // Create a session
        const sessionResponse = await harness.fetch(`/projects/${projectId}/sessions`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        const session = await sessionResponse.json();
        
        // Abort the session
        const abortResponse = await harness.fetch(
          `/projects/${projectId}/sessions/${session.id}/abort`,
          { method: 'POST' }
        );
        
        expect(abortResponse.ok).toBe(true);
        
        const result = await abortResponse.json();
        expect(result.success).toBe(true);
      });
    });
  });

  describe('Error Handling', () => {
    it('should auto-create session and succeed when prompting non-existent session', async () => {
      // The server lazily auto-creates sessions on prompt (get-or-create pattern)
      const response = await harness.fetch(
        `/projects/${projectId}/sessions/non-existent-session/prompt`,
        {
          method: 'POST',
          body: JSON.stringify({ prompt: 'Hello' }),
        }
      );
      
      expect(response.ok).toBe(true);
      const result = await response.json();
      expect(result.status).toBeDefined();
    });

    it('should return messages for auto-created session', async () => {
      // After the previous test auto-created "non-existent-session" via prompt,
      // the session exists with user + assistant messages
      const response = await harness.fetch(
        `/projects/${projectId}/sessions/non-existent-session/messages`
      );
      
      expect(response.ok).toBe(true);
      const messages = await response.json();
      expect(Array.isArray(messages)).toBe(true);
      expect(messages.length).toBeGreaterThanOrEqual(2);
    });

    it('should return 404 for prompt to non-existent project', async () => {
      const response = await harness.fetch(
        `/projects/non-existent-project/sessions/some-session/prompt`,
        {
          method: 'POST',
          body: JSON.stringify({ prompt: 'Hello' }),
        }
      );
      
      expect(response.status).toBe(404);
    });
  });
});
