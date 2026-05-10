/**
 * Platform-Agnostic File Tools
 * 
 * These tools work with any Filesystem implementation provided via ctx.extensions.filesystem.
 * They do NOT fall back to Node.js - a filesystem MUST be provided.
 */

import { z } from "zod";
import { defineTool, type AgentPlugin, type Filesystem } from "@ants/agent-core";

const MAX_FILE_SIZE = 1024 * 1024;
const MAX_LINES = 2000;

/**
 * Coerce a value to a string. LLMs sometimes pass JSON objects directly
 * (e.g. for package.json) instead of a serialized string. Rather than
 * rejecting with a validation error (which causes retry loops), we
 * accept both and stringify objects with pretty-printing.
 */
function coerceToString(val: unknown): string {
  if (typeof val === "string") return val;
  if (val !== null && typeof val === "object") {
    return JSON.stringify(val, null, 2) + "\n";
  }
  return String(val);
}

/**
 * Get the filesystem from the tool context extensions.
 * Throws if no filesystem is provided (unlike the Node.js version which falls back).
 */
function getFilesystem(extensions: Record<string, unknown>): Filesystem {
  const fs = extensions.filesystem as Filesystem | undefined;
  if (!fs) {
    throw new Error(
      "No filesystem provided. Set the filesystem via agent.setExtension('filesystem', yourFilesystem) before using file tools."
    );
  }
  return fs;
}

/**
 * Normalize the working directory so that the security `startsWith` check
 * compares like-for-like against the already-normalized `fullPath` returned
 * by `fs.resolve()`.  Without this, a trailing slash, `file://` prefix, or
 * other cosmetic difference in the raw config value can cause every tool
 * call to be rejected as "outside the working directory".
 */
function normalizeWorkingDirectory(fs: Filesystem, workingDirectory: string): string {
  return fs.resolve(workingDirectory, ".");
}

/**
 * Read tool - reads file contents with line numbers
 */
export const readTool = defineTool({
  name: "read",
  description:
    "Read the contents of a file. Returns the file contents with line numbers. Large files are truncated.",
  parameters: z.object({
    path: z.string().describe("Path to the file (relative to working directory)"),
    offset: z
      .number()
      .optional()
      .describe("Line number to start reading from (0-based)"),
    limit: z
      .number()
      .optional()
      .describe("Maximum number of lines to read (default: 2000)"),
  }),
  async execute(params, ctx) {
    const fs = getFilesystem(ctx.extensions);
    const { path, offset = 0, limit = MAX_LINES } = params;
    const workDir = normalizeWorkingDirectory(fs, ctx.workingDirectory);
    const fullPath = fs.resolve(workDir, path);
    const relativePath = fs.relative(workDir, fullPath);

    if (!fullPath.startsWith(workDir)) {
      return {
        output: `Error: Path "${path}" is outside the working directory`,
        metadata: { error: true },
      };
    }

    try {
      const fileStat = await fs.stat(fullPath);

      if (fileStat.isDirectory) {
        return {
          output: `Error: "${relativePath}" is a directory, not a file`,
          metadata: { error: true },
        };
      }

      if (fileStat.size > MAX_FILE_SIZE) {
        return {
          output: `Error: File is too large (${Math.round(fileStat.size / 1024)}KB). Maximum size is ${MAX_FILE_SIZE / 1024}KB.`,
          metadata: { error: true, size: fileStat.size },
        };
      }

      const content = await fs.readFile(fullPath);
      const lines = content.split("\n");
      const totalLines = lines.length;

      const selectedLines = lines.slice(offset, offset + limit);
      const numberedLines = selectedLines.map(
        (line, idx) => `${String(offset + idx + 1).padStart(5, " ")}\t${line}`
      );

      let output = numberedLines.join("\n");

      if (offset > 0 || offset + limit < totalLines) {
        output += `\n\n(Showing lines ${offset + 1}-${Math.min(offset + limit, totalLines)} of ${totalLines})`;
      }

      return {
        output,
        metadata: {
          path: relativePath,
          totalLines,
          shownLines: selectedLines.length,
        },
      };
    } catch (err) {
      const error = err as Error & { code?: string };
      if (error.code === "ENOENT") {
        return {
          output: `Error: File not found: ${relativePath}`,
          metadata: { error: true },
        };
      }
      return {
        output: `Error reading file: ${error.message}`,
        metadata: { error: true },
      };
    }
  },
});

/**
 * Write tool - writes content to a file
 */
export const writeTool = defineTool({
  name: "write",
  description:
    "Write content to a file. Creates the file if it doesn't exist, or overwrites it if it does. Parent directories are created automatically.",
  parameters: z.object({
    path: z.string().describe("Path to the file (relative to working directory)"),
    content: z.any().describe("Content to write to the file"),
  }),
  async execute(params, ctx) {
    const fs = getFilesystem(ctx.extensions);
    const { path } = params;
    const content = coerceToString(params.content);
    const workDir = normalizeWorkingDirectory(fs, ctx.workingDirectory);
    const fullPath = fs.resolve(workDir, path);
    const relativePath = fs.relative(workDir, fullPath);

    if (!fullPath.startsWith(workDir)) {
      return {
        output: `Error: Path "${path}" is outside the working directory`,
        metadata: { error: true },
      };
    }

    try {
      // writeFile in our abstraction handles mkdir automatically
      await fs.writeFile(fullPath, content);

      const lineCount = content.split("\n").length;
      // Use TextEncoder for cross-platform byte counting
      const byteCount = new TextEncoder().encode(content).length;

      return {
        output: `Successfully wrote ${lineCount} lines (${byteCount} bytes) to ${relativePath}`,
        metadata: {
          path: relativePath,
          lines: lineCount,
          bytes: byteCount,
        },
      };
    } catch (err) {
      const error = err as Error;
      return {
        output: `Error writing file: ${error.message}`,
        metadata: { error: true },
      };
    }
  },
});

