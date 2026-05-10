import { describe, it, expect, vi } from 'vitest';
import { createServer } from '../index.js';
import type { ServerAgent, ServerState } from '../index.js';
import type { Message } from '@openmgr/agent-core';

/**
 * Create a full ServerAgent mock with all methods needed by the server.
 */
function createFullMockAgent(overrides: Partial<ServerAgent> = {}): ServerAgent {
  const config = {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    workingDirectory: '/tmp/test',
  };
  const extensions = new Map<string, unknown>();
  let messageHistory: Message[] = [];

  return {
    emit: () => true,
    on: () => {},
    off: () => {},
    getConfig: () => config,
    setExtension: (key: string, value: unknown) => extensions.set(key, value),
    getExtension: <T>(key: string) => extensions.get(key) as T | undefined,
    prompt: async (message: string) => {
      const msg: Message = { id: 'resp-1', role: 'assistant', content: `Response to: ${message}`, createdAt: Date.now() };
      messageHistory.push(
        { id: 'usr-1', role: 'user', content: message, createdAt: Date.now() },
        msg,
      );
      return msg;
    },
    abort: vi.fn(),
    getMessages: () => messageHistory,
    setMessages: (msgs: Message[]) => { messageHistory = msgs; },
    clearMessages: () => { messageHistory = []; },
    getAvailableProviders: () => ['anthropic', 'openai'],
    ...overrides,
  };
}

function createTestState(overrides: Partial<ServerAgent> = {}): ServerState {
  const agent = createFullMockAgent(overrides);
  return {
    agent,
    agentFactory: async () => createFullMockAgent(overrides),
  };
}

// ============================================================================
// Permission Config Routes
// ============================================================================

describe('Permission Config Routes (/permissions)', () => {
  describe('GET /permissions/config', () => {
    it('should return default config when agent does not support permission config', async () => {
      const app = createServer(createTestState());
      const res = await app.fetch(new Request('http://localhost/permissions/config'));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.defaultMode).toBe('ask');
      expect(body.alwaysAllow).toEqual([]);
      expect(body.alwaysDeny).toEqual([]);
      expect(body.allowAll).toBe(false);
    });

    it('should return agent permission config when available', async () => {
      const app = createServer(createTestState({
        getPermissionConfig: () => ({
          defaultMode: 'allow',
          alwaysAllow: ['read_file'],
          alwaysDeny: ['delete_file'],
          allowAll: false,
        }),
      }));
      const res = await app.fetch(new Request('http://localhost/permissions/config'));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.defaultMode).toBe('allow');
      expect(body.alwaysAllow).toEqual(['read_file']);
      expect(body.alwaysDeny).toEqual(['delete_file']);
    });
  });

  describe('PUT /permissions/config', () => {
    it('should return 501 when agent does not support permission config', async () => {
      const app = createServer(createTestState());
      const res = await app.fetch(new Request('http://localhost/permissions/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultMode: 'allow' }),
      }));

      expect(res.status).toBe(501);
    });

    it('should update permission config', async () => {
      const updateFn = vi.fn();
      const app = createServer(createTestState({
        getPermissionConfig: () => ({
          defaultMode: 'allow',
          alwaysAllow: ['read_file'],
          alwaysDeny: [],
          allowAll: false,
        }),
        updatePermissionConfig: updateFn,
      }));

      const res = await app.fetch(new Request('http://localhost/permissions/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultMode: 'allow', alwaysAllow: ['read_file'] }),
      }));

      expect(res.status).toBe(200);
      expect(updateFn).toHaveBeenCalledWith({ defaultMode: 'allow', alwaysAllow: ['read_file'] });
    });
  });
});

// ============================================================================
// Disabled Tools Routes
// ============================================================================

