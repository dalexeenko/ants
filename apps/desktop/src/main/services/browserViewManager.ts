/**
 * BrowserViewManager — manages WebContentsView instances for embedded browsers.
 *
 * Creates native Electron WebContentsView instances that overlay the renderer's
 * browser tab placeholder. Each browser tab gets its own WebContentsView that
 * can be shown/hidden/resized as tabs switch.
 *
 * The WebContentsView displays the same URL as the Playwright-controlled browser,
 * giving the user a native, full-fidelity view of what the agent is browsing.
 */
import { WebContentsView, BrowserWindow } from 'electron';
import { createLogger } from '@ants/ui';

const log = createLogger('BrowserViewManager');

export interface BrowserViewInfo {
  /** Unique browser ID (matches the agent's browser instance ID) */
  browserId: string;
  /** The WebContentsView instance */
  view: WebContentsView;
  /** Current bounds */
  bounds: { x: number; y: number; width: number; height: number };
  /** Whether this view is currently visible */
  visible: boolean;
  /** Current URL */
  url: string;
}

export class BrowserViewManager {
  private mainWindow: BrowserWindow;
  private views: Map<string, BrowserViewInfo> = new Map();

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
  }

  /**
   * Create a new WebContentsView for a browser instance.
   * The view starts hidden; call `show()` to make it visible.
   */
  create(browserId: string, url?: string): void {
    if (this.views.has(browserId)) {
      log.warn(`View already exists for browser ${browserId}`);
      return;
    }

    const view = new WebContentsView({
      webPreferences: {
        // No preload — this is a sandboxed browser view, not our app
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const info: BrowserViewInfo = {
      browserId,
      view,
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      visible: false,
      url: url || 'about:blank',
    };

    this.views.set(browserId, info);

    // Load the initial URL
    if (url && url !== 'about:blank') {
      view.webContents.loadURL(url).catch((err) => {
        log.error(`Failed to load URL ${url} for browser ${browserId}:`, err);
      });
    }

    // Track navigation within the embedded view
    view.webContents.on('did-navigate', (_event, navUrl) => {
      info.url = navUrl;
      // Notify renderer of user navigation in the embedded browser
      this.mainWindow.webContents.send('browser-view:navigated', browserId, navUrl);
    });

    view.webContents.on('did-navigate-in-page', (_event, navUrl) => {
      info.url = navUrl;
      this.mainWindow.webContents.send('browser-view:navigated', browserId, navUrl);
    });

    // Set a reasonable user agent
    view.webContents.setUserAgent(
      view.webContents.getUserAgent().replace(/Electron\/\S+\s/, ''),
    );

    log.info(`Created browser view for ${browserId} (url: ${url || 'about:blank'})`);
  }

  /**
   * Destroy a WebContentsView for a browser instance.
   */
  destroy(browserId: string): void {
    const info = this.views.get(browserId);
    if (!info) return;

    // Remove from the content view if attached
    try {
      this.mainWindow.contentView.removeChildView(info.view);
    } catch {
      // May not be attached
    }

    // Destroy the webContents
    try {
      (info.view.webContents as any).destroy?.();
    } catch {
      // May already be destroyed
    }

    this.views.delete(browserId);
    log.info(`Destroyed browser view for ${browserId}`);
  }

  /**
   * Show a browser view by attaching it to the main window's content view.
   */
  show(browserId: string): void {
    const info = this.views.get(browserId);
    if (!info || info.visible) return;

    this.mainWindow.contentView.addChildView(info.view);
    info.view.setBounds(info.bounds);
    info.visible = true;
    log.debug(`Showing browser view ${browserId}`);
  }

  /**
   * Hide a browser view by removing it from the main window's content view.
   */
  hide(browserId: string): void {
    const info = this.views.get(browserId);
    if (!info || !info.visible) return;

    try {
      this.mainWindow.contentView.removeChildView(info.view);
    } catch {
      // May not be attached
    }
    info.visible = false;
    log.debug(`Hiding browser view ${browserId}`);
  }

  /**
   * Hide all browser views.
   */
  hideAll(): void {
    for (const [browserId] of this.views) {
      this.hide(browserId);
    }
  }

  /**
   * Update the bounds of a browser view (called when the renderer's
   * placeholder div resizes or the tab becomes active).
   */
  setBounds(browserId: string, bounds: { x: number; y: number; width: number; height: number }): void {
    const info = this.views.get(browserId);
    if (!info) return;

    info.bounds = bounds;
    if (info.visible) {
      info.view.setBounds(bounds);
    }
  }

  /**
   * Navigate the WebContentsView to a new URL.
   * Called when the Playwright browser navigates.
   */
  navigate(browserId: string, url: string): void {
    const info = this.views.get(browserId);
    if (!info) return;

    // Avoid navigating if already at this URL
    if (info.url === url) return;

    info.url = url;
    info.view.webContents.loadURL(url).catch((err) => {
      log.error(`Failed to navigate browser ${browserId} to ${url}:`, err);
    });
  }

  /**
   * Get info about a browser view.
   */
  get(browserId: string): BrowserViewInfo | undefined {
    return this.views.get(browserId);
  }

  /**
   * Get all browser view IDs.
   */
  getAllIds(): string[] {
    return [...this.views.keys()];
  }

  /**
   * Destroy all views (cleanup on shutdown).
   */
  destroyAll(): void {
    for (const browserId of [...this.views.keys()]) {
      this.destroy(browserId);
    }
  }
}
