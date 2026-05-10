/**
 * Template Manager
 * Manages project templates including built-in templates,
 * local custom templates, and templates synced from the Hub.
 */

import { eq, desc } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { projectTemplates } from '../db/schema.js';
import type { DrizzleDB } from '../db/index.js';
import type { ProjectManager } from './project-manager.js';
import { execFile } from 'child_process';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { promisify } from 'util';
import { pathExists } from '../utils/fs.js';

const execFileAsync = promisify(execFile);

export interface TemplateConfig {
  name: string;
  slug: string;
  description?: string;
  category?: string;
  agentConfig?: {
    provider?: string;
    model?: string;
    systemPrompt?: string;
  };
  skills?: string[];
  mcpServers?: Record<string, unknown>;
  tools?: Record<string, unknown>;
  promptTemplate?: string;
  setupCommands?: string[];
  fileTemplates?: Record<string, string>;
  /** Which built-in agent type to set as the project's root agent */
  rootAgentType?: string;
  /** Agent type names to include in the project config (from builtin registry) */
  agentTypes?: string[];
}

// Built-in templates
const BUILTIN_TEMPLATES: TemplateConfig[] = [
  {
    name: 'React Application',
    slug: 'react-app',
    description: 'A React application with testing and build tools configured',
    category: 'web',
    agentConfig: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      systemPrompt: 'You are a React developer. Help build and maintain this React application. Use TypeScript, follow React best practices, and write tests.',
    },
    skills: ['code-review', 'test-writing', 'refactor'],
    setupCommands: ['npm create vite@latest . -- --template react-ts', 'npm install'],
    promptTemplate: 'The project has been scaffolded with Vite + React + TypeScript. Review the structure and suggest any initial improvements.',
    rootAgentType: 'general-code',
    agentTypes: ['general-code', 'explore-code', 'code-review', 'code-test', 'code-refactor'],
  },
  {
    name: 'Node.js API',
    slug: 'node-api',
    description: 'A Node.js REST API service with testing configured',
    category: 'api',
    agentConfig: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      systemPrompt: 'You are a backend developer. Help build and maintain this Node.js API service. Use TypeScript, write tests, and follow REST best practices.',
    },
    skills: ['code-review', 'test-writing', 'security-review'],
    setupCommands: ['npm init -y', 'npm install typescript @types/node hono', 'npx tsc --init'],
    promptTemplate: 'The project has been initialized as a Node.js TypeScript API. Set up a basic Hono server with health check endpoint.',
    rootAgentType: 'general-code',
    agentTypes: ['general-code', 'explore-code', 'code-review', 'code-test', 'code-debug'],
  },
  {
    name: 'Python Project',
    slug: 'python-project',
    description: 'A Python project with virtual environment and testing',
    category: 'other',
    agentConfig: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      systemPrompt: 'You are a Python developer. Help build and maintain this Python project. Follow PEP 8, write tests with pytest, and use type hints.',
    },
    skills: ['code-review', 'test-writing', 'documentation'],
    setupCommands: ['python3 -m venv .venv', 'pip install pytest'],
    promptTemplate: 'The project has been set up with a Python virtual environment and pytest. Create an initial project structure.',
    rootAgentType: 'general-code',
    agentTypes: ['general-code', 'explore-code', 'code-review', 'code-test'],
  },
  {
    name: 'Full-Stack Application',
    slug: 'fullstack-app',
    description: 'A full-stack application with React frontend and Node.js backend',
    category: 'web',
    agentConfig: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      systemPrompt: 'You are a full-stack developer. Help build and maintain this application with a React frontend and Node.js backend. Use TypeScript throughout.',
    },
    skills: ['code-review', 'test-writing', 'refactor', 'security-review'],
    fileTemplates: {
      'README.md': '# Full-Stack Application\n\nFrontend: React + TypeScript\nBackend: Node.js + Hono\n',
    },
    promptTemplate: 'Set up a monorepo with a React frontend (Vite) and Node.js backend (Hono). Create the initial project structure with shared types.',
    rootAgentType: 'general-code',
    agentTypes: ['general-code', 'explore-code', 'code-review', 'code-test', 'code-refactor', 'code-debug'],
  },
  {
    name: 'CLI Tool',
    slug: 'cli-tool',
    description: 'A command-line tool built with Node.js',
    category: 'cli',
    agentConfig: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      systemPrompt: 'You are building a CLI tool. Use TypeScript, commander.js for argument parsing, and provide helpful error messages.',
    },
    skills: ['code-review', 'test-writing', 'documentation'],
    setupCommands: ['npm init -y', 'npm install typescript commander', 'npx tsc --init'],
    promptTemplate: 'Set up a CLI tool structure with commander.js. Create the main entry point and a sample command.',
    rootAgentType: 'general-code',
    agentTypes: ['general-code', 'explore-code', 'code-review', 'code-test'],
  },
  {
    name: 'DevOps Automation',
    slug: 'devops-automation',
    description: 'DevOps automation scripts and infrastructure management',
    category: 'devops',
    agentConfig: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      systemPrompt: 'You are a DevOps engineer. Help manage infrastructure, write automation scripts, and maintain CI/CD pipelines. Focus on reliability and security.',
    },
    skills: ['security-review', 'documentation'],
    promptTemplate: 'Set up a basic DevOps project structure with directories for scripts, configs, and documentation.',
    rootAgentType: 'general-code',
    agentTypes: ['general-code', 'explore-code', 'files-root', 'files-analyzer', 'files-organizer'],
  },
  {
    name: 'Blank Project',
    slug: 'blank',
    description: 'An empty project with default configuration',
    category: 'other',
  },
];

