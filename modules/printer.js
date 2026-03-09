// =======================================================
// PRINTER HANDLER MODULE
// Support File Output, Network, USB, Serial, Bluetooth
// =======================================================

const fs = require("fs");
const path = require("path");
const escpos = require("escpos");
const { app } = require("electron");
const { getMainWindow } = require("./globals");
const { sendLog } = require("./logger");
const { formatDateTime } = require("./helper");

// =======================================================
// FILE DEVICE - for debug/test mode
// =======================================================
class FileDevice {
  constructor(filePath) {
    this.filePath = filePath;
  }
  open(callback) {
    this.stream = fs.createWriteStream(this.filePath, { flags: "a" });
    callback && callback();
  }
  write(data) {
    this.stream.write(data);
  }
  close() {
    this.stream.end();
  }
}

// =======================================================
// GET DEVICE HANDLER (Dynamic adapter loader)
// =======================================================
function getDevice(printMode, printerName, printerPort) {
  try {
    switch (printMode) {
      // --- File mode ---
      case "file": {
        const printDir = path.join(app.getPath("userData"), "print");
        if (!fs.existsSync(printDir)) fs.mkdirSync(printDir, { recursive: true });
        const filePath = path.join(printDir, `print_output_${formatDateTime()}.txt`);
        return new FileDevice(filePath);
      }

      // --- Network printer ---
      case "network": {
        try { escpos.Network = require("escpos-network"); } catch {}
        return new escpos.Network(printerName, printerPort || 9100);
      }

      // --- USB printer ---
      case "usb": {
        try { escpos.USB = require("escpos-usb"); } catch {}
        const arrPrinterName = printerName.split(":").map((item)=>item.trim());
        return new escpos.USB(arrPrinterName[0], arrPrinterName[1]);
      }

      // --- Serial printer ---
      case "serial": {
        try { escpos.Serial = require("escpos-serialport"); } catch {}
        return new escpos.Serial(printerName || "/dev/ttyUSB0", { baudRate: 9600 });
      }

      // --- Bluetooth printer ---
      case "bluetooth": {
        try { escpos.Bluetooth = require("escpos-bluetooth"); } catch {}
        if (!escpos.Bluetooth) throw new Error("escpos-bluetooth module not available");

        const device = new escpos.Bluetooth(printerName);
        if (typeof device.open !== "function") {
          throw new Error("Bluetooth adapter not compatible (no .open method)");
        }
        return device;
      }

      default:
        throw new Error(`Unsupported print mode: ${printMode}`);
    }
  } catch (err) {
    throw new Error(`Failed to initialize device (${printMode}): ${err.message}`);
  }
}

// =======================================================
// MAIN PRINT FUNCTION
// =======================================================
function printToPrinter(data) {
  const mainWindow = getMainWindow();

  const {
    printMode = "network",
    printerName = "192.168.1.110",
    printerPort = 9100,
    printType = "text", // text | image | escpos
    printText = "TEST",
  } = data || {};

  return new Promise((resolve, reject) => {
    try {
      const device = getDevice(printMode, printerName, printerPort);
      const printer = new escpos.Printer(device, { encoding: "GB18030" });

      sendLog(mainWindow, `<span class="text-info">Printing in ${printMode} mode...</span>`);

      device.open(async (errDevice) => {
        if (errDevice) {
          sendLog(mainWindow, `<span class="text-danger">Printer connection error: ${errDevice.message}</span>`);
          return reject(errDevice);
        }
        
        try {
          if (printType=="image") {
            // =======================================================
            // HANDLE IMAGE (base64)
            // =======================================================
            const tempDir = path.join(app.getPath('userData'), 'print-temp');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

            const tempFile = path.join(tempDir, `image_${Date.now()}.png`);

            try {
              // === Save base64 to dummy file ===
              const cleanBase64 = printText.replace(/^data:image\/\w+;base64,/, '');
              const imgBuffer = Buffer.from(cleanBase64, 'base64');
              fs.writeFileSync(tempFile, imgBuffer);

              // === Load and print image with timeout ===
              const timeout = setTimeout(() => {
                sendLog(mainWindow, `<span class="text-danger">Image print timeout — job skipped.</span>`);
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
                reject(new Error('Image print timeout'));
              }, 10000); // 10s

              try {
                escpos.Image.load(tempFile, async (image) => {
                  clearTimeout(timeout);
                  try {
                    await printer.align('CT').image(image, 's8');
                    printer.text('\n\n\n');
                    printer.cut();
                    printer.close();

                    sendLog(mainWindow, 'Printed successfully : ' + printerName + ' (img)');
                    resolve('Printed successfully : ' + printerName + ' (img)');
                  } catch (errPrint) {
                    sendLog(mainWindow, `<span class="text-warning">Image print failed : ${errPrint.message}</span>`);
                    reject(errPrint);
                  } finally {
                    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
                  }
                });
              } catch (errLoad) {
                clearTimeout(timeout);
                sendLog(mainWindow, `<span class="text-danger">Image load failed: ${errLoad.message}</span>`);
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
                reject(errLoad);
              }

            } catch (errImg) {
              sendLog(mainWindow, `<span class="text-danger">Base64 save error: ${errImg.message}</span>`);
              if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
              reject(errImg);
            }
          } else if(printType=="escpos"){
            // =======================================================
            // HANDLE RAWDATA (base64)
            // =======================================================
            try {
              const rawBuffer = Buffer.from(printText, 'base64');
              if (!rawBuffer || rawBuffer.length === 0) throw new Error('Empty ESC/POS buffer');

              // Write raw ESC/POS data directly via device
              device.write(rawBuffer);
              setTimeout(() => printer.close(), 300);

              sendLog(mainWindow, 'Printed successfully : ' + printerName + ' (escpos)');
              resolve('Printed successfully : ' + printerName + ' (escpos)');
            } catch (errRaw) {
              sendLog(mainWindow, `<span class="text-danger">Raw ESC/POS print failed: ${errRaw.message}</span>`);
              reject(errRaw);
            }
          } else {
            // =======================================================
            // HANDLE TEXT
            // =======================================================
            try {
              printer
                .align('CT')
                .text(printText)
                .text('\n\n\n')
                .cut()
                .close();

              sendLog(mainWindow, 'Printed successfully : ' + printerName + ' (txt)');
              resolve('Printed successfully : ' + printerName + ' (txt)');
            } catch (errTxt) {
              sendLog(mainWindow, `<span class="text-danger">Text print failed: ${errTxt.message}</span>`);
              reject(errTxt);
            }
          }
        } catch (errPrint) {
          sendLog(mainWindow, `<span class="text-danger">Print process error: ${errPrint.message}</span>`);
          reject(errPrint);
        }
      });
    } catch (errOuter) {
      sendLog(mainWindow, `<span class="text-danger">Print module error: ${errOuter.message}</span>`);
      reject(errOuter);
    }
  });
}

module.exports = { printToPrinter, getDevice };
