/**
 * MCP (Model Context Protocol) bridge methods.
 */

import type { AgentBridge } from '../types';
import type { BridgeDeps } from './types';

type McpMethods = Pick<
  AgentBridge,
  'listMcpServers' | 'addMcpServer' | 'removeMcpServer' | 'getMcpTools' | 'getMcpStatus'
>;

export function createMcpMethods(_deps: BridgeDeps): McpMethods {
  return {
    async listMcpServers(_projectId) {
      return [];
    },

    async addMcpServer(_projectId, _config) {
      // Platform-specific
    },

    async removeMcpServer(_projectId, _serverName) {
      // Platform-specific
    },

    async getMcpTools(_projectId) {
      return [];
    },

    async getMcpStatus(_projectId) {
      return {};
    },
  };
}
