// Re-export all public APIs

// Primitives
export * from './primitives';

// Styles
export * from './styles';

// Stores
export * from './store';

// Hooks
export * from './hooks';

// Agent types
export * from './agent';

// Deeplinks
export * from './deeplinks';

// Utils
export { createLogger, setLogLevel, getLogLevel, type Logger, type LogLevel } from './utils/logger';

// Feature components
export * from './chat';
export * from './sidebar';
export * from './permissions';
export * from './questions';
export * from './settings';
export * from './files';
export * from './search';
export * from './terminal';
export * from './panels';
export * from './browser';

// NOTE: Platform and Shell are NOT re-exported from the barrel.
// The Electron main process imports from '@openmgr/ui' for utilities
// (createLogger, types, etc.). Re-exporting shell/platform here would
// pull React, react-native-web, and the entire component tree into the
// main process bundle, crashing it (no DOM in Node.js context).
//
// Import platform and shell directly:
//   import { PlatformProvider, usePlatform } from '@openmgr/ui/src/platform';
//   import { AppShell } from '@openmgr/ui/src/shell';
