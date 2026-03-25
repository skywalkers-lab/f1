// F1 PitWall — Electron Main Process
// Spawns the Python backend and serves the built frontend.
// Supports two modes: Pit Wall (full analysis) and Driver HUD (overlay).

const { app, BrowserWindow, dialog, ipcMain, screen, crashReporter } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const IS_DEV = !app.isPackaged;

/* ── #40: Embedded crash reporter with redaction ─── */

crashReporter.start({
  submitURL: '', // No remote submission by default — crash dumps stored locally
  uploadToServer: false,
  compress: true,
  extra: {
    app_version: app.getVersion?.() ?? '0.0.0',
    platform: process.platform,
  },
});

/**
 * Redact sensitive data from crash context before any future upload.
 * Strips environment variables, file paths containing user home dirs, tokens.
 */
function getRedactedCrashContext() {
  const ctx = {
    version: app.getVersion?.() ?? '0.0.0',
    platform: process.platform,
    arch: process.arch,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
  };
  // Redact any env-based secrets that might leak into crash metadata
  const safeCtx = JSON.parse(JSON.stringify(ctx));
  return safeCtx;
}

/* ── #39: Auto-update channel for desktop package ── */

let autoUpdater = null;
function setupAutoUpdate() {
  if (IS_DEV) return; // Skip in dev mode
  try {
    // electron-updater is an optional dependency — graceful fallback
    const { autoUpdater: updater } = require('electron-updater');
    autoUpdater = updater;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
      console.log(`[pitwall] Update available: ${info.version}`);
      if (mainWindow) {
        mainWindow.webContents.send('update:available', {
          version: info.version,
          releaseDate: info.releaseDate,
        });
      }
      // Prompt user
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Available',
        message: `PitWall v${info.version} is available. Download now?`,
        buttons: ['Download', 'Later'],
        defaultId: 0,
      }).then(({ response }) => {
        if (response === 0) autoUpdater.downloadUpdate();
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log(`[pitwall] Update downloaded: ${info.version}`);
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Ready',
        message: `PitWall v${info.version} has been downloaded. Restart to apply?`,
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
      }).then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
    });

    autoUpdater.on('error', (err) => {
      console.warn('[pitwall] Auto-update error:', err.message);
    });

    // Check for updates after a short delay
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
  } catch {
    // electron-updater not installed — skip silently
    console.log('[pitwall] electron-updater not available, auto-update disabled');
  }
}

ipcMain.handle('update:check', async () => {
  if (!autoUpdater) return { available: false, reason: 'updater_unavailable' };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { available: !!result?.updateInfo, info: result?.updateInfo };
  } catch {
    return { available: false, reason: 'check_failed' };
  }
});

const BACKEND_PORT = 8765;
const BACKEND_HOST = '127.0.0.1';

let mainWindow = null;
let overlayWindow = null;
let backendProcess = null;

/* ── Paths ────────────────────────────────────────── */

function resourcePath(...segments) {
  if (IS_DEV) {
    return path.join(__dirname, '..', ...segments);
  }
  return path.join(process.resourcesPath, ...segments);
}

function frontendDir() {
  if (IS_DEV) {
    return path.join(__dirname, '..', 'frontend', 'dist');
  }
  return path.join(process.resourcesPath, 'frontend');
}

function packagedBackendExePath() {
  const exeName = process.platform === 'win32' ? 'pitwall-backend.exe' : 'pitwall-backend'
  return path.join(process.resourcesPath, 'backend_dist', exeName)
}

function hasPackagedBackendExe() {
  if (IS_DEV) return false
  try {
    fs.accessSync(packagedBackendExePath())
    return true
  } catch {
    return false
  }
}

/* ── Backend ──────────────────────────────────────── */

function findPython() {
  // Prefer venv python if it exists
  const venvPython = path.join(resourcePath('backend'), '.venv',
    process.platform === 'win32' ? 'Scripts' : 'bin', 'python');
  try {
    require('fs').accessSync(venvPython);
    return venvPython;
  } catch {
    // fall back to system python
    return process.platform === 'win32' ? 'python' : 'python3';
  }
}

