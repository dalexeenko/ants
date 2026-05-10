/**
 * PlatformContext — React context for platform-specific capabilities.
 *
 * Components in `@ants/ui` that need platform-specific behavior (native
 * file dialogs, keyboard shortcuts via main process, deeplinks, embedded
 * browser views, etc.) consume this context. Each host app (desktop, web,
 * mobile) provides its own adapter implementation.
 *
 * All methods are optional — components must gracefully degrade when a
 * capability is absent. For example, if `openDirectoryDialog` is not
 * provided, the project setup form uses the server's filesystem API
 * through the bridge instead.
 */

import { createContext, useContext, type ReactNode } from 'react';
import React from 'react';

// ============================================================================
// Auto-Update Status
// ============================================================================

export interface UpdateStatus {
  /** Current state of the updater */
  state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  /** Update info when an update is available or downloaded */
  info?: {
    version: string;
    releaseDate?: string;
    releaseNotes?: string;
  };
  /** Download progress (0-100) */
  progress?: number;
  /** Error message if state is 'error' */
  error?: string;
}

// ============================================================================
// Platform Adapter Interface
// ============================================================================

export interface PlatformAdapter {
  /**
   * Platform identifier. Components can use this to conditionally render
   * platform-specific UI (e.g. traffic-light spacer on macOS desktop).
   */
  platform: 'desktop' | 'web' | 'mobile';

  // ── Filesystem dialogs ──────────────────────────────────────────────

  /** Open a native directory picker dialog. Returns the selected path or null. */
  openDirectoryDialog?: () => Promise<string | null>;

  /** Get the user's Documents directory path. */
  getDocumentsPath?: () => Promise<string>;

  /** Ensure a directory exists on the local filesystem (mkdir -p). */
  ensureDirectoryExists?: (path: string) => Promise<void>;

  /** Write a file to the local filesystem. */
  writeFile?: (filePath: string, content: string) => Promise<void>;

  /** Open a path in the system's file browser (Finder, Explorer, etc.). */
  openInFileBrowser?: (path: string) => Promise<void>;

  // ── Keyboard shortcuts ──────────────────────────────────────────────

  /**
   * Register a handler for a named keyboard shortcut from the host app.
   * Returns an unsubscribe function.
   *
   * On desktop, these come from Electron's main process via IPC.
   * On web, the AppShell registers DOM keydown handlers and dispatches
   * to the same named shortcut system.
   */
  onShortcut?: (shortcut: string, callback: (...args: unknown[]) => void) => () => void;

  // ── Deeplinks ───────────────────────────────────────────────────────

  /**
   * Register a handler for deeplink URLs (e.g. ants://...).
   * Returns an unsubscribe function.
   */
  onDeeplink?: (callback: (url: string) => void) => () => void;

  // ── Auth callbacks ──────────────────────────────────────────────────

  /**
   * Register a handler for auth callback URLs.
   * Returns an unsubscribe function.
   */
  onAuthCallback?: (callback: (url: string) => void) => () => void;

  // ── Director IPC (desktop-only) ─────────────────────────────────────

  /** Register a handler for Director agent navigation commands. */
  onDirectorNavigate?: (callback: (target: string) => void) => () => void;

  /** Register a handler for Director agent theme changes. */
  onDirectorSetTheme?: (callback: (mode: string) => void) => () => void;

  // ── Screenshot URL resolution ────────────────────────────────────────

  /**
   * Resolve a screenshot file path (relative to .ants/) to a displayable
   * URL. Each platform resolves differently:
   * - Desktop: ants-screenshot://<projectId>/<path>
   * - Web: /api/beta/projects/<projectId>/<path>
   * - Mobile: file:// URL via the filesystem adapter
   *
   * @param projectId The project that owns the screenshot
   * @param path Relative path from .ants/ (e.g. "screenshots/abc.png")
   * @returns A URL the renderer can use as an image src
   */
  resolveScreenshotUrl?: (projectId: string, path: string) => string;

  // ── Auto-update (desktop-only) ────────────────────────────────────

  update?: {
    /** Check for updates manually. Returns update info or null. */
    checkForUpdate: () => Promise<unknown>;
    /** Quit the app and install the downloaded update. */
    installUpdate: () => Promise<void>;
    /** Get the current update status. */
    getStatus: () => Promise<UpdateStatus>;
    /** Subscribe to update status changes. Returns an unsubscribe function. */
    onStatusChange: (callback: (status: UpdateStatus) => void) => () => void;
  };

  // ── Embedded browser views (desktop-only) ───────────────────────────

  browserView?: {
    show: (browserId: string) => Promise<void>;
    hide: (browserId: string) => Promise<void>;
    hideAll: () => Promise<void>;
    setBounds: (browserId: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<void>;
    destroy: (browserId: string) => Promise<void>;
    onNavigated: (callback: (browserId: string, url: string) => void) => () => void;
  };
}

// ============================================================================
// Default (no-op) adapter — used when no platform adapter is provided
// ============================================================================

const defaultAdapter: PlatformAdapter = {
  platform: 'web',
};

// ============================================================================
// React Context
// ============================================================================

const PlatformCtx = createContext<PlatformAdapter>(defaultAdapter);

export interface PlatformProviderProps {
  adapter: PlatformAdapter;
  children: ReactNode;
}

export function PlatformProvider({ adapter, children }: PlatformProviderProps) {
  return (
    <PlatformCtx.Provider value={adapter}>
      {children}
    </PlatformCtx.Provider>
  );
}

/** Get the current platform adapter. */
export function usePlatform(): PlatformAdapter {
  return useContext(PlatformCtx);
}
