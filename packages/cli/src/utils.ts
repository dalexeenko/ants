import chalk from "chalk";

/**
 * CLI Spinner for showing progress
 */
export class Spinner {
  private frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private current = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private message: string;

  constructor(message = "Working") {
    this.message = message;
  }

  start(): void {
    if (this.interval) return;
    process.stdout.write("\x1B[?25l");
    this.interval = setInterval(() => {
      const frame = this.frames[this.current];
      process.stdout.write(`\r${chalk.cyan(frame)} ${chalk.gray(this.message)}`);
      this.current = (this.current + 1) % this.frames.length;
    }, 80);
  }

  update(message: string): void {
    this.message = message;
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      process.stdout.write("\r\x1B[K");
      process.stdout.write("\x1B[?25h");
    }
  }
}

/**
 * Debug logger for CLI operations
 */
export class DebugLogger {
  private enabled: boolean;

  constructor(enabled = false) {
    this.enabled = enabled;
  }

  log(category: string, message: string, data?: unknown): void {
    if (!this.enabled) return;
    const timestamp = new Date().toISOString().slice(11, 23);
    const prefix = chalk.magenta(`[${timestamp}] [${category}]`);
    if (data !== undefined) {
      const dataStr = typeof data === "string" ? data : JSON.stringify(data, null, 2);
      const truncated = dataStr.length > 500 ? dataStr.slice(0, 500) + "..." : dataStr;
      console.error(`${prefix} ${message}\n${chalk.gray(truncated)}`);
    } else {
      console.error(`${prefix} ${message}`);
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}

// Global debug logger instance
export const debug = new DebugLogger();

/**
 * Format a timestamp for display
 */
export function formatTime(date: Date): string {
  return date.toLocaleString();
}

/**
 * Format a duration in milliseconds to human readable
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Truncate a string to a maximum length
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

/**
 * Print an error message and exit
 */
export function exitWithError(message: string, code = 1): never {
  console.error(chalk.red(`Error: ${message}`));
  process.exit(code);
}

/**
 * Print a success message
 */
export function printSuccess(message: string): void {
  console.log(chalk.green(`✓ ${message}`));
}

/**
 * Print an info message
 */
export function printInfo(message: string): void {
  console.log(chalk.blue(`ℹ ${message}`));
}

/**
 * Print a warning message
 */
export function printWarning(message: string): void {
  console.log(chalk.yellow(`⚠ ${message}`));
}
