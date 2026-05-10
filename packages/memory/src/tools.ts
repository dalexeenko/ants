import { z } from "zod";
import type { ToolDefinition, ToolContext, ToolExecuteResult } from "@openmgr/agent-core";
import { MemoryStorage } from "./storage.js";

// ==================== memory_add ====================

const MEMORY_ADD_DESCRIPTION = `Add a memory to the project's knowledge base.

Memories persist across sessions and are shared by all developers working on this project.
They are stored in .openmgr/memories.db and can be tracked in git.

## When to Add Memories

- Project conventions and patterns (e.g., "We use React Query for data fetching")
- Architecture decisions and their rationale
- Important caveats or gotchas about specific code areas
- Team preferences and coding standards
- Integration details with external services
- Anything a new developer would need to know

## Scoping

Use the scope parameter to organize memories by area of the codebase:
- "/" (default) - Global, applies to entire project
- "/src/auth" - Applies to auth module and subdirectories
- "/api" - Applies to API layer

When working in a directory, memories from that scope and all parent scopes are automatically relevant.

## Tags

Use tags for cross-cutting concerns that span multiple scopes:
- ["security"] - Security-related memory
- ["performance", "database"] - Performance note about DB
- ["deprecated"] - Mark something as deprecated`;

const memoryAddParams = z.object({
  content: z.string().describe("The memory content - what should be remembered"),
  scope: z.string().optional().describe("Path-based scope (e.g., '/', '/src/auth'). Defaults to '/'"),
  tags: z.array(z.string()).optional().describe("Optional tags for cross-cutting concerns"),
  author: z.string().optional().describe("Who is adding this memory (e.g., developer name)"),
});

export const memoryAddTool: ToolDefinition<z.infer<typeof memoryAddParams>> = {
  name: "memory_add",
  description: MEMORY_ADD_DESCRIPTION,
  parameters: memoryAddParams,
  async execute(params, ctx) {
    const storage = new MemoryStorage(ctx.workingDirectory);
    
    const memory = await storage.create({
      content: params.content,
      scope: params.scope,
      tags: params.tags,
      author: params.author,
    });

    let output = `Memory added successfully.\n\nID: ${memory.id}\nScope: ${memory.scope}\nTags: ${memory.tags.length > 0 ? memory.tags.join(", ") : "(none)"}\n\nContent:\n${memory.content}`;

    if (!memory.hasEmbedding) {
      output += `\n\nWarning: Semantic search unavailable. Embedding model not loaded.\nMemory was saved with keyword search only.`;
    }

    return {
      output,
      metadata: {
        memoryId: memory.id,
        scope: memory.scope,
        tags: memory.tags,
        hasEmbedding: memory.hasEmbedding,
      },
    };
  },
};

// ==================== memory_search ====================

const MEMORY_SEARCH_DESCRIPTION = `Search the project's memory/knowledge base.

Uses hybrid search combining:
1. **Keyword search** (FTS5) - Fast exact and prefix matching
2. **Semantic search** (embeddings) - Finds conceptually similar content

## Scope-Aware Search

When you provide a scope (current working path), the search automatically includes:
- Memories at that exact scope
- Memories at all parent scopes (up to "/")
- Global memories

Example: Searching with scope="/src/auth/login" includes memories from:
- /src/auth/login
- /src/auth  
- /src
- / (global)

## When to Search

- Before making changes to unfamiliar code areas
- When you need context about architectural decisions
- To find project conventions and patterns
- To understand why something was implemented a certain way`;

const memorySearchParams = z.object({
  query: z.string().describe("What to search for - can be keywords or natural language"),
  scope: z.string().optional().describe("Current working path for scope-aware results"),
  tags: z.array(z.string()).optional().describe("Filter by specific tags"),
  limit: z.number().optional().describe("Maximum results to return (default: 10)"),
});

