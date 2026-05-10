import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ensureDirectory, readJsonFile } from './fs.js';

describe('ensureDirectory', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `openmgr-test-${Date.now()}`);
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should create a directory if it does not exist', () => {
    const dir = join(testDir, 'new-dir');
    expect(existsSync(dir)).toBe(false);
    ensureDirectory(dir);
    expect(existsSync(dir)).toBe(true);
  });

  it('should create nested directories recursively', () => {
    const dir = join(testDir, 'a', 'b', 'c');
    ensureDirectory(dir);
    expect(existsSync(dir)).toBe(true);
  });

  it('should not throw if directory already exists', () => {
    mkdirSync(testDir, { recursive: true });
    expect(() => ensureDirectory(testDir)).not.toThrow();
  });
});

describe('readJsonFile', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `openmgr-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should return default value when file does not exist', () => {
    const result = readJsonFile(join(testDir, 'missing.json'), { foo: 'bar' });
    expect(result).toEqual({ foo: 'bar' });
  });

  it('should parse and return JSON from existing file', () => {
    const filePath = join(testDir, 'test.json');
    writeFileSync(filePath, JSON.stringify({ key: 'value' }));
    const result = readJsonFile(filePath, {});
    expect(result).toEqual({ key: 'value' });
  });

  it('should return default value for invalid JSON', () => {
    const filePath = join(testDir, 'bad.json');
    writeFileSync(filePath, 'not valid json{{{');
    const result = readJsonFile(filePath, { fallback: true });
    expect(result).toEqual({ fallback: true });
  });

  it('should handle null as default value', () => {
    const result = readJsonFile(join(testDir, 'missing.json'), null);
    expect(result).toBeNull();
  });

  it('should handle arrays', () => {
    const filePath = join(testDir, 'array.json');
    writeFileSync(filePath, JSON.stringify([1, 2, 3]));
    const result = readJsonFile<number[]>(filePath, []);
    expect(result).toEqual([1, 2, 3]);
  });
});
