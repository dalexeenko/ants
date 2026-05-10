import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// We need to test loadConfig which reads process.env and cwd.
// Mock fs.existsSync for .env detection and readJsonFile for config.json.
// loadConfig also calls process.exit on fatal errors, so we mock that too.

describe('loadConfig', () => {
  let testDir: string;
  let dataDir: string;
  const originalCwd = process.cwd;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    testDir = join(tmpdir(), `ants-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    dataDir = join(testDir, 'data');
    mkdirSync(testDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });

    // Set required env vars
    process.env.ANTS_ENCRYPTION_KEY = Buffer.from('a'.repeat(32)).toString('base64');
    process.env.ANTS_DATA_DIR = dataDir;
    process.env.ANTS_WORKSPACES_DIR = join(testDir, 'workspaces');

    // Reset module cache so loadConfig re-reads env
    vi.resetModules();
  });

  afterEach(() => {
    process.cwd = originalCwd;
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('ANTS_')) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);

    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should not read config.json when .env is present in cwd', async () => {
    // Write a config.json with multiUser: true
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify({
      multiUser: true,
    }));

    // Create a .env file in the "cwd"
    writeFileSync(join(testDir, '.env'), 'ANTS_ENCRYPTION_KEY=ignored');

    // Point cwd to testDir
    process.cwd = () => testDir;

    const { loadConfig } = await import('./config.js');
    const config = loadConfig();

    // multiUser should be false (default) since config.json was ignored
    expect(config.multiUser).toBe(false);
  });

  it('should not write config.json when .env is present in cwd', async () => {
    // Create a .env file in the "cwd"
    writeFileSync(join(testDir, '.env'), 'ANTS_ENCRYPTION_KEY=ignored');

    process.cwd = () => testDir;

    const { loadConfig } = await import('./config.js');
    loadConfig();

    // config.json should not be created
    expect(existsSync(join(dataDir, 'config.json'))).toBe(false);
  });

  it('should read config.json when no .env is present', async () => {
    // Write a config.json with a custom port
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify({
      port: 9999,
    }));

    // Point cwd to a directory without .env
    const noDotEnvDir = join(testDir, 'no-dotenv');
    mkdirSync(noDotEnvDir);
    process.cwd = () => noDotEnvDir;

    const { loadConfig } = await import('./config.js');
    const config = loadConfig();

    expect(config.port).toBe(9999);
  });

  it('should write config.json when no .env is present', async () => {
    const noDotEnvDir = join(testDir, 'no-dotenv');
    mkdirSync(noDotEnvDir);
    process.cwd = () => noDotEnvDir;

    const { loadConfig } = await import('./config.js');
    loadConfig();

    expect(existsSync(join(dataDir, 'config.json'))).toBe(true);
    const written = JSON.parse(readFileSync(join(dataDir, 'config.json'), 'utf-8'));
    expect(written).toHaveProperty('port');
    expect(written).toHaveProperty('host');
  });

  it('should parse ANTS_ALLOWED_HOSTS from env', async () => {
    const noDotEnvDir = join(testDir, 'no-dotenv');
    mkdirSync(noDotEnvDir);
    process.cwd = () => noDotEnvDir;
    process.env.ANTS_ALLOWED_HOSTS = 'example.com, Other.COM ';

    const { loadConfig } = await import('./config.js');
    const config = loadConfig();

    expect(config.allowedHosts).toEqual(['example.com', 'other.com']);
  });

  it('should default allowedHosts to empty array', async () => {
    const noDotEnvDir = join(testDir, 'no-dotenv');
    mkdirSync(noDotEnvDir);
    process.cwd = () => noDotEnvDir;

    const { loadConfig } = await import('./config.js');
    const config = loadConfig();

    expect(config.allowedHosts).toEqual([]);
  });

  it('should enable multiUser from ANTS_MULTI_USER env var', async () => {
    writeFileSync(join(testDir, '.env'), '');
    process.cwd = () => testDir;
    process.env.ANTS_MULTI_USER = 'true';
    // Multi-user mode conflicts with explicit secret
    delete process.env.ANTS_SECRET;

    const { loadConfig } = await import('./config.js');
    const config = loadConfig();

    expect(config.multiUser).toBe(true);
    expect(config.secret).toBeUndefined();
  });
});
