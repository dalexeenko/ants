import { describe, it, expect, beforeEach } from 'vitest';
import { MockAgentClient } from './openmgr-agent-manager.js';

describe('MockAgentClient', () => {
  let client: MockAgentClient;

  beforeEach(() => {
    client = new MockAgentClient();
  });

  describe('isHealthy', () => {
    it('should always return true', async () => {
      expect(await client.isHealthy()).toBe(true);
    });
  });

  describe('createSession', () => {
    it('should create a session with an id', async () => {
      const session = await client.createSession() as { id: string };
      
      expect(session.id).toBeDefined();
      expect(typeof session.id).toBe('string');
      expect(session.id.length).toBeGreaterThan(0);
    });

    it('should create a session with provided options', async () => {
      const session = await client.createSession({
        title: 'Test Session',
        workingDirectory: '/test/path',
        parentId: 'parent-123',
      }) as { id: string; title: string; workingDirectory: string; parentId: string };
      
      expect(session.id).toBeDefined();
      expect(session.title).toBe('Test Session');
      expect(session.workingDirectory).toBe('/test/path');
      expect(session.parentId).toBe('parent-123');
    });

    it('should create unique session ids', async () => {
      const session1 = await client.createSession() as { id: string };
      const session2 = await client.createSession() as { id: string };
      
      expect(session1.id).not.toBe(session2.id);
    });
  });

  describe('getSession', () => {
    it('should retrieve a created session', async () => {
      const created = await client.createSession({ title: 'Get Test' }) as { id: string };
      const retrieved = await client.getSession(created.id) as { id: string; title: string };
      
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.title).toBe('Get Test');
    });

    it('should throw for non-existent session', async () => {
      await expect(client.getSession('non-existent'))
        .rejects.toThrow('Session not found');
    });
  });

  describe('sendPromptAsync', () => {
    it('should send a prompt and receive a mock response', async () => {
      const session = await client.createSession() as { id: string };
      const result = await client.sendPromptAsync(session.id, 'Hello') as { 
        status: string; 
        success: boolean; 
        message: string 
      };
      
      expect(result.status).toBe('completed');
      expect(result.success).toBe(true);
      expect(result.message).toBe('Mock response to: Hello');
    });

    it('should throw for non-existent session', async () => {
      await expect(client.sendPromptAsync('non-existent', 'Hello'))
        .rejects.toThrow('Session not found');
    });
  });

  describe('getMessages', () => {
    it('should return empty messages for new session', async () => {
      const session = await client.createSession() as { id: string };
      const result = await client.getMessages(session.id) as { messages: unknown[] };
      
      expect(result.messages).toEqual([]);
    });

    it('should return messages after sending prompts', async () => {
      const session = await client.createSession() as { id: string };
      await client.sendPromptAsync(session.id, 'Hello');
      
      const result = await client.getMessages(session.id) as { 
        messages: Array<{ role: string; content: string }> 
      };
      
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toBe('Hello');
      expect(result.messages[1].role).toBe('assistant');
      expect(result.messages[1].content).toBe('Mock response to: Hello');
    });

    it('should throw for non-existent session', async () => {
      await expect(client.getMessages('non-existent'))
        .rejects.toThrow('Session not found');
    });
  });

  describe('getProviders', () => {
    it('should return mock providers', async () => {
      const result = await client.getProviders() as { providers: Array<{ id: string }> };
      
      expect(result.providers).toBeDefined();
      expect(Array.isArray(result.providers)).toBe(true);
      expect(result.providers.length).toBeGreaterThan(0);
    });
  });

  describe('abortSession', () => {
    it('should throw for non-existent session', async () => {
      await expect(client.abortSession('non-existent'))
        .rejects.toThrow('Session not found');
    });

    it('should succeed for any existing session', async () => {
      const session = await client.createSession() as { id: string };
      const result = await client.abortSession(session.id) as { success: boolean };
      
      expect(result.success).toBe(true);
    });
  });

  describe('deleteSession', () => {
    it('should delete an existing session', async () => {
      const session = await client.createSession() as { id: string };
      const result = await client.deleteSession(session.id) as { success: boolean };
      
      expect(result.success).toBe(true);
      
      // Verify session is deleted
      await expect(client.getSession(session.id))
        .rejects.toThrow('Session not found');
    });

    it('should throw for non-existent session', async () => {
      await expect(client.deleteSession('non-existent'))
        .rejects.toThrow('Session not found');
    });
  });
});


