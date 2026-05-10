import { z } from "zod";
import { defineTool } from "@openmgr/agent-core";
import { getFilesystem } from "./filesystem.js";

/**
 * Coerce a value to a string. LLMs sometimes pass JSON objects directly
 * instead of a serialized string. Rather than rejecting with a validation
 * error (which causes retry loops), we accept both and stringify objects.
 */
function coerceToString(val: unknown): string {
  if (typeof val === "string") return val;
  if (val !== null && typeof val === "object") {
    return JSON.stringify(val, null, 2) + "\n";
  }
  return String(val);
}

export const editTool = defineTool({
  name: "edit",
  description:
    "Edit a file by replacing a specific string with another. The oldString must match exactly (including whitespace). Use this for precise edits rather than rewriting entire files.",
  requiredCapabilities: ["filesystem"],
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
    const fullPath = fs.resolve(ctx.workingDirectory, path);
    const relativePath = fs.relative(ctx.workingDirectory, fullPath);

    if (!fullPath.startsWith(ctx.workingDirectory)) {
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