export class TemplateManager {
  private db: DrizzleDB;
  private projectManager: ProjectManager;

  constructor(db: DrizzleDB, projectManager: ProjectManager) {
    this.db = db;
    this.projectManager = projectManager;
  }

  /**
   * Ensure built-in templates exist in the database
   */
  ensureBuiltinTemplates(): void {
    for (const tmpl of BUILTIN_TEMPLATES) {
      const existing = this.db.select()
        .from(projectTemplates)
        .where(eq(projectTemplates.slug, tmpl.slug))
        .get();

      if (!existing) {
        this.db.insert(projectTemplates).values({
          id: uuid(),
          name: tmpl.name,
          slug: tmpl.slug,
          description: tmpl.description ?? null,
          category: tmpl.category ?? null,
          agentConfig: tmpl.agentConfig ? JSON.stringify(tmpl.agentConfig) : null,
          skills: tmpl.skills ? JSON.stringify(tmpl.skills) : null,
          mcpServers: tmpl.mcpServers ? JSON.stringify(tmpl.mcpServers) : null,
          tools: tmpl.tools ? JSON.stringify(tmpl.tools) : null,
          promptTemplate: tmpl.promptTemplate ?? null,
          setupCommands: tmpl.setupCommands ? JSON.stringify(tmpl.setupCommands) : null,
          fileTemplates: tmpl.fileTemplates ? JSON.stringify(tmpl.fileTemplates) : null,
          rootAgentType: tmpl.rootAgentType ?? null,
          agentTypes: tmpl.agentTypes ? JSON.stringify(tmpl.agentTypes) : null,
          source: 'builtin',
          createdAt: new Date(),
          updatedAt: new Date(),
        }).run();
      }
    }
  }

  /**
   * List all templates
   */
  listTemplates(category?: string): unknown[] {
    if (category) {
      return this.db.select()
        .from(projectTemplates)
        .where(eq(projectTemplates.category, category))
        .orderBy(projectTemplates.name)
        .all();
    }
    return this.db.select()
      .from(projectTemplates)
      .orderBy(projectTemplates.name)
      .all();
  }