/**
 * Edit tool - find and replace in files
 */
export const editTool = defineTool({
  name: "edit",
  description:
    "Edit a file by replacing a specific string with another. The oldString must match exactly (including whitespace). Use this for precise edits rather than rewriting entire files.",
  parameters: z.object({
    path: z.string().describe("Path to the file (relative to working directory)"),
    oldString: z.any().describe("The exact string to find and replace"),
    newString: z.any().describe("The string to replace it with"),
    replaceAll: z
      .boolean()
      .optional()
      .default(false)
      .describe("Replace all occurrences (default: false, replaces first only)"),
  }),
  async execute(params, ctx) {
    const fs = getFilesystem(ctx.extensions);
    const { path, replaceAll = false } = params;
    const oldString = coerceToString(params.oldString);
    const newString = coerceToString(params.newString);
    const workDir = normalizeWorkingDirectory(fs, ctx.workingDirectory);
    const fullPath = fs.resolve(workDir, path);
    const relativePath = fs.relative(workDir, fullPath);

    if (!fullPath.startsWith(workDir)) {
      return {
        output: `Error: Path "${path}" is outside the working directory`,
        metadata: { error: true },
      };
    }

    if (oldString === newString) {
      return {
        output: "Error: oldString and newString are identical",
        metadata: { error: true },
      };
    }

    try {
      const content = await fs.readFile(fullPath);

      if (!content.includes(oldString)) {
        return {
          output: `Error: oldString not found in ${relativePath}`,
          metadata: { error: true },
        };
      }

      const occurrences = content.split(oldString).length - 1;

      if (!replaceAll && occurrences > 1) {
        return {
          output: `Error: oldString found ${occurrences} times in ${relativePath}. Use replaceAll=true to replace all occurrences, or provide more context to make the match unique.`,
          metadata: { error: true, occurrences },
        };
      }

      const newContent = replaceAll
        ? content.split(oldString).join(newString)
        : content.replace(oldString, newString);

      await fs.writeFile(fullPath, newContent);

      const replacements = replaceAll ? occurrences : 1;

      return {
        output: `Successfully replaced ${replacements} occurrence${replacements > 1 ? "s" : ""} in ${relativePath}`,
        metadata: {
          path: relativePath,
          replacements,
        },
      };
    } catch (err) {
      const error = err as Error & { code?: string };
      if (error.code === "ENOENT") {
        return {
          output: `Error: File not found: ${relativePath}`,
          metadata: { error: true },
        };
      }
      return {
        output: `Error editing file: ${error.message}`,
        metadata: { error: true },
      };
    }
  },
});

/**
 * List directory tool - lists files and directories
 */
export const listTool = defineTool({
  name: "ls",
  description:
    "List files and directories in a path. Shows whether each entry is a file or directory.",
  parameters: z.object({
    path: z.string().nullish().describe("Path to list (defaults to working directory)"),
  }),
  async execute(params, ctx) {
    const fs = getFilesystem(ctx.extensions);
    const path = params.path || ".";
    const workDir = normalizeWorkingDirectory(fs, ctx.workingDirectory);
    const fullPath = fs.resolve(workDir, path);
    const relativePath = fs.relative(workDir, fullPath);

    if (!fullPath.startsWith(workDir)) {
      return {
        output: `Error: Path "${path}" is outside the working directory`,
        metadata: { error: true },
      };
    }

    try {
      const entries = await fs.readdir(fullPath);
      
      if (entries.length === 0) {
        return {
          output: `Directory "${relativePath || "."}" is empty`,
          metadata: { path: relativePath, count: 0 },
        };
      }

      // Sort: directories first, then files, alphabetically within each
      const sorted = entries.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      const lines = sorted.map((entry) => {
        const prefix = entry.isDirectory ? "[dir]  " : "[file] ";
        return prefix + entry.name;
      });

      return {
        output: lines.join("\n"),
        metadata: {
          path: relativePath,
          count: entries.length,
          directories: entries.filter((e) => e.isDirectory).length,
          files: entries.filter((e) => e.isFile).length,
        },
      };
    } catch (err) {
      const error = err as Error & { code?: string };
      if (error.code === "ENOENT") {
        return {
          output: `Error: Directory not found: ${relativePath}`,
          metadata: { error: true },
        };
      }
      return {
        output: `Error listing directory: ${error.message}`,
        metadata: { error: true },
      };
    }
  },
});

/**
 * All file tools
 */
export const fileTools = [readTool, writeTool, editTool, listTool];

/**
 * Plugin that registers file tools with the agent.
 * IMPORTANT: You must set the filesystem extension before using these tools:
 * 
 * ```typescript
 * import { createReactNativeFilesystem } from '@ants/agent-react-native';
 * import * as FileSystem from 'expo-file-system';
 * 
 * agent.setExtension('filesystem', createReactNativeFilesystem(FileSystem));
 * await agent.use(fileToolsPlugin);
 * ```
 */
export const fileToolsPlugin: AgentPlugin = {
  name: "@ants/agent-react-native/file-tools",
  version: "0.1.0",
  tools: fileTools as AgentPlugin["tools"],
};
