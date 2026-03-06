// =======================================================
// HELPER MODULE
// All Global Function
// =======================================================

// Format filename: ddMMyyyyHHmmss
function formatDateTime() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}${pad(d.getMonth() + 1)}${d.getFullYear()}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

module.exports = { formatDateTime };