/**
 * LSP Client
 * Manages a single language server process and communication
 */

import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "eventemitter3";
import { LspTransport } from "./transport.js";
import type {
  JsonRpcMessage,
  JsonRpcResponse,
  InitializeParams,
  InitializeResult,
  ServerCapabilities,
  Diagnostic,
  PublishDiagnosticsParams,
  DidOpenTextDocumentParams,
  DidChangeTextDocumentParams,
  DidCloseTextDocumentParams,
  DidSaveTextDocumentParams,
  TextDocumentItem,
  LanguageServerConfig,
  ClientCapabilities,
} from "./types.js";

export interface LspClientOptions {
  /** Language ID (e.g., "typescript", "go") */
  languageId: string;
  /** Server configuration */
  config: LanguageServerConfig;
  /** Root URI of the workspace */
  rootUri: string;
  /** Working directory for the server process */
  workingDirectory: string;
}

export interface LspClientEvents {
  diagnostics: (uri: string, diagnostics: Diagnostic[]) => void;
  error: (error: Error) => void;
  close: () => void;
  initialized: () => void;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  method: string;
}

/**
 * LSP Client manages communication with a single language server
 */
export class LspClient extends EventEmitter<LspClientEvents> {
  private options: LspClientOptions;
  private process: ChildProcess | null = null;
  private transport: LspTransport | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number | string, PendingRequest>();
  private capabilities: ServerCapabilities | null = null;
  private isInitialized = false;
  private isShuttingDown = false;
  private openDocuments = new Map<string, { version: number; languageId: string }>();
  private diagnosticsCache = new Map<string, Diagnostic[]>();

  constructor(options: LspClientOptions) {
    super();
    this.options = options;
  }

