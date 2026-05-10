import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ServerHarness, type ServerInfo } from './server-harness.js';

describe('Server Health and Connection', () => {
  let harness: ServerHarness;
  let server: ServerInfo;

  beforeAll(async () => {
    harness = new ServerHarness();
    server = await harness.start();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  describe('GET /health', () => {
    it('should return healthy status without authentication', async () => {
      const response = await fetch(`${server.url}/api/beta/health`);
      
      expect(response.ok).toBe(true);
      
      const body = await response.json();
      expect(body.status).toBe('ok');
    });

    it('should return ok status', async () => {
      const response = await fetch(`${server.url}/api/beta/health`);
      const body = await response.json();
      
      expect(body.status).toBe('ok');
    });
  });

  describe('GET /info', () => {
    it('should return server info without authentication', async () => {
      const response = await fetch(`${server.url}/api/beta/info`);
      
      expect(response.ok).toBe(true);
      
      const body = await response.json();
      // version is only present when OPENMGR_SERVER_VERSION env var is set
      expect(typeof body.agentInstalled).toBe('boolean');
    });

    it('should indicate agent installation status', async () => {
      const response = await fetch(`${server.url}/api/beta/info`);
      const body = await response.json();
      
      // The server reports whether the agent is installed
      expect(typeof body.agentInstalled).toBe('boolean');
    });
  });

  describe('GET /health/auth', () => {
    it('should return status ok with valid token', async () => {
      const response = await harness.fetch('/health/auth');
      
      expect(response.ok).toBe(true);
      
      const body = await response.json();
      expect(body.status).toBe('ok');
      // version is only present when OPENMGR_SERVER_VERSION env var is set
      expect(typeof body.agentInstalled).toBe('boolean');
    });

    it('should reject unauthenticated requests', async () => {
      const response = await fetch(`${server.url}/api/beta/health/auth`);
      
      expect(response.status).toBe(401);
    });

    it('should reject requests with invalid token', async () => {
      const response = await fetch(`${server.url}/api/beta/health/auth`, {
        headers: {
          'Authorization': 'Bearer invalid-token',
        },
      });
      
      expect(response.status).toBe(401);
    });
  });

  describe('Authentication', () => {
    it('should reject unauthenticated requests to protected endpoints', async () => {
      const response = await fetch(`${server.url}/api/beta/projects`);
      
      expect(response.status).toBe(401);
    });

    it('should accept authenticated requests with valid token', async () => {
      const response = await harness.fetch('/projects');
      
      expect(response.ok).toBe(true);
    });

    it('should reject requests with invalid token', async () => {
      const response = await fetch(`${server.url}/api/beta/projects`, {
        headers: {
          'Authorization': 'Bearer invalid-token',
        },
      });
      
      expect(response.status).toBe(401);
    });
  });
});
