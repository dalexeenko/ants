#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { AntsServerClient } from './client.js';
import { ensureDirectoryAsync, readJsonFileAsync } from '../utils/fs.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('mcp');

const CONFIG_DIR = join(homedir(), '.config', 'ants-mcp');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

interface McpConfig {
  serverUrl: string;
  secret: string;
}

export async function loadMcpConfig(): Promise<McpConfig | null> {
  return readJsonFileAsync<McpConfig | null>(CONFIG_FILE, null);
}

export async function saveMcpConfig(config: McpConfig): Promise<void> {
  await ensureDirectoryAsync(CONFIG_DIR);
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

async function getClient(): Promise<AntsServerClient | null> {
  const config = await loadMcpConfig();
  if (!config) {
    return null;
  }
  return new AntsServerClient({
    baseUrl: config.serverUrl,
    secret: config.secret,
  });
}

const tools: Tool[] = [
  {
    name: 'ants_server_configure',
    description: 'Configure connection to @ants/server. Must be called first before using other tools.',
    inputSchema: {
      type: 'object',
      properties: {
        serverUrl: {
          type: 'string',
          description: 'URL of the @ants/server (e.g., http://localhost:6647)',
        },
        secret: {
          type: 'string',
          description: 'Bearer token secret for authentication',
        },
      },
      required: ['serverUrl', 'secret'],
    },
  },
  {
    name: 'ants_server_status',
    description: 'Get @ants/server status and info',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'ants_server_get_config',
    description: 'Get current MCP configuration (server URL)',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'ants_projects_list',
    description: 'List all agents on the server',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'ants_projects_get',
    description: 'Get details of a specific project',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'ants_projects_create',
    description: 'Create a new project',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name for the new project',
        },
        workingDirectory: {
          type: 'string',
          description: 'Working directory path (optional, will be created in workspaces dir)',
        },
        model: {
          type: 'string',
          description: 'Default model to use (e.g., "anthropic/claude-sonnet-4-20250514")',
        },
        systemPrompt: {
          type: 'string',
          description: 'Custom system prompt for the project',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'ants_projects_update',
    description: 'Update an existing project',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project to update',
        },
        name: {
          type: 'string',
          description: 'New name for the project',
        },
        model: {
          type: 'string',
          description: 'New default model',
        },
        systemPrompt: {
          type: 'string',
          description: 'New system prompt',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'ants_projects_delete',
    description: 'Delete an project',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project to delete',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'ants_projects_restart',
    description: 'Restart a project agent server',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project to restart',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'ants_tasks_list',
    description: 'List scheduled tasks for an project',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'ants_tasks_get',
    description: 'Get details of a scheduled task',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project',
        },
        taskId: {
          type: 'string',
          description: 'The ID of the task',
        },
      },
      required: ['projectId', 'taskId'],
    },
  },
  {
    name: 'ants_tasks_create',
    description: 'Create a new scheduled task for an project',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project',
        },
        name: {
          type: 'string',
          description: 'Name for the task',
        },
        prompt: {
          type: 'string',
          description: 'The prompt to send when the task runs',
        },
        cronSchedule: {
          type: 'string',
          description: 'Cron schedule (e.g., "0 9 * * *" for daily at 9am)',
        },
        enabled: {
          type: 'boolean',
          description: 'Whether the task is enabled (default: true)',
        },
        sessionMode: {
          type: 'string',
          enum: ['newEachRun', 'dedicatedSession'],
          description: 'Session mode: newEachRun creates a new session each time',
        },
        model: {
          type: 'string',
          description: 'Model to use for this task',
        },
      },
      required: ['projectId', 'name', 'prompt', 'cronSchedule'],
    },
  },
  {
    name: 'ants_tasks_update',
    description: 'Update a scheduled task',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project',
        },
        taskId: {
          type: 'string',
          description: 'The ID of the task to update',
        },
        name: {
          type: 'string',
          description: 'New name for the task',
        },
        prompt: {
          type: 'string',
          description: 'New prompt',
        },
        cronSchedule: {
          type: 'string',
          description: 'New cron schedule',
        },
        enabled: {
          type: 'boolean',
          description: 'Enable or disable the task',
        },
        sessionMode: {
          type: 'string',
          enum: ['newEachRun', 'dedicatedSession'],
          description: 'Session mode',
        },
        model: {
          type: 'string',
          description: 'Model to use',
        },
      },
      required: ['projectId', 'taskId'],
    },
  },
  {
    name: 'ants_tasks_delete',
    description: 'Delete a scheduled task',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project',
        },
        taskId: {
          type: 'string',
          description: 'The ID of the task to delete',
        },
      },
      required: ['projectId', 'taskId'],
    },
  },
  {
    name: 'ants_tasks_run',
    description: 'Run a scheduled task immediately (for testing)',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project',
        },
        taskId: {
          type: 'string',
          description: 'The ID of the task to run',
        },
      },
      required: ['projectId', 'taskId'],
    },
  },
  {
    name: 'ants_tasks_history',
    description: 'Get run history for a scheduled task',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project',
        },
        taskId: {
          type: 'string',
          description: 'The ID of the task',
        },
      },
      required: ['projectId', 'taskId'],
    },
  },
  {
    name: 'ants_providers_list',
    description: 'List all AI providers and their API key status',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'ants_providers_get',
    description: 'Get details of a specific provider',
    inputSchema: {
      type: 'object',
      properties: {
        providerId: {
          type: 'string',
          description: 'Provider ID (e.g., anthropic, openai, google)',
        },
      },
      required: ['providerId'],
    },
  },
  {
    name: 'ants_providers_set_api_key',
    description: 'Set or update API key for a provider. The key will be injected into the agent when it starts.',
    inputSchema: {
      type: 'object',
      properties: {
        providerId: {
          type: 'string',
          description: 'Provider ID (e.g., anthropic, openai, google)',
        },
        apiKey: {
          type: 'string',
          description: 'The API key for the provider',
        },
      },
      required: ['providerId', 'apiKey'],
    },
  },
  {
    name: 'ants_providers_remove_api_key',
    description: 'Remove API key for a provider',
    inputSchema: {
      type: 'object',
      properties: {
        providerId: {
          type: 'string',
          description: 'Provider ID (e.g., anthropic, openai, google)',
        },
      },
      required: ['providerId'],
    },
  },
  {
    name: 'ants_config_get',
    description: 'Get agent configuration for a project (.ants.json)',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'ants_config_set',
    description: 'Update agent configuration for a project. Writes to .ants.json in the project working directory.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project',
        },
        model: {
          type: 'string',
          description: 'Default model for the project (e.g., "anthropic/claude-sonnet-4-20250514")',
        },
        mcp: {
          type: 'object',
          description: 'MCP server configurations. Keys are server names, values are server configs.',
          additionalProperties: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: { type: 'string', enum: ['local', 'remote'] },
              command: { type: 'array', items: { type: 'string' } },
              url: { type: 'string' },
              enabled: { type: 'boolean' },
            },
          },
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'ants_system_disk',
    description: 'Get disk usage for data and workspaces directories',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'ants_system_info',
    description: 'Get server system info (uptime, memory usage, node version)',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'ants_system_cleanup',
    description: 'Clean up old agent sessions to free disk space',
    inputSchema: {
      type: 'object',
      properties: {
        olderThanDays: {
          type: 'number',
          description: 'Delete sessions older than this many days (default: 30)',
        },
      },
      required: [],
    },
  },
  {
    name: 'ants_agent_status',
    description: 'Check if the agent CLI is installed on the server and get its version',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'ants_agent_install',
    description: 'Install or update the agent CLI on the server. Required for projects to function.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'ants_files_list',
    description: 'List files and directories in a project\'s working directory',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project',
        },
        path: {
          type: 'string',
          description: 'Path relative to agent working directory (default: ".")',
        },
        showHidden: {
          type: 'boolean',
          description: 'Show hidden files (default: false)',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'ants_files_read',
    description: 'Read the contents of a file in a project\'s working directory',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project',
        },
        path: {
          type: 'string',
          description: 'Path to the file relative to agent working directory',
        },
      },
      required: ['projectId', 'path'],
    },
  },
  {
    name: 'ants_files_write',
    description: 'Write content to a file in a project\'s working directory',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project',
        },
        path: {
          type: 'string',
          description: 'Path to the file relative to agent working directory',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file',
        },
      },
      required: ['projectId', 'path', 'content'],
    },
  },
  {
    name: 'ants_files_delete',
    description: 'Delete a file or directory in a project\'s working directory',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project',
        },
        path: {
          type: 'string',
          description: 'Path to delete relative to agent working directory',
        },
        recursive: {
          type: 'boolean',
          description: 'Delete directories recursively (default: false)',
        },
      },
      required: ['projectId', 'path'],
    },
  },
  {
    name: 'ants_files_mkdir',
    description: 'Create a directory in a project\'s working directory',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project',
        },
        path: {
          type: 'string',
          description: 'Path to create relative to agent working directory',
        },
        recursive: {
          type: 'boolean',
          description: 'Create parent directories if needed (default: false)',
        },
      },
      required: ['projectId', 'path'],
    },
  },
  {
    name: 'ants_files_stat',
    description: 'Get file or directory metadata in a project\'s working directory',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project',
        },
        path: {
          type: 'string',
          description: 'Path to check relative to agent working directory',
        },
      },
      required: ['projectId', 'path'],
    },
  },
  {
    name: 'ants_terminals_list',
    description: 'List all terminal sessions for an project',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'ants_terminals_create',
    description: 'Create a new terminal session for an project',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project',
        },
        shell: {
          type: 'string',
          description: 'Shell to use (default: system default)',
        },
        workingDirectory: {
          type: 'string',
          description: 'Working directory for the terminal (default: agent working directory)',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'ants_terminals_get',
    description: 'Get information about a specific terminal session',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project',
        },
        sessionId: {
          type: 'string',
          description: 'The ID of the terminal session',
        },
      },
      required: ['projectId', 'sessionId'],
    },
  },
  {
    name: 'ants_terminals_delete',
    description: 'Delete/kill a terminal session',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project',
        },
        sessionId: {
          type: 'string',
          description: 'The ID of the terminal session',
        },
      },
      required: ['projectId', 'sessionId'],
    },
  },
  {
    name: 'ants_terminals_resize',
    description: 'Resize a terminal session',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The ID of the project',
        },
        sessionId: {
          type: 'string',
          description: 'The ID of the terminal session',
        },
        cols: {
          type: 'number',
          description: 'Number of columns',
        },
        rows: {
          type: 'number',
          description: 'Number of rows',
        },
      },
      required: ['projectId', 'sessionId', 'cols', 'rows'],
    },
  },
];

