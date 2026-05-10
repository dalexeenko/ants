/**
 * LSP Protocol Types
 * Based on the Language Server Protocol Specification
 * https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/
 */

// JSON-RPC types
export interface JsonRpcMessage {
  jsonrpc: "2.0";
}

export interface JsonRpcRequest extends JsonRpcMessage {
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse extends JsonRpcMessage {
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification extends JsonRpcMessage {
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// LSP Base types
export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  uri: string;
  range: Range;
}

export interface TextDocumentIdentifier {
  uri: string;
}

export interface VersionedTextDocumentIdentifier extends TextDocumentIdentifier {
  version: number;
}

export interface TextDocumentItem {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

export interface TextDocumentContentChangeEvent {
  range?: Range;
  rangeLength?: number;
  text: string;
}

// Diagnostic types
export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4,
}

export interface DiagnosticRelatedInformation {
  location: Location;
  message: string;
}

export interface Diagnostic {
  range: Range;
  severity?: DiagnosticSeverity;
  code?: number | string;
  codeDescription?: { href: string };
  source?: string;
  message: string;
  tags?: number[];
  relatedInformation?: DiagnosticRelatedInformation[];
  data?: unknown;
}

export interface PublishDiagnosticsParams {
  uri: string;
  version?: number;
  diagnostics: Diagnostic[];
}

// Initialize types
export interface ClientCapabilities {
  workspace?: {
    applyEdit?: boolean;
    workspaceEdit?: {
      documentChanges?: boolean;
    };
    didChangeConfiguration?: {
      dynamicRegistration?: boolean;
    };
    didChangeWatchedFiles?: {
      dynamicRegistration?: boolean;
    };
    symbol?: {
      dynamicRegistration?: boolean;
    };
    executeCommand?: {
      dynamicRegistration?: boolean;
    };
    workspaceFolders?: boolean;
    configuration?: boolean;
  };
  textDocument?: {
    synchronization?: {
      dynamicRegistration?: boolean;
      willSave?: boolean;
      willSaveWaitUntil?: boolean;
      didSave?: boolean;
    };
    completion?: {
      dynamicRegistration?: boolean;
      completionItem?: {
        snippetSupport?: boolean;
        commitCharactersSupport?: boolean;
        documentationFormat?: string[];
        deprecatedSupport?: boolean;
        preselectSupport?: boolean;
      };
      completionItemKind?: {
        valueSet?: number[];
      };
      contextSupport?: boolean;
    };
    hover?: {
      dynamicRegistration?: boolean;
      contentFormat?: string[];
    };
    signatureHelp?: {
      dynamicRegistration?: boolean;
      signatureInformation?: {
        documentationFormat?: string[];
        parameterInformation?: {
          labelOffsetSupport?: boolean;
        };
      };
      contextSupport?: boolean;
    };
    declaration?: {
      dynamicRegistration?: boolean;
      linkSupport?: boolean;
    };
    definition?: {
      dynamicRegistration?: boolean;
      linkSupport?: boolean;
    };
    typeDefinition?: {
      dynamicRegistration?: boolean;
      linkSupport?: boolean;
    };
    implementation?: {
      dynamicRegistration?: boolean;
      linkSupport?: boolean;
    };
    references?: {
      dynamicRegistration?: boolean;
    };
    documentHighlight?: {
      dynamicRegistration?: boolean;
    };
    documentSymbol?: {
      dynamicRegistration?: boolean;
      symbolKind?: {
        valueSet?: number[];
      };
      hierarchicalDocumentSymbolSupport?: boolean;
    };
    codeAction?: {
      dynamicRegistration?: boolean;
      codeActionLiteralSupport?: {
        codeActionKind?: {
          valueSet?: string[];
        };
      };
    };
    codeLens?: {
      dynamicRegistration?: boolean;
    };
    documentLink?: {
      dynamicRegistration?: boolean;
    };
    colorProvider?: {
      dynamicRegistration?: boolean;
    };
    formatting?: {
      dynamicRegistration?: boolean;
    };
    rangeFormatting?: {
      dynamicRegistration?: boolean;
    };
    onTypeFormatting?: {
      dynamicRegistration?: boolean;
    };
    rename?: {
      dynamicRegistration?: boolean;
      prepareSupport?: boolean;
    };
    publishDiagnostics?: {
      relatedInformation?: boolean;
      tagSupport?: {
        valueSet?: number[];
      };
      versionSupport?: boolean;
    };
    foldingRange?: {
      dynamicRegistration?: boolean;
      rangeLimit?: number;
      lineFoldingOnly?: boolean;
    };
  };
  general?: {
    staleRequestSupport?: {
      cancel?: boolean;
      retryOnContentModified?: string[];
    };
  };
}

export interface InitializeParams {
  processId: number | null;
  clientInfo?: {
    name: string;
    version?: string;
  };
  rootUri: string | null;
  rootPath?: string | null;
  capabilities: ClientCapabilities;
  initializationOptions?: unknown;
  trace?: "off" | "messages" | "verbose";
  workspaceFolders?: WorkspaceFolder[] | null;
}

export interface WorkspaceFolder {
  uri: string;
  name: string;
}

export interface ServerCapabilities {
  textDocumentSync?: TextDocumentSyncOptions | number;
  completionProvider?: CompletionOptions;
  hoverProvider?: boolean | HoverOptions;
  signatureHelpProvider?: SignatureHelpOptions;
  declarationProvider?: boolean;
  definitionProvider?: boolean;
  typeDefinitionProvider?: boolean;
  implementationProvider?: boolean;
  referencesProvider?: boolean;
  documentHighlightProvider?: boolean;
  documentSymbolProvider?: boolean;
  codeActionProvider?: boolean | CodeActionOptions;
  codeLensProvider?: CodeLensOptions;
  documentLinkProvider?: DocumentLinkOptions;
  colorProvider?: boolean;
  documentFormattingProvider?: boolean;
  documentRangeFormattingProvider?: boolean;
  documentOnTypeFormattingProvider?: DocumentOnTypeFormattingOptions;
  renameProvider?: boolean | RenameOptions;
  foldingRangeProvider?: boolean;
  executeCommandProvider?: ExecuteCommandOptions;
  workspaceSymbolProvider?: boolean;
  workspace?: {
    workspaceFolders?: {
      supported?: boolean;
      changeNotifications?: boolean | string;
    };
  };
  diagnosticProvider?: DiagnosticOptions;
}

export interface TextDocumentSyncOptions {
  openClose?: boolean;
  change?: number; // 0 = None, 1 = Full, 2 = Incremental
  willSave?: boolean;
  willSaveWaitUntil?: boolean;
  save?: SaveOptions | boolean;
}

export interface SaveOptions {
  includeText?: boolean;
}

export interface CompletionOptions {
  triggerCharacters?: string[];
  resolveProvider?: boolean;
}

export interface HoverOptions {
  workDoneProgress?: boolean;
}

export interface SignatureHelpOptions {
  triggerCharacters?: string[];
  retriggerCharacters?: string[];
}

export interface CodeActionOptions {
  codeActionKinds?: string[];
}

export interface CodeLensOptions {
  resolveProvider?: boolean;
}

export interface DocumentLinkOptions {
  resolveProvider?: boolean;
}

export interface DocumentOnTypeFormattingOptions {
  firstTriggerCharacter: string;
  moreTriggerCharacter?: string[];
}

export interface RenameOptions {
  prepareProvider?: boolean;
}

export interface ExecuteCommandOptions {
  commands: string[];
}

export interface DiagnosticOptions {
  identifier?: string;
  interFileDependencies: boolean;
  workspaceDiagnostics: boolean;
}

export interface InitializeResult {
  capabilities: ServerCapabilities;
  serverInfo?: {
    name: string;
    version?: string;
  };
}

// Document sync notifications
export interface DidOpenTextDocumentParams {
  textDocument: TextDocumentItem;
}

export interface DidChangeTextDocumentParams {
  textDocument: VersionedTextDocumentIdentifier;
  contentChanges: TextDocumentContentChangeEvent[];
}

export interface DidSaveTextDocumentParams {
  textDocument: TextDocumentIdentifier;
  text?: string;
}

export interface DidCloseTextDocumentParams {
  textDocument: TextDocumentIdentifier;
}

// Language detection
export const LANGUAGE_IDS: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".go": "go",
  ".py": "python",
  ".rs": "rust",
  ".rb": "ruby",
  ".java": "java",
  ".c": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".php": "php",
  ".swift": "swift",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".scala": "scala",
  ".lua": "lua",
  ".r": "r",
  ".R": "r",
  ".sh": "shellscript",
  ".bash": "shellscript",
  ".zsh": "shellscript",
  ".fish": "shellscript",
  ".ps1": "powershell",
  ".json": "json",
  ".jsonc": "jsonc",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".xml": "xml",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".sass": "sass",
  ".less": "less",
  ".md": "markdown",
  ".markdown": "markdown",
  ".sql": "sql",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".vue": "vue",
  ".svelte": "svelte",
  ".astro": "astro",
  ".zig": "zig",
  ".nim": "nim",
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  ".hrl": "erlang",
  ".hs": "haskell",
  ".lhs": "haskell",
  ".ml": "ocaml",
  ".mli": "ocaml",
  ".fs": "fsharp",
  ".fsi": "fsharp",
  ".fsx": "fsharp",
  ".clj": "clojure",
  ".cljs": "clojure",
  ".cljc": "clojure",
  ".dart": "dart",
  ".jl": "julia",
  ".v": "v",
  ".vhdl": "vhdl",
  ".vhd": "vhdl",
  ".verilog": "verilog",
  ".sv": "systemverilog",
  ".proto": "protobuf",
  ".tf": "terraform",
  ".tfvars": "terraform",
  ".dockerfile": "dockerfile",
  ".cmake": "cmake",
  ".make": "makefile",
  ".makefile": "makefile",
};

export function getLanguageId(filePath: string): string | undefined {
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  
  // Special cases for files without extensions
  const basename = filePath.split("/").pop()?.toLowerCase() ?? "";
  if (basename === "dockerfile") return "dockerfile";
  if (basename === "makefile" || basename === "gnumakefile") return "makefile";
  if (basename === "cmakelists.txt") return "cmake";
  
  return LANGUAGE_IDS[ext];
}

// Default language server configurations
export interface LanguageServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  rootPatterns?: string[];
}

export const DEFAULT_LANGUAGE_SERVERS: Record<string, LanguageServerConfig> = {
  typescript: {
    command: "typescript-language-server",
    args: ["--stdio"],
    rootPatterns: ["tsconfig.json", "jsconfig.json", "package.json"],
  },
  javascript: {
    command: "typescript-language-server",
    args: ["--stdio"],
    rootPatterns: ["jsconfig.json", "package.json"],
  },
  go: {
    command: "gopls",
    args: [],
    rootPatterns: ["go.mod", "go.work"],
  },
  python: {
    command: "pyright-langserver",
    args: ["--stdio"],
    rootPatterns: ["pyproject.toml", "setup.py", "requirements.txt", "pyrightconfig.json"],
  },
  rust: {
    command: "rust-analyzer",
    args: [],
    rootPatterns: ["Cargo.toml"],
  },
  // Add more as needed
};
