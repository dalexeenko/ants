import { z } from "zod";
import { defineTool } from "@openmgr/agent-core";
import { getFilesystem } from "./filesystem.js";

/**
 * Coerce content to a string. LLMs sometimes pass JSON objects directly
 * (e.g. for package.json) instead of a serialized string. Rather than
 * rejecting with a validation error (which causes retry loops), we
 * accept both and stringify objects with pretty-printing.
 */
function coerceContent(val: unknown): string {
  if (typeof val === "string") return val;
  if (val !== null && typeof val === "object") {
    return JSON.stringify(val, null, 2) + "\n";
  }
  return String(val);
}

export const writeTool = defineTool({
  name: "write",
  description:
    "Write content to a file. Creates the file if it doesn't exist, or overwrites it if it does. Parent directories are created automatically.",
  requiredCapabilities: ["filesystem"],
  parameters: z.object({
    path: z.string().describe("Path to the file (relative to working directory)"),
    content: z.any().describe("Content to write to the file"),
  }),
  async execute(params, ctx) {
    const fs = getFilesystem(ctx.extensions);
    const { path } = params;
    const content = coerceContent(params.content);
    const fullPath = fs.resolve(ctx.workingDirectory, path);
    const relativePath = fs.relative(ctx.workingDirectory, fullPath);

    if (!fullPath.startsWith(ctx.workingDirectory)) {
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
