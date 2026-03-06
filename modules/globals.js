// =======================================================
// GLOBAL VARIABLE MODULE
// Setter And Getter Variable Global
// =======================================================
let globalMainWindow = null;

function setMainWindow(win) {
  globalMainWindow = win;
}

function getMainWindow() {
  return globalMainWindow;
}

module.exports = { setMainWindow, getMainWindow };