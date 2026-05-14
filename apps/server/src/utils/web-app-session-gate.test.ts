import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { createTestDatabase, type TestDatabase } from '../test-utils/db.js';
import { WebSessionService } from '../services/web-session.js';
import { ensureSystemUser } from '../services/system-user.js';
import { hasValidWebUiSession } from './web-app-session-gate.js';

describe('hasValidWebUiSession', () => {
  let testDb: TestDatabase;
  let webSessionService: WebSessionService;

  beforeEach(async () => {
    testDb = createTestDatabase();
    await ensureSystemUser(testDb.db as any);
    webSessionService = new WebSessionService(testDb.db as any);
  });

  afterEach(() => {
    testDb.sqlite.close();
  });

  it('returns false when no cookie is sent', async () => {
    const app = new Hono();
    app.get('/x', (c) => c.text(hasValidWebUiSession(c, webSessionService) ? 'yes' : 'no'));
    const res = await app.request('/x');
    expect(await res.text()).toBe('no');
  });

  it('returns false when an unrelated cookie is sent', async () => {
    const app = new Hono();
    app.get('/x', (c) => c.text(hasValidWebUiSession(c, webSessionService) ? 'yes' : 'no'));
    const res = await app.request('/x', { headers: { Cookie: 'other=value' } });
    expect(await res.text()).toBe('no');
  });

  it('returns false when ants_session is not a valid token', async () => {
    const app = new Hono();
    app.get('/x', (c) => c.text(hasValidWebUiSession(c, webSessionService) ? 'yes' : 'no'));
    const res = await app.request('/x', { headers: { Cookie: 'ants_session=not-a-real-session' } });
    expect(await res.text()).toBe('no');
  });

  it('returns true for a freshly created session', async () => {
    const token = webSessionService.createSession('system');
    const app = new Hono();
    app.get('/x', (c) => c.text(hasValidWebUiSession(c, webSessionService) ? 'yes' : 'no'));
    const res = await app.request('/x', { headers: { Cookie: `ants_session=${token}` } });
    expect(await res.text()).toBe('yes');
  });
});
