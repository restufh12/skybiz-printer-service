// =======================================================
// PRINT QUEUE MODULE
// =======================================================
const { getDB } = require('./db');
const { getMainWindow } = require('./globals');
const { sendLog } = require('./logger');

function addToQueue(payload) {
  const mainWindow = getMainWindow();
  const db = getDB();

  try {
    const {
      print_mode = 'network',
      printer_name = '',
      printer_port = 9100,
      print_type = 'text',
      print_text = ''
    } = payload;

    db.prepare(`
      INSERT INTO print_queue (print_mode, printer_name, printer_port, print_type, print_text)
      VALUES (@print_mode, @printer_name, @printer_port, @print_type, @print_text)
    `).run({ print_mode, printer_name, printer_port, print_type, print_text });

    sendLog(mainWindow, `Added to queue: ${printer_name}`);
  } catch (err) {
    sendLog(mainWindow, `<span class="text-danger">Failed to queue print job: ${err.message}</span>`);
  }
}

module.exports = { addToQueue };