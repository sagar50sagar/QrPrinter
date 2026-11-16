/**
 * The panel's starting data.
 *
 * None of this comes from a server — there isn't one to talk to yet. It exists
 * so the counter screen can be built, clicked and judged before the product API
 * is written. `store.js` is the seam: when the real API arrives, it loads jobs
 * there and this file stops being imported.
 */

/** Editable from Settings, so these are defaults and not the shop's identity. */
export const defaultSettings = {
  cafeName: 'My cyber cafe',
  welcomeMessage: 'Scan the QR code, upload your document and pay at the counter.',
  /** Rupees per printed page. Drives every amount in the panel. */
  rateBw: 1,
  rateColor: 5,
  /**
   * Which printer handles which print type. Empty means unassigned: the panel
   * warns and sends nothing rather than guessing a printer.
   */
  printerBw: '',
  printerColor: '',
}

/** Today at a wall-clock time, so the "today" counters always have something in them. */
function todayAt(hours, minutes) {
  const date = new Date()
  date.setHours(hours, minutes, 0, 0)
  return date.toISOString()
}

function yesterdayAt(hours, minutes) {
  const date = new Date()
  date.setDate(date.getDate() - 1)
  date.setHours(hours, minutes, 0, 0)
  return date.toISOString()
}

/**
 * A job as the counter sees it.
 *
 * `mode` is bw or color, `method` is cash or online. Cash jobs are paid at the
 * counter; online jobs are prepaid, so they arrive already paid and go straight
 * to the Prepaid tab. `paid` is the only field the counter changes during the day.
 */
export const demoJobs = [
  { id: 'J-1071', name: 'Rakesh Kumar', file: 'aadhaar-update.pdf', pages: 2, copies: 3, mode: 'bw', paid: false, method: 'cash', at: todayAt(9, 12) },
  { id: 'J-1072', name: 'Priya Sharma', file: 'resume-final.pdf', pages: 1, copies: 2, mode: 'bw', paid: true, method: 'online', at: todayAt(9, 26) },
  { id: 'J-1073', name: 'Abdul Nazeer', file: 'land-record-03.pdf', pages: 14, copies: 1, mode: 'color', paid: false, method: 'cash', at: todayAt(9, 41) },
  { id: 'J-1074', name: 'Sana Sheikh', file: 'passport-form.pdf', pages: 3, copies: 2, mode: 'bw', paid: true, method: 'cash', at: todayAt(10, 4) },
  { id: 'J-1075', name: 'Vikram Rathore', file: '10th-marksheet.pdf', pages: 1, copies: 4, mode: 'color', paid: true, method: 'online', at: todayAt(10, 18) },
  { id: 'J-1076', name: 'Lakshmi Iyer', file: 'affidavit-stamp.pdf', pages: 4, copies: 1, mode: 'bw', paid: true, method: 'cash', at: todayAt(10, 33) },
  { id: 'J-1077', name: 'Mohammed Irfan', file: 'bus-ticket-confirmation.pdf', pages: 1, copies: 1, mode: 'color', paid: true, method: 'online', at: todayAt(11, 2) },
  { id: 'J-1078', name: 'Deepa Patil', file: 'photos-passport-8.pdf', pages: 8, copies: 1, mode: 'color', paid: false, method: 'cash', at: todayAt(11, 21) },
  { id: 'J-1079', name: 'Suresh Yadav', file: 'electricity-bill.pdf', pages: 1, copies: 2, mode: 'bw', paid: true, method: 'online', at: todayAt(11, 40) },
  { id: 'J-1080', name: 'Anita Das', file: 'application-form.pdf', pages: 6, copies: 1, mode: 'bw', paid: true, method: 'online', at: todayAt(12, 7) },
  { id: 'J-1081', name: 'Karthik Raja', file: 'degree-certificate.pdf', pages: 2, copies: 3, mode: 'color', paid: true, method: 'cash', at: todayAt(12, 28) },
  { id: 'J-1082', name: 'Nisha Verma', file: 'gumastha-license.pdf', pages: 5, copies: 2, mode: 'bw', paid: false, method: 'cash', at: todayAt(13, 9) },
  { id: 'J-1083', name: 'Farhan Qureshi', file: 'iot-project-report.pdf', pages: 38, copies: 2, mode: 'bw', paid: true, method: 'online', at: todayAt(13, 44) },
  { id: 'J-1084', name: 'Meena Kumari', file: 'family-photo-collage.pdf', pages: 1, copies: 6, mode: 'color', paid: true, method: 'cash', at: todayAt(14, 15) },
  // Yesterday, so the today counters have something to exclude.
  { id: 'J-1061', name: 'Ganesh Jadhav', file: 'voter-list.pdf', pages: 3, copies: 1, mode: 'bw', paid: true, method: 'cash', at: yesterdayAt(17, 5) },
  { id: 'J-1062', name: 'Ritika Bansal', file: 'portfolio-2026.pdf', pages: 12, copies: 1, mode: 'color', paid: true, method: 'online', at: yesterdayAt(18, 30) },
]

/**
 * Shaped like what the local agent reports on its heartbeat, because that is
 * where the real list will come from.
 */
export const demoPrinters = [
  { name: 'Counter LaserJet', kind: 'local', state: 'ready', stateReason: '', port: 'USB002', queueLength: 0, isDefault: true },
  { name: 'Colour Duplexer', kind: 'network', state: 'ready', stateReason: 'toner low', port: '192.168.1.20:9100', queueLength: 2, isDefault: false },
  { name: 'Bill Print', kind: 'network', state: 'offline', stateReason: 'marked offline in Windows', port: '192.168.1.24:9100', queueLength: 0, isDefault: false },
]
