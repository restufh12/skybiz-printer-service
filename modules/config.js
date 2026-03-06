// =======================================================
// CONFIG MANAGER MODULE
// =======================================================
const { getDB } = require('./db');
const { getMainWindow } = require('./globals');
const { sendLog } = require('./logger');

function ConfigManager() {
  const mainWindow = getMainWindow();
  const db = getDB();

  const defaultConfig = {
    DEVICE_ID: 'SKYBIZTEST2025',
    WS_SERVER: 'wss://www.skybizcloud.com/wsprinter/'
  };

  // === LOAD CONFIG (create default if not exist) ===
  function load() {
    try {
      const row = db.prepare('SELECT * FROM config ORDER BY id DESC LIMIT 1').get();
      if (row) {
        sendLog(mainWindow, 'Config loaded from DB.');
        return row;
      } else {
        save(defaultConfig);
        sendLog(mainWindow, 'Default config created in DB.');
        return defaultConfig;
      }
    } catch (err) {
      sendLog(mainWindow, `<span class="text-danger">Failed to load config: ${err.message}</span>`);
      return { ...defaultConfig };
    }
  }

  // === SAVE CONFIG ===
  function save(cfg) {
    try {
      db.prepare(`
        INSERT INTO config (DEVICE_ID, WS_SERVER)
        VALUES (@DEVICE_ID, @WS_SERVER)
      `).run(cfg);
      sendLog(mainWindow, 'Config saved to DB.');
    } catch (err) {
      sendLog(mainWindow, `<span class="text-danger">Failed to save config: ${err.message}</span>`);
    }
  }

  // === GET CONFIG ===
  function get() {
    try {
      const row = db.prepare('SELECT * FROM config ORDER BY id DESC LIMIT 1').get();
      return row || { ...defaultConfig };
    } catch (err) {
      sendLog(mainWindow, `<span class="text-danger">Failed to get config: ${err.message}</span>`);
      return { ...defaultConfig };
    }
  }

  return { load, save, get };
}

// === Helper set global variable ===
function refreshConfigVars(configManager) {
  const cfg = configManager.get();
  return {
    DEVICE_ID: cfg.DEVICE_ID,
    WS_SERVER: cfg.WS_SERVER
  };
}

module.exports = { ConfigManager, refreshConfigVars };