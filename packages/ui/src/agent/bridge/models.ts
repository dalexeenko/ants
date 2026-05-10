/**
 * Model management bridge methods.
 */

import type { ModelInfo, AuthStatus, AgentBridge } from '../types';
import { getAvailableProviders } from '../modelsApi';
import type { BridgeDeps } from './types';
import { createLogger } from '../../utils/logger';

const log = createLogger('models');

type ModelMethods = Pick<
  AgentBridge,
  | 'getModels'
  | 'getCurrentModel'
  | 'setModel'
  | 'getSessionModel'
  | 'setSessionModel'
  | 'clearSessionModel'
>;

export function createModelMethods(deps: BridgeDeps): ModelMethods {
  const { config, state, helpers } = deps;
  const { localAgents, sessionModelOverrides } = state;
  const { getRemoteServerForProject, remoteFetch } = helpers;
  const { storage } = config;

  return {
    async getModels(projectId) {
      log.debug('getModels: Called for projectId:', projectId);

      const server = getRemoteServerForProject(projectId);
      if (server) {
        log.debug('getModels: Fetching from remote server:', server.url);
        try {
          const response = await remoteFetch(server, `/projects/${projectId}/models`);
          if (response.ok) {
            const data = await response.json();
            const remoteModels = data.models || data || [];
            log.debug('getModels: Got', remoteModels.length, 'remote models');
            if (remoteModels.length > 0) {
              return remoteModels as ModelInfo[];
            }
          } else {
            log.warn('getModels: Remote fetch failed:', response.status);
          }
        } catch (e) {
          log.error('getModels: Error fetching remote models:', e);
        }
      }

      log.debug('getModels: Fetching from models.dev...');
      const providers = await getAvailableProviders();
      log.debug('getModels: Got', providers.length, 'providers from models.dev:', providers.map(p => `${p.id}(${p.models.length})`).join(', '));

      const authStatus = await storage.getAuthStatus();
      log.debug('getModels: Auth status:', JSON.stringify(authStatus));
      const models: ModelInfo[] = [];

      for (const provider of providers) {
        let hasCredentials = false;

        if (provider.id === 'anthropic') {
          hasCredentials = authStatus.anthropic.authenticated || await storage.hasApiKey('anthropic');
        } else {
          const statusKey = provider.id as keyof AuthStatus;
          const providerStatus = authStatus[statusKey] as { hasApiKey?: boolean } | undefined;
          hasCredentials = providerStatus?.hasApiKey || await storage.hasApiKey(provider.id);
        }

        log.debug(`getModels: Provider ${provider.id}: hasCredentials=${hasCredentials}, models=${provider.models.length}`);

        // Only include models from providers the user has credentials for
        if (!hasCredentials) {
          log.debug(`getModels: Skipping provider ${provider.id} (no credentials)`);
          continue;
        }

        for (const model of provider.models) {
          models.push(model);
        }
      }

      log.debug('getModels: Returning', models.length, 'total models');
      return models;
    },

    async getCurrentModel(projectId) {
      const managed = localAgents.get(projectId);
      if (managed) {
        return managed.agent.getModel();
      }

      const server = getRemoteServerForProject(projectId);
      if (server) {
        try {
          const response = await remoteFetch(server, `/projects/${projectId}/config`);
          if (response.ok) {
            const data = await response.json();
            return {
              provider: data.config?.provider || 'anthropic',
              model: data.config?.model || 'claude-sonnet-4-20250514',
            };
          }
        } catch (e) {
          log.error('getCurrentModel: Error fetching remote model:', e);
        }
      }

      return { provider: 'anthropic', model: 'claude-sonnet-4-20250514' };
    },

    async setModel(projectId, provider, model) {
      log.info('setModel: Setting model:', { projectId, provider, model });

      const managed = localAgents.get(projectId);
      if (managed) {
        managed.agent.setModel(provider, model);
        log.info('setModel: Set model on local agent');
        return;
      }

      const server = getRemoteServerForProject(projectId);
      if (server) {
        const response = await remoteFetch(server, `/projects/${projectId}/config`, {
          method: 'PUT',
          body: JSON.stringify({ provider, model }),
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: 'Failed to update model' }));
          throw new Error(error.error || `Failed to update model: ${response.status}`);
        }
        log.info('setModel: Set model on remote server');
        return;
      }

      throw new Error(`Project not found: ${projectId}`);
    },

    async getSessionModel(_projectId, sessionId) {
      const override = sessionModelOverrides.get(sessionId);
      return override ?? null;
    },

    async setSessionModel(_projectId, sessionId, provider, model) {
      log.debug('setSessionModel: Setting session model:', { sessionId, provider, model });
      sessionModelOverrides.set(sessionId, { provider, model });
    },

    async clearSessionModel(_projectId, sessionId) {
      log.debug('clearSessionModel: Clearing session model:', { sessionId });
      sessionModelOverrides.delete(sessionId);
    },
  };
}
