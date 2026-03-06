// =======================================================
// DATABASE MODULE
// =======================================================
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { app } = require('electron');

let db = null;

function initDatabase() {
  const userDataDir = app.getPath('userData');
  const dbPath = path.join(userDataDir, 'appdata.db');

  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 3000');

  // === Create tables ===
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      DEVICE_ID TEXT,
      WS_SERVER TEXT,
      UPDATED_AT DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS print_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      print_mode TEXT DEFAULT 'network',
      printer_name TEXT DEFAULT '',
      printer_port INTEGER DEFAULT 9100,
      print_type TEXT DEFAULT 'text',
      print_text TEXT DEFAULT '',
      retry_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log('DB initialized at', dbPath);
  return db;
}

function getDB() {
  if (!db) throw new Error('Database not initialized!');
  return db;
}

module.exports = { initDatabase, getDB };