describe('Disabled Tools Routes (/tools)', () => {
  describe('GET /tools/disabled', () => {
    it('should return empty array when agent does not support disabled tools', async () => {
      const app = createServer(createTestState());
      const res = await app.fetch(new Request('http://localhost/tools/disabled'));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.disabledTools).toEqual([]);
    });

    it('should return disabled tools list', async () => {
      const app = createServer(createTestState({
        getDisabledTools: () => ['bash', 'write_file'],
      }));
      const res = await app.fetch(new Request('http://localhost/tools/disabled'));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.disabledTools).toEqual(['bash', 'write_file']);
    });
  });

  describe('PUT /tools/disabled', () => {
    it('should return 501 when agent does not support it', async () => {
      const app = createServer(createTestState());
      const res = await app.fetch(new Request('http://localhost/tools/disabled', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tools: ['bash'] }),
      }));

      expect(res.status).toBe(501);
    });

    it('should set disabled tools list', async () => {
      const setFn = vi.fn();
      const app = createServer(createTestState({
        setDisabledTools: setFn,
      }));

      const res = await app.fetch(new Request('http://localhost/tools/disabled', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tools: ['bash', 'write_file'] }),
      }));

      expect(res.status).toBe(200);
      expect(setFn).toHaveBeenCalledWith(['bash', 'write_file']);
      const body = await res.json();
      expect(body.disabledTools).toEqual(['bash', 'write_file']);
    });

    it('should return 400 when tools is not an array', async () => {
      const app = createServer(createTestState({
        setDisabledTools: vi.fn(),
      }));

      const res = await app.fetch(new Request('http://localhost/tools/disabled', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tools: 'not-an-array' }),
      }));

      expect(res.status).toBe(400);
    });
  });

  describe('POST /tools/:name/disable', () => {
    it('should disable a tool', async () => {
      const setFn = vi.fn();
      const app = createServer(createTestState({
        getDisabledTools: () => ['write_file'],
        setDisabledTools: setFn,
      }));

      const res = await app.fetch(new Request('http://localhost/tools/bash/disable', {
        method: 'POST',
      }));

      expect(res.status).toBe(200);
      expect(setFn).toHaveBeenCalledWith(['write_file', 'bash']);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.disabled).toBe(true);
    });

    it('should not duplicate already-disabled tool', async () => {
      const setFn = vi.fn();
      const app = createServer(createTestState({
        getDisabledTools: () => ['bash'],
        setDisabledTools: setFn,
      }));

      const res = await app.fetch(new Request('http://localhost/tools/bash/disable', {
        method: 'POST',
      }));

      expect(res.status).toBe(200);
      expect(setFn).not.toHaveBeenCalled();
    });
  });

  describe('POST /tools/:name/enable', () => {
    it('should enable a tool', async () => {
      const setFn = vi.fn();
      const app = createServer(createTestState({
        getDisabledTools: () => ['bash', 'write_file'],
        setDisabledTools: setFn,
      }));

      const res = await app.fetch(new Request('http://localhost/tools/bash/enable', {
        method: 'POST',
      }));

      expect(res.status).toBe(200);
      expect(setFn).toHaveBeenCalledWith(['write_file']);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.disabled).toBe(false);
    });
  });
});

// ============================================================================
// Usage Routes
// ============================================================================

describe('Usage Routes (/usage)', () => {
  describe('GET /usage', () => {
    it('should return null when agent does not support usage', async () => {
      const app = createServer(createTestState());
      const res = await app.fetch(new Request('http://localhost/usage'));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toBeNull();
    });

    it('should return usage summary', async () => {
      const summary = {
        total: { promptTokens: 100, completionTokens: 50, totalTokens: 150, estimatedCost: 0.01, requestCount: 5 },
        sessions: [],
      };
      const app = createServer(createTestState({
        getUsageSummary: () => summary,
      }));

      const res = await app.fetch(new Request('http://localhost/usage'));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.total.promptTokens).toBe(100);
      expect(body.total.completionTokens).toBe(50);
      expect(body.total.requestCount).toBe(5);
    });
  });
});

// ============================================================================
// MCP Routes
// ============================================================================

describe('MCP Routes (/mcp)', () => {
  describe('GET /mcp/servers', () => {
    it('should return empty array when agent does not support MCP', async () => {
      const app = createServer(createTestState());
      const res = await app.fetch(new Request('http://localhost/mcp/servers'));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.servers).toEqual([]);
    });

    it('should return MCP servers list', async () => {
      const servers = [
        { name: 'test-server', connected: true, toolCount: 3, transport: 'stdio' },
      ];
      const app = createServer(createTestState({
        getMcpServers: () => servers,
      }));

      const res = await app.fetch(new Request('http://localhost/mcp/servers'));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.servers).toHaveLength(1);
      expect(body.servers[0].name).toBe('test-server');
      expect(body.servers[0].connected).toBe(true);
    });
  });

  describe('POST /mcp/servers', () => {
    it('should return 501 when agent does not support MCP', async () => {
      const app = createServer(createTestState());
      const res = await app.fetch(new Request('http://localhost/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test', config: { command: 'test' } }),
      }));

      expect(res.status).toBe(501);
    });

    it('should add an MCP server', async () => {
      const addFn = vi.fn();
      const app = createServer(createTestState({
        addMcpServer: addFn,
      }));

      const res = await app.fetch(new Request('http://localhost/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test-server', config: { command: 'node', args: ['server.js'] } }),
      }));

      expect(res.status).toBe(201);
      expect(addFn).toHaveBeenCalledWith('test-server', { command: 'node', args: ['server.js'] });
    });

    it('should return 400 when name is missing', async () => {
      const app = createServer(createTestState({
        addMcpServer: vi.fn(),
      }));

      const res = await app.fetch(new Request('http://localhost/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { command: 'test' } }),
      }));

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /mcp/servers/:name', () => {
    it('should remove an MCP server', async () => {
      const removeFn = vi.fn();
      const app = createServer(createTestState({
        removeMcpServer: removeFn,
      }));

      const res = await app.fetch(new Request('http://localhost/mcp/servers/test-server', {
        method: 'DELETE',
      }));

      expect(res.status).toBe(200);
      expect(removeFn).toHaveBeenCalledWith('test-server');
    });
  });

  describe('GET /mcp/tools', () => {
    it('should return empty array when agent does not support MCP', async () => {
      const app = createServer(createTestState());
      const res = await app.fetch(new Request('http://localhost/mcp/tools'));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tools).toEqual([]);
    });

    it('should return MCP tools', async () => {
      const tools = [
        { name: 'mcp_tool_1', description: 'A tool', serverName: 'test-server' },
      ];
      const app = createServer(createTestState({
        getMcpTools: () => tools,
      }));

      const res = await app.fetch(new Request('http://localhost/mcp/tools'));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].name).toBe('mcp_tool_1');
    });
  });
});
