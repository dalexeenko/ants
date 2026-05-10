import { describe, it, expect } from 'vitest';
import { getLanguageId, LANGUAGE_IDS, DEFAULT_LANGUAGE_SERVERS } from '../types.js';

describe('getLanguageId', () => {
  describe('TypeScript/JavaScript files', () => {
    it('should return "typescript" for .ts files', () => {
      expect(getLanguageId('file.ts')).toBe('typescript');
      expect(getLanguageId('/path/to/file.ts')).toBe('typescript');
    });

    it('should return "typescriptreact" for .tsx files', () => {
      expect(getLanguageId('component.tsx')).toBe('typescriptreact');
    });

    it('should return "javascript" for .js files', () => {
      expect(getLanguageId('file.js')).toBe('javascript');
    });

    it('should return "javascript" for .mjs and .cjs files', () => {
      expect(getLanguageId('module.mjs')).toBe('javascript');
      expect(getLanguageId('common.cjs')).toBe('javascript');
    });

    it('should return "javascriptreact" for .jsx files', () => {
      expect(getLanguageId('component.jsx')).toBe('javascriptreact');
    });
  });

  describe('Other languages', () => {
    it('should return "python" for .py files', () => {
      expect(getLanguageId('script.py')).toBe('python');
    });

    it('should return "go" for .go files', () => {
      expect(getLanguageId('main.go')).toBe('go');
    });

    it('should return "rust" for .rs files', () => {
      expect(getLanguageId('lib.rs')).toBe('rust');
    });

    it('should return "json" for .json files', () => {
      expect(getLanguageId('package.json')).toBe('json');
    });

    it('should return "yaml" for .yaml and .yml files', () => {
      expect(getLanguageId('config.yaml')).toBe('yaml');
      expect(getLanguageId('config.yml')).toBe('yaml');
    });

    it('should return "markdown" for .md files', () => {
      expect(getLanguageId('README.md')).toBe('markdown');
    });

    it('should return "html" for .html files', () => {
      expect(getLanguageId('index.html')).toBe('html');
    });

    it('should return "css" for .css files', () => {
      expect(getLanguageId('styles.css')).toBe('css');
    });
  });

  describe('Special cases (files without typical extensions)', () => {
    it('should return "dockerfile" for Dockerfile', () => {
      expect(getLanguageId('Dockerfile')).toBe('dockerfile');
      expect(getLanguageId('/path/to/Dockerfile')).toBe('dockerfile');
    });

    it('should return "makefile" for Makefile', () => {
      expect(getLanguageId('Makefile')).toBe('makefile');
      expect(getLanguageId('GNUmakefile')).toBe('makefile');
    });

    it('should return "cmake" for CMakeLists.txt', () => {
      expect(getLanguageId('CMakeLists.txt')).toBe('cmake');
    });
  });

  describe('Case insensitivity for extensions', () => {
    it('should handle uppercase extensions', () => {
      expect(getLanguageId('file.TS')).toBe('typescript');
      expect(getLanguageId('file.PY')).toBe('python');
      expect(getLanguageId('file.JSON')).toBe('json');
    });

    it('should handle mixed case extensions', () => {
      expect(getLanguageId('file.Ts')).toBe('typescript');
    });
  });

  describe('Unknown extensions', () => {
    it('should return undefined for unknown extensions', () => {
      expect(getLanguageId('file.unknown')).toBeUndefined();
      expect(getLanguageId('file.xyz')).toBeUndefined();
    });

    it('should return undefined for files without extensions', () => {
      expect(getLanguageId('somefile')).toBeUndefined();
    });
  });
});

describe('LANGUAGE_IDS', () => {
  it('should be a non-empty object', () => {
    expect(typeof LANGUAGE_IDS).toBe('object');
    expect(Object.keys(LANGUAGE_IDS).length).toBeGreaterThan(0);
  });

  it('should have string values', () => {
    for (const [ext, langId] of Object.entries(LANGUAGE_IDS)) {
      expect(typeof ext).toBe('string');
      expect(typeof langId).toBe('string');
      expect(ext.startsWith('.')).toBe(true);
    }
  });

  it('should contain common extensions', () => {
    expect(LANGUAGE_IDS['.ts']).toBe('typescript');
    expect(LANGUAGE_IDS['.js']).toBe('javascript');
    expect(LANGUAGE_IDS['.py']).toBe('python');
    expect(LANGUAGE_IDS['.go']).toBe('go');
    expect(LANGUAGE_IDS['.rs']).toBe('rust');
  });
});

describe('DEFAULT_LANGUAGE_SERVERS', () => {
  it('should be a non-empty object', () => {
    expect(typeof DEFAULT_LANGUAGE_SERVERS).toBe('object');
    expect(Object.keys(DEFAULT_LANGUAGE_SERVERS).length).toBeGreaterThan(0);
  });

  it('should have valid structure for each server', () => {
    for (const [lang, config] of Object.entries(DEFAULT_LANGUAGE_SERVERS)) {
      expect(typeof lang).toBe('string');
      expect(config).toHaveProperty('command');
      expect(typeof config.command).toBe('string');
      
      if (config.args) {
        expect(Array.isArray(config.args)).toBe(true);
      }
      
      if (config.rootPatterns) {
        expect(Array.isArray(config.rootPatterns)).toBe(true);
      }
    }
  });

  it('should include TypeScript server', () => {
    expect(DEFAULT_LANGUAGE_SERVERS.typescript).toBeDefined();
    expect(DEFAULT_LANGUAGE_SERVERS.typescript.command).toBe('typescript-language-server');
  });

  it('should include Go server', () => {
    expect(DEFAULT_LANGUAGE_SERVERS.go).toBeDefined();
    expect(DEFAULT_LANGUAGE_SERVERS.go.command).toBe('gopls');
  });

  it('should include Python server', () => {
    expect(DEFAULT_LANGUAGE_SERVERS.python).toBeDefined();
    expect(DEFAULT_LANGUAGE_SERVERS.python.command).toBe('pyright-langserver');
  });

  it('should include Rust server', () => {
    expect(DEFAULT_LANGUAGE_SERVERS.rust).toBeDefined();
    expect(DEFAULT_LANGUAGE_SERVERS.rust.command).toBe('rust-analyzer');
  });
});
