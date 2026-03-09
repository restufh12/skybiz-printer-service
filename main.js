// =======================================================
//  SkyBiz Printer Service (Electron Main Process)
// =======================================================
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const AutoLaunch = require('electron-auto-launch');
const WebSocket = require('ws');
const escpos = require('escpos');
const usb = require("usb");
const { autoUpdater } = require('electron-updater');

// Try enable escpos-network (for LAN printer)
try { escpos.Network = require('escpos-network'); } catch {}

// === Import DB FIRST ===
const { initDatabase, getDB } = require('./modules/db');
const db = initDatabase();

// === Import Custom Modules ===
const { setMainWindow, getMainWindow } = require('./modules/globals');
const { sendLog, flushLogs } = require('./modules/logger');
const { ConfigManager, refreshConfigVars } = require('./modules/config');
const { connectWebSocket } = require('./modules/websocket');
const { printToPrinter } = require('./modules/printer');
const { getMacAddress } = require('./utils/systemInfo');
const { startQueueWorker } = require('./modules/queueWorker');

// === Globals ===
let mainWindow = null;
let changelogWindow = null;
let tray = null;
let configManager = null;
let DEVICE_ID, WS_SERVER;
let logBuffer = [];
let isWindowReady = false;

// =======================================================
// WINDOW & TRAY
// =======================================================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 600,
    show: true,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon-tray.ico'),
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  // Set global variable mainWindow
  setMainWindow(mainWindow);

  // Load first page
  mainWindow.loadFile('index.html');

  // Handle onclose to tray
  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createChangelogWindow() {
  if (changelogWindow) {
    changelogWindow.focus();
    return;
  }

  changelogWindow = new BrowserWindow({
    width: 420,
    height: 520,
    title: 'Change Log',
    resizable: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon-tray.ico'),
    webPreferences: {
      nodeIntegration: true, 
      contextIsolation: false 
    }
  });

  changelogWindow.loadFile(path.join(__dirname, 'changelog.html'));

  changelogWindow.on('closed', () => {
    changelogWindow = null;
  });
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'assets', 'icon-tray.ico'));
  const trayMenu = Menu.buildFromTemplate([
    { label: 'Open Service', click: () => mainWindow.show() },
    { label: 'Change Log', click: createChangelogWindow },
    { label: 'Help', click: () => shell.openExternal('https://aisupport.skybizglobal.com/skybizclouderp/') },
    { label: 'Exit', click: () => { app.isQuiting = true; app.quit(); } },
  ]);
  tray.setToolTip('SkyBiz Printer Service');
  tray.setContextMenu(trayMenu);
  tray.on('click', () => (mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()));
}

// =======================================================
// AUTO LAUNCH
// =======================================================
function setupAutoLaunch() {
  const autoLauncher = new AutoLaunch({
    name: 'SkyBizPrinterService',
    path: process.execPath,
  });

  autoLauncher.isEnabled()
    .then((isEnabled) => !isEnabled && autoLauncher.enable())
    .catch((err) => sendLog(mainWindow, `<span class="text-danger">Auto-launch error: ${err}</span>`));
}

// =======================================================
// AUTO UPDATE
// =======================================================
function setupAutoUpdater() {
  // Set update source URL — this must match your "publish.url" in package.json
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: 'https://cloudtest.skybiz.my/01/printer-service/',
  });

  // Wait 5 seconds before checking for updates (let the app finish initializing)
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 5000);

  // Event: update available
  autoUpdater.on('update-available', () => {
    sendLog(mainWindow, 'Update available, downloading...');
  });

  // Event: no update found
  autoUpdater.on('update-not-available', () => {
    sendLog(mainWindow, 'You are running the latest version.');
  });

  // Event: error during update
  autoUpdater.on('error', (err) => {
    sendLog(mainWindow, `<span class="text-danger">Auto-update error: ${err.message}</span>`);
  });

  // Event: update downloaded and ready to install
  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: 'A new version of SkyBiz Printer Service has been downloaded.\nThe application will restart to install the update.',
    }).then(() => {
      autoUpdater.quitAndInstall();
    });
  });
}