export const memorySearchTool: ToolDefinition<z.infer<typeof memorySearchParams>> = {
  name: "memory_search",
  description: MEMORY_SEARCH_DESCRIPTION,
  parameters: memorySearchParams,
  async execute(params, ctx) {
    const storage = new MemoryStorage(ctx.workingDirectory);
    
    const status = await storage.checkEmbeddingsStatus();
    
    const results = await storage.search({
      query: params.query,
      scope: params.scope,
      tags: params.tags,
      limit: params.limit,
    });

    const hasSemanticResults = results.some(r => r.matchType === "semantic" || r.matchType === "hybrid");

    if (results.length === 0) {
      let output = "No memories found matching your query.";
      if (!status.available) {
        output += "\n\nNote: Semantic search unavailable (embedding model not loaded). Only keyword matching was used.";
      }
      return {
        output,
        metadata: { results: [], count: 0, semanticSearchAvailable: status.available },
      };
    }

    const formatted = results.map((r, i) => {
      const tagStr = r.memory.tags.length > 0 ? ` [${r.memory.tags.join(", ")}]` : "";
      const scorePercent = Math.round(r.score * 100);
      return `${i + 1}. [${r.matchType}:${scorePercent}%] ${r.memory.scope}${tagStr}\n   ${r.memory.content}\n   ID: ${r.memory.id}`;
    }).join("\n\n");

    let output = `Found ${results.length} memory/memories:\n\n${formatted}`;

    if (!status.available) {
      output += "\n\nNote: Semantic search unavailable (embedding model not loaded). Results are keyword-only.";
    } else if (!hasSemanticResults && status.memoriesWithEmbeddings === 0) {
      output += "\n\nNote: No memories have embeddings yet. Add new memories to enable semantic search.";
    }

    return {
      output,
      metadata: {
        results: results.map(r => ({
          id: r.memory.id,
          scope: r.memory.scope,
          tags: r.memory.tags,
          score: r.score,
          matchType: r.matchType,
        })),
        count: results.length,
        semanticSearchAvailable: status.available,
        memoriesWithEmbeddings: status.memoriesWithEmbeddings,
      },
    };
  },
};

// ==================== memory_list ====================

const MEMORY_LIST_DESCRIPTION = `List memories in the project's knowledge base.

Use this to browse memories by scope or tags without searching for specific content.`;

const memoryListParams = z.object({
  scope: z.string().optional().describe("Filter by scope (exact match or prefix)"),
  tags: z.array(z.string()).optional().describe("Filter by specific tags"),
  limit: z.number().optional().describe("Maximum results (default: 50)"),
  offset: z.number().optional().describe("Offset for pagination"),
});

export const memoryListTool: ToolDefinition<z.infer<typeof memoryListParams>> = {
  name: "memory_list",
  description: MEMORY_LIST_DESCRIPTION,
  parameters: memoryListParams,
  async execute(params, ctx) {
    const storage = new MemoryStorage(ctx.workingDirectory);
    
    const memories = await storage.list({
      scope: params.scope,
      tags: params.tags,
      limit: params.limit,
      offset: params.offset,
    });

    const total = await storage.count();

    if (memories.length === 0) {
      return {
        output: "No memories found.",
        metadata: { memories: [], count: 0, total },
      };
    }

    const formatted = memories.map((m, i) => {
      const tagStr = m.tags.length > 0 ? ` [${m.tags.join(", ")}]` : "";
      return `${i + 1}. ${m.scope}${tagStr}\n   ${m.content.slice(0, 100)}${m.content.length > 100 ? "..." : ""}\n   ID: ${m.id}`;
    }).join("\n\n");

    return {
      output: `Found ${memories.length} of ${total} total memories:\n\n${formatted}`,
      metadata: {
        memories: memories.map(m => ({
          id: m.id,
          scope: m.scope,
          tags: m.tags,
          contentPreview: m.content.slice(0, 100),
        })),
        count: memories.length,
        total,
      },
    };
  },
};

// ==================== memory_delete ====================

const MEMORY_DELETE_DESCRIPTION = `Delete a memory from the project's knowledge base.

Use with caution - deleted memories cannot be recovered.`;

const memoryDeleteParams = z.object({
  id: z.string().describe("The ID of the memory to delete"),
});

export const memoryDeleteTool: ToolDefinition<z.infer<typeof memoryDeleteParams>> = {
  name: "memory_delete",
  description: MEMORY_DELETE_DESCRIPTION,
  parameters: memoryDeleteParams,
  async execute(params, ctx) {
    const storage = new MemoryStorage(ctx.workingDirectory);
    
    const memory = await storage.get(params.id);
    if (!memory) {
      return {
        output: `Memory not found: ${params.id}`,
        metadata: { deleted: false, id: params.id },
      };
    }

    const deleted = await storage.delete(params.id);
    
    return {
      output: deleted 
        ? `Memory deleted successfully.\n\nID: ${memory.id}\nScope: ${memory.scope}\nContent: ${memory.content.slice(0, 100)}...`
        : `Failed to delete memory: ${params.id}`,
      metadata: { deleted, id: params.id, scope: memory.scope },
    };
  },
};

/**
 * All memory tools as an array.
 */
export const memoryTools = [
  memoryAddTool,
  memorySearchTool,
  memoryListTool,
  memoryDeleteTool,
] as ToolDefinition[];
