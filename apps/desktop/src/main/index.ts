import { app, BrowserWindow, ipcMain, shell, Menu, dialog, protocol, net } from 'electron';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { createDesktopBridge, type DesktopBridge } from './services/desktopBridge';
import { SecureStorage } from './services/secureStorage';
import { BrowserViewManager } from './services/browserViewManager';
import { setupIpcHandlers } from './ipc';
import { initAutoUpdater } from './autoUpdater';
import { createLogger } from '@ants/ui';

// Prevent EPIPE errors from crashing the app when stdout/stderr pipes close
// (e.g., when the parent process or terminal that launched the app goes away).
// These writes are only for logging, so it's safe to silently ignore them.
//
// Three layers of protection:
// 1. The logger (utils/logger.ts) wraps console calls in try/catch
// 2. Stream error handlers catch async EPIPE on stdout/stderr
// 3. uncaughtException handler catches any synchronous EPIPE throws that
//    bypass the stream error event (e.g., from console.log internals)
process.stdout?.on('error', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return;
  throw err;
});
process.stderr?.on('error', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return;
  throw err;
});
process.on('uncaughtException', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return;
  // For non-EPIPE errors, log and exit to match default Node.js behavior.
  // We can't re-throw from uncaughtException, so we replicate the crash.
  try { console.error('Uncaught exception:', err); } catch {}
  process.exit(1);
});

const log = createLogger('ElectronMain');

// Diagnostic logging for CI debugging
console.log('[electron-main] Module loaded, NODE_ENV=' + process.env.NODE_ENV);
console.log('[electron-main] argv[1]=' + process.argv[1]);

// ============ CDP Remote Debugging ============
// When ANTS_CDP_PORT is set, enable Chrome DevTools Protocol remote debugging
// so external tools (e.g., @playwright/mcp) can connect to the renderer process.
const cdpPort = process.env.ANTS_CDP_PORT;
if (cdpPort) {
  app.commandLine.appendSwitch('remote-debugging-port', cdpPort);
  log.info(`CDP remote debugging enabled on port ${cdpPort}`);
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
// This is only needed for Windows Squirrel installer.
try {
  if (require('electron-squirrel-startup')) {
    app.quit();
  }
} catch {
  // electron-squirrel-startup not installed, skip
}

// ============ Custom Protocol Registration ============
// Must be called before app.ready to register privileged schemes.
// This protocol serves screenshot images from project .ants/screenshots/ dirs.
const SCREENSHOT_SCHEME = 'ants-screenshot';
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCREENSHOT_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      // Allow cross-origin access so the renderer can load images from this scheme
      corsEnabled: true,
    },
  },
]);

// ============ Constants ============

const DEEPLINK_SCHEME = 'ants';

// ============ Global State ============

let mainWindow: BrowserWindow | null = null;
let desktopBridge: DesktopBridge;
let secureStorage: SecureStorage;
let browserViewManager: BrowserViewManager | null = null;
let pendingDeeplinkUrl: string | null = null;
let rendererReady = false;

async function createWindow() {
  console.log('[electron-main] createWindow() called');
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: '#272E27',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: process.env.NODE_ENV !== 'development',
    },
  });

  // Initialize services
  console.log('[electron-main] Initializing services...');
  secureStorage = new SecureStorage();
  browserViewManager = new BrowserViewManager(mainWindow);
  desktopBridge = createDesktopBridge(mainWindow, secureStorage, browserViewManager);
  console.log('[electron-main] Services initialized');

  // Setup IPC handlers
  setupIpcHandlers(ipcMain, desktopBridge, secureStorage, browserViewManager);

  // Initialize auto-updater (checks for updates on launch and periodically)
  initAutoUpdater(mainWindow);

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    // In development, load from vite dev server
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load from built files
    const rendererPath = join(__dirname, '../renderer/index.html');
    console.log('[electron-main] Loading renderer from:', rendererPath);
    mainWindow.loadFile(rendererPath);
  }
  console.log('[electron-main] createWindow() completed');

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererReady = false;
  });

  // Setup application menu with keyboard shortcuts
  setupApplicationMenu();

  // Check command line for deeplink (Windows/Linux cold start) and store as pending.
  // The renderer will retrieve it via the 'deeplink:ready' IPC call.
  const cmdLineUrl = process.argv.find(arg => arg.startsWith(`${DEEPLINK_SCHEME}://`));
  if (cmdLineUrl && !pendingDeeplinkUrl) {
    log.info('Deeplink: found in command line args, storing as pending:', cmdLineUrl);
    pendingDeeplinkUrl = cmdLineUrl;
  }

  // Reset rendererReady on page reload so the renderer re-signals
  mainWindow.webContents.on('did-finish-load', () => {
    rendererReady = false;
  });
}

