import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readTool } from '../read.js';
import { writeTool } from '../write.js';
import { editTool } from '../edit.js';
import { globTool } from '../glob.js';
import type { ToolContext } from '@openmgr/agent-core';

// Create a temp directory for tests
let testDir: string;

function createTestContext(): ToolContext {
  return {
    workingDirectory: testDir,
    extensions: {},
  };
}

beforeEach(() => {
  testDir = join(tmpdir(), `tools-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

describe('readTool', () => {
  it('should have correct metadata', () => {
    expect(readTool.name).toBe('read');
    expect(readTool.description).toBeDefined();
  });

  it('should read an existing file', async () => {
    const filePath = join(testDir, 'test.txt');
    writeFileSync(filePath, 'Hello, World!');
    
    const ctx = createTestContext();
    const result = await readTool.execute({ path: filePath }, ctx);
    
    expect(result.output).toContain('Hello, World!');
  });

  it('should return error for non-existing file', async () => {
    const filePath = join(testDir, 'nonexistent.txt');
    
    const ctx = createTestContext();
    const result = await readTool.execute({ path: filePath }, ctx);
    
    expect(result.metadata?.error).toBe(true);
  });

  it('should include line numbers', async () => {
    const filePath = join(testDir, 'lines.txt');
    writeFileSync(filePath, 'Line 1\nLine 2\nLine 3');
    
    const ctx = createTestContext();
    const result = await readTool.execute({ path: filePath }, ctx);
    
    expect(result.output).toContain('1');
    expect(result.output).toContain('Line 1');
  });

  it('should apply offset and limit', async () => {
    const filePath = join(testDir, 'many-lines.txt');
    const lines = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`).join('\n');
    writeFileSync(filePath, lines);
    
    const ctx = createTestContext();
    const result = await readTool.execute({ path: filePath, offset: 2, limit: 3 }, ctx);
    
    expect(result.output).toContain('Line 3');
    expect(result.output).toContain('Line 4');
    expect(result.output).toContain('Line 5');
    expect(result.output).not.toContain('Line 1');
    expect(result.output).not.toContain('Line 6');
  });
});

describe('writeTool', () => {
  it('should have correct metadata', () => {
    expect(writeTool.name).toBe('write');
    expect(writeTool.description).toBeDefined();
  });

  it('should write a new file', async () => {
    const filePath = join(testDir, 'new-file.txt');
    const content = 'New file content';
    
    const ctx = createTestContext();
    const result = await writeTool.execute({ path: filePath, content }, ctx);
    
    expect(result.metadata?.error).toBeFalsy();
    expect(existsSync(filePath)).toBe(true);
  });

  it('should create parent directories', async () => {
    const filePath = join(testDir, 'subdir', 'deep', 'file.txt');
    const content = 'Deep file content';
    
    const ctx = createTestContext();
    const result = await writeTool.execute({ path: filePath, content }, ctx);
    
    expect(result.metadata?.error).toBeFalsy();
    expect(existsSync(filePath)).toBe(true);
  });

  it('should overwrite existing file', async () => {
    const filePath = join(testDir, 'existing.txt');
    writeFileSync(filePath, 'Original content');
    
    const ctx = createTestContext();
    const result = await writeTool.execute({ path: filePath, content: 'New content' }, ctx);
    
    expect(result.metadata?.error).toBeFalsy();
  });

  it('should coerce object content to JSON string', async () => {
    const filePath = join(testDir, 'package.json');
    const objectContent = {
      name: "test-package",
      version: "1.0.0",
      scripts: { test: "vitest" },
    };
    
    const ctx = createTestContext();
    const result = await writeTool.execute({ path: filePath, content: objectContent as any }, ctx);
    
    expect(result.metadata?.error).toBeFalsy();
    expect(existsSync(filePath)).toBe(true);
    const written = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(written);
    expect(parsed.name).toBe('test-package');
    expect(parsed.version).toBe('1.0.0');
    expect(parsed.scripts.test).toBe('vitest');
    // Should be pretty-printed with 2-space indent
    expect(written).toContain('  "name"');
  });

  it('should coerce array content to JSON string', async () => {
    const filePath = join(testDir, 'data.json');
    const arrayContent = [{ id: 1 }, { id: 2 }];
    
    const ctx = createTestContext();
    const result = await writeTool.execute({ path: filePath, content: arrayContent as any }, ctx);
    
    expect(result.metadata?.error).toBeFalsy();
    expect(existsSync(filePath)).toBe(true);
    const written = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(written);
    expect(parsed).toEqual([{ id: 1 }, { id: 2 }]);
  });
});

describe('editTool', () => {
  it('should have correct metadata', () => {
    expect(editTool.name).toBe('edit');
    expect(editTool.description).toBeDefined();
  });

  it('should replace text in file', async () => {
    const filePath = join(testDir, 'edit-test.txt');
    writeFileSync(filePath, 'Hello World');
    
    const ctx = createTestContext();
    const result = await editTool.execute({
      path: filePath,
      oldString: 'World',
      newString: 'Universe',
    }, ctx);
    
    expect(result.metadata?.error).toBeFalsy();
  });

  it('should fail when oldString not found', async () => {
    const filePath = join(testDir, 'edit-fail.txt');
    writeFileSync(filePath, 'Hello World');
    
    const ctx = createTestContext();
    const result = await editTool.execute({
      path: filePath,
      oldString: 'NotFound',
      newString: 'Replacement',
    }, ctx);
    
    expect(result.metadata?.error).toBe(true);
    expect(result.output.toLowerCase()).toContain('not found');
  });

  it('should fail when oldString equals newString', async () => {
    const filePath = join(testDir, 'edit-same.txt');
    writeFileSync(filePath, 'Hello World');
    
    const ctx = createTestContext();
    const result = await editTool.execute({
      path: filePath,
      oldString: 'World',
      newString: 'World',
    }, ctx);
    
    expect(result.metadata?.error).toBe(true);
  });
});

describe('globTool', () => {
  it('should have correct metadata', () => {
    expect(globTool.name).toBe('glob');
    expect(globTool.description).toBeDefined();
  });

  it('should find files matching pattern', async () => {
    writeFileSync(join(testDir, 'file1.ts'), '');
    writeFileSync(join(testDir, 'file2.ts'), '');
    writeFileSync(join(testDir, 'file3.js'), '');
    
    const ctx = createTestContext();
    // globTool uses workingDirectory from context, and pattern
    const result = await globTool.execute({ pattern: '*.ts' }, ctx);
    
    expect(result.output).toContain('file1.ts');
    expect(result.output).toContain('file2.ts');
    expect(result.output).not.toContain('file3.js');
  });

  it('should return empty for no matches', async () => {
    const ctx = createTestContext();
    const result = await globTool.execute({ pattern: '*.xyz' }, ctx);
    
    expect(result.output).toContain('No files found');
  });

  it('should handle nested directories', async () => {
    mkdirSync(join(testDir, 'subdir'), { recursive: true });
    writeFileSync(join(testDir, 'subdir', 'nested.ts'), '');
    
    const ctx = createTestContext();
    const result = await globTool.execute({ pattern: '**/*.ts' }, ctx);
    
    expect(result.output).toContain('nested.ts');
  });
});