type ToolArgs = Record<string, unknown>;

export async function handleTool(name: string, args: ToolArgs): Promise<string> {
  if (name === 'ants_server_configure') {
    const serverUrl = args.serverUrl as string;
    const secret = args.secret as string;
    
    const tempClient = new AntsServerClient({ baseUrl: serverUrl, secret });
    try {
      await tempClient.health();
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      throw new Error(`Failed to connect to server: ${error}`);
    }
    
    await saveMcpConfig({ serverUrl, secret });
    return JSON.stringify({ success: true, message: 'Configuration saved and connection verified' });
  }
  
  if (name === 'ants_server_get_config') {
    const config = await loadMcpConfig();
    if (!config) {
      return JSON.stringify({ configured: false, message: 'Not configured. Use ants_server_configure first.' });
    }
    return JSON.stringify({ configured: true, serverUrl: config.serverUrl });
  }
  
  const client = await getClient();
  if (!client) {
    throw new Error('Server not configured. Use ants_server_configure first.');
  }
  
  switch (name) {
    case 'ants_server_status': {
      const info = await client.info();
      return JSON.stringify(info, null, 2);
    }
    
    case 'ants_projects_list': {
      const result = await client.listProjects();
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_projects_get': {
      const result = await client.getProject(args.projectId as string);
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_projects_create': {
      const result = await client.createProject({
        name: args.name as string,
        workingDirectory: args.workingDirectory as string | undefined,
        model: args.model as string | undefined,
        systemPrompt: args.systemPrompt as string | undefined,
      });
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_projects_update': {
      const result = await client.updateProject(args.projectId as string, {
        name: args.name as string | undefined,
        model: args.model as string | undefined,
        systemPrompt: args.systemPrompt as string | undefined,
      });
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_projects_delete': {
      const result = await client.deleteProject(args.projectId as string);
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_projects_restart': {
      const result = await client.restartProject(args.projectId as string);
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_tasks_list': {
      const result = await client.listTasks(args.projectId as string);
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_tasks_get': {
      const result = await client.getTask(args.projectId as string, args.taskId as string);
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_tasks_create': {
      const result = await client.createTask(args.projectId as string, {
        name: args.name as string,
        prompt: args.prompt as string,
        cronSchedule: args.cronSchedule as string,
        enabled: args.enabled as boolean | undefined,
        sessionMode: args.sessionMode as 'newEachRun' | 'dedicatedSession' | undefined,
        model: args.model as string | undefined,
      });
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_tasks_update': {
      const result = await client.updateTask(args.projectId as string, args.taskId as string, {
        name: args.name as string | undefined,
        prompt: args.prompt as string | undefined,
        cronSchedule: args.cronSchedule as string | undefined,
        enabled: args.enabled as boolean | undefined,
        sessionMode: args.sessionMode as 'newEachRun' | 'dedicatedSession' | undefined,
        model: args.model as string | undefined,
      });
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_tasks_delete': {
      const result = await client.deleteTask(args.projectId as string, args.taskId as string);
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_tasks_run': {
      const result = await client.runTask(args.projectId as string, args.taskId as string);
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_tasks_history': {
      const result = await client.getTaskHistory(args.projectId as string, args.taskId as string);
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_providers_list': {
      const result = await client.listProviders();
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_providers_get': {
      const result = await client.getProvider(args.providerId as string);
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_providers_set_api_key': {
      const result = await client.setProviderApiKey(args.providerId as string, args.apiKey as string);
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_providers_remove_api_key': {
      const result = await client.removeProviderApiKey(args.providerId as string);
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_config_get': {
      const result = await client.getProjectConfig(args.projectId as string);
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_config_set': {
      const config: Record<string, unknown> = {};
      if (args.model !== undefined) {
        config.model = args.model;
      }
      if (args.mcp !== undefined) {
        config.mcp = args.mcp;
      }
      const result = await client.updateProjectConfig(args.projectId as string, config);
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_system_disk': {
      const result = await client.getDiskUsage();
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_system_info': {
      const result = await client.getSystemInfo();
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_system_cleanup': {
      const result = await client.cleanupSessions(args.olderThanDays as number | undefined);
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_agent_status': {
      const result = await client.getAgentStatus();
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_agent_install': {
      const result = await client.installAgent();
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_files_list': {
      const result = await client.listFiles(
        args.projectId as string,
        args.path as string | undefined,
        args.showHidden as boolean | undefined
      );
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_files_read': {
      const result = await client.readFile(args.projectId as string, args.path as string);
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_files_write': {
      const result = await client.writeFile(
        args.projectId as string,
        args.path as string,
        args.content as string
      );
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_files_delete': {
      const result = await client.deleteFile(
        args.projectId as string,
        args.path as string,
        args.recursive as boolean | undefined
      );
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_files_mkdir': {
      const result = await client.createDirectory(
        args.projectId as string,
        args.path as string,
        args.recursive as boolean | undefined
      );
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_files_stat': {
      const result = await client.getFileStat(args.projectId as string, args.path as string);
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_terminals_list': {
      const result = await client.listTerminals(args.projectId as string);
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_terminals_create': {
      const result = await client.createTerminal(
        args.projectId as string,
        args.shell as string | undefined,
        args.workingDirectory as string | undefined
      );
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_terminals_get': {
      const result = await client.getTerminal(args.projectId as string, args.sessionId as string);
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_terminals_delete': {
      const result = await client.deleteTerminal(args.projectId as string, args.sessionId as string);
      return JSON.stringify(result, null, 2);
    }
    
    case 'ants_terminals_resize': {
      const result = await client.resizeTerminal(
        args.projectId as string,
        args.sessionId as string,
        args.cols as number,
        args.rows as number
      );
      return JSON.stringify(result, null, 2);
    }
    
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function main(): Promise<void> {
  const server = new Server(
    {
      name: 'ants-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    
    try {
      const result = await handleTool(name, (args as ToolArgs) || {});
      return {
        content: [{ type: 'text', text: result }],
      };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: 'text', text: `Error: ${error}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('ants-mcp started');
}

main().catch((error) => {
  log.error('Fatal error:', error);
  process.exit(1);
});