  /**
   * Get a template by ID or slug
   */
  getTemplate(idOrSlug: string): unknown {
    return this.db.select()
      .from(projectTemplates)
      .where(eq(projectTemplates.id, idOrSlug))
      .get() || this.db.select()
      .from(projectTemplates)
      .where(eq(projectTemplates.slug, idOrSlug))
      .get();
  }

  /**
   * Create a custom template
   */
  createTemplate(input: TemplateConfig, createdBy?: string): unknown {
    const id = uuid();
    const now = new Date();

    this.db.insert(projectTemplates).values({
      id,
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      category: input.category ?? null,
      agentConfig: input.agentConfig ? JSON.stringify(input.agentConfig) : null,
      skills: input.skills ? JSON.stringify(input.skills) : null,
      mcpServers: input.mcpServers ? JSON.stringify(input.mcpServers) : null,
      tools: input.tools ? JSON.stringify(input.tools) : null,
      promptTemplate: input.promptTemplate ?? null,
      setupCommands: input.setupCommands ? JSON.stringify(input.setupCommands) : null,
      fileTemplates: input.fileTemplates ? JSON.stringify(input.fileTemplates) : null,
      rootAgentType: input.rootAgentType ?? null,
      agentTypes: input.agentTypes ? JSON.stringify(input.agentTypes) : null,
      source: 'local',
      createdBy: createdBy || null,
      createdAt: now,
      updatedAt: now,
    }).run();

    return this.getTemplate(id);
  }

  /**
   * Update a template
   */
  updateTemplate(id: string, updates: Partial<TemplateConfig>): unknown {
    const existing = this.db.select()
      .from(projectTemplates)
      .where(eq(projectTemplates.id, id))
      .get();

    if (!existing) return null;

    const setValues: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.name !== undefined) setValues.name = updates.name;
    if (updates.description !== undefined) setValues.description = updates.description;
    if (updates.category !== undefined) setValues.category = updates.category;
    if (updates.agentConfig !== undefined) setValues.agentConfig = JSON.stringify(updates.agentConfig);
    if (updates.skills !== undefined) setValues.skills = JSON.stringify(updates.skills);
    if (updates.mcpServers !== undefined) setValues.mcpServers = JSON.stringify(updates.mcpServers);
    if (updates.tools !== undefined) setValues.tools = JSON.stringify(updates.tools);
    if (updates.promptTemplate !== undefined) setValues.promptTemplate = updates.promptTemplate;
    if (updates.setupCommands !== undefined) setValues.setupCommands = JSON.stringify(updates.setupCommands);
    if (updates.fileTemplates !== undefined) setValues.fileTemplates = JSON.stringify(updates.fileTemplates);
    if (updates.rootAgentType !== undefined) setValues.rootAgentType = updates.rootAgentType;
    if (updates.agentTypes !== undefined) setValues.agentTypes = JSON.stringify(updates.agentTypes);

    this.db.update(projectTemplates)
      .set(setValues)
      .where(eq(projectTemplates.id, id))
      .run();

