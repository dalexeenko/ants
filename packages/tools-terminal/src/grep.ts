import { glob } from "glob";
import { z } from "zod";
import { defineTool } from "@ants/agent-core";
import { getFilesystem } from "./filesystem.js";

const MAX_RESULTS = 50;
const MAX_FILE_SIZE = 512 * 1024;
const CONTEXT_LINES = 2;

interface Match {
  file: string;
  line: number;
  content: string;
  context: string[];
}

export const grepTool = defineTool({
  name: "grep",
  description:
    "Search for a pattern in files. Returns matching lines with context. Use this to find code, text, or patterns across files.",
  requiredCapabilities: ["filesystem"],
  parameters: z.object({
    pattern: z.string().describe("Regular expression pattern to search for"),
    include: z
      .string()
      .optional()
      .describe('Glob pattern to filter files (e.g., "*.ts", "src/**/*.js")'),
    caseSensitive: z
      .boolean()
      .optional()
      .default(false)
      .describe("Whether the search is case-sensitive"),
  }),
  async execute(params, ctx) {
    const fs = getFilesystem(ctx.extensions);
    const { pattern, include = "**/*", caseSensitive = false } = params;

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, caseSensitive ? "g" : "gi");
    } catch (err) {
      return {
        output: `Invalid regex pattern: ${(err as Error).message}`,
        metadata: { error: true },
      };
    }

    try {
      const files = await glob(include, {
        cwd: ctx.workingDirectory,
        ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
        nodir: true,
      });

      const matches: Match[] = [];

      for (const file of files) {
        if (matches.length >= MAX_RESULTS) break;

        const fullPath = fs.resolve(ctx.workingDirectory, file);
        
        try {
          const content = await fs.readFile(fullPath);
          
          // Use TextEncoder for cross-platform byte counting
          if (new TextEncoder().encode(content).length > MAX_FILE_SIZE) continue;
          if (content.includes("\0")) continue;

          const lines = content.split("\n");

          for (let i = 0; i < lines.length && matches.length < MAX_RESULTS; i++) {
            if (regex.test(lines[i]!)) {
              const contextStart = Math.max(0, i - CONTEXT_LINES);
              const contextEnd = Math.min(lines.length - 1, i + CONTEXT_LINES);
              const context = lines.slice(contextStart, contextEnd + 1).map(
                (line, idx) => `${contextStart + idx + 1}: ${line}`
              );

              matches.push({
                file,
                line: i + 1,
                content: lines[i]!,
                context,
              });
            }
            regex.lastIndex = 0;
          }
        } catch {
          continue;
        }
      }

      if (matches.length === 0) {
        return {
          output: `No matches found for pattern: ${pattern}`,
          metadata: { count: 0 },
        };
      }

      const output = matches
        .map((m) => `${m.file}:${m.line}\n${m.context.join("\n")}`)
        .join("\n\n---\n\n");

      return {
        output:
          matches.length >= MAX_RESULTS
            ? output + `\n\n(Showing first ${MAX_RESULTS} matches)`
            : output,
        metadata: {
          count: matches.length,
          filesSearched: files.length,
        },
      };
    } catch (err) {
      return {
        output: `Error searching files: ${(err as Error).message}`,
        metadata: { error: true },
      };
    }
  },
});
