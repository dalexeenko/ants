import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createHostValidation } from './host-validation.js';

function createApp(allowedHosts: string[]) {
  const app = new Hono();
  const middleware = createHostValidation(allowedHosts);
  if (middleware) {
    app.use('*', middleware);
  }
  app.get('/test', (c) => c.json({ ok: true }));
  return app;
}

describe('createHostValidation', () => {
  it('should return null when wildcard is configured', () => {
    expect(createHostValidation(['*'])).toBeNull();
  });

  it('should return a middleware when hosts are specified', () => {
    expect(createHostValidation(['example.com'])).toBeInstanceOf(Function);
  });

  it('should return a middleware when no hosts are specified (localhost only)', () => {
    expect(createHostValidation([])).toBeInstanceOf(Function);
  });

  describe('localhost always allowed', () => {
    const app = createApp([]);

    it('should allow localhost', async () => {
      const res = await app.request('/test', { headers: { host: 'localhost' } });
      expect(res.status).toBe(200);
    });

    it('should allow localhost with port', async () => {
      const res = await app.request('/test', { headers: { host: 'localhost:6647' } });
      expect(res.status).toBe(200);
    });

    it('should allow 127.0.0.1', async () => {
      const res = await app.request('/test', { headers: { host: '127.0.0.1' } });
      expect(res.status).toBe(200);
    });

    it('should allow 127.0.0.1 with port', async () => {
      const res = await app.request('/test', { headers: { host: '127.0.0.1:3000' } });
      expect(res.status).toBe(200);
    });

    it('should allow [::1]', async () => {
      const res = await app.request('/test', { headers: { host: '[::1]' } });
      expect(res.status).toBe(200);
    });

    it('should allow [::1] with port', async () => {
      const res = await app.request('/test', { headers: { host: '[::1]:6647' } });
      expect(res.status).toBe(200);
    });

    it('should allow ::1', async () => {
      const res = await app.request('/test', { headers: { host: '::1' } });
      expect(res.status).toBe(200);
    });
  });

  describe('rejecting disallowed hosts', () => {
    const app = createApp([]);

    it('should reject unknown host with 421', async () => {
      const res = await app.request('/test', { headers: { host: 'evil.com' } });
      expect(res.status).toBe(421);
      const body = await res.json();
      expect(body.error).toBe('Invalid Host header');
    });

    it('should reject unknown host with port', async () => {
      const res = await app.request('/test', { headers: { host: 'evil.com:6647' } });
      expect(res.status).toBe(421);
    });

    it('should reject empty host header', async () => {
      const res = await app.request('/test', { headers: { host: '' } });
      expect(res.status).toBe(421);
    });
  });

  describe('explicitly allowed hosts', () => {
    const app = createApp(['example.com', 'ants.internal']);

    it('should allow a configured host', async () => {
      const res = await app.request('/test', { headers: { host: 'example.com' } });
      expect(res.status).toBe(200);
    });

    it('should allow a configured host with port', async () => {
      const res = await app.request('/test', { headers: { host: 'example.com:443' } });
      expect(res.status).toBe(200);
    });

    it('should allow the second configured host', async () => {
      const res = await app.request('/test', { headers: { host: 'ants.internal' } });
      expect(res.status).toBe(200);
    });

    it('should still allow localhost', async () => {
      const res = await app.request('/test', { headers: { host: 'localhost:6647' } });
      expect(res.status).toBe(200);
    });

    it('should reject hosts not in the list', async () => {
      const res = await app.request('/test', { headers: { host: 'other.com' } });
      expect(res.status).toBe(421);
    });
  });

  describe('case insensitivity', () => {
    const app = createApp(['Example.COM']);

    it('should match regardless of case', async () => {
      const res = await app.request('/test', { headers: { host: 'example.com' } });
      expect(res.status).toBe(200);
    });

    it('should match uppercase Host header', async () => {
      const res = await app.request('/test', { headers: { host: 'EXAMPLE.COM' } });
      expect(res.status).toBe(200);
    });
  });

  describe('wildcard allows everything', () => {
    const app = createApp(['*']);

    it('should allow any host when wildcard is set', async () => {
      const res = await app.request('/test', { headers: { host: 'anything.example.com' } });
      expect(res.status).toBe(200);
    });
  });
});
