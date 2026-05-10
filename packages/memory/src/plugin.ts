import type { AgentPlugin, AgentInterface } from "@openmgr/agent-core";
import { memoryTools } from "./tools.js";
import { MemoryStorage } from "./storage.js";
import { closeAllMemoryDbs } from "./database.js";

const MEMORY_SYSTEM_PROMPT_SECTION = `## Knowledge Base & Memory

You have access to a persistent knowledge base that spans across sessions. Use it to:

1. **Save important decisions** — When significant architectural, design, or strategic decisions are made, save them with \`memory_add\` so future sessions can reference them.
2. **Save project conventions** — When you discover or establish coding conventions, naming patterns, or workflow preferences, save them.
3. **Search before asking** — Before asking the user for context about past decisions or project conventions, search the knowledge base with \`memory_search\`.
4. **Save key findings** — When debugging reveals important root causes or when you discover non-obvious system behaviors, save them.

Use descriptive tags and appropriate scopes when saving memories. The scope should reflect the relevant part of the project (e.g., "backend/api", "frontend/auth").`;

/**
 * Memory plugin that provides semantic memory tools to the agent.
 * 
 * @example
 * ```ts
 * import { Agent } from "@openmgr/agent-core";
 * import { memoryPlugin } from "@openmgr/agent-memory";
 * 
 * const agent = new Agent({ ... });
 * await agent.use(memoryPlugin());
 * ```
 */
export function memoryPlugin(): AgentPlugin {
  return {
    name: "memory",
    version: "0.1.0",
    tools: memoryTools,
    
    onRegister(agent: AgentInterface) {
      // Append the memory system prompt section to the agent's system prompt.
      // The agent instance has getSystemPrompt/setSystemPrompt even though
      // AgentInterface doesn't declare them — cast to access.
      const agentWithPrompt = agent as AgentInterface & {
        getSystemPrompt(): string;
        setSystemPrompt(prompt: string): void;
      };
      const currentPrompt = agentWithPrompt.getSystemPrompt();
      agentWithPrompt.setSystemPrompt(currentPrompt + "\n\n" + MEMORY_SYSTEM_PROMPT_SECTION);
    },

    async onShutdown() {
      closeAllMemoryDbs();
    },
  };
}