function setupApplicationMenu() {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        {
          label: 'Settings',
          accelerator: 'Cmd+,',
          click: () => mainWindow?.webContents.send('shortcut:settings'),
        },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ],
    }] : []),

    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Project',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow!, {
              properties: ['openDirectory'],
            });
            if (!result.canceled && result.filePaths.length > 0) {
              mainWindow?.webContents.send('shortcut:openProject', result.filePaths[0]);
            }
          },
        },
        {
          label: 'New Session',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('shortcut:newSession'),
        },
        { type: 'separator' as const },
        {
          label: 'Close Session',
          accelerator: 'CmdOrCtrl+W',
          click: () => mainWindow?.webContents.send('shortcut:closeSession'),
        },
        ...(!isMac ? [
          { type: 'separator' as const },
          {
            label: 'Settings',
            accelerator: 'Ctrl+,',
            click: () => mainWindow?.webContents.send('shortcut:settings'),
          },
          { type: 'separator' as const },
          { role: 'quit' as const },
        ] : []),
      ],
    },

    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
      ],
    },

    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
        { type: 'separator' as const },
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => mainWindow?.webContents.send('shortcut:toggleSidebar'),
        },
      ],
    },

    // Session menu
    {
      label: 'Session',
      submenu: [
        {
          label: 'Previous Session',
          accelerator: 'CmdOrCtrl+[',
          click: () => mainWindow?.webContents.send('shortcut:prevSession'),
        },
        {
          label: 'Next Session',
          accelerator: 'CmdOrCtrl+]',
          click: () => mainWindow?.webContents.send('shortcut:nextSession'),
        },
        { type: 'separator' as const },
        {
          label: 'Stop Operation',
          accelerator: 'CmdOrCtrl+.',
          click: () => mainWindow?.webContents.send('shortcut:stop'),
        },
      ],
    },

    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac ? [
          { type: 'separator' as const },
          { role: 'front' as const },
        ] : [
          { role: 'close' as const },
        ]),
      ],
    },

    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          click: () => mainWindow?.webContents.send('shortcut:showKeyboardShortcuts'),
        },
        { type: 'separator' as const },
        {
          label: 'Documentation',
          click: () => shell.openExternal('https://ants.dev/docs'),
        },
        {
          label: 'Report Issue',
          click: () => shell.openExternal('https://github.com/ants/app/issues'),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// This method will be called when Electron has finished initialization
console.log('[electron-main] Waiting for app.whenReady()...');
app.whenReady().then(() => {
  console.log('[electron-main] app is ready');

  // ── Register screenshot protocol handler ──────────────────────────
  // Serves images from <projectDir>/.ants/screenshots/<filename>
  // URL format: ants-screenshot://<projectId>/screenshots/<filename>
  // The projectId is resolved to a working directory via the desktop bridge.
  protocol.handle(SCREENSHOT_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      // hostname = projectId, pathname = /screenshots/<filename>
      const projectId = url.hostname;
      const pathSegments = url.pathname.split('/').filter(Boolean);

      // Validate: must be screenshots/<filename> with a safe filename
      if (pathSegments.length !== 2 || pathSegments[0] !== 'screenshots' || !pathSegments[1]) {
        return new Response('Not found', { status: 404 });
      }
      const filename: string = pathSegments[1];
      // Security: only allow alphanumeric, hyphens, and dots (UUID + extension)
      if (!/^[a-zA-Z0-9-]+\.(png|jpeg|webp)$/.test(filename)) {
        return new Response('Invalid filename', { status: 400 });
      }

      // Resolve project working directory via the bridge
      if (!desktopBridge) {
        return new Response('Bridge not ready', { status: 503 });
      }
      const projects = await desktopBridge.listProjects();
      const project = projects.find((p: { id: string }) => p.id === projectId);
      if (!project?.path) {
        return new Response('Project not found', { status: 404 });
      }

      const filePath = join(project.path, '.ants', 'screenshots', filename);
      const data = await readFile(filePath);

      const ext = filename.split('.').pop() || 'png';
      const mimeType = ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';

      return new Response(data, {
        headers: {
          'Content-Type': mimeType,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  console.log('[electron-main] Calling createWindow()');
  return createWindow();
}).catch((err) => {
  console.error('[electron-main] createWindow() failed:', err);
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, re-create a window when dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ============ Deeplink Protocol Handling ============

// Register as default protocol handler
// Note: On macOS, also requires Info.plist configuration for production builds
// On Windows, requires registry entries (handled by electron-builder)
if (process.defaultApp) {
  // Development: need to pass the app path
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(DEEPLINK_SCHEME, process.execPath, [process.argv[1]]);
  }
} else {
  // Production
  app.setAsDefaultProtocolClient(DEEPLINK_SCHEME);
}

// Handle deeplink on macOS (open-url event)
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeeplink(url);
});

// Renderer calls this to signal its deeplink listener is ready.
// Returns any pending deeplink that arrived before the listener was registered.
ipcMain.handle('deeplink:ready', () => {
  log.info('Deeplink: renderer signalled ready');
  rendererReady = true;
  const pending = pendingDeeplinkUrl;
  pendingDeeplinkUrl = null;
  if (pending) {
    log.info('Deeplink: flushing pending deeplink to renderer:', pending);
  }
  return pending;
});

// Handle deeplink on Windows/Linux (second-instance event)
// Skip single-instance lock in test mode to avoid lock contention between
// Playwright test retries where the previous Electron process may not have
// fully released the lock yet.
if (process.env.NODE_ENV !== 'test') {
  const gotTheLock = app.requestSingleInstanceLock();

  if (!gotTheLock) {
    app.quit();
  } else {
    app.on('second-instance', (_event, commandLine) => {
      // Windows/Linux: deeplink URL is passed as command line argument
      const url = commandLine.find(arg => arg.startsWith(`${DEEPLINK_SCHEME}://`));
      if (url) {
        handleDeeplink(url);
      }

      // Focus the main window
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  }
}

/**
 * Handle incoming deeplink URL.
 * Routes:
 * - ants://                           → Open app (home)
 * - ants://project/:projectId         → Open specific project
 * - ants://project/:projectId/session/:sessionId → Open specific session
 * - ants://project/:projectId/settings → Open project settings
 * - ants://settings                   → Open app settings
 * - ants://settings/:section          → Open specific settings section
 * - ants://auth/callback?code=...     → OAuth callback
 * - ants://connect?url=...            → Connect to remote server
 * - ants://open?path=...              → Open local project by path
 */
function handleDeeplink(url: string) {
  log.info('Received deeplink:', url);

  // If window isn't ready or renderer hasn't subscribed yet, store for later
  if (!mainWindow || !rendererReady) {
    log.info('Deeplink: storing as pending (mainWindow=', !!mainWindow, 'rendererReady=', rendererReady, ')');
    pendingDeeplinkUrl = url;
    return;
  }

  // Send to renderer for processing
  log.info('Deeplink: sending to renderer via IPC');
  mainWindow.webContents.send('deeplink', url);

  // Focus the window
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

// Security: Prevent navigation to external URLs
app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.origin !== 'http://localhost:5173') {
      event.preventDefault();
    }
  });
});
