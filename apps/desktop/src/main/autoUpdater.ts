import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';
import { BrowserWindow, ipcMain } from 'electron';
import { createLogger } from '@openmgr/ui';

const log = createLogger('AutoUpdater');

/**
 * Update status sent to the renderer process via IPC.
 */
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

let currentStatus: UpdateStatus = { state: 'idle' };
let mainWindow: BrowserWindow | null = null;

function sendStatusToRenderer(status: UpdateStatus) {
  currentStatus = status;
  mainWindow?.webContents.send('update:status', status);
}

/**
 * Initialize the auto-updater. Call once after the main window is created.
 *
 * Behavior:
 * - Checks for updates on launch and every 4 hours
 * - Downloads updates silently in the background
 * - Notifies the renderer when an update is ready to install
 * - The user triggers install via the `update:install` IPC channel
 */
export function initAutoUpdater(window: BrowserWindow) {
  mainWindow = window;

  // Don't check for updates in development
  if (process.env.NODE_ENV === 'development') {
    log.info('Skipping auto-updater in development mode');
    return;
  }

  // Configure auto-updater
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Don't auto-run the installer — let the user decide when to restart
  autoUpdater.autoRunAppAfterInstall = true;

  // ── Event handlers ──────────────────────────────────────────────────

  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update...');
    sendStatusToRenderer({ state: 'checking' });
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    log.info('Update available:', info.version);
    sendStatusToRenderer({
      state: 'available',
      info: {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: typeof info.releaseNotes === 'string'
          ? info.releaseNotes
          : undefined,
      },
    });
  });

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    log.info('No update available. Current version is up to date:', info.version);
    sendStatusToRenderer({
      state: 'not-available',
      info: { version: info.version },
    });
  });

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    log.info(`Download progress: ${progress.percent.toFixed(1)}%`);
    sendStatusToRenderer({
      state: 'downloading',
      progress: Math.round(progress.percent),
    });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    log.info('Update downloaded:', info.version);
    sendStatusToRenderer({
      state: 'downloaded',
      info: {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: typeof info.releaseNotes === 'string'
          ? info.releaseNotes
          : undefined,
      },
    });
  });

  autoUpdater.on('error', (err: Error) => {
    log.error('Auto-updater error:', err.message);
    sendStatusToRenderer({
      state: 'error',
      error: err.message,
    });
  });

  // ── IPC handlers ────────────────────────────────────────────────────

  ipcMain.handle('update:check', async () => {
    log.info('Manual update check requested');
    try {
      const result = await autoUpdater.checkForUpdates();
      return result?.updateInfo ?? null;
    } catch (err) {
      log.error('Update check failed:', err);
      return null;
    }
  });

  ipcMain.handle('update:install', () => {
    log.info('Install requested — quitting and installing');
    autoUpdater.quitAndInstall(false, true);
  });

  ipcMain.handle('update:getStatus', () => {
    return currentStatus;
  });

  // ── Initial check and periodic checks ───────────────────────────────

  // Check for updates after a short delay to let the app fully initialize
  setTimeout(() => {
    log.info('Running initial update check');
    autoUpdater.checkForUpdates().catch((err) => {
      log.error('Initial update check failed:', err);
    });
  }, 10_000);

  // Check every 4 hours
  const FOUR_HOURS = 4 * 60 * 60 * 1000;
  setInterval(() => {
    log.info('Running periodic update check');
    autoUpdater.checkForUpdates().catch((err) => {
      log.error('Periodic update check failed:', err);
    });
  }, FOUR_HOURS);
}
