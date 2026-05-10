import { glob as globFn } from "glob";
import { z } from "zod";
import { defineTool } from "@openmgr/agent-core";

const MAX_RESULTS = 100;

export const globTool = defineTool({
  name: "glob",
  description:
    'Find files matching a glob pattern. Examples: "**/*.ts" finds all TypeScript files, "src/**/*.js" finds JS files in src.',
  requiredCapabilities: ["filesystem"],
  parameters: z.object({
    pattern: z.string().describe("Glob pattern to match files"),
    ignore: z
      .array(z.string())
      .optional()
      .describe("Patterns to ignore (default: node_modules, .git)"),
  }),
  async execute(params, ctx) {
    const { pattern, ignore = ["**/node_modules/**", "**/.git/**"] } = params;

    try {
      const matches = await globFn(pattern, {
        cwd: ctx.workingDirectory,
        ignore,
        nodir: true,
        dot: true,
      });

      if (matches.length === 0) {
        return {
          output: `No files found matching pattern: ${pattern}`,
          metadata: { count: 0 },
        };
      }

      const sortedMatches = matches.sort();
      const limitedMatches = sortedMatches.slice(0, MAX_RESULTS);
      const output = limitedMatches.join("\n");

      let result = output;
      if (matches.length > MAX_RESULTS) {
        result += `\n\n... and ${matches.length - MAX_RESULTS} more files (showing first ${MAX_RESULTS})`;
      }

      return {
        output: result,
        metadata: {
          count: matches.length,
          shown: limitedMatches.length,
        },
      };
    } catch (err) {
      const error = err as Error;
      return {
        output: `Error searching for files: ${error.message}`,
        metadata: { error: true },
      };
    }
  },
});
