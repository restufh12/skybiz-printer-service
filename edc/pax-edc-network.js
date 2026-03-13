// =======================================================
// GHL EDC MODULE - NETWORK (TCP/IP)
// Protocol: GHL Systems POS Integration Spec v1.0.17
// Device  : PAX A920 + PaymentDirect UOB / Verifone Vx / Engage
// Connection: Stateless - new TCP connection per transaction
// =======================================================

const net = require('net');

// -------------------------------------------------------
// CONSTANTS
// -------------------------------------------------------
const STX = 0x02;
const ETX = 0x03;

const COMMANDS = {
  SALE:       '020',
  VOID:       '022',
  REFUND:     '026',
  SETTLEMENT: '050',
};

const ERROR_CODES = {
  '00': 'Successful',
  'BT': 'Transaction timed out from Bank',
  'CT': 'Transaction timed out / cancelled on Terminal',
  'CD': 'Invalid Check Digit',
};

const CARD_TYPES = {
  '04': 'VISA',
  '05': 'MasterCard',
  '06': 'Diners',
  '07': 'Amex',
  '08': 'MyDebit',
  '09': 'JCB',
  '10': 'UnionPay',
  '11': 'eWallet',
};

// -------------------------------------------------------
// HELPER: Calculate Check Digit (Section 5 of GHL spec)
// - Concat all fields between STX and Check Digit field
// - Break into 8-byte blocks, pad last block with 0xFF
// - XOR all blocks = 8-byte raw Buffer
// -------------------------------------------------------
function calcCheckDigit(data) {
  const buf    = Buffer.from(data, 'ascii');
  const padded = Math.ceil(buf.length / 8) * 8;
  const padBuf = Buffer.alloc(padded, 0xFF);
  buf.copy(padBuf);

  let result = Buffer.alloc(8, 0x00);
  for (let i = 0; i < padBuf.length; i += 8) {
    const block = padBuf.slice(i, i + 8);
    for (let j = 0; j < 8; j++) result[j] ^= block[j];
  }
  return result; // raw 8-byte Buffer
}

// -------------------------------------------------------
// HELPER: Build GHL request packet
// Format: STX | CMD(3) | Amount(12) | Invoice(6) | Cashier(4) | CheckDigit(8 raw) | ETX
// Total  : 1 + 3 + 12 + 6 + 4 + 8 + 1 = 35 bytes
// -------------------------------------------------------
function buildPacket(command, amount = 0, invoiceNumber = '000000', cashierNumber = '   1') {
  // Amount: N12 zero-padded, already in cents (e.g. RM1.00 = 100)
  const amountStr  = String(parseInt(amount) || 0).padStart(12, '0').slice(-12);

  // Invoice: N6 zero-padded (only used for Void, others pad with 0s)
  const invoiceStr = String(invoiceNumber || '0').padStart(6, '0').slice(-6);

  // Cashier: ANS4 right-justified, space-padded
  const cashierStr = String(cashierNumber || '1').padStart(4, ' ').slice(-4);

  const dataForCheck = command + amountStr + invoiceStr + cashierStr;
  const checkDigit   = calcCheckDigit(dataForCheck); // raw 8-byte Buffer

  const packet = Buffer.concat([
    Buffer.from([STX]),
    Buffer.from(dataForCheck, 'ascii'),
    checkDigit,
    Buffer.from([ETX]),
  ]);

  return packet;
}

// -------------------------------------------------------
// HELPER: Parse GHL response packet (Terminal to POS)
// -------------------------------------------------------
function parseResponse(buf) {
  try {
    const str    = buf.toString('ascii');
    const stxIdx = str.indexOf(String.fromCharCode(STX));
    const etxIdx = str.lastIndexOf(String.fromCharCode(ETX));

    if (stxIdx === -1 || etxIdx === -1)
      return { success: false, error: 'Invalid packet: missing STX/ETX' };

    const body  = str.substring(stxIdx + 1, etxIdx);
    let offset  = 0;

    const command       = body.substring(offset, offset += 3);
    const errorCode     = body.substring(offset, offset += 2);
    const cardNumberRaw = body.substring(offset, offset += 22);
    const expiryDate    = body.substring(offset, offset += 4);
    const cardTypeCode  = body.substring(offset, offset += 2);
    const approvalCode  = body.substring(offset, offset += 8).trim();
    const grossAmount   = body.substring(offset, offset += 12);
    const netAmount     = body.substring(offset, offset += 12);
    const traceNumber   = body.substring(offset, offset += 6);
    const invoiceNumber = body.substring(offset, offset += 6);
    const cashierNumber = body.substring(offset, offset += 4).trim();
    const cardName      = body.substring(offset, offset += 15).trim();
    const terminalId    = body.substring(offset, offset += 8).trim();
    const merchantId    = body.substring(offset, offset += 15).trim();
    const batchNumber   = body.substring(offset, offset += 6).trim();

    const cardLength = parseInt(cardNumberRaw.substring(0, 2)) || 0;
    const cardNumber = cardNumberRaw.substring(2, 2 + cardLength);

    return {
      success:        errorCode === '00',
      command,
      errorCode,
      errorMessage:   ERROR_CODES[errorCode] || `Error ${errorCode}`,
      cardNumber,
      expiryDate,
      cardTypeCode,
      cardType:       CARD_TYPES[cardTypeCode] || `Unknown (${cardTypeCode})`,
      cardName,
      approvalCode,
      grossAmount:    parseInt(grossAmount) || 0,
      netAmount:      parseInt(netAmount)   || 0,
      traceNumber:    traceNumber.trim(),
      invoiceNumber:  invoiceNumber.trim(),
      cashierNumber,
      terminalId,
      merchantId,
      batchNumber,
    };
  } catch (err) {
    return { success: false, error: `Parse error: ${err.message}` };
  }
}

