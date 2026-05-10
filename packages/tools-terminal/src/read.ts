import { z } from "zod";
import { defineTool } from "@ants/agent-core";
import { getFilesystem } from "./filesystem.js";

const MAX_FILE_SIZE = 1024 * 1024;
const MAX_LINES = 2000;

export const readTool = defineTool({
  name: "read",
  description:
    "Read the contents of a file. Returns the file contents with line numbers. Large files are truncated.",
  requiredCapabilities: ["filesystem"],
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
    const fullPath = fs.resolve(ctx.workingDirectory, path);
    const relativePath = fs.relative(ctx.workingDirectory, fullPath);

    if (!fullPath.startsWith(ctx.workingDirectory)) {
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
      const error = err as NodeJS.ErrnoException;
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
