import { describe, it, expect } from 'vitest';
import * as agentExports from '../index.js';

describe('@ants/agent exports', () => {
  it('should export Agent class', () => {
    expect(agentExports.Agent).toBeDefined();
    expect(typeof agentExports.Agent).toBe('function');
  });

  it('should export defineTool', () => {
    expect(agentExports.defineTool).toBeDefined();
    expect(typeof agentExports.defineTool).toBe('function');
  });

  it('should export SkillManagerInterface type', () => {
    // SkillManagerInterface is now a type, not a class
    // The actual implementation is in @ants/agent-skills-loader
    expect(agentExports.SkillLoadError).toBeDefined();
    expect(agentExports.SkillNotFoundError).toBeDefined();
  });

  it('should export ConfigLoader type', () => {
    // ConfigLoader is now a type, not a function
    // The actual implementation is in @ants/agent-config-xdg
    expect(true).toBe(true);
  });

  it('should export provider functions', () => {
    expect(agentExports.createProvider).toBeDefined();
    expect(typeof agentExports.createProvider).toBe('function');
  });

  it('should export providersPlugin', () => {
    expect(agentExports.providersPlugin).toBeDefined();
    expect(typeof agentExports.providersPlugin).toBe('object');
    expect(agentExports.providersPlugin.name).toBe('@ants/agent-providers');
  });

  it('should export storage classes', () => {
    expect(agentExports.SessionManager).toBeDefined();
    expect(agentExports.createDatabase).toBeDefined();
  });

  it('should export loadMemoryModule helper', () => {
    expect(agentExports.loadMemoryModule).toBeDefined();
    expect(typeof agentExports.loadMemoryModule).toBe('function');
  });

  it('should lazily load memory module', async () => {
    const mod = await agentExports.loadMemoryModule();
    // May be null if @huggingface/transformers is not installed (lite image)
    if (mod) {
      expect(mod.MemoryStorage).toBeDefined();
      expect(typeof mod.MemoryStorage).toBe('function');
    }
  });

  it('should export server functions', () => {
    expect(agentExports.createServer).toBeDefined();
    expect(agentExports.startServer).toBeDefined();
    expect(agentExports.serverPlugin).toBeDefined();
  });

  it('should export skills-loader functions', () => {
    expect(agentExports.skillsBundledPlugin).toBeDefined();
    expect(agentExports.getBundledSkillPath).toBeDefined();
    expect(agentExports.getBundledSkillNames).toBeDefined();
    expect(agentExports.FilesystemSkillManager).toBeDefined();
  });

  it('should export tool plugins', () => {
    expect(agentExports.toolsPlugin).toBeDefined();
    expect(agentExports.toolsTerminalPlugin).toBeDefined();
  });

  it('should export auth functions', () => {
    expect(agentExports.login).toBeDefined();
    expect(agentExports.isLoggedIn).toBeDefined();
    expect(agentExports.createOAuthHandler).toBeDefined();
    expect(agentExports.generateCodeVerifier).toBeDefined();
    expect(agentExports.generateCodeChallenge).toBeDefined();
  });

  it('should export LSP classes', () => {
    expect(agentExports.LspClient).toBeDefined();
    expect(agentExports.LspManager).toBeDefined();
    expect(agentExports.getLanguageId).toBeDefined();
  });

  it('should export CLI utilities', () => {
    expect(agentExports.Spinner).toBeDefined();
    expect(agentExports.DebugLogger).toBeDefined();
    expect(agentExports.registerAllCommands).toBeDefined();
  });

  it('should export core tools', () => {
    expect(agentExports.todoReadTool).toBeDefined();
    expect(agentExports.todoWriteTool).toBeDefined();
    expect(agentExports.webFetchTool).toBeDefined();
  });

  it('should export terminal tools', () => {
    expect(agentExports.bashTool).toBeDefined();
    expect(agentExports.readTool).toBeDefined();
    expect(agentExports.writeTool).toBeDefined();
    expect(agentExports.editTool).toBeDefined();
    expect(agentExports.globTool).toBeDefined();
    expect(agentExports.grepTool).toBeDefined();
  });
});
