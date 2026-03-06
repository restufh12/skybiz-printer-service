// =======================================================
// UTILITY 
// System Information
// =======================================================
const path = require('path');
const { getMainWindow } = require(path.join(__dirname, '../modules/globals'));
const { sendLog } = require(path.join(__dirname, '../modules/logger'));

const macaddress = require('macaddress');

async function getMacAddress() {
  const mainWindow = getMainWindow();
  try {
    const mac = await macaddress.one();
    return mac;
  } catch (err) {
    sendLog(mainWindow, `<span class="text-danger">Error getting MAC address: ${err}</span>`);
    return null;
  }
}

module.exports = { getMacAddress };