    return this.getTemplate(id);
  }

  /**
   * Delete a template
   */
  deleteTemplate(id: string): boolean {
    const result = this.db.delete(projectTemplates)
      .where(eq(projectTemplates.id, id))
      .run();
    return result.changes > 0;
  }

  /**
   * Create a project from a template
   */
  async createProjectFromTemplate(
    templateIdOrSlug: string,
    projectName: string,
    workingDirectory: string,
    createdBy?: string,
  ): Promise<{ project: unknown; setupLog: string[] }> {
    const template = this.getTemplate(templateIdOrSlug) as any;
    if (!template) {
      throw new Error('Template not found');
    }

    const setupLog: string[] = [];

    // Ensure working directory exists
    if (!await pathExists(workingDirectory)) {
      await mkdir(workingDirectory, { recursive: true });
      setupLog.push(`Created directory: ${workingDirectory}`);
    }

    // Create file templates
    if (template.fileTemplates) {
      const files = JSON.parse(template.fileTemplates) as Record<string, string>;
      for (const [filePath, content] of Object.entries(files)) {
        const fullPath = join(workingDirectory, filePath);
        const dir = dirname(fullPath);
        if (!await pathExists(dir)) {
          await mkdir(dir, { recursive: true });
        }
        await writeFile(fullPath, content);
        setupLog.push(`Created file: ${filePath}`);
      }
    }

    // Run setup commands
    if (template.setupCommands) {
      const commands = JSON.parse(template.setupCommands) as string[];
      for (const cmd of commands) {
        try {
          setupLog.push(`Running: ${cmd}`);
          // Use shell execution for setup commands since they may use shell features
          await execFileAsync('bash', ['-c', cmd], { cwd: workingDirectory, timeout: 60000 });
          setupLog.push(`  Success`);
        } catch (error) {
          setupLog.push(`  Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }

    // Parse agent config
    let agentConfig;
    if (template.agentConfig) {
      agentConfig = JSON.parse(template.agentConfig);
    }

    // Write .openmgr.json config with rootAgentType and agentTypes if specified
    const openmgrConfig: Record<string, unknown> = {};
    if (template.rootAgentType) {
      openmgrConfig.rootAgentType = template.rootAgentType;
    }
    if (template.agentTypes) {
      const agentTypeNames = typeof template.agentTypes === 'string'
        ? JSON.parse(template.agentTypes) as string[]
        : template.agentTypes;
      if (agentTypeNames.length > 0) {
        openmgrConfig.agentTypes = agentTypeNames;
      }
    }
    if (Object.keys(openmgrConfig).length > 0) {
      const configPath = join(workingDirectory, '.openmgr.json');
      // Merge with existing config if present
      let existingConfig: Record<string, unknown> = {};
      try {
        if (await pathExists(configPath)) {
          existingConfig = JSON.parse(await readFile(configPath, 'utf-8'));
        }
      } catch {
        // Ignore parse errors
      }
      const mergedConfig = { ...existingConfig, ...openmgrConfig };
      await writeFile(configPath, JSON.stringify(mergedConfig, null, 2) + '\n');
      setupLog.push(`Wrote .openmgr.json with rootAgentType=${openmgrConfig.rootAgentType ?? 'default'}, agentTypes=${(openmgrConfig.agentTypes as string[] || []).join(', ')}`);
    }

    // Create the project
    const project = await this.projectManager.createProject({
      name: projectName,
      workingDirectory,
      agentConfig,
    }, createdBy);

    setupLog.push(`Project created: ${projectName}`);

    return { project, setupLog };
  }

  /**
   * Import a template from the Hub
   */
  importFromHub(hubTemplate: {
    id: string;
    name: string;
    slug: string;
    description?: string;
    category?: string;
    content: string; // The template definition as JSON
  }): unknown {
    const config = JSON.parse(hubTemplate.content) as TemplateConfig;
    
    const id = uuid();
    const now = new Date();

    this.db.insert(projectTemplates).values({
      id,
      name: hubTemplate.name,
      slug: hubTemplate.slug,
      description: hubTemplate.description ?? config.description ?? null,
      category: hubTemplate.category ?? config.category ?? null,
      agentConfig: config.agentConfig ? JSON.stringify(config.agentConfig) : null,
      skills: config.skills ? JSON.stringify(config.skills) : null,
      mcpServers: config.mcpServers ? JSON.stringify(config.mcpServers) : null,
      tools: config.tools ? JSON.stringify(config.tools) : null,
      promptTemplate: config.promptTemplate ?? null,
      setupCommands: config.setupCommands ? JSON.stringify(config.setupCommands) : null,
      fileTemplates: config.fileTemplates ? JSON.stringify(config.fileTemplates) : null,
      rootAgentType: config.rootAgentType ?? null,
      agentTypes: config.agentTypes ? JSON.stringify(config.agentTypes) : null,
      source: 'hub',
      hubTemplateId: hubTemplate.id,
      createdAt: now,
      updatedAt: now,
    }).run();

    return this.getTemplate(id);
  }
}
