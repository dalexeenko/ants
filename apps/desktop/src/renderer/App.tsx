/**
 * Desktop App — thin wrapper that provides the Electron platform adapter
 * and renders the shared AppShell from @openmgr/ui.
 *
 * All UI logic now lives in the AppShell. This file only provides
 * the platform-specific adapter that maps window.electron APIs to the
 * PlatformAdapter interface.
 */

import React, { useMemo } from 'react';
import { PlatformProvider, type PlatformAdapter } from '@openmgr/ui/platform';
import { AppShell } from '@openmgr/ui/shell';

// Extend window type for electron API
declare global {
  interface Window {
    electron?: {
      openDirectoryDialog: () => Promise<string | null>;
      getDocumentsPath: () => Promise<string>;
      ensureDirectoryExists: (path: string) => Promise<void>;
      writeFile: (filePath: string, content: string) => Promise<void>;
      openInFileBrowser: (path: string) => Promise<void>;
      onShortcut: (shortcut: string, callback: (...args: unknown[]) => void) => () => void;
      onAuthCallback: (callback: (url: string) => void) => () => void;
      onDeeplink: (callback: (url: string) => void) => () => void;
      onDirectorNavigate?: (callback: (target: string) => void) => () => void;
      onDirectorSetTheme?: (callback: (mode: string) => void) => () => void;
      update?: {
        checkForUpdate: () => Promise<unknown>;
        installUpdate: () => Promise<void>;
        getStatus: () => Promise<any>;
        onStatusChange: (callback: (status: any) => void) => () => void;
      };
      browserView?: {
        show: (browserId: string) => Promise<void>;
        hide: (browserId: string) => Promise<void>;
        hideAll: () => Promise<void>;
        setBounds: (browserId: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<void>;
        destroy: (browserId: string) => Promise<void>;
        onNavigated: (callback: (browserId: string, url: string) => void) => () => void;
      };
    };
  }
}

/**
 * Create the desktop platform adapter by mapping window.electron to PlatformAdapter.
 */
function createDesktopAdapter(): PlatformAdapter {
  const electron = window.electron;

  return {
    platform: 'desktop',

    // Filesystem dialogs
    openDirectoryDialog: electron?.openDirectoryDialog
      ? () => electron.openDirectoryDialog()
      : undefined,
    getDocumentsPath: electron?.getDocumentsPath
      ? () => electron.getDocumentsPath()
      : undefined,
    ensureDirectoryExists: electron?.ensureDirectoryExists
      ? (path: string) => electron.ensureDirectoryExists(path)
      : undefined,
    writeFile: electron?.writeFile
      ? (filePath: string, content: string) => electron.writeFile(filePath, content)
      : undefined,
    openInFileBrowser: electron?.openInFileBrowser
      ? (path: string) => electron.openInFileBrowser(path)
      : undefined,

    // Keyboard shortcuts
    onShortcut: electron?.onShortcut
      ? (shortcut: string, callback: (...args: unknown[]) => void) => electron.onShortcut(shortcut, callback)
      : undefined,

    // Deeplinks
    onDeeplink: electron?.onDeeplink
      ? (callback: (url: string) => void) => electron.onDeeplink(callback)
      : undefined,

    // Auth callbacks
    onAuthCallback: electron?.onAuthCallback
      ? (callback: (url: string) => void) => electron.onAuthCallback(callback)
      : undefined,

    // Director IPC
    onDirectorNavigate: electron?.onDirectorNavigate
      ? (callback: (target: string) => void) => electron.onDirectorNavigate!(callback)
      : undefined,
    onDirectorSetTheme: electron?.onDirectorSetTheme
      ? (callback: (mode: string) => void) => electron.onDirectorSetTheme!(callback)
      : undefined,

    // Auto-update
    update: electron?.update,

    // Embedded browser views
    browserView: electron?.browserView,
  };
}

export function App() {
  const adapter = useMemo(() => createDesktopAdapter(), []);

  return (
    <PlatformProvider adapter={adapter}>
      <AppShell />
    </PlatformProvider>
  );
}
