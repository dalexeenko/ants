/**
 * Structured logger for the Ants server.
 *
 * Usage:
 *   import { createLogger } from './utils/logger.js';
 *   const log = createLogger('sessions');
 *   log.info('Session created', sessionId);
 *   log.error('Failed to create session', error);
 *
 * Log level is controlled by the LOG_LEVEL environment variable.
 * Valid levels (from most to least verbose): debug, info, warn, error
 * Default: "info"
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getConfiguredLevel(): LogLevel {
  const env = process.env.LOG_LEVEL?.toLowerCase();
  if (env && env in LEVELS) {
    return env as LogLevel;
  }
  return 'info';
}

let currentLevel: LogLevel = getConfiguredLevel();

/** Override the log level at runtime (useful for tests). */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/** Get the current log level. */
export function getLogLevel(): LogLevel {
  return currentLevel;
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  /** Create a child logger with a sub-module prefix. */
  child(subModule: string): Logger;
}

/**
 * Create a named logger instance.
 *
 * @param module - The module or component name (e.g. 'sessions', 'AgentManager')
 */
export function createLogger(module: string): Logger {
  function shouldLog(level: LogLevel): boolean {
    return LEVELS[level] >= LEVELS[currentLevel];
  }

  function formatPrefix(level: LogLevel): string {
    return `[${level.toUpperCase()}] [${module}]`;
  }

  const logger: Logger = {
    debug(...args: unknown[]) {
      if (shouldLog('debug')) {
        console.log(formatPrefix('debug'), ...args);
      }
    },
    info(...args: unknown[]) {
      if (shouldLog('info')) {
        console.log(formatPrefix('info'), ...args);
      }
    },
    warn(...args: unknown[]) {
      if (shouldLog('warn')) {
        console.warn(formatPrefix('warn'), ...args);
      }
    },
    error(...args: unknown[]) {
      if (shouldLog('error')) {
        console.error(formatPrefix('error'), ...args);
      }
    },
    child(subModule: string): Logger {
      return createLogger(`${module}:${subModule}`);
    },
  };

  return logger;
}

/**
 * A logger for startup banner output that always prints regardless of level.
 * Used only in index.ts for the server banner.
 */
export function banner(...args: unknown[]): void {
  console.log(...args);
}