// -------------------------------------------------------
// GHL EDC NETWORK CLASS - TCP/IP
// Opens new TCP connection per transaction (stateless)
// -------------------------------------------------------
class GhlEDCNetwork {
  constructor(options = {}) {
    this.host    = options.host    || '192.168.1.100';
    this.port    = options.port    || 9100;
    this.timeout = options.timeout || 60000; // 60s - customer needs time to swipe
    this.cashier = options.cashier || '   1';
  }

  // -------------------------------------------------------
  // Open TCP, send packet, receive response, close
  // -------------------------------------------------------
  sendAndReceive(packet) {
    return new Promise((resolve, reject) => {
      const client = new net.Socket();
      let responseBuffer = Buffer.alloc(0);
      let timer = null;
      let settled = false;

      const done = (err, result) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        client.destroy();
        if (err) reject(err);
        else resolve(result);
      };

      timer = setTimeout(() => {
        done(new Error('EDC Network timeout - card was not swiped in time'));
      }, this.timeout);

      client.connect(this.port, this.host, () => {
        console.log(`[GHL NET] Connected: ${this.host}:${this.port}`);
        console.log(`[GHL NET] Sending HEX: ${packet.toString('hex')}`);
        client.write(packet);
      });

      client.on('data', (chunk) => {
        responseBuffer = Buffer.concat([responseBuffer, chunk]);
        if (responseBuffer.indexOf(ETX) !== -1) {
          done(null, responseBuffer);
        }
      });

      client.on('error', (err) => done(new Error(`TCP error: ${err.message}`)));
    });
  }

  // -------------------------------------------------------
  // SALE - amount in cents (RM1.00 = 100)
  // -------------------------------------------------------
  async sale(amount, options = {}) {
    const packet = buildPacket(COMMANDS.SALE, amount, '000000', options.cashier || this.cashier);
    console.log(`[GHL NET] Sale - ${this.host}:${this.port} | Amount: ${amount} cents`);
    const result = parseResponse(await this.sendAndReceive(packet));
    console.log(`[GHL NET] Sale result: ${result.errorMessage} | Approval: ${result.approvalCode}`);
    return result;
  }

  // -------------------------------------------------------
  // VOID - invoiceNumber from original receipt
  // -------------------------------------------------------
  async void(invoiceNumber, options = {}) {
    const packet = buildPacket(COMMANDS.VOID, 0, invoiceNumber, options.cashier || this.cashier);
    console.log(`[GHL NET] Void - Invoice: ${invoiceNumber}`);
    const result = parseResponse(await this.sendAndReceive(packet));
    console.log(`[GHL NET] Void result: ${result.errorMessage}`);
    return result;
  }

  // -------------------------------------------------------
  // REFUND - amount in cents
  // -------------------------------------------------------
  async refund(amount, options = {}) {
    const packet = buildPacket(COMMANDS.REFUND, amount, '000000', options.cashier || this.cashier);
    console.log(`[GHL NET] Refund - Amount: ${amount} cents`);
    const result = parseResponse(await this.sendAndReceive(packet));
    console.log(`[GHL NET] Refund result: ${result.errorMessage}`);
    return result;
  }

  // -------------------------------------------------------
  // SETTLEMENT - batch close
  // -------------------------------------------------------
  async settlement(options = {}) {
    const packet = buildPacket(COMMANDS.SETTLEMENT, 0, '000000', options.cashier || this.cashier);
    console.log(`[GHL NET] Settlement - ${this.host}:${this.port}`);
    const result = parseResponse(await this.sendAndReceive(packet));
    console.log(`[GHL NET] Settlement result: ${result.errorMessage}`);
    return result;
  }
}

module.exports = { GhlEDCNetwork };