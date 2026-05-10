/**
 * @openmgr/agent-tools
 * 
 * Pure code tools for @openmgr/agent that don't require filesystem or terminal access.
 * These tools can run in sandboxed environments like Cloudflare Workers.
 * 
 * Included tools:
 * - todoread / todowrite - Task management
 * - phaseread / phasewrite - Project phase management  
 * - web_fetch - Fetch and convert web content
 * - web_search - Search the web via Exa AI
 * - skill - Load skill instructions
 * - task - Spawn subagents for delegated tasks
 * - task_status - Check subagent status
 * - task_cancel - Cancel running subagents
 * - question - Present interactive questions to the user
 */

import type { AgentPlugin, AgentTypeDefinition } from "@openmgr/agent-core";
import { extendedAgentTypes } from "./agent-types.js";

// Import tool definitions
import { todoReadTool } from "./todo-read.js";
import { todoWriteTool } from "./todo-write.js";
import { phaseReadTool } from "./phase-read.js";
import { phaseWriteTool } from "./phase-write.js";
import { webFetchTool } from "./web-fetch.js";
import { webSearchTool } from "./web-search.js";
import { skillTool } from "./skill.js";
import { taskTool } from "./task.js";
import { taskStatusTool } from "./task-status.js";
import { taskCancelTool } from "./task-cancel.js";
import { questionTool } from "./question.js";

// Export individual tools
export { todoReadTool } from "./todo-read.js";
export { todoWriteTool } from "./todo-write.js";
export { phaseReadTool } from "./phase-read.js";
export { phaseWriteTool } from "./phase-write.js";
export { webFetchTool } from "./web-fetch.js";
export { webSearchTool } from "./web-search.js";
export { skillTool } from "./skill.js";
export { taskTool } from "./task.js";
export { taskStatusTool } from "./task-status.js";
export { taskCancelTool } from "./task-cancel.js";
export { questionTool } from "./question.js";
export { extendedAgentTypes } from "./agent-types.js";

/**
 * All pure code tools
 */
export const tools = [
  todoReadTool,
  todoWriteTool,
  phaseReadTool,
  phaseWriteTool,
  webFetchTool,
  webSearchTool,
  skillTool,
  taskTool,
  taskStatusTool,
  taskCancelTool,
  questionTool,
];

/**
 * Built-in agent type definitions.
 * These provide named subagent presets for common tasks.
 */
export const builtinAgentTypes: AgentTypeDefinition[] = [
  {
    name: "explore-code",
    version: "1.0.0",
    description:
      'Fast, read-only agent for exploring codebases. Use this when you need to find files by patterns (e.g., "src/**/*.tsx"), search code for keywords, or answer questions about how the codebase works. Specify thoroughness in your prompt: "quick" for basic searches, "thorough" for comprehensive analysis.',
    systemPrompt: `You are a code exploration assistant. Your job is to efficiently search, read, and analyze codebases to answer questions and find relevant code.

Guidelines:
- Use glob to find files by name patterns before reading them.
- Use grep to search for specific strings, symbols, or patterns across the codebase.
- Read files to understand implementation details when needed.
- When asked for a "quick" search, do a single targeted search and return results. When asked for a "thorough" search, explore multiple locations, naming conventions, and related files.
- Always report file paths and line numbers so the caller can navigate to the source.
- You are read-only. Do not attempt to modify any files.
- Be concise. Return the specific information requested, not exhaustive dumps of file contents.
- If you cannot find what was asked for, say so clearly rather than guessing.`,
    allowedTools: ["read", "glob", "grep", "list", "bash", "web_fetch", "web_search", "codesearch"],
    deniedTools: ["write", "edit", "apply_patch", "task"],
    tags: ["subagent", "code"],
    source: "builtin",
  },
  {
    name: "general-code",
    version: "1.0.0",
    description:
      "General-purpose coding agent for researching complex questions and executing multi-step software engineering tasks. Use this to execute multiple units of work in parallel, or for tasks that need full tool access including reading, writing, and executing code.",
    systemPrompt: `You are a general-purpose coding assistant. You have full tool access and can read, write, search, and execute commands.

Guidelines:
- Break complex tasks into clear steps and execute them methodically.
- Read relevant code before making changes to understand context.
- After making edits, verify your changes are correct (e.g., check for syntax errors, run relevant tests if available).
- If you encounter an error, diagnose it and fix it rather than reporting back immediately.
- Be thorough but efficient — complete the task fully before returning your result.
- Summarize what you did and any important decisions you made in your final response.`,
    tags: ["root", "subagent", "code"],
    source: "builtin",
  },
  // Extended agent types: code-review, code-refactor, code-test, code-debug,
  // notes, slides, calendar, files, prd, email families
  ...extendedAgentTypes,
];

/**
 * Plugin that registers all pure code tools with the agent.
 * 
 * Provides the "network" capability (for web_fetch, web_search).
 * The "subagent" capability must be provided separately for task tools.
 * Tools without matching capabilities are deferred until the capability is registered.
 */
export const toolsPlugin: AgentPlugin = {
  name: "@openmgr/agent-tools",
  version: "0.1.0",
  tools: tools as AgentPlugin["tools"],
  agentTypes: builtinAgentTypes,
  capabilities: ["network"],
};

export default toolsPlugin;
