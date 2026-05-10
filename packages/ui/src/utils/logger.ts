/**
 * Structured logger for the Ants app packages (ui, desktop, mobile).
 *
 * Usage:
 *   import { createLogger } from '../utils/logger';
 *   const log = createLogger('BridgeCore');
 *   log.info('Session created', sessionId);
 *   log.error('Failed to create session', error);
 *
 * Log level is controlled by:
 *   - globalThis.__ANTS_LOG_LEVEL (set at app startup)
 *   - Defaults to "warn" in production, "debug" in development
 *
 * Valid levels (from most to least verbose): debug, info, warn, error
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

declare global {
  // eslint-disable-next-line no-var
  var __ANTS_LOG_LEVEL: LogLevel | undefined;
}

function getConfiguredLevel(): LogLevel {
  if (globalThis.__ANTS_LOG_LEVEL && globalThis.__ANTS_LOG_LEVEL in LEVELS) {
    return globalThis.__ANTS_LOG_LEVEL;
  }
  // Default: warn in production, debug in development
  return process.env.NODE_ENV === 'production' ? 'warn' : 'debug';
}

let currentLevel: LogLevel | null = null;

function getCurrentLevel(): LogLevel {
  // Lazily evaluate so tests can set __ANTS_LOG_LEVEL before first use
  if (currentLevel === null) {
    currentLevel = getConfiguredLevel();
  }
  return currentLevel;
}

/** Override the log level at runtime (useful for tests). */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/** Get the current log level. */
export function getLogLevel(): LogLevel {
  return getCurrentLevel();
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
 * @param module - The module or component name (e.g. 'BridgeCore', 'messaging')
 */
export function createLogger(module: string): Logger {
  function shouldLog(level: LogLevel): boolean {
    return LEVELS[level] >= LEVELS[getCurrentLevel()];
  }

  function formatPrefix(level: LogLevel): string {
    return `[${level.toUpperCase()}] [${module}]`;
  }

  const logger: Logger = {
    debug(...args: unknown[]) {
      if (shouldLog('debug')) {
        try { console.log(formatPrefix('debug'), ...args); } catch {}
      }
    },
    info(...args: unknown[]) {
      if (shouldLog('info')) {
        try { console.log(formatPrefix('info'), ...args); } catch {}
      }
    },
    warn(...args: unknown[]) {
      if (shouldLog('warn')) {
        try { console.warn(formatPrefix('warn'), ...args); } catch {}
      }
    },
    error(...args: unknown[]) {
      if (shouldLog('error')) {
        try { console.error(formatPrefix('error'), ...args); } catch {}
      }
    },
    child(subModule: string): Logger {
      return createLogger(`${module}:${subModule}`);
    },
  };

  return logger;
}
