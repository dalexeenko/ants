/**
 * Plugins, tools, agent types bridge methods.
 */

import type { AgentBridge } from '../types';
import type { BridgeDeps } from './types';
import { createLogger } from '../../utils/logger';

const log = createLogger('plugins');

type PluginMethods = Pick<
  AgentBridge,
  | 'getPlugins'
  | 'installPlugin'
  | 'uninstallPlugin'
  | 'getToolsInfo'
  | 'getDisabledTools'
  | 'setDisabledTools'
  | 'disableTool'
  | 'enableTool'
  | 'getAgentTypes'
  | 'getAgentTypeConflicts'
  | 'setAgentTypeEnabled'
>;

export function createPluginMethods(deps: BridgeDeps): PluginMethods {
  const { config, state, helpers } = deps;
  const { projects, localAgents, remoteServers } = state;
  const { remoteFetch } = helpers;

  return {
    // ============ Tools ============

    async getToolsInfo(projectId) {
      const project = projects.get(projectId);

      if (project?.providerType === 'remote' && project.remoteServerId) {
        const server = remoteServers.get(project.remoteServerId);
        if (server) {
          try {
            log.debug('getToolsInfo: Fetching tools for remote project:', projectId);
            const response = await remoteFetch(server, `/projects/${projectId}/tools`);
            if (response.ok) {
              const data = await response.json();
              const tools = (data.tools || []).map((tool: { name: string; description?: string; available?: boolean }) => ({
                name: tool.name,
                description: tool.description || '',
                tags: [],
                requires: [],
                available: tool.available ?? true,
                disabled: false,
              }));
              log.debug('getToolsInfo: Got', tools.length, 'tools from remote server');
              return tools;
            } else {
              log.error('getToolsInfo: Failed to fetch tools:', response.status);
            }
          } catch (e) {
            log.error('getToolsInfo: Error fetching tools:', e);
          }
        }
        return [];
      }

      const managed = localAgents.get(projectId);
      if (!managed) {
        log.debug('getToolsInfo: No managed agent found for project:', projectId);
        return [];
      }
      return managed.agent.getToolsInfo();
    },

    async getDisabledTools(projectId) {
      const managed = localAgents.get(projectId);
      if (!managed) return [];
      return managed.agent.getDisabledTools();
    },

    async setDisabledTools(projectId, tools) {
      const managed = localAgents.get(projectId);
      if (managed) {
        managed.agent.setDisabledTools(tools);
      }
    },

    async disableTool(projectId, toolName) {
      const managed = localAgents.get(projectId);
      if (managed) {
        managed.agent.disableTool(toolName);
      }
    },

    async enableTool(projectId, toolName) {
      const managed = localAgents.get(projectId);
      if (managed) {
        managed.agent.enableTool(toolName);
      }
    },

    // ============ Plugins ============

    async getPlugins(projectId) {
      const project = projects.get(projectId);

      if (project?.providerType === 'remote' && project.remoteServerId) {
        const server = remoteServers.get(project.remoteServerId);
        if (server) {
          try {
            const response = await remoteFetch(server, `/projects/${projectId}/plugins`);
            if (response.ok) {
              return await response.json();
            }
          } catch (e) {
            log.error('getPlugins: Error fetching plugins:', e);
          }
        }
        return { installed: [], registered: [] };
      }

      return { installed: [], registered: [] };
    },

    async installPlugin(projectId, packageSpec) {
      const project = projects.get(projectId);

      if (project?.providerType === 'remote' && project.remoteServerId) {
        const server = remoteServers.get(project.remoteServerId);
        if (server) {
          try {
            const response = await remoteFetch(server, `/projects/${projectId}/plugins/install`, {
              method: 'POST',
              body: JSON.stringify({ packageSpec }),
            });
            return await response.json();
          } catch (e) {
            return { success: false, error: e instanceof Error ? e.message : String(e) };
          }
        }
        return { success: false, error: 'Server not found' };
      }

      return { success: false, error: 'Plugin installation not available for local projects' };
    },

    async uninstallPlugin(projectId, packageName) {
      const project = projects.get(projectId);

      if (project?.providerType === 'remote' && project.remoteServerId) {
        const server = remoteServers.get(project.remoteServerId);
        if (server) {
          try {
            const response = await remoteFetch(server, `/projects/${projectId}/plugins/uninstall`, {
              method: 'POST',
              body: JSON.stringify({ packageName }),
            });
            return await response.json();
          } catch (e) {
            return { success: false, error: e instanceof Error ? e.message : String(e) };
          }
        }
        return { success: false, error: 'Server not found' };
      }

      return { success: false, error: 'Plugin uninstallation not available for local projects' };
    },

    // ============ Agent Types ============

    async getAgentTypes(projectId) {
      const project = projects.get(projectId);

      if (project?.providerType === 'remote' && project.remoteServerId) {
        const server = remoteServers.get(project.remoteServerId);
        if (server) {
          try {
            log.debug('getAgentTypes: Fetching agent types for remote project:', projectId);
            const response = await remoteFetch(server, `/projects/${projectId}/agent-types`);
            if (response.ok) {
              const data = await response.json();
              const agentTypes = data.agentTypes || [];
              log.debug('getAgentTypes: Got', agentTypes.length, 'agent types from remote server');
              return agentTypes;
            } else {
              log.error('getAgentTypes: Failed to fetch agent types:', response.status);
            }
          } catch (e) {
            log.error('getAgentTypes: Error fetching agent types:', e);
          }
        }
      }

      // Local project: query the agent's type registry
      const managed = localAgents.get(projectId);
      if (managed?.agent.getAgentTypes) {
        try {
          return managed.agent.getAgentTypes();
        } catch (e) {
          log.error('getAgentTypes: Error getting local agent types:', e);
        }
      }

      // Fallback: use global agent type registry if provided.
      // This handles the case where the project exists but the local agent
      // hasn't been created yet or failed to create (e.g. no auth configured).
      if (config.getGlobalAgentTypes) {
        log.debug('getAgentTypes: Using global fallback for project:', projectId);
        return config.getGlobalAgentTypes();
      }

      return [];
    },

    async getAgentTypeConflicts(projectId) {
      const project = projects.get(projectId);

      if (project?.providerType === 'remote' && project.remoteServerId) {
        const server = remoteServers.get(project.remoteServerId);
        if (server) {
          try {
            const response = await remoteFetch(server, `/projects/${projectId}/agent-types/conflicts`);
            if (response.ok) {
              const data = await response.json();
              return data.conflicts || [];
            }
          } catch (e) {
            log.error('getAgentTypeConflicts: Error fetching conflicts:', e);
          }
        }
      }

      // Local project: query the agent's type conflicts
      const managed = localAgents.get(projectId);
      if (managed?.agent.getAgentTypeConflicts) {
        try {
          return managed.agent.getAgentTypeConflicts();
        } catch (e) {
          log.error('getAgentTypeConflicts: Error getting local conflicts:', e);
        }
      }

      // Fallback: use global agent type conflicts if provided.
      if (config.getGlobalAgentTypeConflicts) {
        return config.getGlobalAgentTypeConflicts();
      }

      return [];
    },

    async setAgentTypeEnabled(projectId, name, enabled) {
      const project = projects.get(projectId);

      if (project?.providerType === 'remote' && project.remoteServerId) {
        const server = remoteServers.get(project.remoteServerId);
        if (server) {
          try {
            const response = await remoteFetch(server, `/projects/${projectId}/agent-types/${encodeURIComponent(name)}/enabled`, {
              method: 'PUT',
              body: JSON.stringify({ enabled }),
            });
            if (!response.ok) {
              log.error('setAgentTypeEnabled: Failed:', response.status);
            }
          } catch (e) {
            log.error('setAgentTypeEnabled: Error:', e);
          }
        }
        return;
      }

      // Local project: toggle directly on the agent
      const managed = localAgents.get(projectId);
      if (managed?.agent.setAgentTypeEnabled) {
        try {
          managed.agent.setAgentTypeEnabled(name, enabled);
        } catch (e) {
          log.error('setAgentTypeEnabled: Error setting local agent type enabled:', e);
        }
      } else if (config.setGlobalAgentTypeEnabled) {
        // Fallback: toggle on global registry
        config.setGlobalAgentTypeEnabled(name, enabled);
      }
    },
  };
}
