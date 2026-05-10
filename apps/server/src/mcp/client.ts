export interface ClientConfig {
  baseUrl: string;
  secret: string;
}

export interface Project {
  id: string;
  name: string;
  workingDirectory: string;
  model?: string;
  systemPrompt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectRequest {
  name: string;
  workingDirectory?: string;
  model?: string;
  systemPrompt?: string;
}

export interface UpdateProjectRequest {
  name?: string;
  model?: string;
  systemPrompt?: string;
}

export interface ScheduledTask {
  id: string;
  projectId: string;
  name: string;
  prompt: string;
  cronSchedule: string;
  enabled: boolean;
  sessionMode: 'newEachRun' | 'dedicatedSession';
  dedicatedSessionId?: string;
  model?: string;
  lastRun?: string;
  nextRun?: string;
  runHistory: TaskRun[];
  webhooks?: TaskWebhook[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskRun {
  id: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed';
  sessionId?: string;
  error?: string;
}

export interface TaskWebhook {
  url: string;
  events: ('start' | 'complete' | 'fail')[];
  secret?: string;
}

export interface CreateTaskRequest {
  name: string;
  prompt: string;
  cronSchedule: string;
  enabled?: boolean;
  sessionMode?: 'newEachRun' | 'dedicatedSession';
  model?: string;
  webhooks?: TaskWebhook[];
}

export interface UpdateTaskRequest {
  name?: string;
  prompt?: string;
  cronSchedule?: string;
  enabled?: boolean;
  sessionMode?: 'newEachRun' | 'dedicatedSession';
  model?: string;
  webhooks?: TaskWebhook[];
}

export interface ServerInfo {
  version: string;
  dataDir: string;
  workspacesDir: string;
}

export interface ProviderInfo {
  providerId: string;
  name: string;
  hasApiKey: boolean;
  envVar: string;
  createdAt?: string;
  updatedAt?: string;
}

import type { McpServerConfig } from '../models/project.js';

export type { McpServerConfig };

export interface AgentConfig {
  model?: string;
  mcp?: Record<string, McpServerConfig>;
}

export interface DiskUsage {
  dataDir: { path: string; sizeBytes: number; sizeHuman: string };
  workspacesDir: { path: string; sizeBytes: number; sizeHuman: string };
  total: { sizeBytes: number; sizeHuman: string };
}

export interface SystemInfo {
  uptimeSeconds: number;
  uptimeHuman: string;
  memoryUsage: NodeJS.MemoryUsage;
  nodeVersion: string;
  platform: string;
  arch: string;
}

export interface CleanupResult {
  deletedSessions: number;
  freedBytes: number;
  freedHuman: string;
  olderThanDays: number;
}

export interface AgentStatus {
  installed: boolean;
  version: string | null;
  path: string | null;
}

export interface AgentInstallResult {
  success: boolean;
  message: string;
  version?: string;
  error?: string;
}

export interface FileInfo {
  name: string;
  path: string;
  absolutePath: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink: boolean;
  size: number;
  mtime: string;
  ctime: string;
  mode: number;
  isHidden: boolean;
  isIgnored: boolean;
  extension: string | null;
}

export interface FileListResponse {
  path: {
    current: string;
    parent: string | null;
    absolute: string;
    relative: string;
  };
  files: FileInfo[];
  total: number;
  directories: number;
  regularFiles: number;
}

export interface FileContentResponse {
  content: string;
  path: string;
  name: string;
}

export interface FileWriteResponse {
  success: boolean;
  path: string;
  size: number;
  mtime: string;
}

export interface FileStatResponse {
  path: string;
  absolutePath: string;
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink: boolean;
  size: number;
  mtime: string;
  ctime: string;
  atime: string;
  mode: number;
  uid: number;
  gid: number;
  extension: string | null;
}

export interface TerminalSession {
  id: string;
  projectId: string;
  workingDirectory: string;
  createdAt: string;
  lastActivity: string;
}

export interface TerminalListResponse {
  sessions: TerminalSession[];
}

export interface TerminalCreateResponse {
  sessionId: string;
  projectId: string;
  workingDirectory: string;
  createdAt: string;
}

export class OpenMgrServerClient {
  constructor(private config: ClientConfig) {}
  
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.config.secret}`,
      'Content-Type': 'application/json',
    };
    
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    
    if (!response.ok) {
      const text = await response.text();
      let errorMessage: string;
      try {
        const json = JSON.parse(text);
        errorMessage = json.error || text;
      } catch {
        errorMessage = text;
      }
      throw new Error(`HTTP ${response.status}: ${errorMessage}`);
    }
    
    return response.json() as Promise<T>;
  }
  
  async health(): Promise<{ status: string }> {
    return this.request('GET', '/health');
  }
  
  async info(): Promise<ServerInfo> {
    return this.request('GET', '/info');
  }
  
  async listProjects(): Promise<{ projects: Project[] }> {
    return this.request('GET', '/projects');
  }
  
  async getProject(id: string): Promise<Project> {
    return this.request('GET', `/projects/${id}`);
  }
  
  async createProject(data: CreateProjectRequest): Promise<Project> {
    return this.request('POST', '/projects', data);
  }
  
  async updateProject(id: string, data: UpdateProjectRequest): Promise<Project> {
    return this.request('PATCH', `/projects/${id}`, data);
  }
  
  async deleteProject(id: string): Promise<{ success: boolean }> {
    return this.request('DELETE', `/projects/${id}`);
  }
  
  async restartProject(id: string): Promise<{ port: number; pid: number }> {
    return this.request('POST', `/projects/${id}/restart`);
  }
  
  async listTasks(projectId: string): Promise<{ tasks: ScheduledTask[] }> {
    return this.request('GET', `/projects/${projectId}/tasks`);
  }
  
  async getTask(projectId: string, taskId: string): Promise<ScheduledTask> {
    return this.request('GET', `/projects/${projectId}/tasks/${taskId}`);
  }
  
  async createTask(projectId: string, data: CreateTaskRequest): Promise<ScheduledTask> {
    return this.request('POST', `/projects/${projectId}/tasks`, data);
  }
  
  async updateTask(projectId: string, taskId: string, data: UpdateTaskRequest): Promise<ScheduledTask> {
    return this.request('PATCH', `/projects/${projectId}/tasks/${taskId}`, data);
  }
  
  async deleteTask(projectId: string, taskId: string): Promise<{ success: boolean }> {
    return this.request('DELETE', `/projects/${projectId}/tasks/${taskId}`);
  }
  
  async runTask(projectId: string, taskId: string): Promise<TaskRun> {
    return this.request('POST', `/projects/${projectId}/tasks/${taskId}/run`);
  }
  
  async getTaskHistory(projectId: string, taskId: string): Promise<{ history: TaskRun[] }> {
    return this.request('GET', `/projects/${projectId}/tasks/${taskId}/history`);
  }
  
  async listProviders(): Promise<{ providers: ProviderInfo[] }> {
    return this.request('GET', '/providers');
  }
  
  async getProvider(providerId: string): Promise<ProviderInfo> {
    return this.request('GET', `/providers/${providerId}`);
  }
  
  async setProviderApiKey(providerId: string, apiKey: string): Promise<ProviderInfo> {
    return this.request('PUT', `/providers/${providerId}`, { apiKey });
  }
  
  async removeProviderApiKey(providerId: string): Promise<{ success: boolean }> {
    return this.request('DELETE', `/providers/${providerId}`);
  }
  
  async getProjectConfig(projectId: string): Promise<AgentConfig> {
    return this.request('GET', `/projects/${projectId}/config`);
  }
  
  async updateProjectConfig(projectId: string, config: AgentConfig): Promise<{ success: boolean }> {
    return this.request('PUT', `/projects/${projectId}/config`, config);
  }
  
  async getDiskUsage(): Promise<DiskUsage> {
    return this.request('GET', '/system/disk');
  }
  
  async getSystemInfo(): Promise<SystemInfo> {
    return this.request('GET', '/system/uptime');
  }
  
  async cleanupSessions(olderThanDays?: number): Promise<CleanupResult> {
    return this.request('POST', '/system/cleanup/sessions', olderThanDays ? { olderThanDays } : {});
  }
  
  async getAgentStatus(): Promise<AgentStatus> {
    return this.request('GET', '/system/agent');
  }
  
  async installAgent(): Promise<AgentInstallResult> {
    return this.request('POST', '/system/agent/install');
  }
  
  async listFiles(projectId: string, path?: string, showHidden?: boolean): Promise<FileListResponse> {
    const params = new URLSearchParams();
    if (path) params.set('path', path);
    if (showHidden) params.set('showHidden', 'true');
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request('GET', `/projects/${projectId}/files${query}`);
  }
  
  async readFile(projectId: string, path: string): Promise<FileContentResponse> {
    const params = new URLSearchParams({ path });
    return this.request('GET', `/projects/${projectId}/files/content?${params.toString()}`);
  }
  
  async writeFile(projectId: string, path: string, content: string): Promise<FileWriteResponse> {
    const params = new URLSearchParams({ path });
    return this.request('PUT', `/projects/${projectId}/files/content?${params.toString()}`, { content });
  }
  
  async deleteFile(projectId: string, path: string, recursive?: boolean): Promise<{ success: boolean; path: string }> {
    const params = new URLSearchParams({ path });
    if (recursive) params.set('recursive', 'true');
    return this.request('DELETE', `/projects/${projectId}/files?${params.toString()}`);
  }
  
  async createDirectory(projectId: string, path: string, recursive?: boolean): Promise<{ success: boolean; path: string; absolutePath: string; created: string }> {
    return this.request('POST', `/projects/${projectId}/files/directory`, { path, recursive });
  }
  
  async getFileStat(projectId: string, path: string): Promise<FileStatResponse> {
    const params = new URLSearchParams({ path });
    return this.request('GET', `/projects/${projectId}/files/stat?${params.toString()}`);
  }
  
  async listTerminals(projectId: string): Promise<TerminalListResponse> {
    return this.request('GET', `/projects/${projectId}/terminals`);
  }
  
  async createTerminal(projectId: string, shell?: string, workingDirectory?: string): Promise<TerminalCreateResponse> {
    const body: any = {};
    if (shell) body.shell = shell;
    if (workingDirectory) body.workingDirectory = workingDirectory;
    return this.request('POST', `/projects/${projectId}/terminals`, body);
  }
  
  async getTerminal(projectId: string, sessionId: string): Promise<TerminalSession> {
    return this.request('GET', `/projects/${projectId}/terminals/${sessionId}`);
  }
  
  async deleteTerminal(projectId: string, sessionId: string): Promise<{ success: boolean }> {
    return this.request('DELETE', `/projects/${projectId}/terminals/${sessionId}`);
  }
  
  async resizeTerminal(projectId: string, sessionId: string, cols: number, rows: number): Promise<{ success: boolean }> {
    return this.request('POST', `/projects/${projectId}/terminals/${sessionId}/resize`, { cols, rows });
  }
}
