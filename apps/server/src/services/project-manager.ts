import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import type { ServerConfig } from '../config.js';
import type { ProjectConfig, CreateProjectRequest, UpdateProjectRequest, AgentConfig } from '../models/project.js';
import { OpenMgrAgentManager, type IAgentClient } from './openmgr-agent-manager.js';
import type { PluginRegistry } from './plugin-registry.js';
import type { DrizzleDB } from '../db/index.js';
import { projects } from '../db/schema.js';
import { ensureDirectoryAsync, pathExists } from '../utils/fs.js';
import { isGitRepo } from '../utils/git.js';

export class ProjectManager {
  private config: ServerConfig;
  private agentManager: OpenMgrAgentManager;
  private pluginRegistry?: PluginRegistry;
  private db: DrizzleDB;
  
  constructor(config: ServerConfig, agentManager: OpenMgrAgentManager, db: DrizzleDB) {
    this.config = config;
    this.agentManager = agentManager;
    this.db = db;
  }

  /** Set the plugin registry (called after construction to avoid circular deps). */
  setPluginRegistry(pluginRegistry: PluginRegistry): void {
    this.pluginRegistry = pluginRegistry;
  }

  /**
   * Returns the agent config augmented with the effective plugin list for a project.
   */
  private getAgentConfigWithPlugins(projectId: string, agentConfig?: AgentConfig): AgentConfig | undefined {
    if (!this.pluginRegistry) return agentConfig;

    const pluginSpecs = this.pluginRegistry.getEffectivePluginsForProject(projectId);
    if (pluginSpecs.length === 0) return agentConfig;

    return {
      ...(agentConfig || {}),
      plugins: pluginSpecs.map((p) => p.packageSpec),
    };
  }
  
  private rowToProject(row: typeof projects.$inferSelect): ProjectConfig {
    return {
      id: row.id,
      name: row.name,
      workingDirectory: row.workingDirectory,
      autoStart: row.autoStart,
      worktreeEnabled: row.worktreeEnabled ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      serverPort: this.agentManager.getServerPort(row.workingDirectory),
      agentConfig: row.agentConfig ? JSON.parse(row.agentConfig) : undefined,
    };
  }

  async listProjects(): Promise<ProjectConfig[]> {
    const rows = this.db.select().from(projects).all();
    
    const projectConfigs = rows
      .map(row => this.rowToProject(row))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Detect git repo status for each project in parallel
    await Promise.all(projectConfigs.map(async (p) => {
      try {
        p.isGitRepo = await isGitRepo(p.workingDirectory);
      } catch {
        p.isGitRepo = false;
      }
    }));

    return projectConfigs;
  }
  
  async getProject(id: string): Promise<ProjectConfig | null> {
    const rows = this.db.select().from(projects).where(eq(projects.id, id)).all();
    
    if (rows.length === 0) {
      return null;
    }
    
    const project = this.rowToProject(rows[0]);
    try {
      project.isGitRepo = await isGitRepo(project.workingDirectory);
    } catch {
      project.isGitRepo = false;
    }
    return project;
  }
  
  private sanitizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
  
  async createProject(request: CreateProjectRequest, createdBy?: string): Promise<ProjectConfig> {
    const id = uuidv4();
    const workingDirectory = (request.workingDirectory && request.workingDirectory.trim() !== '') 
      ? request.workingDirectory 
      : join(this.config.workspacesDir, this.sanitizeName(request.name));
    
    await ensureDirectoryAsync(workingDirectory);
    
    const now = new Date();
    
    this.db.insert(projects).values({
      id,
      name: request.name,
      workingDirectory,
      autoStart: request.autoStart ?? true,
      agentConfig: request.agentConfig ? JSON.stringify(request.agentConfig) : null,
      createdBy: createdBy || null,
      createdAt: now,
      updatedAt: now,
    }).run();
    
    if (request.agentConfig) {
      await this.agentManager.writeAgentConfig(workingDirectory, request.agentConfig);
    }
    
    return {
      id,
      name: request.name,
      workingDirectory,
      autoStart: request.autoStart ?? true,
      defaultModel: request.defaultModel,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      agentConfig: request.agentConfig,
    };
  }
  
  async updateProject(id: string, updates: UpdateProjectRequest): Promise<ProjectConfig | null> {
    const project = await this.getProject(id);
    if (!project) {
      return null;
    }
    
    const now = new Date();
    const updateData: Partial<typeof projects.$inferInsert> = {
      updatedAt: now,
    };
    
    if (updates.name !== undefined) {
      updateData.name = updates.name;
      project.name = updates.name;
    }
    if (updates.autoStart !== undefined) {
      updateData.autoStart = updates.autoStart;
      project.autoStart = updates.autoStart;
    }
    
    if (updates.worktreeEnabled !== undefined) {
      updateData.worktreeEnabled = updates.worktreeEnabled;
      project.worktreeEnabled = updates.worktreeEnabled;
    }
    if (updates.agentConfig !== undefined) {
      updateData.agentConfig = JSON.stringify(updates.agentConfig);
      await this.agentManager.writeAgentConfig(project.workingDirectory, updates.agentConfig);
      project.agentConfig = updates.agentConfig;
    }
    if (updates.defaultModel !== undefined) {
      project.defaultModel = updates.defaultModel;
    }
    
    this.db.update(projects).set(updateData).where(eq(projects.id, id)).run();
    
    project.updatedAt = now.toISOString();
    project.serverPort = this.agentManager.getServerPort(project.workingDirectory);
    
    return project;
  }
  
  async deleteProject(id: string): Promise<boolean> {
    const project = await this.getProject(id);
    if (!project) {
      return false;
    }
    
    await this.agentManager.stopServer(project.workingDirectory);
    
    this.db.delete(projects).where(eq(projects.id, id)).run();
    
    return true;
  }
  
  async workspaceExists(path: string): Promise<boolean> {
    return pathExists(path);
  }
  
  async getAgentConfig(projectId: string): Promise<AgentConfig | null> {
    const project = await this.getProject(projectId);
    if (!project) {
      return null;
    }
    
    return await this.agentManager.readAgentConfig(project.workingDirectory) || {};
  }
  
  async updateAgentConfig(projectId: string, config: AgentConfig): Promise<boolean> {
    const project = await this.getProject(projectId);
    if (!project) {
      return false;
    }
    
    await this.agentManager.writeAgentConfig(project.workingDirectory, config);
    
    this.db.update(projects).set({ 
      agentConfig: JSON.stringify(config),
      updatedAt: new Date() 
    }).where(eq(projects.id, projectId)).run();
    
    return true;
  }
  
  async getClient(projectId: string): Promise<IAgentClient | null> {
    const project = await this.getProject(projectId);
    if (!project) {
      return null;
    }
    
    const config = this.getAgentConfigWithPlugins(projectId, project.agentConfig);
    return this.agentManager.ensureServerRunning(project.workingDirectory, config);
  }
  
  async restartServer(projectId: string): Promise<{ port: number; pid: number } | null> {
    const project = await this.getProject(projectId);
    if (!project) {
      return null;
    }
    
    const config = this.getAgentConfigWithPlugins(projectId, project.agentConfig);
    return this.agentManager.restartServer(project.workingDirectory, config);
  }
}
