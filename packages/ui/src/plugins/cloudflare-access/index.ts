/**
 * Cloudflare Access Auth Plugin
 *
 * Adds a "Cloudflare Access" auth type to the server connection/settings pages.
 * Uses Cloudflare Access Service Tokens (Client ID + Client Secret) to authenticate
 * requests to servers behind Cloudflare Access.
 *
 * This is the first real consumer of the UI plugin system's auth provider extension point.
 */

import type { TypedAuthProviderContribution } from '../types';
import { CloudflareAccessConnectionForm } from './CloudflareAccessConnectionForm';
import { CloudflareAccessSettings } from './CloudflareAccessSettings';

export const cloudflareAccessAuthProvider: TypedAuthProviderContribution = {
  id: 'cloudflare-access',
  label: 'Cloudflare Access',
  icon: 'shield',
  connectionComponent: CloudflareAccessConnectionForm,
  settingsComponent: CloudflareAccessSettings,
  getAuthHeaders: (authConfig) => ({
    'CF-Access-Client-Id': String(authConfig.clientId ?? ''),
    'CF-Access-Client-Secret': String(authConfig.clientSecret ?? ''),
  }),
  pluginName: 'cloudflare-access-auth',
};
