import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatTime, formatDuration, truncate, DebugLogger, Spinner } from '../utils.js';

describe('formatTime', () => {
  it('should format a date to locale string', () => {
    const date = new Date('2024-01-15T10:30:00Z');
    const result = formatTime(date);
    
    // Result depends on locale, just check it's a non-empty string
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('formatDuration', () => {
  it('should format milliseconds (< 1000ms)', () => {
    expect(formatDuration(100)).toBe('100ms');
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('should format seconds (< 60000ms)', () => {
    expect(formatDuration(1000)).toBe('1.0s');
    expect(formatDuration(5500)).toBe('5.5s');
    expect(formatDuration(30000)).toBe('30.0s');
    expect(formatDuration(59999)).toBe('60.0s');
  });

  it('should format minutes and seconds', () => {
    expect(formatDuration(60000)).toBe('1m 0s');
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(125000)).toBe('2m 5s');
    expect(formatDuration(3600000)).toBe('60m 0s');
  });
});

describe('truncate', () => {
  it('should return unchanged string if under limit', () => {
    expect(truncate('hello', 10)).toBe('hello');
    expect(truncate('short', 100)).toBe('short');
  });

  it('should return exact length string unchanged', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('should truncate and add ... if over limit', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
    expect(truncate('this is a long string', 10)).toBe('this is...');
  });

  it('should handle edge cases', () => {
    expect(truncate('', 5)).toBe('');
    expect(truncate('ab', 3)).toBe('ab');
  });
});

describe('DebugLogger', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('should not log when disabled (default)', () => {
    const logger = new DebugLogger();
    logger.log('test', 'message');
    
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('should log when enabled', () => {
    const logger = new DebugLogger(true);
    logger.log('test', 'message');
    
    expect(consoleErrorSpy).toHaveBeenCalled();
    const output = consoleErrorSpy.mock.calls[0][0];
    expect(output).toContain('test');
    expect(output).toContain('message');
  });

  it('should log with data', () => {
    const logger = new DebugLogger(true);
    logger.log('test', 'message', { key: 'value' });
    
    expect(consoleErrorSpy).toHaveBeenCalled();
    const output = consoleErrorSpy.mock.calls[0][0];
    expect(output).toContain('key');
    expect(output).toContain('value');
  });

  it('should truncate long data', () => {
    const logger = new DebugLogger(true);
    const longData = 'x'.repeat(1000);
    logger.log('test', 'message', longData);
    
    const output = consoleErrorSpy.mock.calls[0][0];
    expect(output).toContain('...');
    expect(output.length).toBeLessThan(1500);
  });

  it('should toggle enabled state', () => {
    const logger = new DebugLogger(false);
    
    logger.log('test', 'should not log');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    
    logger.setEnabled(true);
    logger.log('test', 'should log');
    expect(consoleErrorSpy).toHaveBeenCalled();
    
    logger.setEnabled(false);
    consoleErrorSpy.mockClear();
    logger.log('test', 'should not log again');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});

describe('Spinner', () => {
  let originalStdoutWrite: typeof process.stdout.write;
  let writeOutput: string[];

  beforeEach(() => {
    writeOutput = [];
    originalStdoutWrite = process.stdout.write;
    process.stdout.write = vi.fn((chunk: string) => {
      writeOutput.push(chunk);
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
  });

  it('should create spinner with default message', () => {
    const spinner = new Spinner();
    expect(spinner).toBeDefined();
    spinner.stop(); // Cleanup
  });

  it('should create spinner with custom message', () => {
    const spinner = new Spinner('Loading');
    expect(spinner).toBeDefined();
    spinner.stop(); // Cleanup
  });

  it('should start and write to stdout', async () => {
    const spinner = new Spinner('Test');
    spinner.start();
    
    // Wait for at least one frame
    await new Promise(resolve => setTimeout(resolve, 100));
    
    spinner.stop();
    
    expect(writeOutput.length).toBeGreaterThan(0);
  });

  it('should update message', () => {
    const spinner = new Spinner('Initial');
    spinner.update('Updated');
    spinner.stop();
    // Just verify it doesn't throw
  });

  it('should not start multiple times', async () => {
    const spinner = new Spinner('Test');
    spinner.start();
    spinner.start(); // Should be a no-op
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    spinner.stop();
    // Should not throw or cause issues
  });

  it('should stop cleanly', () => {
    const spinner = new Spinner('Test');
    spinner.start();
    spinner.stop();
    spinner.stop(); // Multiple stops should be safe
  });
});
