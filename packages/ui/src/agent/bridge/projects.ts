/**
 * Project management bridge methods.
 */

import type { Project, AgentBridge } from '../types';
import type { ManagedAgent } from '../BridgeCore';
import type { BridgeDeps } from './types';
import { createLogger } from '../../utils/logger';

const log = createLogger('projects');

type ProjectMethods = Pick<
  AgentBridge,
  'createProject' | 'listProjects' | 'syncRemoteProjects' | 'updateProject' | 'removeProject' | 'discoverProjects'
>;

export function createProjectMethods(deps: BridgeDeps): ProjectMethods {
  const { config, state, helpers } = deps;
  const { projects, localAgents, remoteServers } = state;
  const { generateId, emitEvent } = helpers;
  const { agentFactory, storage } = config;

  return {
    async createProject(path, providerType, remoteServerId, customName) {
      log.debug('createProject: Called with path:', path, 'providerType:', providerType, 'remoteServerId:', remoteServerId, 'customName:', JSON.stringify(customName));
      const name = customName || path.split('/').pop() || 'Untitled';
      log.debug('createProject: Resolved name:', JSON.stringify(name));

      // For remote projects, create on the remote server first
      if (providerType === 'remote' && remoteServerId) {
        const server = remoteServers.get(remoteServerId);
        if (!server) {
          throw new Error(`Remote server not found: ${remoteServerId}`);
        }

        log.debug('createProject: Creating project on remote server:', server.url);

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (server.token) {
          headers['Authorization'] = `Bearer ${server.token}`;
        }

        const response = await fetch(`${server.url}/api/beta/projects`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ name, ...(path ? { workingDirectory: path } : {}) }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          log.error('createProject: Failed to create remote project:', response.status, errorText);
          throw new Error(`Failed to create project on remote server: ${response.status}`);
        }

        const remoteProject = await response.json();
        log.debug('createProject: Remote project created:', remoteProject);

        const project: Project = {
          id: remoteProject.id,
          name: remoteProject.name || name,
          path: remoteProject.workingDirectory || path,
          createdAt: remoteProject.createdAt ? new Date(remoteProject.createdAt).getTime() : Date.now(),
          providerType,
          remoteServerId,
        };

        projects.set(project.id, project);
        config.onProjectsChanged?.(Array.from(projects.values()));

        return project;
      }

      // For local projects
      const id = generateId();

      const project: Project = {
        id,
        name,
        path,
        createdAt: Date.now(),
        providerType,
        remoteServerId,
      };

      projects.set(id, project);
      config.onProjectsChanged?.(Array.from(projects.values()));

      // Create agent for local projects
      if (providerType === 'local') {
        // Try OAuth tokens first (preferred), then fall back to API key
        const oauthTokens = storage.getOAuthTokens ? await storage.getOAuthTokens() : null;
        const apiKey = oauthTokens ? undefined : await storage.getApiKey('anthropic');

        log.debug('createProject: Auth for local project:', {
          hasOAuthTokens: !!oauthTokens,
          hasAccessToken: !!oauthTokens?.accessToken,
          hasRefreshToken: !!oauthTokens?.refreshToken,
          hasExpiresAt: !!oauthTokens?.expiresAt,
          hasApiKey: !!apiKey,
          hasGetOAuthTokens: !!storage.getOAuthTokens,
          hasSaveOAuthTokens: !!storage.saveOAuthTokens,
        });

        const { agent, sessionManager, hasIncrementalPersistence } = await agentFactory.createAgent({
          projectId: id,
          workingDirectory: path,
          apiKey: apiKey || undefined,
          oauthTokens: oauthTokens || undefined,
          onTokenRefresh: storage.saveOAuthTokens ? storage.saveOAuthTokens.bind(storage) : undefined,
          onEvent: (event) => emitEvent(id, event),
        });

        const managed: ManagedAgent = {
          id,
          workingDirectory: path,
          agent,
          sessionManager,
          currentSessionId: null,
          permissionResolvers: new Map(),
          questionResolvers: new Map(),
          hasIncrementalPersistence,
        };

        // Set up permission callback
        agent.setPermissionRequestCallback(async (toolCall) => {
          return new Promise((resolve) => {
            managed.permissionResolvers.set(toolCall.id, resolve);
            emitEvent(id, {
              type: 'tool.permission.request',
              sessionId: managed.currentSessionId || '',
              messageId: '',
              toolCall: {
                id: toolCall.id,
                name: toolCall.name,
                arguments: toolCall.arguments,
                status: 'pending',
              },
            });
          });
        });

        localAgents.set(id, managed);
      }

      return project;
    },

    async listProjects() {
      return Array.from(projects.values());
    },

    async syncRemoteProjects() {
      log.debug('syncRemoteProjects: Syncing projects from remote servers...');

      // Remove all cached remote projects first
      for (const [id, project] of projects.entries()) {
        if (project.providerType === 'remote') {
          projects.delete(id);
        }
      }

      // Track servers that couldn't be reached
      const unreachableServers: import('../types').RemoteServerConfig[] = [];

      // Fetch and cache projects from all remote servers
      for (const server of remoteServers.values()) {
        try {
          log.debug('syncRemoteProjects: Fetching from:', server.url);

          const headers: Record<string, string> = {};
          if (server.token) {
            headers['Authorization'] = `Bearer ${server.token}`;
          }

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          const response = await fetch(`${server.url}/api/beta/projects`, { headers, signal: controller.signal });
          clearTimeout(timeoutId);

          if (response.ok) {
            const data = await response.json();
            const remoteProjects = data.projects || data || [];

            log.debug('syncRemoteProjects: Got', remoteProjects.length, 'projects from', server.name);

            for (const rp of remoteProjects) {
              const p: Project = {
                id: rp.id,
                name: rp.name,
                path: rp.workingDirectory || '',
                createdAt: rp.createdAt ? new Date(rp.createdAt).getTime() : Date.now(),
                providerType: 'remote',
                remoteServerId: server.id,
                isGitRepo: rp.isGitRepo ?? undefined,
                worktreeEnabled: rp.worktreeEnabled ?? undefined,
              };
              projects.set(p.id, p);
            }
          } else {
            log.error('syncRemoteProjects: Failed to fetch from', server.name, ':', response.status);
            unreachableServers.push(server);
          }
        } catch (e) {
          log.error('syncRemoteProjects: Error fetching from', server.name, ':', e);
          unreachableServers.push(server);
        }
      }

      config.onProjectsChanged?.(Array.from(projects.values()));
      return { unreachableServers };
    },

    async updateProject(projectId, updates) {
      const project = projects.get(projectId);
      if (!project) {
        throw new Error(`Project not found: ${projectId}`);
      }

      // For remote projects, update on the server first
      if (project.providerType === 'remote' && project.remoteServerId) {
        const server = remoteServers.get(project.remoteServerId);
        if (server) {
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          };
          if (server.token) {
            headers['Authorization'] = `Bearer ${server.token}`;
          }

          const response = await fetch(`${server.url}/api/beta/projects/${projectId}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(updates),
          });

          if (!response.ok) {
            throw new Error(`Failed to update project on server: ${response.status}`);
          }
          log.debug('updateProject: Updated project on', server.name);
        }
      }

      // Update local cache
      if (updates.name !== undefined) {
        project.name = updates.name;
      }
      if (updates.rootAgentType !== undefined) {
        project.rootAgentType = updates.rootAgentType || undefined;
      }
      if (updates.customInstructions !== undefined) {
        project.customInstructions = updates.customInstructions || undefined;
      }
      if (updates.worktreeEnabled !== undefined) {
        project.worktreeEnabled = updates.worktreeEnabled;
      }
      projects.set(projectId, project);
      config.onProjectsChanged?.(Array.from(projects.values()));
    },

    async removeProject(projectId) {
      const project = projects.get(projectId);
      if (!project) {
        log.warn('removeProject: Project not found:', projectId);
        return;
      }

      // For local projects, shut down the agent
      if (project.providerType === 'local') {
        const managed = localAgents.get(projectId);
        if (managed) {
          await managed.agent.shutdown();
          localAgents.delete(projectId);
        }
      }

      // For remote projects, delete on the server
      if (project.providerType === 'remote' && project.remoteServerId) {
        const server = remoteServers.get(project.remoteServerId);
        if (server) {
          const headers: Record<string, string> = {};
          if (server.token) {
            headers['Authorization'] = `Bearer ${server.token}`;
          }

          const response = await fetch(`${server.url}/api/beta/projects/${projectId}`, {
            method: 'DELETE',
            headers,
          });

          if (!response.ok) {
            throw new Error(`Failed to delete project on server: ${response.status}`);
          }
          log.debug('removeProject: Deleted project from', server.name);
        }
      }

      projects.delete(projectId);
      config.onProjectsChanged?.(Array.from(projects.values()));
    },

    async discoverProjects(_directory) {
      return [];
    },
  };
}
