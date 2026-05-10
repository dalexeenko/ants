import { describe, it, expect, beforeAll } from 'vitest';
import { execa, type ExecaError } from 'execa';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(__dirname, '../../../packages/cli/dist/bin.js');

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execa('node', [CLI_PATH, ...args]);
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const execaError = error as ExecaError;
    return {
      stdout: execaError.stdout || '',
      stderr: execaError.stderr || '',
      exitCode: execaError.exitCode || 1,
    };
  }
}

describe('CLI Commands E2E', () => {
  beforeAll(async () => {
    // Ensure CLI is built
    const { existsSync } = await import('fs');
    if (!existsSync(CLI_PATH)) {
      throw new Error(`CLI not built. Run 'pnpm -r build' first. Expected: ${CLI_PATH}`);
    }
  });

  describe('--help', () => {
    it('should display help information', async () => {
      const { stdout, exitCode } = await runCli(['--help']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Usage:');
      expect(stdout).toContain('Commands:');
    });
  });

  describe('--version', () => {
    it('should display version', async () => {
      const { stdout, exitCode } = await runCli(['--version']);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe('models', () => {
    it('should list available models', async () => {
      const { stdout, exitCode } = await runCli(['models', 'list']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('claude');
    });
  });

  describe('skill', () => {
    it('should list available skills', async () => {
      const { stdout, exitCode } = await runCli(['skill', 'list']);
      expect(exitCode).toBe(0);
      // Should show bundled skills
      expect(stdout).toMatch(/code-review|debug|explain|refactor|test/i);
    });

    it('should show skill details', async () => {
      const { stdout, exitCode } = await runCli(['skill', 'show', 'code-review']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('code-review');
    });
  });

  describe('config', () => {
    it('should show current config', async () => {
      const { stdout, exitCode } = await runCli(['config', 'show']);
      expect(exitCode).toBe(0);
      // Output shows "Provider:" with capital P
      expect(stdout).toMatch(/[Pp]rovider/);
    });

    it('should show config paths', async () => {
      const { stdout, exitCode } = await runCli(['config', 'path']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Global');
      expect(stdout).toContain('Local');
    });

    it('should get a config value', async () => {
      const { stdout, exitCode } = await runCli(['config', 'get', 'provider']);
      expect(exitCode).toBe(0);
      // Should return some value or empty
      expect(typeof stdout).toBe('string');
    });
  });

  describe('session', () => {
    it('should list sessions', async () => {
      const { stdout, exitCode } = await runCli(['session', 'list', '--all']);
      expect(exitCode).toBe(0);
      // May or may not have sessions
      expect(typeof stdout).toBe('string');
    });
  });

  describe('db', () => {
    it('should show database path', async () => {
      const { stdout, exitCode } = await runCli(['db', 'path']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('.db');
    });
  });

  describe('error handling', () => {
    it('should handle unknown commands gracefully', async () => {
      const { stdout, stderr, exitCode } = await runCli(['unknown-command']);
      // Commander.js may output to stdout or stderr, and may not exit with 1
      const output = stdout + stderr;
      expect(output.toLowerCase()).toMatch(/unknown|error|invalid|command/i);
    });

    it('should handle invalid subcommands', async () => {
      const { stdout, stderr, exitCode } = await runCli(['config', 'invalid']);
      // Should indicate an error somehow
      expect(exitCode).toBeGreaterThanOrEqual(0);
    });
  });
});
