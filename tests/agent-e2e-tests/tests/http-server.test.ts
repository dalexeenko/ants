import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, startServer } from '@openmgr/agent-server';
import type { AgentInterface, AgentConfig } from '@openmgr/agent-core';

// Helper to parse JSON with type assertion
async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

// Mock agent for testing
function createMockAgent(): AgentInterface {
  const config: AgentConfig = {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
  };

  const extensions = new Map<string, unknown>();

  return {
    getConfig: () => config,
    setExtension: (key: string, value: unknown) => {
      extensions.set(key, value);
    },
    getExtension: (key: string) => extensions.get(key),
    // Add other required interface methods as stubs
    run: async () => ({ response: '', usage: { inputTokens: 0, outputTokens: 0 } }),
    registerPlugin: async () => {},
    registerTool: () => {},
    getTools: () => [],
    getTool: () => undefined,
  } as AgentInterface;
}

// Mock session manager for testing
function createMockSessionManager() {
  const sessions = new Map<string, { id: string; title: string; createdAt: Date }>();
  const messages = new Map<string, Array<{ role: string; content: string }>>();

  // Create a test session
  sessions.set('test-session-1', {
    id: 'test-session-1',
    title: 'Test Session',
    createdAt: new Date(),
  });
  messages.set('test-session-1', [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there!' },
  ]);

  return {
    getRootSessions: async (limit: number) => {
      return Array.from(sessions.values()).slice(0, limit);
    },
    getSession: async (id: string) => {
      return sessions.get(id) || null;
    },
    getSessionMessages: async (id: string) => {
      return messages.get(id) || [];
    },
    deleteSession: async (id: string) => {
      const exists = sessions.has(id);
      sessions.delete(id);
      messages.delete(id);
      return exists;
    },
  };
}

describe('HTTP Server E2E', () => {
  let server: { port: number; hostname: string; close: () => void };
  let baseUrl: string;

  // Use a fixed port that's unlikely to conflict
  const TEST_PORT = 19876;

  beforeAll(async () => {
    const agent = createMockAgent();
    const sessions = createMockSessionManager();
    const app = createServer({ agent, sessions });
    
    // Use 127.0.0.1 instead of localhost to avoid DNS resolution issues
    server = await startServer(app, { port: TEST_PORT, hostname: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${TEST_PORT}`;
  });

  afterAll(() => {
    server?.close();
  });

  describe('GET /healthz', () => {
    it('should return health status', async () => {
      const response = await fetch(`${baseUrl}/healthz`);
      expect(response.status).toBe(200);
      
      const data = await parseJson<{ status: string; timestamp: string }>(response);
      expect(data.status).toBe('healthy');
      expect(data.timestamp).toBeDefined();
    });
  });

  describe('GET /readyz', () => {
    it('should return readiness status', async () => {
      const response = await fetch(`${baseUrl}/readyz`);
      expect(response.status).toBe(200);
      
      const data = await parseJson<{ ready: boolean }>(response);
      expect(data.ready).toBe(true);
    });
  });

  describe('GET /beta/status', () => {
    it('should return agent status', async () => {
      const response = await fetch(`${baseUrl}/beta/status`);
      expect(response.status).toBe(200);
      
      const data = await parseJson<{ agent: { provider: string; model: string }; version: string }>(response);
      expect(data.agent.provider).toBe('anthropic');
      expect(data.agent.model).toBe('claude-sonnet-4-20250514');
      expect(data.version).toBeDefined();
    });
  });

  describe('Conversations API', () => {
    describe('GET /beta/conversations', () => {
      it('should list conversations', async () => {
        const response = await fetch(`${baseUrl}/beta/conversations`);
        expect(response.status).toBe(200);
        
        const data = await parseJson<{ data: Array<{ id: string; title: string }>; count: number }>(response);
        expect(data.data).toBeDefined();
        expect(Array.isArray(data.data)).toBe(true);
        expect(data.data.length).toBeGreaterThan(0);
        expect(data.count).toBeGreaterThan(0);
      });
    });

    describe('GET /beta/conversations/:id', () => {
      it('should get a conversation by id', async () => {
        const response = await fetch(`${baseUrl}/beta/conversations/test-session-1`);
        expect(response.status).toBe(200);
        
        const data = await parseJson<{ data: { id: string; title: string } }>(response);
        expect(data.data).toBeDefined();
        expect(data.data.id).toBe('test-session-1');
        expect(data.data.title).toBe('Test Session');
      });

      it('should return 404 for non-existent conversation', async () => {
        const response = await fetch(`${baseUrl}/beta/conversations/non-existent`);
        expect(response.status).toBe(404);
        
        const data = await parseJson<{ error: string }>(response);
        expect(data.error).toBe('Conversation not found');
      });
    });

    describe('GET /beta/conversations/:id/messages', () => {
      it('should get conversation messages', async () => {
        const response = await fetch(`${baseUrl}/beta/conversations/test-session-1/messages`);
        expect(response.status).toBe(200);
        
        const data = await parseJson<{ data: Array<{ role: string; content: string }>; count: number }>(response);
        expect(data.data).toBeDefined();
        expect(Array.isArray(data.data)).toBe(true);
        expect(data.data.length).toBe(2);
        expect(data.data[0].role).toBe('user');
        expect(data.data[0].content).toBe('Hello');
        expect(data.count).toBe(2);
      });

      it('should return empty array for non-existent conversation', async () => {
        const response = await fetch(`${baseUrl}/beta/conversations/non-existent/messages`);
        expect(response.status).toBe(200);
        
        const data = await parseJson<{ data: unknown[]; count: number }>(response);
        expect(data.data).toEqual([]);
        expect(data.count).toBe(0);
      });
    });

    describe('DELETE /beta/conversations/:id', () => {
      it('should delete a conversation', async () => {
        // First verify conversation exists
        let response = await fetch(`${baseUrl}/beta/conversations/test-session-1`);
        expect(response.status).toBe(200);

        // Delete the conversation
        response = await fetch(`${baseUrl}/beta/conversations/test-session-1`, {
          method: 'DELETE',
        });
        expect(response.status).toBe(200);
        
        const data = await parseJson<{ success: boolean }>(response);
        expect(data.success).toBe(true);

        // Verify conversation no longer exists
        response = await fetch(`${baseUrl}/beta/conversations/test-session-1`);
        expect(response.status).toBe(404);
      });

      it('should return false for non-existent conversation', async () => {
        const response = await fetch(`${baseUrl}/beta/conversations/non-existent`, {
          method: 'DELETE',
        });
        expect(response.status).toBe(200);
        
        const data = await parseJson<{ success: boolean }>(response);
        expect(data.success).toBe(false);
      });
    });
  });

  describe('CORS', () => {
    it('should include CORS headers', async () => {
      const response = await fetch(`${baseUrl}/healthz`);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
    });

    it('should handle OPTIONS preflight requests', async () => {
      const response = await fetch(`${baseUrl}/beta/status`, {
        method: 'OPTIONS',
      });
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-methods')).toContain('GET');
      expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await fetch(`${baseUrl}/beta/unknown`);
      expect(response.status).toBe(404);
    });
  });
});