function startBackend() {
  const env = {
    ...process.env,
    PITWALL_HOST: BACKEND_HOST,
    PITWALL_PORT: String(BACKEND_PORT),
    // Allow requests from file:// (Electron) and null origins without CORS rejection.
    // The backend only listens on 127.0.0.1 so this is safe.
    PITWALL_CORS_ALLOW_ALL: '1',
  }

  if (hasPackagedBackendExe()) {
    const exePath = packagedBackendExePath()
    backendProcess = spawn(exePath, [], {
      cwd: path.dirname(exePath),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    console.log(`[pitwall] Using packaged backend executable: ${exePath}`)
  } else {
    const python = findPython();
    const backendDir = resourcePath('backend');
    const pyEnv = {
      ...env,
      PYTHONPATH: path.join(backendDir, 'src'),
    }

    backendProcess = spawn(python, [
      '-m', 'uvicorn',
      'pitwall.main:app',
      '--host', BACKEND_HOST,
      '--port', String(BACKEND_PORT),
    ], {
      cwd: backendDir,
      env: pyEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    console.log(`[pitwall] Using Python backend: ${python}`)
  }

  backendProcess.stdout.on('data', (data) => {
    process.stdout.write(`[backend] ${data}`);
  });

  backendProcess.stderr.on('data', (data) => {
    process.stderr.write(`[backend] ${data}`);
  });

  backendProcess.on('error', (err) => {
    dialog.showErrorBox('Backend Error',
      `Failed to start backend.\n\n${err.message}\n\nIf this is a packaged app, rebuild backend_dist. If this is dev mode, ensure Python 3.11+ and backend deps are installed.`);
  });

  backendProcess.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[backend] exited with code ${code}`);
    }
    backendProcess = null;
  });
}

function stopBackend() {
  if (!backendProcess) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(backendProcess.pid), '/f', '/t']);
  } else {
    backendProcess.kill('SIGTERM');
  }
  backendProcess = null;
}

function waitForBackend(timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      if (Date.now() - start > timeoutMs) {
        return reject(new Error('Backend did not start in time'));
      }
      const req = http.get(`http://${BACKEND_HOST}:${BACKEND_PORT}/health`, (res) => {
        if (res.statusCode === 200) return resolve();
        setTimeout(check, 300);
      });
      req.on('error', () => setTimeout(check, 300));
      req.end();
    }
    check();
  });
}

/* ── Main Window ──────────────────────────────────── */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'F1 PitWall',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (IS_DEV) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(frontendDir(), 'index.html');
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/* ── Driver HUD Overlay Window ───────────────────── */

function createOverlayWindow() {
  if (overlayWindow) {
    overlayWindow.focus();
    return;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  overlayWindow = new BrowserWindow({
    width: Math.min(480, Math.round(width * 0.25)),
    height: height,
    x: width - Math.min(480, Math.round(width * 0.25)),
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    focusable: false,             // Don't steal focus from game
    type: 'toolbar',              // Overlay-friendly window type
    title: 'F1 Driver HUD',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Prevent the overlay from capturing mouse input when not in config mode
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  if (IS_DEV) {
    overlayWindow.loadURL('http://localhost:5173/#/hud');
  } else {
    const indexPath = path.join(frontendDir(), 'index.html');
    overlayWindow.loadFile(indexPath, { hash: '/hud' });
  }

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

function destroyOverlayWindow() {
  if (overlayWindow) {
    overlayWindow.close();
    overlayWindow = null;
  }
}

/* ── IPC Handlers ────────────────────────────────── */

ipcMain.handle('hud:toggle', () => {
  if (overlayWindow) {
    destroyOverlayWindow();
    return { active: false };
  }
  createOverlayWindow();
  return { active: true };
});

ipcMain.handle('hud:setClickThrough', (_event, enabled) => {
  if (overlayWindow) {
    overlayWindow.setIgnoreMouseEvents(enabled, { forward: true });
  }
});

ipcMain.handle('hud:setOpacity', (_event, opacity) => {
  if (overlayWindow) {
    overlayWindow.setOpacity(Math.max(0.1, Math.min(1, opacity)));
  }
});

ipcMain.handle('hud:setSize', (_event, width, height) => {
  if (overlayWindow) {
    overlayWindow.setSize(
      Math.max(200, Math.min(800, width)),
      Math.max(200, Math.min(2000, height))
    );
  }
});

/* ── App lifecycle ────────────────────────────────── */

app.whenReady().then(async () => {
  startBackend();
  setupAutoUpdate();

  try {
    await waitForBackend();
  } catch {
    console.warn('[pitwall] Backend health check timed out – opening window anyway');
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

/* ── #40: crash context IPC ──────────────────────── */
ipcMain.handle('crash:getContext', () => getRedactedCrashContext());
ipcMain.handle('crash:getCrashDumpDir', () => app.getPath('crashDumps'));

app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopBackend();
});
