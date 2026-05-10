// Storage
export { MemoryStorage } from "./storage.js";

// Database utilities
export {
  getMemoryDb,
  closeMemoryDb,
  closeAllMemoryDbs,
  memoryDbExists,
  getMemoryDbPath,
  createInMemoryDb,
} from "./database.js";

// Embeddings
export {
  generateEmbedding,
  generateEmbeddings,
  cosineSimilarity,
  embeddingToBuffer,
  bufferToEmbedding,
  isEmbeddingsAvailable,
  getModelPath,
  getEmbeddingDimensions,
} from "./embeddings.js";

// Types
export type {
  MemoryItem,
  MemorySearchOptions,
  MemorySearchResult,
  MemoryListOptions,
  MemoryCreateInput,
  MemoryUpdateInput,
  EmbeddingsStatus,
} from "./types.js";

// Tools
export {
  memoryAddTool,
  memorySearchTool,
  memoryListTool,
  memoryDeleteTool,
  memoryTools,
} from "./tools.js";

// Plugin
export { memoryPlugin } from "./plugin.js";
