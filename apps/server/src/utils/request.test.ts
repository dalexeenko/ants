import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { isSecure, getServerUrl } from './request.js';

/**
 * Helper: create a Hono app that returns isSecure() and getServerUrl() for each request.
 */
function createApp() {
  const app = new Hono();
  app.get('/test', (c) => c.json({ secure: isSecure(c), serverUrl: getServerUrl(c) }));
  return app;
}

describe('isSecure', () => {
  const app = createApp();

  it('should return false for plain HTTP with no forwarded headers', async () => {
    const res = await app.request('/test', { headers: { host: 'example.com' } });
    const data = await res.json();
    expect(data.secure).toBe(false);
  });

  it('should return true when x-forwarded-proto is https', async () => {
    const res = await app.request('/test', {
      headers: { host: 'example.com', 'x-forwarded-proto': 'https' },
    });
    const data = await res.json();
    expect(data.secure).toBe(true);
  });

  it('should return false when x-forwarded-proto is http', async () => {
    const res = await app.request('/test', {
      headers: { host: 'example.com', 'x-forwarded-proto': 'http' },
    });
    const data = await res.json();
    expect(data.secure).toBe(false);
  });

  it('should handle x-forwarded-proto with multiple values (first wins)', async () => {
    const res = await app.request('/test', {
      headers: { host: 'example.com', 'x-forwarded-proto': 'https, http' },
    });
    const data = await res.json();
    expect(data.secure).toBe(true);
  });

  it('should handle x-forwarded-proto case-insensitively', async () => {
    const res = await app.request('/test', {
      headers: { host: 'example.com', 'x-forwarded-proto': 'HTTPS' },
    });
    const data = await res.json();
    expect(data.secure).toBe(true);
  });

  it('should return true when x-forwarded-scheme is https', async () => {
    const res = await app.request('/test', {
      headers: { host: 'example.com', 'x-forwarded-scheme': 'https' },
    });
    const data = await res.json();
    expect(data.secure).toBe(true);
  });

  it('should return false when x-forwarded-scheme is http', async () => {
    const res = await app.request('/test', {
      headers: { host: 'example.com', 'x-forwarded-scheme': 'http' },
    });
    const data = await res.json();
    expect(data.secure).toBe(false);
  });

  it('should return true when x-forwarded-ssl is on', async () => {
    const res = await app.request('/test', {
      headers: { host: 'example.com', 'x-forwarded-ssl': 'on' },
    });
    const data = await res.json();
    expect(data.secure).toBe(true);
  });

  it('should return false when x-forwarded-ssl is off', async () => {
    const res = await app.request('/test', {
      headers: { host: 'example.com', 'x-forwarded-ssl': 'off' },
    });
    const data = await res.json();
    expect(data.secure).toBe(false);
  });

  it('should return true when Forwarded header has proto=https', async () => {
    const res = await app.request('/test', {
      headers: { host: 'example.com', forwarded: 'for=1.2.3.4; proto=https; by=proxy' },
    });
    const data = await res.json();
    expect(data.secure).toBe(true);
  });

  it('should return false when Forwarded header has proto=http', async () => {
    const res = await app.request('/test', {
      headers: { host: 'example.com', forwarded: 'for=1.2.3.4; proto=http' },
    });
    const data = await res.json();
    expect(data.secure).toBe(false);
  });

  it('should prefer x-forwarded-proto over other headers', async () => {
    const res = await app.request('/test', {
      headers: {
        host: 'example.com',
        'x-forwarded-proto': 'http',
        'x-forwarded-scheme': 'https',
        'x-forwarded-ssl': 'on',
      },
    });
    const data = await res.json();
    // x-forwarded-proto takes priority — it says http
    expect(data.secure).toBe(false);
  });
});

describe('getServerUrl', () => {
  const app = createApp();

  it('should return http:// for plain HTTP', async () => {
    const res = await app.request('/test', { headers: { host: 'example.com' } });
    const data = await res.json();
    expect(data.serverUrl).toBe('http://example.com');
  });

  it('should return https:// when x-forwarded-proto is https', async () => {
    const res = await app.request('/test', {
      headers: { host: 'personal.openmgr.dev', 'x-forwarded-proto': 'https' },
    });
    const data = await res.json();
    expect(data.serverUrl).toBe('https://personal.openmgr.dev');
  });

  it('should preserve port in host header', async () => {
    const res = await app.request('/test', {
      headers: { host: 'localhost:6647', 'x-forwarded-proto': 'https' },
    });
    const data = await res.json();
    expect(data.serverUrl).toBe('https://localhost:6647');
  });
});