  /**
   * Start the language server process and initialize
   */
  async start(): Promise<void> {
    if (this.process) {
      throw new Error("LSP client already started");
    }

    const { config, workingDirectory } = this.options;

    // Spawn the language server process
    this.process = spawn(config.command, config.args ?? [], {
      cwd: workingDirectory,
      env: { ...process.env, ...config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (!this.process.stdin || !this.process.stdout) {
      throw new Error("Failed to create language server process pipes");
    }

    // Set up transport
    this.transport = new LspTransport(this.process.stdout, this.process.stdin);

    this.transport.onMessage((message) => {
      this.handleMessage(message);
    });

    this.transport.onError((error) => {
      this.emit("error", error);
    });

    this.transport.onClose(() => {
      if (!this.isShuttingDown) {
        this.emit("close");
      }
    });

    // Handle process errors
    this.process.on("error", (err) => {
      this.emit("error", new Error(`LSP process error: ${err.message}`));
    });

    this.process.on("exit", (code, signal) => {
      if (!this.isShuttingDown && code !== 0) {
        this.emit("error", new Error(`LSP process exited with code ${code}, signal ${signal}`));
      }
      this.cleanup();
    });

    // Log stderr for debugging
    this.process.stderr?.on("data", (data: Buffer) => {
      // Could emit this as a debug event
      // console.error(`[LSP ${this.options.languageId}] ${data.toString()}`);
    });

    // Initialize the server
    await this.initialize();
  }

  /**
   * Initialize the language server
   */
  private async initialize(): Promise<void> {
    const capabilities: ClientCapabilities = {
      textDocument: {
        synchronization: {
          dynamicRegistration: false,
          willSave: false,
          willSaveWaitUntil: false,
          didSave: true,
        },
        publishDiagnostics: {
          relatedInformation: true,
          versionSupport: true,
          tagSupport: {
            valueSet: [1, 2], // Unnecessary, Deprecated
          },
        },
        completion: {
          dynamicRegistration: false,
          completionItem: {
            snippetSupport: false,
            commitCharactersSupport: false,
            documentationFormat: ["plaintext", "markdown"],
            deprecatedSupport: true,
            preselectSupport: false,
          },
          contextSupport: false,
        },
        hover: {
          dynamicRegistration: false,
          contentFormat: ["plaintext", "markdown"],
        },
        definition: {
          dynamicRegistration: false,
          linkSupport: false,
        },
        references: {
          dynamicRegistration: false,
        },
        documentSymbol: {
          dynamicRegistration: false,
          hierarchicalDocumentSymbolSupport: true,
        },
        codeAction: {
          dynamicRegistration: false,
        },
      },
      workspace: {
        applyEdit: false,
        workspaceEdit: {
          documentChanges: false,
        },
        didChangeConfiguration: {
          dynamicRegistration: false,
        },
        didChangeWatchedFiles: {
          dynamicRegistration: false,
        },
        workspaceFolders: true,
        configuration: true,
      },
    };

    const params: InitializeParams = {
      processId: process.pid,
      clientInfo: {
        name: "openmgr-agent",
        version: "0.1.0",
      },
      rootUri: this.options.rootUri,
      capabilities,
      workspaceFolders: [
        {
          uri: this.options.rootUri,
          name: "workspace",
        },
      ],
    };

    const result = await this.sendRequest<InitializeResult>("initialize", params);
    this.capabilities = result.capabilities;

    // Send initialized notification
    this.sendNotification("initialized", {});
    this.isInitialized = true;
    this.emit("initialized");
  }

  /**
   * Send a request and wait for response
   */
  private sendRequest<T>(method: string, params?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.transport || this.transport.closed) {
        reject(new Error("LSP transport not available"));
        return;
      }

      const id = ++this.requestId;
      this.pendingRequests.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        method,
      });

      this.transport.sendRequest(id, method, params);

      // Timeout after 30 seconds
      setTimeout(() => {
        const pending = this.pendingRequests.get(id);
        if (pending) {
          this.pendingRequests.delete(id);
          pending.reject(new Error(`LSP request timeout: ${method}`));
        }
      }, 30000);
    });
  }

  /**
   * Send a notification (no response expected)
   */
  private sendNotification(method: string, params?: unknown): void {
    if (!this.transport || this.transport.closed) {
      return;
    }
    this.transport.sendNotification(method, params);
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(message: JsonRpcMessage): void {
    if ("id" in message && message.id !== undefined) {
      // Response to a request
      const response = message as JsonRpcResponse;
      const pending = this.pendingRequests.get(response.id as number | string);
      if (pending) {
        this.pendingRequests.delete(response.id as number | string);
        if (response.error) {
          pending.reject(new Error(`${pending.method}: ${response.error.message}`));
        } else {
          pending.resolve(response.result);
        }
      }
    } else if ("method" in message) {
      // Notification from server
      const notification = message as { method: string; params?: unknown };
      this.handleNotification(notification.method, notification.params);
    }
  }

  /**
   * Handle server notifications
   */
  private handleNotification(method: string, params: unknown): void {
    switch (method) {
      case "textDocument/publishDiagnostics": {
        const diagnosticParams = params as PublishDiagnosticsParams;
        this.diagnosticsCache.set(diagnosticParams.uri, diagnosticParams.diagnostics);
        this.emit("diagnostics", diagnosticParams.uri, diagnosticParams.diagnostics);
        break;
      }
      case "window/logMessage":
      case "window/showMessage":
        // Could handle these if needed
        break;
      default:
        // Ignore unknown notifications
        break;
    }
  }

  /**
   * Open a document in the language server
   */
  async openDocument(uri: string, text: string, languageId?: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error("LSP client not initialized");
    }

    const docLanguageId = languageId ?? this.options.languageId;
    const version = 1;

    this.openDocuments.set(uri, { version, languageId: docLanguageId });

    const params: DidOpenTextDocumentParams = {
      textDocument: {
        uri,
        languageId: docLanguageId,
        version,
        text,
      },
    };

    this.sendNotification("textDocument/didOpen", params);
  }

  /**
   * Update a document in the language server
   */
  async updateDocument(uri: string, text: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error("LSP client not initialized");
    }

    const doc = this.openDocuments.get(uri);
    if (!doc) {
      // Document not open, open it instead
      await this.openDocument(uri, text);
      return;
    }

    doc.version++;

    const params: DidChangeTextDocumentParams = {
      textDocument: {
        uri,
        version: doc.version,
      },
      contentChanges: [{ text }], // Full sync
    };

    this.sendNotification("textDocument/didChange", params);
  }

  /**
   * Save a document
   */
  async saveDocument(uri: string, text?: string): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    const params: DidSaveTextDocumentParams = {
      textDocument: { uri },
      ...(text !== undefined && { text }),
    };

    this.sendNotification("textDocument/didSave", params);
  }

  /**
   * Close a document
   */
  async closeDocument(uri: string): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    this.openDocuments.delete(uri);
    this.diagnosticsCache.delete(uri);

    const params: DidCloseTextDocumentParams = {
      textDocument: { uri },
    };

    this.sendNotification("textDocument/didClose", params);
  }

  /**
   * Get cached diagnostics for a document
   */
  getDiagnostics(uri: string): Diagnostic[] {
    return this.diagnosticsCache.get(uri) ?? [];
  }

  /**
   * Get all cached diagnostics
   */
  getAllDiagnostics(): Map<string, Diagnostic[]> {
    return new Map(this.diagnosticsCache);
  }

  /**
   * Get server capabilities
   */
  getCapabilities(): ServerCapabilities | null {
    return this.capabilities;
  }

  /**
   * Check if client is initialized
   */
  get initialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Get language ID
   */
  get languageId(): string {
    return this.options.languageId;
  }

  /**
   * Shutdown the language server
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized || this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;

    try {
      await this.sendRequest("shutdown", null);
      this.sendNotification("exit", null);
    } catch {
      // Ignore errors during shutdown
    }

    // Wait a bit for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 500));
    this.cleanup();
  }

  /**
   * Force stop the language server
   */
  stop(): void {
    this.isShuttingDown = true;
    this.cleanup();
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }

    if (this.transport) {
      this.transport.close();
      this.transport = null;
    }

    this.pendingRequests.clear();
    this.openDocuments.clear();
    this.isInitialized = false;
  }
}
