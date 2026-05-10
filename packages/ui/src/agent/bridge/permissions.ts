/**
 * Permissions & question-response bridge methods.
 */

import type { AgentBridge } from '../types';
import type { BridgeDeps } from './types';
import { createLogger } from '../../utils/logger';

const log = createLogger('permissions');

type PermissionMethods = Pick<
  AgentBridge,
  | 'respondToPermission'
  | 'respondToQuestion'
  | 'getPermissionConfig'
  | 'updatePermissionConfig'
>;

export function createPermissionMethods(deps: BridgeDeps): PermissionMethods {
  const { state, helpers } = deps;
  const { localAgents } = state;
  const { getRemoteServerForProject, remoteFetch } = helpers;

  return {
    async respondToPermission(projectId, sessionId, toolCallId, response) {
      const managed = localAgents.get(projectId);
      if (managed) {
        const resolver = managed.permissionResolvers.get(toolCallId);
        if (resolver) {
          resolver(response);
          managed.permissionResolvers.delete(toolCallId);
        }
        return;
      }

      const server = getRemoteServerForProject(projectId);
      if (server) {
        try {
          await remoteFetch(server, `/projects/${projectId}/sessions/${sessionId}/permission/${encodeURIComponent(toolCallId)}/respond`, {
            method: 'POST',
            body: JSON.stringify({ response }),
          });
        } catch (e) {
          log.error('respondToPermission: Error sending permission response:', e);
        }
      }
    },

    async respondToQuestion(projectId, sessionId, questionId, response) {
      const managed = localAgents.get(projectId);
      if (managed) {
        const resolver = managed.questionResolvers.get(questionId);
        if (resolver) {
          resolver(response);
          managed.questionResolvers.delete(questionId);
        }
        return;
      }

      const server = getRemoteServerForProject(projectId);
      if (server) {
        try {
          await remoteFetch(server, `/projects/${projectId}/sessions/${sessionId}/question/${encodeURIComponent(questionId)}/respond`, {
            method: 'POST',
            body: JSON.stringify(response),
          });
        } catch (e) {
          log.error('respondToQuestion: Error sending question response:', e);
        }
      }
    },

    async getPermissionConfig(projectId) {
      const managed = localAgents.get(projectId);
      if (!managed) {
        return { defaultMode: 'ask', alwaysAllow: [], alwaysDeny: [], allowAll: false };
      }
      return managed.agent.getPermissionConfig();
    },

    async updatePermissionConfig(projectId, config) {
      const managed = localAgents.get(projectId);
      if (managed) {
        managed.agent.updatePermissionConfig(config);
      }
    },
  };
}
