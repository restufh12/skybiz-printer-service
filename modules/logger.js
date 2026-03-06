// =======================================================
// LOGGER MODULE
// Handles sending log messages to renderer and console
// =======================================================
let logBuffer = [];
let isWindowReady = false;

function sendLog(win, message) {
  console.log('[LOG]', message);

  if (!isWindowReady || !win || !win.webContents) {
    logBuffer.push(message);
    return;
  }

  try {
    win.webContents.send('log', message);
  } catch (err) {
    console.error('sendLog failed:', err);
  }
}

function flushLogs(win) {
  isWindowReady = true;
  logBuffer.forEach(msg => {
    try { win.webContents.send('log', msg); } catch (e) { console.error(e); }
  });
  logBuffer = [];
}

module.exports = { sendLog, flushLogs };