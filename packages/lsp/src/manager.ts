/**
 * LSP Manager
 * Manages multiple language server clients based on file types
 */

import { EventEmitter } from "eventemitter3";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { pathToFileURL, fileURLToPath } from "url";
import { LspClient, type LspClientOptions } from "./client.js";
import {
  getLanguageId,
  DEFAULT_LANGUAGE_SERVERS,
  type LanguageServerConfig,
  type Diagnostic,
  DiagnosticSeverity,
} from "./types.js";

export interface LspServerConfig {
  /** Whether this server is disabled */
  disabled?: boolean;
  /** Command to run the server */
  command?: string;
  /** Arguments for the command */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Root patterns to detect workspace root */
  rootPatterns?: string[];
}

export interface LspConfig {
  /** Per-language server configurations */
  [languageId: string]: LspServerConfig;
}

export interface LspManagerOptions {
  /** Working directory */
  workingDirectory: string;
  /** LSP configuration */
  config?: LspConfig;
  /** Enable debug logging */
  debug?: boolean;
}

export interface LspManagerEvents {
  diagnostics: (uri: string, diagnostics: Diagnostic[]) => void;
  "server.started": (languageId: string) => void;
  "server.stopped": (languageId: string) => void;
  "server.error": (languageId: string, error: Error) => void;
}

export interface FormattedDiagnostic {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  source?: string;
  code?: string | number;
}

/**
 * LSP Manager coordinates multiple language servers
 */
export class LspManager extends EventEmitter<LspManagerEvents> {
  private options: LspManagerOptions;
  private clients = new Map<string, LspClient>();
  private startingClients = new Map<string, Promise<LspClient>>();
  private config: LspConfig;

  constructor(options: LspManagerOptions) {
    super();
    this.options = options;
    this.config = options.config ?? {};
  }

  /**
   * Get or start a language server for a file
   */
  async getClientForFile(filePath: string): Promise<LspClient | null> {
    const languageId = getLanguageId(filePath);
    if (!languageId) {
      return null;
    }

    return this.getClient(languageId, filePath);
  }

  /**
   * Get or start a language server for a language
   */
  async getClient(languageId: string, filePath?: string): Promise<LspClient | null> {
    // Check if disabled
    const userConfig = this.config[languageId];
    if (userConfig?.disabled) {
      return null;
    }

    // Return existing client
    const existing = this.clients.get(languageId);
    if (existing?.initialized) {
      return existing;
    }

    // Check if already starting
    const starting = this.startingClients.get(languageId);
    if (starting) {
      return starting;
    }

    // Get server config
    const serverConfig = this.getServerConfig(languageId);
    if (!serverConfig) {
      return null;
    }

    // Check if server command exists
    const commandExists = await this.checkCommandExists(serverConfig.command);
    if (!commandExists) {
      if (this.options.debug) {
        console.log(`[LSP] Server command not found: ${serverConfig.command}`);
      }
      return null;
    }

    // Find workspace root
    const rootPath = filePath
      ? await this.findWorkspaceRoot(filePath, serverConfig.rootPatterns ?? [])
      : this.options.workingDirectory;

    const rootUri = pathToFileURL(rootPath).href;

    // Start the client
    const startPromise = this.startClient(languageId, serverConfig, rootUri);
    this.startingClients.set(languageId, startPromise);

    try {
      const client = await startPromise;
      this.startingClients.delete(languageId);
      return client;
    } catch (err) {
      this.startingClients.delete(languageId);
      this.emit("server.error", languageId, err as Error);
      return null;
    }
  }

  /**
   * Start a language server client
   */
  private async startClient(
    languageId: string,
    config: LanguageServerConfig,
    rootUri: string
  ): Promise<LspClient> {
    const clientOptions: LspClientOptions = {
      languageId,
      config,
      rootUri,
      workingDirectory: this.options.workingDirectory,
    };

    const client = new LspClient(clientOptions);

    // Forward events
    client.on("diagnostics", (uri, diagnostics) => {
      this.emit("diagnostics", uri, diagnostics);
    });

    client.on("error", (error) => {
      this.emit("server.error", languageId, error);
    });

    client.on("close", () => {
      this.clients.delete(languageId);
      this.emit("server.stopped", languageId);
    });

    await client.start();
    this.clients.set(languageId, client);
    this.emit("server.started", languageId);

    if (this.options.debug) {
      console.log(`[LSP] Started ${languageId} server`);
    }

    return client;
  }

  /**
   * Get server config for a language
   */
  private getServerConfig(languageId: string): LanguageServerConfig | null {
    const userConfig = this.config[languageId];
    const defaultConfig = DEFAULT_LANGUAGE_SERVERS[languageId];

    if (!defaultConfig && !userConfig?.command) {
      return null;
    }

    return {
      command: userConfig?.command ?? defaultConfig?.command ?? "",
      args: userConfig?.args ?? defaultConfig?.args ?? [],
      env: userConfig?.env ?? defaultConfig?.env,
      rootPatterns: userConfig?.rootPatterns ?? defaultConfig?.rootPatterns ?? [],
    };
  }

