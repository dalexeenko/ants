/**
 * Session management bridge methods.
 */

import type { Session, AgentBridge, AgentMode } from '../types';
import type { BridgeDeps } from './types';
import { createLogger } from '../../utils/logger';

const log = createLogger('sessions');

type SessionMethods = Pick<
  AgentBridge,
  'listSessions' | 'syncRemoteSessions' | 'createSession' | 'deleteSession' | 'deleteAllSessions' | 'getSession' | 'getSessionMode' | 'setSessionMode'
>;

export function createSessionMethods(deps: BridgeDeps): SessionMethods {
  const { state, helpers } = deps;
  const { projects, localAgents, remoteSessions, remoteMessages, sessionModelOverrides } = state;
  const { toUISession, getRemoteServerForProject, remoteFetch } = helpers;

  return {
    async listSessions(projectId) {
      const managed = localAgents.get(projectId);
      if (managed) {
        const sessions = await managed.sessionManager.getRootSessions(50);
        return sessions.map(toUISession);
      }

      return remoteSessions.get(projectId) || [];
    },

    async syncRemoteSessions(projectId) {
      const server = getRemoteServerForProject(projectId);
      if (!server) {
        log.debug('syncRemoteSessions: Not a remote project:', projectId);
        return;
      }

      try {
        log.debug('syncRemoteSessions: Fetching sessions for project:', projectId);
        const response = await remoteFetch(server, `/projects/${projectId}/sessions`);

        if (response.ok) {
          const data = await response.json();
          const sessions: Session[] = (Array.isArray(data) ? data : data.sessions || []).map((s: any) => ({
            id: s.id,
            title: s.title || 'Untitled Session',
            createdAt: s.createdAt ? new Date(s.createdAt).getTime() : Date.now(),
            updatedAt: s.updatedAt ? new Date(s.updatedAt).getTime() : Date.now(),
          }));

          log.debug('syncRemoteSessions: Got', sessions.length, 'sessions');
          remoteSessions.set(projectId, sessions);
        } else {
          log.error('syncRemoteSessions: Failed:', response.status);
        }
      } catch (e) {
        log.error('syncRemoteSessions: Error:', e);
      }
    },

    async createSession(projectId, options) {
      const project = projects.get(projectId);
      if (!project) {
        throw new Error(`Project not found: ${projectId}`);
      }

      // For remote projects, create on server
      const server = getRemoteServerForProject(projectId);
      if (server) {
        log.debug('createSession: Creating session on remote server');
        const response = await remoteFetch(server, `/projects/${projectId}/sessions`, {
          method: 'POST',
          body: JSON.stringify({
            title: options?.title,
            provider: options?.provider,
            model: options?.model,
            useWorktree: options?.useWorktree,
            worktreeBranch: options?.worktreeBranch,
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to create session: ${response.status}`);
        }

        const data = await response.json();
        const session: Session = {
          id: data.id,
          title: data.title || 'Untitled Session',
          createdAt: data.createdAt ? new Date(data.createdAt).getTime() : Date.now(),
          updatedAt: data.updatedAt ? new Date(data.updatedAt).getTime() : Date.now(),
          provider: options?.provider || data.provider,
          model: options?.model || data.model,
        };

        if (options?.provider && options?.model) {
          sessionModelOverrides.set(session.id, { provider: options.provider, model: options.model });
        }

        const cached = remoteSessions.get(projectId) || [];
        remoteSessions.set(projectId, [session, ...cached]);

        return session;
      }

      // For local projects
      const managed = localAgents.get(projectId);
      if (!managed) {
        throw new Error(`No agent for project: ${projectId}`);
      }

      const currentModel = managed.agent.getModel();
      const sessionProvider = options?.provider || currentModel.provider;
      const sessionModel = options?.model || currentModel.model;

      const session = await managed.sessionManager.createSession({
        workingDirectory: project.path,
        title: options?.title,
        provider: sessionProvider,
        model: sessionModel,
      });

      if (options?.provider && options?.model) {
        sessionModelOverrides.set(session.id, { provider: options.provider, model: options.model });
      }

      return toUISession(session);
    },

    async deleteSession(projectId, sessionId) {
      const server = getRemoteServerForProject(projectId);
      if (server) {
        const response = await remoteFetch(server, `/projects/${projectId}/sessions/${sessionId}`, {
          method: 'DELETE',
        });
        if (response.ok) {
          const cached = remoteSessions.get(projectId) || [];
          remoteSessions.set(projectId, cached.filter(s => s.id !== sessionId));
          remoteMessages.delete(sessionId);
        }
        return;
      }

      const managed = localAgents.get(projectId);
      if (!managed) return;

      await managed.sessionManager.deleteSession(sessionId);
    },

    async deleteAllSessions(projectId) {
      const server = getRemoteServerForProject(projectId);
      if (server) {
        // Capture cached sessions before clearing so we can clean up messages
        const cached = remoteSessions.get(projectId) || [];
        const response = await remoteFetch(server, `/projects/${projectId}/sessions`, {
          method: 'DELETE',
        });
        if (response.ok) {
          remoteSessions.set(projectId, []);
          for (const session of cached) {
            remoteMessages.delete(session.id);
          }
          const data = await response.json();
          return { deletedCount: data.deletedCount || 0 };
        }
        return { deletedCount: 0 };
      }

      const managed = localAgents.get(projectId);
      if (!managed) return { deletedCount: 0 };

      const count = await managed.sessionManager.deleteAllSessions();
      return { deletedCount: count };
    },

    async getSession(projectId, sessionId) {
      const server = getRemoteServerForProject(projectId);
      if (server) {
        const cached = remoteSessions.get(projectId) || [];
        const session = cached.find(s => s.id === sessionId);
        if (session) return session;
        throw new Error(`Session not found: ${sessionId}`);
      }

      const managed = localAgents.get(projectId);
      if (!managed) {
        throw new Error(`Project not found: ${projectId}`);
      }

      const session = await managed.sessionManager.getSession(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      return toUISession(session);
    },

    async getSessionMode(projectId, sessionId): Promise<AgentMode> {
      const server = getRemoteServerForProject(projectId);
      if (server) {
        try {
          const response = await remoteFetch(server, `/projects/${projectId}/sessions/${sessionId}/mode`);
          if (response.ok) {
            const data = await response.json();
            return data.mode || 'build';
          }
        } catch (e) {
          log.error('getSessionMode: Error:', e);
        }
        return 'build';
      }

      const managed = localAgents.get(projectId);
      if (managed) {
        return (managed.agent.getMode?.() as AgentMode) || 'build';
      }
      return 'build';
    },

    async setSessionMode(projectId, sessionId, mode): Promise<void> {
      const server = getRemoteServerForProject(projectId);
      if (server) {
        try {
          await remoteFetch(server, `/projects/${projectId}/sessions/${sessionId}/mode`, {
            method: 'PUT',
            body: JSON.stringify({ mode }),
          });
        } catch (e) {
          log.error('setSessionMode: Error:', e);
        }
        return;
      }

      const managed = localAgents.get(projectId);
      if (managed && managed.agent.setMode) {
        managed.agent.setMode(mode);
      }
    },
  };
}
