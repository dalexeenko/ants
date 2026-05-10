import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { homedir } from 'os';

// Mock fs/promises (used by saveMcpConfig for writeFile)
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
vi.mock('fs/promises', () => ({
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

// Mock ../utils/fs.js (used by loadMcpConfig for readJsonFileAsync, saveMcpConfig for ensureDirectoryAsync)
const mockReadJsonFileAsync = vi.fn();
const mockEnsureDirectoryAsync = vi.fn().mockResolvedValue(undefined);
vi.mock('../utils/fs.js', () => ({
  readJsonFileAsync: (...args: unknown[]) => mockReadJsonFileAsync(...args),
  ensureDirectoryAsync: (...args: unknown[]) => mockEnsureDirectoryAsync(...args),
  // Include other exports in case they're imported elsewhere
  pathExists: vi.fn().mockResolvedValue(false),
  ensureDirectory: vi.fn(),
  readJsonFile: vi.fn().mockReturnValue({}),
}));

const CONFIG_DIR = path.join(homedir(), '.config', 'openmgr-mcp');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

describe('MCP Config Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });
  
  describe('loadMcpConfig', () => {
    it('should return null when config file does not exist', async () => {
      mockReadJsonFileAsync.mockResolvedValue(null);
      
      const { loadMcpConfig } = await import('./index.js');
      
      expect(await loadMcpConfig()).toBeNull();
    });
    
    it('should return config when file exists and is valid', async () => {
      const config = { serverUrl: 'http://localhost:6647', secret: 'test-secret' };
      mockReadJsonFileAsync.mockResolvedValue(config);
      
      vi.resetModules();
      const { loadMcpConfig } = await import('./index.js');
      
      expect(await loadMcpConfig()).toEqual(config);
    });
    
    it('should return null when config file is invalid JSON', async () => {
      // readJsonFileAsync returns the default value (null) on parse error
      mockReadJsonFileAsync.mockResolvedValue(null);
      
      vi.resetModules();
      const { loadMcpConfig } = await import('./index.js');
      
      expect(await loadMcpConfig()).toBeNull();
    });
  });
  
  describe('saveMcpConfig', () => {
    it('should create config directory if it does not exist', async () => {
      vi.resetModules();
      const { saveMcpConfig } = await import('./index.js');
      
      await saveMcpConfig({ serverUrl: 'http://localhost:6647', secret: 'test' });
      
      expect(mockEnsureDirectoryAsync).toHaveBeenCalledWith(CONFIG_DIR);
    });
    
    it('should write config to file', async () => {
      vi.resetModules();
      const { saveMcpConfig } = await import('./index.js');
      
      const config = { serverUrl: 'http://localhost:6647', secret: 'test' };
      await saveMcpConfig(config);
      
      expect(mockWriteFile).toHaveBeenCalledWith(
        CONFIG_FILE,
        JSON.stringify(config, null, 2)
      );
    });
  });
});

describe('MCP Tools', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    
    // loadMcpConfig returns a valid config by default
    mockReadJsonFileAsync.mockResolvedValue({
      serverUrl: 'http://localhost:6647',
      secret: 'test-secret',
    });
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });
  
  describe('openmgr_server_configure', () => {
    it('should save config on successful connection', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ok' }),
      });
      
      // loadMcpConfig not needed for configure, but saveMcpConfig will be called
      
      vi.resetModules();
      const { handleTool } = await import('./index.js');
      
      const result = await handleTool('openmgr_server_configure', {
        serverUrl: 'http://localhost:6647',
        secret: 'new-secret',
      });
      
      expect(JSON.parse(result)).toEqual({
        success: true,
        message: 'Configuration saved and connection verified',
      });
      expect(mockWriteFile).toHaveBeenCalled();
    });
    
    it('should throw on connection failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      
      vi.resetModules();
      const { handleTool } = await import('./index.js');
      
      await expect(handleTool('openmgr_server_configure', {
        serverUrl: 'http://localhost:6647',
        secret: 'test',
      })).rejects.toThrow('Failed to connect to server');
    });
  });
  
  describe('openmgr_server_get_config', () => {
    it('should return not configured when no config exists', async () => {
      mockReadJsonFileAsync.mockResolvedValue(null);
      
      vi.resetModules();
      const { handleTool } = await import('./index.js');
      
      const result = await handleTool('openmgr_server_get_config', {});
      
      expect(JSON.parse(result)).toEqual({
        configured: false,
        message: 'Not configured. Use openmgr_server_configure first.',
      });
    });
    
    it('should return server URL when configured', async () => {
      vi.resetModules();
      const { handleTool } = await import('./index.js');
      
      const result = await handleTool('openmgr_server_get_config', {});
      
      expect(JSON.parse(result)).toEqual({
        configured: true,
        serverUrl: 'http://localhost:6647',
      });
    });
  });
  
  describe('openmgr_server_status', () => {
    it('should return server info', async () => {
      const serverInfo = {
        version: '0.1.0',
        agentInstalled: true,
        agentVersion: '1.0.0',
        dataDir: '/data',
        workspacesDir: '/workspaces',
      };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => serverInfo,
      });
      
      vi.resetModules();
      const { handleTool } = await import('./index.js');
      
      const result = await handleTool('openmgr_server_status', {});
      
      expect(JSON.parse(result)).toEqual(serverInfo);
    });
    
    it('should throw when not configured', async () => {
      mockReadJsonFileAsync.mockResolvedValue(null);
      
      vi.resetModules();
      const { handleTool } = await import('./index.js');
      
      await expect(handleTool('openmgr_server_status', {}))
        .rejects.toThrow('Server not configured');
    });
  });
  
  describe('project tools', () => {
    it('openmgr_projects_list should list projects', async () => {
      const projects = [{ id: 'a1', name: 'Project 1' }];
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ projects }),
      });
      
      vi.resetModules();
      const { handleTool } = await import('./index.js');
      
      const result = await handleTool('openmgr_projects_list', {});
      
      expect(JSON.parse(result)).toEqual({ projects });
    });
    
    it('openmgr_projects_get should get project by id', async () => {
      const project = { id: 'a1', name: 'Project 1' };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => project,
      });
      
      vi.resetModules();
      const { handleTool } = await import('./index.js');
      
      const result = await handleTool('openmgr_projects_get', { projectId: 'a1' });
      
      expect(JSON.parse(result)).toEqual(project);
    });
    
    it('openmgr_projects_create should create project', async () => {
      const project = { id: 'a2', name: 'New Project' };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => project,
      });
      
      vi.resetModules();
      const { handleTool } = await import('./index.js');
      
      const result = await handleTool('openmgr_projects_create', { name: 'New Project' });
      
      expect(JSON.parse(result)).toEqual(project);
    });
    
    it('openmgr_projects_delete should delete project', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });
      
      vi.resetModules();
      const { handleTool } = await import('./index.js');
      
      const result = await handleTool('openmgr_projects_delete', { projectId: 'a1' });
      
      expect(JSON.parse(result)).toEqual({ success: true });
    });
  });
  
  describe('task tools', () => {
    it('openmgr_tasks_list should list tasks', async () => {
      const tasks = [{ id: 't1', name: 'Task 1' }];
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tasks }),
      });
      
      vi.resetModules();
      const { handleTool } = await import('./index.js');
      
      const result = await handleTool('openmgr_tasks_list', { projectId: 'a1' });
      
      expect(JSON.parse(result)).toEqual({ tasks });
    });
    
    it('openmgr_tasks_create should create task', async () => {
      const task = { id: 't2', name: 'New Task', prompt: 'Do it', cronSchedule: '0 9 * * *' };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => task,
      });
      
      vi.resetModules();
      const { handleTool } = await import('./index.js');
      
      const result = await handleTool('openmgr_tasks_create', {
        projectId: 'a1',
        name: 'New Task',
        prompt: 'Do it',
        cronSchedule: '0 9 * * *',
      });
      
      expect(JSON.parse(result)).toEqual(task);
    });
    
    it('openmgr_tasks_run should run task immediately', async () => {
      const run = { id: 'r1', status: 'running' };
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => run,
      });
      
      vi.resetModules();
      const { handleTool } = await import('./index.js');
      
      const result = await handleTool('openmgr_tasks_run', { projectId: 'a1', taskId: 't1' });
      
      expect(JSON.parse(result)).toEqual(run);
    });
  });
  
  describe('unknown tool', () => {
    it('should throw for unknown tool', async () => {
      vi.resetModules();
      const { handleTool } = await import('./index.js');
      
      await expect(handleTool('unknown_tool', {}))
        .rejects.toThrow('Unknown tool: unknown_tool');
    });
  });
});
