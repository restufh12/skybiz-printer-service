// =======================================================
// PAX A920 EDC MODULE - USB SERIAL
// Communication via USB Serial using APOS Protocol
// Supports: Sale, Void, Refund, Settlement
// =======================================================

// FORMAT PARAMETER
/*{
  "type": "edc",
  "payload": {
    "modeEDC": "usb",
    "typeEDC": "PAX A920",
    "portEDC": "COM4",
    "action": "sale",
    "amount": "15000",
    "transactionId": "TEST"
  }
}*/

const { SerialPort } = require('serialport');

// -------------------------------------------------------
// APOS PROTOCOL CONSTANTS
// -------------------------------------------------------
const STX = 0x02;  // Start of Text
const ETX = 0x03;  // End of Text
const ENQ = 0x05;  // Enquiry
const ACK = 0x06;  // Acknowledge
const NAK = 0x15;  // Negative Acknowledge
const FS  = 0x1C;  // Field Separator

const COMMANDS = {
  SALE:       '01',
  VOID:       '04',
  REFUND:     '02',
  SETTLEMENT: '96',
};

const RESPONSE_CODES = {
  '00': 'Approved',
  '01': 'Refer to Card Issuer',
  '05': 'Do Not Honor',
  '12': 'Invalid Transaction',
  '13': 'Invalid Amount',
  '14': 'Invalid Card Number',
  '41': 'Lost Card',
  '43': 'Stolen Card',
  '51': 'Insufficient Funds',
  '54': 'Expired Card',
  '55': 'Invalid PIN',
  '61': 'Exceeds Withdrawal Limit',
  '91': 'Issuer Unavailable',
};

// -------------------------------------------------------
// HELPER: Build APOS packet
// Format: STX | CMD | FS | [FIELDS...] | ETX | LRC
// -------------------------------------------------------
function buildPacket(command, fields = []) {
  const body    = [command, ...fields].join(String.fromCharCode(FS));
  const content = String.fromCharCode(STX) + body + String.fromCharCode(ETX);
  const lrc     = computeLRC(Buffer.from(content));
  return Buffer.concat([Buffer.from(content), Buffer.from([lrc])]);
}

// Compute LRC - XOR of all bytes after STX
function computeLRC(buf) {
  let lrc = 0;
  for (let i = 1; i < buf.length; i++) lrc ^= buf[i];
  return lrc;
}

// -------------------------------------------------------
// HELPER: Parse APOS response packet
// -------------------------------------------------------
function parseResponse(buf) {
  try {
    const str    = buf.toString('ascii');
    const stxIdx = str.indexOf(String.fromCharCode(STX));
    const etxIdx = str.indexOf(String.fromCharCode(ETX));

    if (stxIdx === -1 || etxIdx === -1)
      return { success: false, error: 'Invalid packet: missing STX/ETX' };

    const body  = str.substring(stxIdx + 1, etxIdx);
    const parts = body.split(String.fromCharCode(FS));

    const responseCode = parts[1] || '';
    return {
      success:         responseCode === '00',
      responseCode,
      responseMessage: RESPONSE_CODES[responseCode] || `Unknown (${responseCode})`,
      authCode:        parts[2] || '',
      referenceNumber: parts[3] || '',
      cardNumber:      parts[4] || '',  // masked, e.g. ************1234
      cardType:        parts[5] || '',
      transactionId:   parts[6] || '',
      raw:             parts,
    };
  } catch (err) {
    return { success: false, error: `Parse error: ${err.message}` };
  }
}

// -------------------------------------------------------
// PAX EDC CLASS - USB SERIAL
// -------------------------------------------------------
class PaxEDC {
  constructor(options = {}) {
    this.portPath    = options.portPath || 'COM3';    // Windows: COM3 / Linux: /dev/ttyUSB0
    this.baudRate    = options.baudRate || 115200;
    this.timeout     = options.timeout  || 30000;     // 30 seconds
    this.port        = null;
    this.isConnected = false;
  }

  // -------------------------------------------------------
  // Open serial port connection
  // -------------------------------------------------------
  connect() {
    return new Promise((resolve, reject) => {
      this.port = new SerialPort({
        path:     this.portPath,
        baudRate: this.baudRate,
        dataBits: 8,
        stopBits: 1,
        parity:   'none',
        autoOpen: false,
      });

      this.port.open((err) => {
        if (err) return reject(new Error(`Failed to open port ${this.portPath}: ${err.message}`));
        this.isConnected = true;
        console.log(`[PAX] Connected on ${this.portPath} @ ${this.baudRate} baud`);
        resolve();
      });

      this.port.on('error', (err) => {
        console.error(`[PAX] Serial error: ${err.message}`);
        this.isConnected = false;
      });

      this.port.on('close', () => {
        console.log('[PAX] Port closed');
        this.isConnected = false;
      });
    });
  }

