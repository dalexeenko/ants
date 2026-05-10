/**
 * LSP Module Exports
 */

export { LspClient, type LspClientOptions, type LspClientEvents } from "./client.js";
export { LspManager, type LspManagerOptions, type LspManagerEvents, type LspConfig, type LspServerConfig, type FormattedDiagnostic } from "./manager.js";
export { LspTransport } from "./transport.js";
export {
  // Types
  type Diagnostic,
  type DiagnosticSeverity,
  type Position,
  type Range,
  type Location,
  type ServerCapabilities,
  type LanguageServerConfig,
  // Utilities
  getLanguageId,
  LANGUAGE_IDS,
  DEFAULT_LANGUAGE_SERVERS,
} from "./types.js";