// =======================================================
// MAIN APP
// =======================================================
app.whenReady().then(() => {
  createWindow();
  createTray();
  setupAutoLaunch();
  setupAutoUpdater();

  // Load Config
  configManager = ConfigManager();
  const CONFIG = configManager.load();
  ({ DEVICE_ID, WS_SERVER } = refreshConfigVars(configManager));

  // Connect to WebSocket Server
  connectWebSocket({ DEVICE_ID, WS_SERVER });

  // Queue Every 5 Second
  startQueueWorker(5000);

  // ============ IPC EVENTS ============
  ipcMain.handle('print-test', async (event, data) => {
    try {
      const result = await printToPrinter(data);
      return { success: true, message: result };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('get-mac-address', async (event, data) => {
    try {
      const result = await getMacAddress();
      return { success: true, message: result };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle("get-usb-devices", async () => {
    const devices = usb.getDeviceList();
    const results = [];
    for (const device of devices) {
      const desc       = device.deviceDescriptor;
      let manufacturer = "";
      let product      = "";

      try {
        device.open();
        manufacturer = await new Promise((resolve) => {
          if (!desc.iManufacturer) return resolve("");
          device.getStringDescriptor(desc.iManufacturer, (err, data) => {
            resolve(err ? "" : data);
          });
        });
        product = await new Promise((resolve) => {
          if (!desc.iProduct) return resolve("");
          device.getStringDescriptor(desc.iProduct, (err, data) => {
            resolve(err ? "" : data);
          });
        });
        device.close();
      } catch (err) {}

      results.push({
        vid: "0x" + desc.idVendor.toString(16).padStart(4, "0"),
        pid: "0x" + desc.idProduct.toString(16).padStart(4, "0"),
        manufacturer: manufacturer || "Unknown",
        product: product || "Unknown"
      });
    }
    return results;
  });

  ipcMain.on('save-config', (event, newConfig) => {
    try {
      configManager.save(newConfig);
      ({ DEVICE_ID, WS_SERVER } = refreshConfigVars(configManager));
      connectWebSocket({ DEVICE_ID, WS_SERVER });
      sendLog(mainWindow, 'Config updated & WebSocket reconnected.');
      event.sender.send('config-saved');
    } catch (err) {
      event.sender.send('config-save-error', err.message);
    }
  });

  // =======================================================
  // IPC HANDLER: QUEUE MANAGEMENT
  // =======================================================
  const db = getDB();

  // Queue listing
  ipcMain.handle('get-queue-list', () => {
    try {
      const rows = db.prepare('SELECT * FROM print_queue ORDER BY id DESC').all();
      return { success: true, data: rows };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Delete all failed
  ipcMain.handle('delete-failed-jobs', () => {
    try {
      const result = db.prepare(`DELETE FROM print_queue WHERE status='error'`).run();

      // reset ID if table is empty
      let resetMessage = "";
      const rowCount = db.prepare(`SELECT COUNT(*) as count FROM print_queue`).get();
      if (rowCount.count === 0) {
        db.prepare(`DELETE FROM sqlite_sequence WHERE name='print_queue'`).run();
        resetMessage = " (Table truncated/reset)";
      }

      sendLog(getMainWindow(), `<span class="text-info">Deleted ${result.changes} failed jobs. ${resetMessage}</span>`);
      return { success: true, count: result.changes };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Delete single job
  ipcMain.handle('delete-job', (event, id) => {
    try {
      const result = db.prepare('DELETE FROM print_queue WHERE id=?').run(id);
      sendLog(getMainWindow(), `<span class="text-info">Deleted job #${id}.</span>`);
      return { success: true, count: result.changes };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Retry Job
  ipcMain.handle('retry-job', async (event, id) => {
    try {
      const job = db.prepare('SELECT * FROM print_queue WHERE id=?').get(id);
      if (!job) return { success: false, error: 'Job not found' };

      sendLog(getMainWindow(), `Retrying job #${id} manually...`);
      await printToPrinter({
        printMode: job.print_mode,
        printerName: job.printer_name,
        printerPort: job.printer_port,
        printText: job.print_text,
        printType: job.print_type
      });

      db.prepare('DELETE FROM print_queue WHERE id=?').run(id);
      sendLog(getMainWindow(), `<span class="text-success">Job #${id} reprinted & deleted.</span>`);
      return { success: true };
    } catch (err) {
      sendLog(getMainWindow(), `<span class="text-danger">Retry job #${id} failed: ${err.message}</span>`);
      return { success: false, error: err.message };
    }
  });

  // Send version, logs and config when ready
  mainWindow.webContents.on('did-finish-load', () => {
    isWindowReady = true;

    // Send Application Version
    try {
      const version = app.getVersion();
      mainWindow.webContents.send('app-version', version);
    } catch (e) {
      console.error('Failed to send version:', e);
    }

    // Flush log buffer
    flushLogs(mainWindow);

    // Send config to renderer
    mainWindow.webContents.send('load-config', configManager.get());
  });

  // mainWindow.webContents.openDevTools();
});

// Keep app running in tray
app.on('window-all-closed', (e) => e.preventDefault());