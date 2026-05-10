import { spawn } from "child_process";
import { z } from "zod";
import { defineTool } from "@ants/agent-core";

const MAX_OUTPUT_SIZE = 50000;

export const bashTool = defineTool({
  name: "bash",
  description:
    "Execute a shell command. Use this for running scripts, installing packages, git operations, or any terminal command. Commands run in the working directory.",
  requiredCapabilities: ["terminal"],
  parameters: z.object({
    command: z.string().describe("The shell command to execute"),
    timeout: z
      .number()
      .optional()
      .default(30000)
      .describe("Maximum total timeout in milliseconds (default: 30000)"),
    idleTimeout: z
      .number()
      .optional()
      .default(30000)
      .describe(
        "Kill the process if no stdout/stderr output is received for this many milliseconds (default: 30000). Set to 0 to disable."
      ),
  }),
  async execute(params, ctx) {
    return new Promise((resolve) => {
      const { command, timeout = 30000, idleTimeout = 30000 } = params;

      const proc = spawn("sh", ["-c", command], {
        cwd: ctx.workingDirectory,
        env: { ...process.env, TERM: "dumb" },
      });

      let stdout = "";
      let stderr = "";
      let killed = false;
      let killedReason: "timeout" | "idle" | "abort" | undefined;

      // Absolute timeout — kills the process after a hard limit
      const timeoutId = setTimeout(() => {
        killed = true;
        killedReason = "timeout";
        proc.kill("SIGTERM");
      }, timeout);

      // Idle timeout — kills the process if no output is received for a period.
      // This catches commands that hang waiting for user interaction (e.g. browser
      // OAuth flows, interactive prompts) that will never complete in a headless
      // environment.
      let idleTimeoutId: ReturnType<typeof setTimeout> | null = null;

      function resetIdleTimeout() {
        if (idleTimeout <= 0) return;
        if (idleTimeoutId !== null) clearTimeout(idleTimeoutId);
        idleTimeoutId = setTimeout(() => {
          killed = true;
          killedReason = "idle";
          proc.kill("SIGTERM");
        }, idleTimeout);
      }

      // Start the idle timer immediately (catches commands that produce no output at all)
      resetIdleTimeout();

      const abortHandler = () => {
        killed = true;
        killedReason = "abort";
        proc.kill("SIGTERM");
      };
      ctx.abortSignal?.addEventListener("abort", abortHandler);

      proc.stdout.on("data", (data: Buffer) => {
        if (stdout.length < MAX_OUTPUT_SIZE) {
          stdout += data.toString();
        }
        resetIdleTimeout();
      });

      proc.stderr.on("data", (data: Buffer) => {
        if (stderr.length < MAX_OUTPUT_SIZE) {
          stderr += data.toString();
        }
        resetIdleTimeout();
      });

      proc.on("close", (code: number | null) => {
        clearTimeout(timeoutId);
        if (idleTimeoutId !== null) clearTimeout(idleTimeoutId);
        ctx.abortSignal?.removeEventListener("abort", abortHandler);

        const truncatedStdout =
          stdout.length >= MAX_OUTPUT_SIZE
            ? stdout.slice(0, MAX_OUTPUT_SIZE) + "\n... (output truncated)"
            : stdout;

        const truncatedStderr =
          stderr.length >= MAX_OUTPUT_SIZE
            ? stderr.slice(0, MAX_OUTPUT_SIZE) + "\n... (output truncated)"
            : stderr;

        let output = "";
        if (truncatedStdout) {
          output += truncatedStdout;
        }
        if (truncatedStderr) {
          output += (output ? "\n\nSTDERR:\n" : "STDERR:\n") + truncatedStderr;
        }

        if (killed) {
          if (killedReason === "idle") {
            output +=
              "\n\n(Command was terminated — no output received for " +
              (idleTimeout / 1000) +
              "s. The command may be waiting for user input or trying to open a browser, which is not possible in this environment.)";
          } else if (killedReason === "timeout") {
            output += "\n\n(Command was terminated — exceeded " + (timeout / 1000) + "s timeout)";
          } else {
            output += "\n\n(Command was terminated)";
          }
        }

        resolve({
          output: output || "(no output)",
          metadata: {
            exitCode: code,
            killed,
            killedReason,
          },
        });
      });

      proc.on("error", (err: Error) => {
        clearTimeout(timeoutId);
        if (idleTimeoutId !== null) clearTimeout(idleTimeoutId);
        ctx.abortSignal?.removeEventListener("abort", abortHandler);
        resolve({
          output: `Error executing command: ${err.message}`,
          metadata: { error: true },
        });
      });
    });
  },
});
