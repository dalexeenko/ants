/**
 * Authentication & API key bridge methods.
 */

import type { AgentBridge } from '../types';
import type { BridgeDeps } from './types';

type AuthMethods = Pick<
  AgentBridge,
  | 'getAuthStatus'
  | 'initiateOAuth'
  | 'completeOAuth'
  | 'disconnectOAuth'
  | 'getApiKeys'
  | 'setApiKey'
  | 'deleteApiKey'
>;

export function createAuthMethods(deps: BridgeDeps): AuthMethods {
  const { storage } = deps.config;

  return {
    async getAuthStatus() {
      return storage.getAuthStatus();
    },

    async initiateOAuth(provider) {
      return storage.initiateOAuth(provider);
    },

    async completeOAuth(provider, code, verifier) {
      return storage.completeOAuth(provider, code, verifier);
    },

    async disconnectOAuth(provider) {
      return storage.disconnectOAuth(provider);
    },

    async getApiKeys() {
      return storage.listApiKeys();
    },

    async setApiKey(provider, key) {
      await storage.setApiKey(provider, key);
    },

    async deleteApiKey(provider) {
      await storage.deleteApiKey(provider);
    },
  };
}
