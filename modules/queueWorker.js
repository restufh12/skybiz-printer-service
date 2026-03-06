// =======================================================
// PRINT QUEUE WORKER (WITH AUTO RETRY)
// =======================================================
const { getDB } = require('./db');
const { getMainWindow } = require('./globals');
const { sendLog } = require('./logger');
const { printToPrinter } = require('./printer');

function startQueueWorker(intervalMs = 5000) {
  const db = getDB();
  const mainWindow = getMainWindow();

  async function processQueue() {
    try {
      // gex max 5 job pending
      const jobs = db.prepare(`
        SELECT * FROM print_queue 
        WHERE status='pending' 
        ORDER BY id ASC LIMIT 5
      `).all();

      if (jobs.length > 0) sendLog(mainWindow, `Processing ${jobs.length} print jobs...`);

      for (const job of jobs) {
        try {
          // send to printer
          await printToPrinter({
            printMode: job.print_mode,
            printerName: job.printer_name,
            printerPort: job.printer_port,
            printType: job.print_type,
            printText: job.print_text
          });

          // success
          /*db.prepare(`UPDATE print_queue 
                      SET status='done', retry_count=retry_count+1, updated_at=CURRENT_TIMESTAMP 
                      WHERE id=?
          `).run(job.id);
          sendLog(mainWindow, `<span class="text-success">Job #${job.id} printed successfully.</span>`);*/

          // Delete record if success
          db.prepare(`DELETE FROM print_queue WHERE id=?`).run(job.id);
          sendLog(mainWindow, `<span class="text-success">Job #${job.id} printed & deleted from queue.</span>`);

        } catch (err) {
          // add retry counter
          const currentRetry = (job.retry_count || 0) + 1;

          if (currentRetry < 3) {
            // Retry again
            db.prepare(`
              UPDATE print_queue 
              SET retry_count=?, status='pending', updated_at=CURRENT_TIMESTAMP 
              WHERE id=?
            `).run(currentRetry, job.id);

            sendLog(mainWindow, `<span class="text-warning">Job #${job.id} failed (retry ${currentRetry}/3): ${err.message}</span>`);

          } else {
            // failure
            db.prepare(`
              UPDATE print_queue 
              SET status='error', retry_count=?, updated_at=CURRENT_TIMESTAMP 
              WHERE id=?
            `).run(currentRetry, job.id);

            sendLog(mainWindow, `<span class="text-danger">Job #${job.id} permanently failed after 3 retries.</span>`);
          }
        }
      }
    } catch (err) {
      sendLog(mainWindow, `<span class="text-danger">Worker error: ${err.message}</span>`);
    } finally {
      // run interval
      setTimeout(processQueue, intervalMs);
    }
  }

  processQueue();
}

module.exports = { startQueueWorker };
