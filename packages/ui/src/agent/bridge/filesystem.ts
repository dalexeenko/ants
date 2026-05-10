/**
 * Filesystem bridge methods (project-scoped + remote browsing).
 */

import type { FileEntry, AgentBridge } from '../types';
import type { BridgeDeps } from './types';
import { createLogger } from '../../utils/logger';

const log = createLogger('filesystem');

type FilesystemMethods = Pick<
  AgentBridge,
  | 'readDirectory'
  | 'readFile'
  | 'writeFile'
  | 'watchFile'
  | 'unwatchFile'
  | 'getRemoteFilesystemHome'
  | 'listRemoteFilesystem'
  | 'createRemoteDirectory'
>;

export function createFilesystemMethods(deps: BridgeDeps): FilesystemMethods {
  const { config, state, helpers } = deps;
  const { projects, remoteServers } = state;
  const { remoteFetch, emitEvent } = helpers;
  const { filesystem } = config;

  return {
    async readDirectory(projectId, dirPath) {
      const project = projects.get(projectId);

      if (project?.providerType === 'remote' && project.remoteServerId) {
        const server = remoteServers.get(project.remoteServerId);
        if (server) {
          try {
            const params = new URLSearchParams({ path: dirPath });
            const response = await remoteFetch(server, `/projects/${projectId}/files?${params}`);
            if (response.ok) {
              const data = await response.json();
              const files: FileEntry[] = (data.files || []).map((f: { name: string; path: string; isDirectory: boolean; size?: number; mtime?: string }) => ({
                name: f.name,
                path: f.path,
                isDirectory: f.isDirectory,
                size: f.size,
                modifiedAt: f.mtime ? new Date(f.mtime).getTime() : undefined,
              }));
              return files;
            }
            log.error('readDirectory: Remote fetch failed:', response.status);
          } catch (e) {
            log.error('readDirectory: Failed to fetch remote directory:', e);
          }
          return [];
        }
      }

      if (project?.path && (dirPath === '.' || dirPath === '')) {
        return filesystem.readDirectory(project.path);
      }

      return filesystem.readDirectory(dirPath);
    },

    async readFile(projectId, filePath) {
      const project = projects.get(projectId);

      if (project?.providerType === 'remote' && project.remoteServerId) {
        const server = remoteServers.get(project.remoteServerId);
        if (server) {
          try {
            const params = new URLSearchParams({ path: filePath });
            const response = await remoteFetch(server, `/projects/${projectId}/files/content?${params}`);
            if (response.ok) {
              const data = await response.json();
              return data.content || '';
            }
            log.error('readFile: Remote fetch failed:', response.status);
          } catch (e) {
            log.error('readFile: Failed to fetch remote file:', e);
          }
          return '';
        }
      }

      if (project?.path && !filePath.startsWith('/')) {
        return filesystem.readFile(filePath);
      }

      return filesystem.readFile(filePath);
    },

    async writeFile(projectId, filePath, content) {
      const project = projects.get(projectId);

      if (project?.providerType === 'remote' && project.remoteServerId) {
        const server = remoteServers.get(project.remoteServerId);
        if (server) {
          try {
            const params = new URLSearchParams({ path: filePath });
            const response = await remoteFetch(server, `/projects/${projectId}/files/content?${params}`, {
              method: 'PUT',
              body: JSON.stringify({ content }),
            });
            if (response.ok) {
              return;
            }
            const error = await response.json().catch(() => ({ error: 'Failed to write file' }));
            throw new Error(error.error || `Failed to write file: ${response.status}`);
          } catch (e) {
            log.error('writeFile: Failed to write remote file:', e);
            throw e;
          }
        }
      }

      return filesystem.writeFile(filePath, content);
    },

    async watchFile(projectId, filePath) {
      if (!filesystem.watchFile) {
        log.debug('watchFile: Platform does not support file watching');
        return;
      }

      filesystem.watchFile(filePath, () => {
        log.debug('watchFile: File changed externally:', filePath);
        emitEvent(projectId, { type: 'file.changed', filePath });
      });
    },

    async unwatchFile(projectId, filePath) {
      if (!filesystem.unwatchFile) return;
      filesystem.unwatchFile(filePath);
    },

    async getRemoteFilesystemHome(serverId) {
      const server = remoteServers.get(serverId);
      if (!server) {
        throw new Error(`Remote server not found: ${serverId}`);
      }

      const response = await remoteFetch(server, '/filesystem/home');
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to get filesystem home' }));
        throw new Error(error.error || `Failed to get filesystem home: ${response.status}`);
      }

      return response.json();
    },

    async listRemoteFilesystem(serverId, path, showHidden = false) {
      const server = remoteServers.get(serverId);
      if (!server) {
        throw new Error(`Remote server not found: ${serverId}`);
      }

      const params = new URLSearchParams({ path });
      if (showHidden) {
        params.set('showHidden', 'true');
      }

      const response = await remoteFetch(server, `/filesystem/list?${params}`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to list filesystem' }));
        throw new Error(error.error || `Failed to list filesystem: ${response.status}`);
      }

      return response.json();
    },

    async createRemoteDirectory(serverId, parentPath, name) {
      const server = remoteServers.get(serverId);
      if (!server) {
        throw new Error(`Remote server not found: ${serverId}`);
      }

      const response = await remoteFetch(server, '/filesystem/mkdir', {
        method: 'POST',
        body: JSON.stringify({ parentPath, name }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to create directory' }));
        throw new Error(error.error || `Failed to create directory: ${response.status}`);
      }

      const result = await response.json();
      return result.path;
    },
  };
}
