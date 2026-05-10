import { pipeline, env, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync, existsSync } from "fs";

const MODELS_DIR = join(homedir(), ".config", "openmgr", "models");
const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DIMENSIONS = 384;

let embeddingPipeline: FeatureExtractionPipeline | null = null;
let initializationPromise: Promise<FeatureExtractionPipeline> | null = null;

function ensureModelsDir(): void {
  if (!existsSync(MODELS_DIR)) {
    mkdirSync(MODELS_DIR, { recursive: true });
  }
}

async function initializeEmbeddings(): Promise<FeatureExtractionPipeline> {
  if (embeddingPipeline) {
    return embeddingPipeline;
  }

  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    ensureModelsDir();
    
    env.cacheDir = MODELS_DIR;

    // @ts-expect-error -- v3 pipeline() overloads produce a union too complex for TS
    embeddingPipeline = await pipeline("feature-extraction", MODEL_NAME, {
      dtype: "q8",
    });

    return embeddingPipeline;
  })();

  return initializationPromise;
}

/**
 * Generate an embedding vector for a single text.
 */
export async function generateEmbedding(text: string): Promise<Float32Array> {
  const pipe = await initializeEmbeddings();
  
  const output = await pipe(text, {
    pooling: "mean",
    normalize: true,
  });

  return Float32Array.from(output.data as Iterable<number>);
}

/**
 * Generate embeddings for multiple texts.
 */
export async function generateEmbeddings(texts: string[]): Promise<Float32Array[]> {
  const pipe = await initializeEmbeddings();
  
  const results: Float32Array[] = [];
  for (const text of texts) {
    const output = await pipe(text, {
      pooling: "mean",
      normalize: true,
    });
    results.push(Float32Array.from(output.data as Iterable<number>));
  }
  
  return results;
}

/**
 * Calculate cosine similarity between two embedding vectors.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have the same length");
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    const aVal = a[i]!;
    const bVal = b[i]!;
    dotProduct += aVal * bVal;
    normA += aVal * aVal;
    normB += bVal * bVal;
  }
  
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;
  
  return dotProduct / magnitude;
}

/**
 * Convert an embedding to a buffer for storage.
 */
export function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer);
}

/**
 * Convert a buffer back to an embedding.
 */
export function bufferToEmbedding(buffer: Buffer): Float32Array {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
}

/**
 * Check if the embeddings model is available.
 */
export async function isEmbeddingsAvailable(): Promise<boolean> {
  try {
    await initializeEmbeddings();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the path where models are stored.
 */
export function getModelPath(): string {
  return MODELS_DIR;
}

/**
 * Get the dimensionality of the embedding vectors.
 */
export function getEmbeddingDimensions(): number {
  return EMBEDDING_DIMENSIONS;
}
