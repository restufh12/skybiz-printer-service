// =======================================================
// EDC HANDLER MODULE
// Can be called from WebSocket, IPC, HTTP, or anywhere else
// =======================================================
const WebSocket         = require('ws');
const { PaxEDC }        = require('../edc/pax-edc');
const { PaxEDCNetwork } = require('../edc/pax-edc-network');
const { GhlEDC }        = require('../edc/ghl-edc');
const { GhlEDCNetwork } = require('../edc/ghl-edc-network');
const { getMainWindow } = require('./globals');
const { sendLog }       = require('./logger');

// -------------------------------------------------------
// handleEDC
// -------------------------------------------------------
async function handleEDC(data) {
  const mainWindow = getMainWindow();
  const { requestId = '' } = data.payload || data;
  const { DEVICE_ID = '', ws = null } = data;
  const { modeEDC = 'usb', typeEDC, portEDC, ipEDC, action, transactionId, cashier } = data.payload || data;

  // Convert amount from RM to cents
  // Supports: "1.00", "1,000.00", "10,000.00", 1.00 - always results in cents integer
  const rawAmount = String((data.payload || data).amount || '0');
  const amount    = Math.round(parseFloat(rawAmount.replace(/,/g, '')) * 100);

  sendLog(mainWindow, `[EDC] Mode: ${modeEDC} | Type: ${typeEDC} | ${modeEDC === 'network' ? 'IP: ' + ipEDC + ':' + portEDC : 'Port: ' + portEDC} | Action: ${action} | Amount: ${rawAmount}`);

  // ── Validate required parameters ────────────────────
  const validUsb     = modeEDC === 'usb'     && typeEDC && portEDC;
  const validNetwork = modeEDC === 'network' && typeEDC && ipEDC && portEDC;

  if (!validUsb && !validNetwork) {
    const errMsg = modeEDC === 'network'
      ? 'typeEDC, ipEDC and portEDC are required for network mode'
      : 'typeEDC and portEDC are required for usb mode';
    sendLog(mainWindow, `<span class="text-danger">[EDC] ${errMsg}</span>`);
    wsSend(ws, { type: 'edc_response', requestId, deviceId: DEVICE_ID, modeEDC, typeEDC, success: false, errorMessage: errMsg });
    throw new Error(errMsg);
  }

  // ── Create EDC instance based on typeEDC ────────────
  let edc = null;

  if (typeEDC === 'PAX A920 APOS') {
    edc = modeEDC === 'network'
      ? new PaxEDCNetwork({ host: ipEDC, port: portEDC, timeout: 60000 })
      : new PaxEDC(        { portPath: portEDC, baudRate: 115200, timeout: 60000 });

  } else if (typeEDC === 'PAX A920 GHL') {
    edc = modeEDC === 'network'
      ? new GhlEDCNetwork({ host: ipEDC, port: portEDC, timeout: 60000 })
      : new GhlEDC(        { portPath: portEDC, baudRate: 9600,  timeout: 60000 });
  }
  // else if (typeEDC === 'INGENICO') { ... }

  if (!edc) {
    const errMsg = `Unknown EDC type: ${typeEDC}`;
    sendLog(mainWindow, `<span class="text-danger">[EDC] ${errMsg}</span>`);
    wsSend(ws, { type: 'edc_response', requestId, deviceId: DEVICE_ID, modeEDC, typeEDC, success: false, errorMessage: errMsg });
    throw new Error(errMsg);
  }

  // ── Run action & always disconnect after done ────────
  let result = null;

  try {
    if (action === 'sale') {
      result = await edc.sale(amount, cashier);

    } else if (action === 'void') {
      result = await edc.void(transactionId, cashier);

    } else if (action === 'refund') {
      result = await edc.refund(amount, cashier);

    } else if (action === 'settlement') {
      result = await edc.settlement(cashier);

    } else {
      throw new Error(`Unknown EDC action: ${action}`);
    }

  } catch (err) {
    const errMsg = err.message || String(err);
    sendLog(mainWindow, `<span class="text-danger">[EDC] ${errMsg}</span>`);
    wsSend(ws, {
      type:         'edc_response',
      requestId,
      deviceId:     DEVICE_ID,
      modeEDC,      typeEDC,
      action,
      success:      false,
      errorMessage: errMsg,
    });
    throw err; // re-throw supaya caller tahu ada error

  } finally {
    // Always close serial port
    if (modeEDC === 'usb' && edc && edc.disconnect) {
      try { await edc.disconnect(); } catch (_) {}
    }
  }

  // ── Send result back to WebSocket server ─────────────
  wsSend(ws, {
    type:            'edc_response',
    requestId,
    deviceId:        DEVICE_ID,
    modeEDC,         typeEDC,
    action,
    success:         result.success,
    errorCode:       result.errorCode     || result.responseCode    || '',
    errorMessage:    result.errorMessage  || result.responseMessage || '',
    approvalCode:    result.approvalCode  || result.authCode        || '',
    cardNumber:      result.cardNumber    || '',
    cardType:        result.cardType      || '',
    cardName:        result.cardName      || '',
    expiryDate:      result.expiryDate    || '',
    grossAmount:     result.grossAmount   || '',
    netAmount:       result.netAmount     || '',
    traceNumber:     result.traceNumber   || '',
    invoiceNumber:   result.invoiceNumber || result.transactionId   || '',
    terminalId:      result.terminalId    || '',
    merchantId:      result.merchantId    || '',
    batchNumber:     result.batchNumber   || '',
    amount,
  });

  const logColor = result.success ? 'text-success' : 'text-danger';
  sendLog(mainWindow, `<span class="${logColor}">[EDC] ${typeEDC} ${action} → ${result.errorMessage || result.responseMessage}</span>`);

  return result;
}

// -------------------------------------------------------
// Safe WebSocket send - skips if ws is null or not open
// -------------------------------------------------------
function wsSend(ws, data) {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  } catch (_) {}
}

module.exports = { handleEDC };