  /**
   * Check if a command exists
   */
  private async checkCommandExists(command: string): Promise<boolean> {
    const { execSync } = await import("child_process");
    try {
      execSync(`which ${command}`, { stdio: "ignore" });
      return true;
    } catch {
      // Try Windows 'where' command
      try {
        execSync(`where ${command}`, { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Find workspace root by looking for root pattern files
   */
  private async findWorkspaceRoot(filePath: string, rootPatterns: string[]): Promise<string> {
    let dir = dirname(resolve(filePath));
    const root = resolve("/");

    while (dir !== root) {
      for (const pattern of rootPatterns) {
        if (existsSync(join(dir, pattern))) {
          return dir;
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    // Fall back to working directory
    return this.options.workingDirectory;
  }

  /**
   * Open a file in the appropriate language server
   */
  async openFile(filePath: string): Promise<void> {
    const absolutePath = resolve(this.options.workingDirectory, filePath);
    const client = await this.getClientForFile(absolutePath);
    if (!client) return;

    const uri = pathToFileURL(absolutePath).href;
    const content = await readFile(absolutePath, "utf-8");
    await client.openDocument(uri, content);
  }

  /**
   * Update a file in the appropriate language server
   */
  async updateFile(filePath: string, content?: string): Promise<void> {
    const absolutePath = resolve(this.options.workingDirectory, filePath);
    const client = await this.getClientForFile(absolutePath);
    if (!client) return;

    const uri = pathToFileURL(absolutePath).href;
    const fileContent = content ?? (await readFile(absolutePath, "utf-8"));
    await client.updateDocument(uri, fileContent);
  }

  /**
   * Save a file notification
   */
  async saveFile(filePath: string): Promise<void> {
    const absolutePath = resolve(this.options.workingDirectory, filePath);
    const client = await this.getClientForFile(absolutePath);
    if (!client) return;

    const uri = pathToFileURL(absolutePath).href;
    await client.saveDocument(uri);
  }

  /**
   * Close a file in the appropriate language server
   */
  async closeFile(filePath: string): Promise<void> {
    const absolutePath = resolve(this.options.workingDirectory, filePath);
    const client = await this.getClientForFile(absolutePath);
    if (!client) return;

    const uri = pathToFileURL(absolutePath).href;
    await client.closeDocument(uri);
  }

  /**
   * Get diagnostics for a file
   */
  async getDiagnostics(filePath: string): Promise<FormattedDiagnostic[]> {
    const absolutePath = resolve(this.options.workingDirectory, filePath);
    const client = await this.getClientForFile(absolutePath);
    if (!client) return [];

    const uri = pathToFileURL(absolutePath).href;
    
    // Open the file to trigger diagnostics
    const content = await readFile(absolutePath, "utf-8");
    await client.openDocument(uri, content);

    // Wait a bit for diagnostics to come in
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const diagnostics = client.getDiagnostics(uri);
    return this.formatDiagnostics(filePath, diagnostics);
  }

  /**
   * Get all diagnostics from all servers
   */
  getAllDiagnostics(): Map<string, FormattedDiagnostic[]> {
    const result = new Map<string, FormattedDiagnostic[]>();

    for (const client of this.clients.values()) {
      const allDiags = client.getAllDiagnostics();
      for (const [uri, diagnostics] of allDiags) {
        const filePath = fileURLToPath(uri);
        const relativePath = filePath.startsWith(this.options.workingDirectory)
          ? filePath.slice(this.options.workingDirectory.length + 1)
          : filePath;
        result.set(relativePath, this.formatDiagnostics(relativePath, diagnostics));
      }
    }

    return result;
  }

  /**
   * Format diagnostics for display
   */
  private formatDiagnostics(filePath: string, diagnostics: Diagnostic[]): FormattedDiagnostic[] {
    return diagnostics.map((d) => ({
      file: filePath,
      line: d.range.start.line + 1, // LSP uses 0-based lines
      column: d.range.start.character + 1,
      endLine: d.range.end.line + 1,
      endColumn: d.range.end.character + 1,
      severity: this.formatSeverity(d.severity),
      message: d.message,
      source: d.source,
      code: d.code,
    }));
  }

  /**
   * Format severity level
   */
  private formatSeverity(severity?: DiagnosticSeverity): "error" | "warning" | "info" | "hint" {
    switch (severity) {
      case DiagnosticSeverity.Error:
        return "error";
      case DiagnosticSeverity.Warning:
        return "warning";
      case DiagnosticSeverity.Information:
        return "info";
      case DiagnosticSeverity.Hint:
        return "hint";
      default:
        return "error";
    }
  }

  /**
   * Get list of active servers
   */
  getActiveServers(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Check if a server is running for a language
   */
  hasServer(languageId: string): boolean {
    return this.clients.has(languageId) && this.clients.get(languageId)!.initialized;
  }

  /**
   * Stop a specific language server
   */
  async stopServer(languageId: string): Promise<void> {
    const client = this.clients.get(languageId);
    if (client) {
      await client.shutdown();
      this.clients.delete(languageId);
    }
  }

  /**
   * Shutdown all language servers
   */
  async shutdown(): Promise<void> {
    const shutdownPromises = Array.from(this.clients.values()).map((client) =>
      client.shutdown().catch(() => {})
    );
    await Promise.all(shutdownPromises);
    this.clients.clear();
  }
}
