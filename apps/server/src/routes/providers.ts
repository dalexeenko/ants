/**
 * Legacy provider credential routes.
 *
 * These routes preserve backward compatibility with the original
 * `/providers` API while delegating to the encrypted `ApiKeyManager`.
 * New consumers should use `/system/api-keys` instead.
 */

import { Hono } from 'hono';
import type { ApiKeyManager } from '../services/api-key-manager.js';
import { parseBody } from '../utils/validation.js';
import { SetApiKeySchema } from '../schemas/index.js';

export function createProviderRoutes(apiKeyManager: ApiKeyManager) {
  const app = new Hono();

  /**
   * GET /providers — list all known providers with their config status.
   *
   * Legacy shape: `{ providers: [{ providerId, name, hasApiKey, envVar }] }`
   */
  app.get('/', async (c) => {
    const definitions = apiKeyManager.getProviderDefinitions();
    const full = await apiKeyManager.listApiKeys();

    const providers = definitions.map(def => {
      const status = full.providers.find(p => p.id === def.id);
      // The legacy API returned the first (primary) env var for the provider
      const envVar = def.fields[0]?.envVar ?? '';
      return {
        providerId: def.id,
        name: def.name,
        hasApiKey: status?.isConfigured ?? false,
        envVar,
      };
    });

    return c.json({ providers });
  });

  /**
   * GET /providers/:providerId — single provider detail.
   *
   * Legacy shape: `{ providerId, name, envVar, hasApiKey, createdAt, updatedAt }`
   */
  app.get('/:providerId', async (c) => {
    const providerId = c.req.param('providerId');
    const definitions = apiKeyManager.getProviderDefinitions();
    const def = definitions.find(d => d.id === providerId);

    if (!def) {
      return c.json({ error: 'Unknown provider' }, 404);
    }

    const full = await apiKeyManager.listApiKeys();
    const status = full.providers.find(p => p.id === providerId);
    const envVar = def.fields[0]?.envVar ?? '';

    return c.json({
      providerId,
      name: def.name,
      envVar,
      hasApiKey: status?.isConfigured ?? false,
    });
  });

  /**
   * PUT /providers/:providerId — set an API key.
   *
   * Legacy input: `{ apiKey: string }`
   * Translates to `ApiKeyManager.setProviderKeys()` using the primary env var.
   */
  app.put('/:providerId', async (c) => {
    const providerId = c.req.param('providerId');
    const body = await parseBody(c, SetApiKeySchema);

    const definitions = apiKeyManager.getProviderDefinitions();
    const def = definitions.find(d => d.id === providerId);

    if (!def) {
      return c.json({ error: 'Unknown provider' }, 404);
    }

    // The legacy API accepted a single apiKey; map it to the primary env var.
    const primaryEnvVar = def.fields[0]?.envVar;
    if (!primaryEnvVar) {
      return c.json({ error: 'Provider has no configurable fields' }, 400);
    }

    await apiKeyManager.setProviderKeys(providerId, { [primaryEnvVar]: body.apiKey });

    return c.json({
      providerId,
      name: def.name,
      envVar: primaryEnvVar,
      hasApiKey: true,
    });
  });

  /**
   * DELETE /providers/:providerId — remove an API key.
   */
  app.delete('/:providerId', async (c) => {
    const providerId = c.req.param('providerId');
    const deleted = await apiKeyManager.deleteProviderKeys(providerId);

    if (!deleted) {
      return c.json({ error: 'No API key found for provider' }, 404);
    }

    return c.json({ success: true });
  });

  return app;
}
