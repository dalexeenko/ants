/**
 * A memory item stored in the project's knowledge base.
 */
export interface MemoryItem {
  id: string;
  content: string;
  /** Path-based scope, e.g., "/", "/src/auth", "/api" */
  scope: string;
  /** Optional tags for cross-cutting concerns */
  tags: string[];
  /** Who added this memory */
  author?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Options for searching memories.
 */
export interface MemorySearchOptions {
  query: string;
  /** Current working context path for scope-aware results */
  scope?: string;
  /** Filter by specific tags */
  tags?: string[];
  limit?: number;
  /** Default true if embeddings available */
  useSemanticSearch?: boolean;
}

/**
 * A search result with relevance score.
 */
export interface MemorySearchResult {
  memory: MemoryItem;
  /** Relevance score (0-1) */
  score: number;
  matchType: "keyword" | "semantic" | "hybrid";
}

/**
 * Options for listing memories.
 */
export interface MemoryListOptions {
  /** Filter by scope (exact match or prefix) */
  scope?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
  orderBy?: "createdAt" | "updatedAt";
  order?: "asc" | "desc";
}

/**
 * Input for creating a new memory.
 */
export interface MemoryCreateInput {
  content: string;
  /** Defaults to "/" */
  scope?: string;
  tags?: string[];
  author?: string;
}

/**
 * Input for updating an existing memory.
 */
export interface MemoryUpdateInput {
  content?: string;
  scope?: string;
  tags?: string[];
}

/**
 * Status of the embeddings system.
 */
export interface EmbeddingsStatus {
  available: boolean;
  memoriesWithEmbeddings: number;
  totalMemories: number;
}
