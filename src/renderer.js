const { ipcRenderer } = require('electron');
const Inputmask = require("inputmask").default;

window.addEventListener("DOMContentLoaded", () => {
  const deviceId = document.getElementById('deviceId');
  const wsServer = document.getElementById('wsServer');

  // PRINTER
  const printerName = document.getElementById('printerName');
  const printerPort = document.getElementById('printerPort');
  const printMode = document.getElementById('printMode');
  const printText = document.getElementById('printText');
  const btnMACAddress = document.getElementById('btnMACAddress');
  const btnSaveConfig = document.getElementById('btnSaveConfig');
  const btnTestPrint = document.getElementById('btnTestPrint');
  const btnDeleteFailed = document.getElementById("btnDeleteFailed");
  const btnClear = document.getElementById('btnClearLog');
  const log = document.getElementById('log');
  const btnShowUSB = document.getElementById('btnShowUSB');
  const btnInfoUSB = document.getElementById('btnInfoUSB');
  const divPrintModeUSB = document.getElementById('divPrintModeUSB');
  const divPrinterName = document.getElementById('divPrinterName');
  const divPrinterPort = document.getElementById('divPrinterPort');
  const cptPrinterName = document.getElementById('cptPrinterName');
  const cptPrinterPort = document.getElementById('cptPrinterPort');

  // EDC
  const modeEDC = document.getElementById('modeEDC');
  const typeEDC = document.getElementById('typeEDC');
  const ipEDC = document.getElementById('ipEDC');
  const portEDC = document.getElementById('portEDC');
  const actionEDC = document.getElementById('actionEDC');
  const amountEDC = document.getElementById('amountEDC');
  const cashierEDC = document.getElementById('cashierEDC');
  const transactionIdEDC = document.getElementById('transactionIdEDC');
  const btnTestEDC = document.getElementById('btnTestEDC');
  const btnShowEDCUSB = document.getElementById('btnShowEDCUSB');
  const divEDCModeUSB = document.getElementById('divEDCModeUSB');
  const divIpEDC = document.getElementById('divIpEDC');
  const divPortEDC = document.getElementById('divPortEDC');
  const cptIpEDC = document.getElementById('cptIpEDC');
  const cptPortEDC = document.getElementById('cptPortEDC');

  function addLog(message) {
    const div = document.createElement('div');
    div.innerHTML = `> ${message}`;
    log.appendChild(div);

    // max 50 log entries
    const logItems = log.querySelectorAll('div');
    if (logItems.length > 50) log.removeChild(logItems[0]);

    // scroll to bottom
    log.scrollTop = log.scrollHeight;
  }

  function decodeEscposBase64(base64) {
    try {
      const buffer = Buffer.from(base64, "base64");
      const bytes = Array.from(buffer);
      let output = "";
      let asciiLine = "";
      let hexLine = [];

      // === Hex dump 16 bytes per line ===
      for (let i = 0; i < bytes.length; i++) {
        const hex = bytes[i].toString(16).padStart(2, "0");
        const char = bytes[i] >= 32 && bytes[i] <= 126 ? String.fromCharCode(bytes[i]) : ".";
        hexLine.push(hex);
        asciiLine += char;

        if ((i + 1) % 16 === 0 || i === bytes.length - 1) {
          output += `${hexLine.join(" ").padEnd(48)} | ${asciiLine}\n`;
          hexLine = [];
          asciiLine = "";
        }
      }

      // === Interpret some common ESC/POS patterns ===
      const hexString = buffer.toString("hex");
      const patterns = {
        "1b40": "ESC @  (Initialize printer)",
        "1b6100": "ESC a 0 (Align left)",
        "1b6101": "ESC a 1 (Align center)",
        "1b6102": "ESC a 2 (Align right)",
        "1d5600": "GS V 0 (Full cut)",
        "1d5601": "GS V 1 (Partial cut)",
        "1b21": "ESC ! (Font style)",
        "1d6b": "GS k (Barcode)",
        "1d28": "GS ( (QR code)",
      };

      const found = Object.entries(patterns)
        .filter(([code]) => hexString.includes(code))
        .map(([code, desc]) => `Found: ${desc}`)
        .join("\n");

      return `ESC/POS Raw Data (${buffer.length} bytes)\n\n${output}\n${found}`;
    } catch (err) {
      return `Failed to decode ESC/POS data:\n${err.message}`;
    }
  }


  // ---- IPC EVENT HANDLERS ----
  ipcRenderer.on('load-config', (event, config) => {
    deviceId.value = config.DEVICE_ID;
    wsServer.value = config.WS_SERVER;
  });

  ipcRenderer.on('app-version', (event, version) => {
    const el = document.getElementById('appVersion');
    if (el) el.textContent = version;
  });

  ipcRenderer.on('log', (_, msg) => addLog(msg));

  // ---- ACTION BUTTONS ----
  btnSaveConfig.onclick = () => {
    // VALIDATION EMPTY
    if(deviceId.value==""){
      deviceId.focus();
      return;
    }
    if(wsServer.value==""){
      wsServer.focus();
      return;
    }

    btnSaveConfig.disabled = true;
    const originalText = btnSaveConfig.innerHTML;
    btnSaveConfig.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status"></span>Saving...`;

    const newConfig = {
      DEVICE_ID: deviceId.value,
      WS_SERVER: wsServer.value
    };

    ipcRenderer.send('save-config', newConfig);

    ipcRenderer.once('config-saved', () => {
      btnSaveConfig.disabled = false;
      btnSaveConfig.innerHTML = originalText;

      Swal.fire({
        icon: 'success',
        title: 'Configuration Saved',
        text: 'Your service configuration has been updated successfully!',
        confirmButtonText: 'OK',
      });
    });

    ipcRenderer.once('config-save-error', (event, err) => {
      btnSaveConfig.disabled = false;
      btnSaveConfig.innerHTML = originalText;

      Swal.fire({
        icon: 'error',
        title: 'Failed to Save Config',
        text: err || 'An unknown error occurred.',
        confirmButtonText: 'OK',
      });
    });
  };

  btnMACAddress.onclick = async () => {
    const result = await ipcRenderer.invoke('get-mac-address');
    if (result.success) {
      Swal.fire('System Information', 'Your MAC Address : <b>'+result.message+'</b>', 'info');
    } else {
      Swal.fire('Error', result.error || '', 'error');
    }
  }

  btnTestPrint.onclick = async () => {
    // VALIDATION EMPTY
    if(printMode.value==""){
      printMode.focus();
      return;
    }

    if(printMode.value=="usb"){
      if(printerName.value==""){
        printerName.focus();
        return;
      }
    } else {
      if(printerName.value==""){
        printerName.focus();
        return;
      }
      if(printerPort.value==""){
        printerPort.focus();
        return;
      }
    }

    if(printText.value==""){
      printText.focus();
      return;
    }

    // Show Loading
    const originalText = btnTestPrint.innerHTML;
    btnTestPrint.disabled = true;
    btnTestPrint.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status"></span>Printing...`;

    try {
      /*const result = await ipcRenderer.invoke('print-test', {
        printerName  : printerName.value, 
        printerPort  : printerPort.value, 
        printMode    : printMode.value, 
        printType    : 'image',
        printText    : `data:image/png;base64,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`
      });*/

      const result = await ipcRenderer.invoke('print-test', {
        printerName  : printerName.value, 
        printerPort  : printerPort.value, 
        printMode    : printMode.value, 
        printType    : 'text',
        printText    : printText.value
      });

      if (result.success) {
        Swal.fire('Success', result.message || 'Print command sent', 'success');
      } else {
        Swal.fire('Error', result.error || 'Unknown error', 'error');
      }
    } catch (e) {
      Swal.fire('Error', e.message || e, 'error');
    } finally {
      // ALWAYS restore button
      btnTestPrint.disabled = false;
      btnTestPrint.innerHTML = originalText;
    }
  };

  btnClear.onclick = () => {
    log.innerHTML = '';
  };

  printMode.onchange = () => {
    if (printMode.value === 'usb') {
      divPrintModeUSB.style.display = 'inline-block';
      divPrinterPort.style.display = 'none';
      cptPrinterName.innerHTML = 'Printer USB (VID:PID)';
      printerName.value = '0x4b43:0x3830';
      printerName.placeholder='VID:PID';
    } else {
      divPrintModeUSB.style.display = 'none';
      divPrinterPort.style.display = 'block';
      cptPrinterName.innerHTML = 'Printer IP';
      printerName.value = '192.168.1.110';
      printerName.placeholder='e.g. 192.168.1.110';
    }
  };

  btnInfoUSB.onclick = async () => {
    const divContent = document.getElementById("content-usb-info-modal");
    const res  = await fetch("./views/usb-configuration.html");
    const html = await res.text();

    divContent.innerHTML = html;

    const USBInfoModal = new bootstrap.Modal(document.getElementById("USBInfoModal"));
    USBInfoModal.show();
  };

  btnShowUSB.onclick = async () => {
    const devices   = await ipcRenderer.invoke("get-usb-devices");
    const tbody     = document.getElementById("usbTableBody");
    tbody.innerHTML = "";

    devices.forEach(d => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${d.vid}</td>
        <td>${d.pid}</td>
        <td>${d.manufacturer}</td>
        <td>${d.product}</td>
        <td align="center"><button class="btn btn-sm btn-outline-success btn-use-usb" data-vid="${d.vid}" data-pid="${d.pid}">Use</button></td>
      `;
      tbody.appendChild(tr);
    });

    const USBConnectedModal = new bootstrap.Modal(document.getElementById("USBConnectedModal"));
    USBConnectedModal.show();
  };

  document.getElementById("usbTableBody").addEventListener("click", function(e) {
    const btn = e.target.closest(".btn-use-usb");
    if (!btn) return;
    const vid = btn.dataset.vid;
    const pid = btn.dataset.pid;
    document.getElementById("printerName").value = `${vid}:${pid}`;
    const modalEl = document.getElementById("USBConnectedModal");
    const modal = bootstrap.Modal.getInstance(modalEl);
    modal.hide();
  });


  // EDC
  modeEDC.onchange = () => {
    if (modeEDC.value === 'usb') {
      divEDCModeUSB.style.display = 'inline-block';
      divIpEDC.style.display = 'none';
      cptPortEDC.innerHTML = 'EDC USB/Port';
      portEDC.value = '';
      portEDC.placeholder='';
      portEDC.readOnly = true;
      portEDC.style.background = "#F5F2F2";
    } else {
      divEDCModeUSB.style.display = 'none';
      divIpEDC.style.display = 'block';
      cptPortEDC.innerHTML = 'EDC Port';
      portEDC.value = '9100';
      portEDC.placeholder='e.g. 9100';
      portEDC.readOnly = false;
      portEDC.style.background = "#FFFFFF";
    }
  };

  btnShowEDCUSB.onclick = async () => {
    const devices   = await ipcRenderer.invoke("get-usb-devices-edc");
    const tbody     = document.getElementById("usbEDCTableBody");
    tbody.innerHTML = "";

    devices.forEach(d => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${d.comPort}</td>
        <td>${d.manufacturer}</td>
        <td>${d.vendorId}</td>
        <td>${d.productId}</td>
        <td align="center"><button class="btn btn-sm btn-outline-success btn-use-usb-edc" data-comport="${d.comPort}">Use</button></td>
      `;
      tbody.appendChild(tr);
    });

    const USBConnectedEDCModal = new bootstrap.Modal(document.getElementById("USBConnectedEDCModal"));
    USBConnectedEDCModal.show();
  };

  document.getElementById("usbEDCTableBody").addEventListener("click", function(e) {
    const btn = e.target.closest(".btn-use-usb-edc");
    if (!btn) return;
    const comPort = btn.dataset.comport;
    document.getElementById("portEDC").value = `${comPort}`;
    const modalEl = document.getElementById("USBConnectedEDCModal");
    const modal = bootstrap.Modal.getInstance(modalEl);
    modal.hide();
  });

  btnTestEDC.onclick = async () => {
    // VALIDATION EMPTY
    if(modeEDC.value==""){
      modeEDC.focus();
      return;
    }

    if(modeEDC.value=="usb"){
      if(portEDC.value==""){
        portEDC.focus();
        return;
      }
    } else {
      if(ipEDC.value==""){
        ipEDC.focus();
        return;
      }
      if(portEDC.value==""){
        portEDC.focus();
        return;
      }
    }

    const vAmountEDC = parseFloat(amountEDC.value.replace(/,/g, ''));
    if (isNaN(vAmountEDC) || vAmountEDC <= 0) {
      amountEDC.focus();
      return;
    }

    // Show Loading
    const originalText = btnTestEDC.innerHTML;
    btnTestEDC.disabled = true;
    btnTestEDC.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status"></span>Connecting...`;

    try {
      const result = await ipcRenderer.invoke('edc-test', {
        modeEDC       : modeEDC.value, 
        typeEDC       : typeEDC.value, 
        ipEDC         : ipEDC.value, 
        portEDC       : portEDC.value, 
        action        : actionEDC.value, 
        amount        : vAmountEDC,
        cashier       : cashierEDC.value,
        transactionId : transactionIdEDC.value
      });

      if (result.success) {
        Swal.fire('Success', result.message || 'Print command sent', 'success');
      } else {
        Swal.fire('Error', result.error || 'Unknown error', 'error');
      }
    } catch (e) {
      Swal.fire('Error', e.message || e, 'error');
    } finally {
      // ALWAYS restore button
      btnTestEDC.disabled = false;
      btnTestEDC.innerHTML = originalText;
    }
  };

  // AMOUNT MUST 2 DECIMAL
  Inputmask({
    'alias': 'decimal',
    'groupSeparator': ',', // Optional: adds thousand separators
    'autoGroup': true,     // Optional: automatically groups digits
    'digits': 2,           // Specifies exactly 2 decimal places
    'digitsOptional': false, // Ensures the 2 decimal places are always shown
    'placeholder': '0.00', // Shows placeholder in the correct format
    'rightAlign': true     // Aligns the input to the right
  }).mask(amountEDC);

  // CONFIGURATION GRID.JS
  let grid;
  async function loadQueue() {
    const res = await ipcRenderer.invoke("get-queue-list");
    if (!res?.success) {
      console.error("Failed to get queue list:", res?.error);
      return;
    }

    const rows = res.data.map(job => [
      job.id,
      `${job.printer_name || '-'}:${job.printer_port || '-'}`,
      gridjs.html(`
        <button class="btn btn-sm btn-outline-info text-detail-btn" data-text="${encodeURIComponent(job.print_text || '')}">
          <i class="fa fa-eye"></i>
        </button>
      `),
      job.status,
      job.retry_count,
      gridjs.html(`
        <button class="btn btn-sm btn-outline-success retry-btn" data-id="${job.id}">
          <i class="fa fa-redo"></i>
        </button>
        <button class="btn btn-sm btn-outline-danger del-btn" data-id="${job.id}">
          <i class="fa fa-trash"></i>
        </button>
      `)
    ]);

    if (grid) {
      grid.updateConfig({ data: rows }).forceRender();
      return;
    }

    // Initialize Grid.js
    grid = new gridjs.Grid({
      columns: [
        { name: "ID", attributes: () => ({ style: "width:100px;text-align:center;" }) },
        "Printer",
        { name: "Text", sort: false, attributes: () => ({ style: "width:100px;text-align:center;" }) },
        { name: "Status", attributes: () => ({ style: "width:110px;text-align:center;" }) },
        { name: "Retry", attributes: () => ({ style: "width:110px;text-align:center;" }) },
        { name: "Action", sort: false, attributes: () => ({ style: "width:140px;text-align:center;" }) },
      ],
      data: rows,
      search: { enabled: true, placeholder: "Search..." },
      sort: true,
      pagination: { enabled: true, limit: 10, summary: true },
      className: {
        table: "table table-bordered table-striped table-sm align-middle",
        th: "text-center",
      },
      style: {
        table: { "font-size": "0.9rem" },
        th: { "background-color": "#f8f9fa" },
      }
    }).render(document.getElementById("queueTable"));
  }

  loadQueue();

  // Show Text Detail Modal
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".text-detail-btn");
    if (!btn) return;

    const raw = decodeURIComponent(btn.dataset.text);
    const modalTitle = document.getElementById("modalTitle");
    const modalContent = document.getElementById("modalContent");
    modalTitle.innerHTML = ""; // Clear content before
    modalContent.innerHTML = ""; // Clear content before

    // === Detect base64 image ===
    const isBase64Image = /^data:image\/(png|jpe?g|gif|bmp|webp);base64,/i.test(raw);

    // === Detect base64 ESC/POS ===
    const isEscposBase64 = /^[A-Za-z0-9+/=]+$/.test(raw) && raw.length > 100 && !isBase64Image;

    if (isBase64Image) {
      // Base64 image preview
      const img = document.createElement("img");
      img.src = raw;
      img.alt = "Base64 Image";
      img.className = "img-fluid rounded shadow-sm";
      modalTitle.innerHTML = "Type : Image";
      modalContent.appendChild(img);
    } else if (isEscposBase64) {
      // Base64 ESC/POS human-readable view
      const readable = decodeEscposBase64(raw);

      const pre = document.createElement("pre");
      pre.textContent = readable;
      pre.style.whiteSpace = "pre-wrap";
      pre.style.fontFamily = "monospace";
      pre.className = "bg-light p-3 rounded border";
      modalTitle.innerHTML = "Type : ESC/POS";
      modalContent.appendChild(pre);
    } else {
      // Normal text
      const pre = document.createElement("pre");
      pre.textContent = raw;
      pre.style.whiteSpace = "pre-wrap";
      pre.style.fontFamily = "monospace";
      modalTitle.innerHTML = "Type : Text";
      modalContent.appendChild(pre);
    }

    const modal = new bootstrap.Modal(document.getElementById("textModal"));
    modal.show();
  });

  // Delete All Failed
  document.getElementById("btnDeleteFailed").onclick = async () => {
    const confirm = await Swal.fire({
      icon: "warning",
      title: "Delete all failed jobs?",
      showCancelButton: true,
      confirmButtonText: "Yes, delete",
    });
    if (!confirm.isConfirmed) return;
    const res = await ipcRenderer.invoke("delete-failed-jobs");
    if (res.success) {
      Swal.fire("Deleted", `Removed ${res.count} failed jobs.`, "success");
      loadQueue();
    } else Swal.fire("Error", res.error || "Delete failed.", "error");
  };

  // Action Button
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.classList.contains("retry-btn")) {
      const res = await ipcRenderer.invoke("retry-job", id);
      Swal.fire(res.success ? "Success" : "Error",
        res.success ? `Job #${id} retried.` : res.error,
        res.success ? "success" : "error");
      loadQueue();
    } else if (btn.classList.contains("del-btn")) {
      const res = await ipcRenderer.invoke("delete-job", id);
      Swal.fire(res.success ? "Deleted" : "Error",
        res.success ? `Job #${id} removed.` : res.error,
        res.success ? "success" : "error");
      loadQueue();
    }
  });

  setInterval(loadQueue, 5000);
});