  // -------------------------------------------------------
  // Close serial port connection
  // -------------------------------------------------------
  disconnect() {
    return new Promise((resolve) => {
      if (this.port && this.port.isOpen) {
        this.port.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  // -------------------------------------------------------
  // Send packet and wait for response
  // -------------------------------------------------------
  sendAndReceive(packet) {
    return new Promise((resolve, reject) => {
      let responseBuffer = Buffer.alloc(0);
      let timer = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        this.port.removeAllListeners('data');
      };

      // Reject if no response within timeout
      timer = setTimeout(() => {
        cleanup();
        reject(new Error('EDC transaction timeout'));
      }, this.timeout);

      // Collect incoming data chunks until complete packet received
      this.port.on('data', (chunk) => {
        responseBuffer = Buffer.concat([responseBuffer, chunk]);

        // Packet is complete when ETX + LRC are received
        const etxIdx = responseBuffer.indexOf(ETX);
        if (etxIdx !== -1 && responseBuffer.length > etxIdx + 1) {
          cleanup();
          resolve(responseBuffer);
        }
      });

      // Send ENQ handshake first, then send the packet after ACK delay
      this.port.write(Buffer.from([ENQ]), (err) => {
        if (err) {
          cleanup();
          return reject(new Error(`ENQ write error: ${err.message}`));
        }

        setTimeout(() => {
          this.port.write(packet, (err) => {
            if (err) {
              cleanup();
              reject(new Error(`Packet write error: ${err.message}`));
            }
          });
        }, 200);
      });
    });
  }

  // -------------------------------------------------------
  // SALE
  // amount: in cents, e.g. 15000 = Rp 150.00
  // -------------------------------------------------------
  async sale(amount, options = {}) {
    if (!this.isConnected) await this.connect();

    const amountStr = String(amount).padStart(12, '0');
    const fields = [
      amountStr,
      options.tipAmount  || '000000000000',  // tip amount
      options.cashback   || '000000000000',  // cashback amount
      options.merchantId || '',              // merchant ID (optional)
      options.terminalId || '',              // terminal ID (optional)
    ];

    console.log(`[PAX] Sale request - Amount: ${amountStr}`);
    const result = parseResponse(await this.sendAndReceive(buildPacket(COMMANDS.SALE, fields)));
    console.log(`[PAX] Sale result: ${result.responseMessage} (${result.responseCode})`);
    return result;
  }

  // -------------------------------------------------------
  // VOID
  // Used to cancel a transaction before settlement
  // -------------------------------------------------------
  async void(transactionId, options = {}) {
    if (!this.isConnected) await this.connect();

    const fields = [
      transactionId,
      options.amount || '000000000000',
    ];

    console.log(`[PAX] Void request - TxID: ${transactionId}`);
    const result = parseResponse(await this.sendAndReceive(buildPacket(COMMANDS.VOID, fields)));
    console.log(`[PAX] Void result: ${result.responseMessage} (${result.responseCode})`);
    return result;
  }

  // -------------------------------------------------------
  // REFUND
  // Used to return funds after settlement (supports partial refund)
  // -------------------------------------------------------
  async refund(transactionId, amount, options = {}) {
    if (!this.isConnected) await this.connect();

    const amountStr = String(amount).padStart(12, '0');
    const fields = [
      amountStr,
      transactionId,
      options.merchantId || '',
      options.terminalId || '',
    ];

    console.log(`[PAX] Refund request - TxID: ${transactionId} | Amount: ${amountStr}`);
    const result = parseResponse(await this.sendAndReceive(buildPacket(COMMANDS.REFUND, fields)));
    console.log(`[PAX] Refund result: ${result.responseMessage} (${result.responseCode})`);
    return result;
  }

  // -------------------------------------------------------
  // SETTLEMENT
  // Batch close all approved transactions for the day
  // -------------------------------------------------------
  async settlement() {
    if (!this.isConnected) await this.connect();

    console.log('[PAX] Settlement request...');
    const result = parseResponse(await this.sendAndReceive(buildPacket(COMMANDS.SETTLEMENT, [])));
    console.log(`[PAX] Settlement result: ${result.responseMessage} (${result.responseCode})`);
    return result;
  }
}

module.exports = { PaxEDC };
