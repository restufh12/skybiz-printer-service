// =======================================================
// WEBSOCKET HANDLER MODULE
// Handle WS connection & auto-reconnect
// =======================================================
const WebSocket = require('ws');
const { getMainWindow } = require('./globals');
const { sendLog } = require('./logger');
const { addToQueue } = require('./queue');

let ws = null;
let reconnectTimeout = null;

function connectWebSocket(vars) {
  const mainWindow = getMainWindow();
  const { DEVICE_ID, WS_SERVER } = vars;

  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    try {
      sendLog(mainWindow, 'Closing previous WebSocket...');
      ws.removeAllListeners();
      ws.close(1000, 'Reconnecting');
    } catch (e) {
      sendLog(mainWindow, `<span class="text-danger">Error closing WS: ${e}</span>`);
    }
  }

  sendLog(mainWindow, `Connecting to WebSocket: ${WS_SERVER}`);
  ws = new WebSocket(WS_SERVER);

  ws.on('open', () => {
    sendLog(mainWindow, 'Connected to ' + WS_SERVER);
    try { ws.send(JSON.stringify({ type: 'register', deviceId: DEVICE_ID })); }
    catch (err) { sendLog(mainWindow, `<span class="text-danger">Register send failed: ${err.message}</span>`); }
  });

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'print') {
        if (data.payload){
          addToQueue({
            print_mode: data.payload.printMode || 'network',
            printer_name: data.payload.printerName || '',
            printer_port: data.payload.printerPort || 9100,
            print_type: data.payload.printType || 'text',
            print_text: data.payload.printText || ''
          });
        }
      }
    } catch (err) {
      sendLog(mainWindow, `<span class="text-danger">WS message error: ${err.message}</span>`);
    }
  });

  ws.on('close', () => {
    sendLog(mainWindow, 'WebSocket closed. Reconnecting in 3s...');
    reconnectTimeout = setTimeout(() => connectWebSocket(vars), 3000);
  });

  ws.on('error', (err) => {
    sendLog(mainWindow, `<span class="text-danger">WebSocket error: ${err.message}</span>`);
  });
}

module.exports = { connectWebSocket };