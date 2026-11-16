/**
 * Panel check: drives a real Chromium over CDP with no npm installs.
 *
 *   node panel/check.mjs [url]
 *
 * It answers the questions a screenshot cannot settle on its own: does anything
 * overflow sideways at phone width, is the day sheet readable in both themes,
 * does the text actually clear WCAG AA on the surfaces it sits on, and do the
 * counter's payment actions still work after a reload.
 *
 * Screenshots land in the OS temp directory (see OUT below). Exits non-zero
 * when a check fails, so it can gate a release.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

// localhost, not 127.0.0.1: Vite on Windows binds ::1 only, so the IPv4
// literal gets a refused connection and a blank page.
const URL_UNDER_TEST = process.argv[2] ?? 'http://localhost:5173/panel/'
const PORT = 9333
// Outside the repo on purpose. Vite watches the project root and answers a new
// file with a full page reload, which pulls the document out from under the
// measurement halfway through the run.
const OUT = join(tmpdir(), 'qrprinter-panel-check')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
// Absolute, because Chrome resolves a relative profile against its own working
// directory and then silently joins the user's running session instead.
const PROFILE = join(tmpdir(), 'qrprinter-panel-check-profile')

const failures = []
const report = {}

// Progress goes to stderr so `node panel/check.mjs | jq` still works, and so a
// run that hangs names the phase it hung in.
const started = Date.now()
const log = (phase) => console.error(`[check +${((Date.now() - started) / 1000).toFixed(1)}s] ${phase}`)

function check(name, ok, detail) {
  if (!ok) failures.push(`${name}: ${detail}`)
  return { name, ok, detail }
}

class Session {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    this.handlers = new Map()
    socket.onmessage = (raw) => {
      const message = JSON.parse(raw.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject, method } = this.pending.get(message.id)
        this.pending.delete(message.id)
        message.error ? reject(new Error(`${message.error.message} (${method})`)) : resolve(message.result)
      } else if (message.method && this.handlers.has(message.method)) {
        this.handlers.get(message.method)(message.params)
      }
    }
  }

  send(methodName, params = {}, timeoutMs = 20_000) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${methodName} timed out after ${timeoutMs / 1000}s`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
        method: methodName,
      })
      this.socket.send(JSON.stringify({ id, method: methodName, params }))
    })
  }

  on(event, handler) {
    this.handlers.set(event, handler)
  }

  async evaluate(expression, timeoutMs) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, timeoutMs)
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation failed')
    }
    return result.result.value
  }
}

async function waitForJson(url, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.json()
    } catch {
      /* Chrome is still booting */
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`no debugger at ${url}`)
}

async function open(url) {
  const targets = await waitForJson(`http://127.0.0.1:${PORT}/json/list`)
  const target = targets.find((entry) => entry.type === 'page')
  if (!target) throw new Error('no page target')

  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })

  const session = new Session(socket)
  const consoleLines = []
  await session.send('Runtime.enable')
  await session.send('Page.enable')
  session.on('Runtime.consoleAPICalled', (params) => {
    if (params.type === 'error' || params.type === 'warning') {
      consoleLines.push(`${params.type}: ${params.args.map((arg) => arg.description ?? arg.value).join(' ')}`)
    }
  })
  session.on('Runtime.exceptionThrown', (params) => {
    consoleLines.push(`exception: ${params.details.exception?.description ?? params.details.text}`)
  })

  await session.send('Page.navigate', { url })
  await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })

  // React renders after load. Waiting for the panel itself, and failing loudly
  // if it never appears, keeps a blank page from being read as "zero rows".
  let rendered = false
  for (let attempt = 0; attempt < 200 && !rendered; attempt++) {
    rendered = await session.evaluate(`!!document.querySelector('[role=tab]')`).catch(() => false)
    if (!rendered) await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!rendered) throw new Error(`the panel never rendered at ${url}`)

  return { session, consoleLines, socket }
}

async function shot(session, name, { fullPage = true } = {}) {
  // A beyond-viewport capture at 2x on a tall phone page can stall Chrome, and
  // a stalled screenshot must not cost the rest of the run. Fall back to the
  // visible area, which is still enough to judge the layout.
  const attempts = fullPage
    ? [{ captureBeyondViewport: true }, { captureBeyondViewport: false }]
    : [{ captureBeyondViewport: false }]

  for (const params of attempts) {
    try {
      const { data } = await session.send('Page.captureScreenshot', { format: 'png', ...params })
      writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
      return
    } catch (error) {
      report.screenshotNotes = [...(report.screenshotNotes ?? []), `${name}: ${error.message}`]
    }
  }
}

const sizeTo = async (session, width, height, mobile) => {
  await session.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile,
  })
  await new Promise((resolve) => setTimeout(resolve, 200))
}

const themeTo = async (session, mode) => {
  await session.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: mode }],
  })
  await session.evaluate(`
    (function () {
      try { localStorage.removeItem('qp-theme') } catch (e) {}
      var next = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      document.documentElement.classList.toggle('dark', next === 'dark')
    })()
  `)
  // Colours animate over 150-250ms; sampling too early reports a mid-transition
  // value, which would fail a contrast check that the finished page passes.
  await new Promise((resolve) => setTimeout(resolve, 700))
}

/**
 * Overflow, contrast and layout in one page evaluation. Contrast is computed
 * here because only the page knows the colours it finally resolved to.
 */
const MEASURE = `
(function () {
  function rgbOf(color) {
    var m = /rgba?\\(([^)]+)\\)/.exec(color)
    if (!m) return null
    var parts = m[1].split(',').map(Number)
    return parts.length === 3 ? parts : (parts[3] === 0 ? null : parts.slice(0, 3))
  }
  function lum(c) {
    var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
  }
  function ratio(a, b) {
    var l1 = lum(a), l2 = lum(b)
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
  }
  function backgroundOf(node) {
    for (var el = node; el; el = el.parentElement) {
      var c = rgbOf(getComputedStyle(el).backgroundColor)
      if (c) return c
    }
    return rgbOf(getComputedStyle(document.body).backgroundColor) || [255, 255, 255]
  }
  function contrastOf(selector, label) {
    var node = document.querySelector(selector)
    if (!node) return { label: label, skipped: 'not rendered at this width' }
    var fg = rgbOf(getComputedStyle(node).color)
    var bg = backgroundOf(node)
    if (!fg) return { label: label, skipped: 'unparsable colour ' + getComputedStyle(node).color }
    return { label: label, ratio: Math.round(ratio(fg, bg) * 100) / 100, fg: fg, bg: bg, size: getComputedStyle(node).fontSize }
  }

  var root = document.documentElement || document.createElement('html')
  var header = document.querySelector('header')
  var tableWrap = document.querySelector('[data-panel=job-table]')
  var cardList = document.querySelector('[data-panel=job-cards]')
  return {
    theme: root.classList.contains('dark') ? 'dark' : 'light',
    present: {
      header: !!header,
      tabs: document.querySelectorAll('[role=tab]').length,
      rows: document.querySelectorAll('table tbody tr').length,
      cards: cardList ? cardList.querySelectorAll('li').length : 0,
      bodyChildren: document.body.innerHTML.length,
    },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    horizontalOverflowPx: root.scrollWidth - root.clientWidth,
    widestElement: (function () {
      var worst = { tag: '', right: 0 }
      document.querySelectorAll('body *').forEach(function (node) {
        var rect = node.getBoundingClientRect()
        if (rect.right > worst.right) {
          worst = { tag: node.tagName.toLowerCase() + '.' + String(node.className.baseVal !== undefined ? '' : node.className).split(' ')[0], right: Math.round(rect.right) }
        }
      })
      return worst
    })(),
    headerHeightPx: header ? Math.round(header.getBoundingClientRect().height) : -1,
    rowsVisible: [...document.querySelectorAll('table tbody tr')].filter((r) => r.offsetParent).length,
    cardsVisible: cardList ? [...cardList.querySelectorAll('li')].filter((li) => li.offsetParent).length : 0,
    tableDisplayed: tableWrap ? getComputedStyle(tableWrap).display : 'no table',
    // overflow-hidden on the table wrapper clips instead of scrolling, so a
    // table wider than its container silently removes the payment controls
    // from the page. Measuring the box catches what the document overflow
    // cannot see.
    tableClippedPx: tableWrap ? Math.round(tableWrap.scrollWidth - tableWrap.clientWidth) : 0,
    lastColumnRight: (function () {
      var cell = document.querySelector('table tbody tr > *:last-child')
      return cell ? Math.round(cell.getBoundingClientRect().right) : -1
    })(),
    // A JSX comment written without its braces renders as page copy.
    commentMarkersInText: (function () {
      var text = document.body.innerText || ''
      return text.split('/*').length - 1 + (text.split('*/').length - 1)
    })(),
    contrasts: [
      contrastOf('h1', 'cafe name on header'),
      contrastOf('header p.text-sm', 'welcome message on header'),
      contrastOf('main .panel-numeric.text-xl', 'stat value on card'),
      contrastOf('main p.uppercase', 'stat label on card'),
      contrastOf('[role=tab][aria-selected=true]', 'selected tab text'),
      contrastOf('[role=tab]:not([aria-selected=true])', 'unselected tab text'),
      contrastOf('table tbody tr td:nth-child(3)', 'customer name on row'),
      contrastOf('select[aria-label^="Payment status"][class*=success]', 'paid status dropdown'),
      contrastOf('select[aria-label^="Payment status"][class*=warn]', 'unpaid status dropdown'),
      contrastOf('table thead th', 'column heading'),
      contrastOf('.rounded-full.bg-accent-600, label.text-white', 'active filter chip'),
      contrastOf('[data-panel=queue-list] span.ring-1', 'queue status badge'),
    ],
  }
})()
`

/**
 * A measurement is only worth what the page was when it was taken, so it is
 * retried until the panel is actually on screen rather than trusting one race.
 */
async function measure(session, label) {
  let lastError = null
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const page = await session.evaluate(MEASURE)
      if (page && page.present.tabs > 0) return page
      lastError = new Error(`panel not on screen (tabs=${page?.present?.tabs}, body=${page?.present?.bodyChildren})`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`${label}: ${lastError?.message ?? lastError}`)
}

const INTERACT = `
(async function () {
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms) }) }
  var q = function (s) { return document.querySelector(s) }
  var qa = function (s) { return Array.from(document.querySelectorAll(s)) }
  var out = {}
  // React tracks select values, so a plain .value assignment is invisible to
  // onChange; the native setter plus a bubbling event is the supported way in.
  var setSelect = function (el, value) {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  var clickButton = function (text) {
    var button = qa('button').find(function (b) { return b.textContent.trim().indexOf(text) === 0 })
    if (!button) throw new Error('no button starting with: ' + text)
    button.click()
  }
  var readQueue = function () {
    try { return JSON.parse(localStorage.getItem('qp-panel-queue')) || [] } catch (e) { return [] }
  }
  var activeIn = function (entries) { return entries.filter(function (e) { return e.status === 'pending' || e.status === 'printing' }) }

  // ── cash: bulk mark paid, then the dropdown moving one job back ──
  var before = qa('table tbody tr').length
  out.before = before
  q('table thead input[type=checkbox]').click()
  await wait(120)
  var toolbar = q('[role=toolbar]')
  out.toolbarButtons = toolbar ? qa('[role=toolbar] button').map(function (b) { return b.textContent.trim() }) : []
  clickButton('Mark paid')
  await wait(150)
  out.markPaidAnnouncement = q('[role=status]').textContent
  q('input[name=filter-status][value=unpaid]').click()
  await wait(150)
  out.unpaidRowsAfterMarkAllPaid = qa('table tbody tr').length
  out.emptyShown = !!q('.border-dashed')
  q('input[name=filter-status][value=paid]').click()
  await wait(150)
  out.paidRows = qa('table tbody tr').length
  var firstStatus = q('table tbody tr select[aria-label^="Payment status"]')
  out.dropdownMovedJobId = firstStatus.getAttribute('aria-label').split(' ')[3].replace(',', '')
  setSelect(firstStatus, 'unpaid')
  await wait(150)
  out.paidRowsAfterDropdown = qa('table tbody tr').length
  q('input[name=filter-status][value=unpaid]').click()
  await wait(120)
  out.unpaidRowsAfterDropdown = qa('table tbody tr').length
  q('input[name=filter-status][value=all]').click()
  await wait(120)
  out.allRowsBack = qa('table tbody tr').length

  // ── prepaid with nothing assigned: warn, send nothing ──
  q('#tab-printing-prepaid').click()
  await wait(150)
  q('[data-panel=prepaid-table] thead input[type=checkbox]').click()
  await wait(120)
  clickButton('Print selected')
  await wait(200)
  out.unassignedWarning = (q('[role=alert]') || {}).textContent
  out.queueAfterUnassigned = readQueue().length

  // ── settings: assign, test, save ──
  q('#tab-settings').click()
  await wait(150)
  setSelect(q('#printer-bw'), 'Counter LaserJet')
  setSelect(q('#printer-color'), 'Colour Duplexer')
  await wait(120)
  q('button[aria-label="Test B&W printer"]').click()
  await wait(120)
  out.testNote = qa('[role=status]').map(function (p) { return p.textContent }).join(' | ')
  clickButton('Save configuration')
  await wait(150)
  out.savedNote = qa('[role=status]').map(function (p) { return p.textContent }).join(' | ')
  out.savedSettings = JSON.parse(localStorage.getItem('qp-panel-settings'))

  // ── prepaid: mixed bulk print routes by type ──
  q('#tab-printing').click()
  await wait(120)
  q('#tab-printing-prepaid').click()
  await wait(150)
  q('[data-panel=prepaid-table] thead input[type=checkbox]').click()
  await wait(120)
  clickButton('Print selected')
  await wait(250)
  out.printAnnouncement = qa('[role=status]').map(function (p) { return p.textContent }).filter(Boolean).join(' | ')
  out.queueAfterSend = readQueue().length
  out.rowButtonLocked = q('[data-panel=prepaid-table] button[aria-label^="Print J-"]').disabled

  // ── duplicate submission while the batch is moving ──
  q('[data-panel=prepaid-table] thead input[type=checkbox]').click()
  await wait(120)
  clickButton('Print selected')
  await wait(200)
  out.duplicateWarning = (q('[role=alert]') || {}).textContent
  out.queueAfterDuplicate = readQueue().length

  // ── wait for the simulated agent to finish the batch ──
  var settled = false
  for (var attempt = 0; attempt < 50 && !settled; attempt++) {
    await wait(500)
    settled = activeIn(readQueue()).length === 0
  }
  var entries = readQueue()
  out.batchSettled = settled
  out.batchStatuses = entries.map(function (e) { return e.status })
  out.routingCorrect = entries.every(function (e) {
    return e.printer === (e.mode === 'color' ? 'Colour Duplexer' : 'Counter LaserJet')
  })

  // ── select all skips successfully printed documents ──
  var prepaidHead = q('[data-panel=prepaid-table] thead input[type=checkbox]')
  out.selectAllDisabledAfterSuccess = prepaidHead.disabled
  prepaidHead.click()
  await wait(150)
  out.selectAllAfterSuccess = qa('[data-panel=prepaid-table] tbody input[type=checkbox]:checked').length

  // ── an offline printer fails with the reason, and Retry re-attempts ──
  q('#tab-settings').click()
  await wait(150)
  setSelect(q('#printer-bw'), 'Bill Print')
  await wait(120)
  clickButton('Save configuration')
  await wait(150)
  q('#tab-printing').click()
  await wait(120)
  q('#tab-printing-prepaid').click()
  await wait(150)
  q('button[aria-label="Print J-1072"]').click()
  await wait(2200)
  var failed = readQueue().filter(function (e) { return e.jobId === 'J-1072' }).pop()
  out.offlineFailed = failed && failed.status === 'failed'
  out.offlineError = failed && failed.error
  q('#tab-dashboard').click()
  await wait(150)
  q('button[aria-label="Retry resume-final.pdf"]').click()
  await wait(2200)
  var retried = readQueue().filter(function (e) { return e.jobId === 'J-1072' }).pop()
  out.retryAttempted = retried && retried.status === 'failed' && retried.at !== failed.at

  // ── a failed document is still selectable, the six succeeded ones are not ──
  q('#tab-printing').click()
  await wait(120)
  q('#tab-printing-prepaid').click()
  await wait(150)
  q('[data-panel=prepaid-table] thead input[type=checkbox]').click()
  await wait(150)
  out.selectAllAfterFailure = qa('[data-panel=prepaid-table] tbody input[type=checkbox]:checked').length

  // ── cash: only paid jobs offer Print, and it routes like prepaid ──
  q('#tab-printing').click()
  await wait(120)
  q('#tab-printing-cash').click()
  await wait(150)
  q('input[name=filter-status][value=all]').click()
  await wait(150)
  out.unpaidHasNoPrint = !q('button[aria-label="Print J-1084"]')
  out.paidHasPrint = !!q('button[aria-label="Print J-1081"]')
  q('button[aria-label="Print J-1081"]').click()
  await wait(3000)
  var cashEntry = readQueue().filter(function (e) { return e.jobId === 'J-1081' }).pop()
  out.cashPrintRouted = cashEntry && cashEntry.printer === 'Colour Duplexer'
  out.cashPrintStatus = cashEntry && cashEntry.status
  q('[data-panel=job-table] thead input[type=checkbox]').click()
  await wait(150)
  out.cashSelectAllSkipsPrinted = qa('[data-panel=job-table] tbody input[type=checkbox]:checked').length
  return out
})()
`

// Runs after a real Page.reload: a reload inside Runtime.evaluate would destroy
// the very context the promise lives in.
const persistProbe = (movedJobId) => `
(function () {
  var read = function (key) { try { return JSON.parse(localStorage.getItem(key)) } catch (e) { return null } }
  var queue = read('qp-panel-queue') || []
  var jobs = read('qp-panel-jobs') || []
  var moved = jobs.find(function (j) { return j.id === '${movedJobId}' })
  var result = {
    persistedSettings: read('qp-panel-settings'),
    persistedQueueLength: queue.length,
    persistedQueueStatuses: queue.map(function (e) { return e.status }),
    persistedMovedJob: moved ? moved.paid : null,
    dashboardQueueRows: document.querySelectorAll('[data-panel=queue-list] li').length,
  }
  localStorage.removeItem('qp-panel-jobs')
  localStorage.removeItem('qp-panel-settings')
  localStorage.removeItem('qp-panel-queue')
  return result
})()
`

mkdirSync(OUT, { recursive: true })
rmSync(PROFILE, { recursive: true, force: true })

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--window-size=1440,1000',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

try {
  log(`launching chrome for ${URL_UNDER_TEST}`)
  const { session, consoleLines, socket } = await open(URL_UNDER_TEST)
  log('panel rendered')

  // The dashboard is the landing tab: measure it in both themes before the
  // job table replaces it, so the stat cards keep their contrast coverage.
  await sizeTo(session, 1440, 1000, false)
  await themeTo(session, 'light')
  log('measuring dashboard light')
  report.dashboardLight = await measure(session, 'dashboard light')
  await shot(session, 'dashboard-light')
  await themeTo(session, 'dark')
  log('measuring dashboard dark')
  report.dashboardDark = await measure(session, 'dashboard dark')
  await shot(session, 'dashboard-dark')

  // Layout passes run on the cash table with every cash job shown.
  await session.evaluate(`
    (function () {
      document.querySelector('#tab-printing').click()
    })()
  `)
  await new Promise((resolve) => setTimeout(resolve, 200))
  await session.evaluate(`
    (function () {
      var all = document.querySelector('input[name=filter-status][value=all]')
      if (all) all.click()
    })()
  `)
  await new Promise((resolve) => setTimeout(resolve, 200))

  // Desktop, light, then dark.
  await sizeTo(session, 1440, 1000, false)
  await themeTo(session, 'light')
  log('measuring desktop light')
  report.desktopLight = await measure(session, 'desktop light')
  await shot(session, 'desktop-light')

  await themeTo(session, 'dark')
  log('measuring desktop dark')
  report.desktopDark = await measure(session, 'desktop dark')
  await shot(session, 'desktop-dark')

  for (const width of [390, 768, 1024]) {
    await sizeTo(session, width, 844, width < 500)
    await themeTo(session, 'light')
    log(`measuring ${width}px`)
    report[`width${width}`] = await measure(session, `${width}px`)
    await shot(session, `width-${width}`, { fullPage: width >= 768 })
  }

  // Prepaid and Settings get their own visual + overflow pass: the interaction
  // probe drives them, but only a measurement catches a page that scrolls
  // sideways without failing a click.
  const overflowOf = () =>
    session.evaluate(`(function () { var r = document.documentElement; return r.scrollWidth - r.clientWidth })()`)
  const clickTab = async (id) => {
    await session.evaluate(`(function () { document.querySelector('${id}').click() })()`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  await sizeTo(session, 1440, 1000, false)
  await clickTab('#tab-printing-prepaid')
  report.prepaidOverflow1440 = await overflowOf()
  await shot(session, 'prepaid-light')
  await clickTab('#tab-settings')
  report.settingsOverflow1440 = await overflowOf()
  await shot(session, 'settings-light')

  await sizeTo(session, 390, 844, true)
  await clickTab('#tab-printing')
  await clickTab('#tab-printing-prepaid')
  report.prepaidOverflow390 = await overflowOf()
  await shot(session, 'prepaid-390')
  await clickTab('#tab-settings')
  report.settingsOverflow390 = await overflowOf()
  await shot(session, 'settings-390')

  // INTERACT starts on the cash table with every cash job shown.
  await sizeTo(session, 1440, 1000, false)
  await clickTab('#tab-printing')
  await session.evaluate(`
    (function () {
      var all = document.querySelector('input[name=filter-status][value=all]')
      if (all) all.click()
    })()
  `)
  await new Promise((resolve) => setTimeout(resolve, 200))
  log('driving the counter')
  // The full counter flow waits out two printer batches plus a retry, so it
  // needs far more than the default per-call timeout.
  report.interaction = await session.evaluate(INTERACT, 120_000)

  // A real reload, then read what survived it.
  log('reloading to check persistence')
  await session.send('Page.reload')
  for (let attempt = 0; attempt < 100; attempt++) {
    const rendered = await session.evaluate(`!!document.querySelector('[data-panel=queue-list]')`).catch(() => false)
    if (rendered) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  await new Promise((resolve) => setTimeout(resolve, 300))
  Object.assign(report.interaction, await session.evaluate(persistProbe(report.interaction.dropdownMovedJobId)))

  await new Promise((resolve) => setTimeout(resolve, 200))
  report.consoleLines = consoleLines

  check('no console errors', consoleLines.length === 0, consoleLines.join(' | '))
  check('no sideways overflow at 1440', report.desktopLight.horizontalOverflowPx <= 0, `${report.desktopLight.horizontalOverflowPx}px`)
  check('no sideways overflow at 1024', report.width1024.horizontalOverflowPx <= 0, `${report.width1024.horizontalOverflowPx}px`)
  check('no sideways overflow at 768', report.width768.horizontalOverflowPx <= 0, `${report.width768.horizontalOverflowPx}px`)
  check('no sideways overflow at 390', report.width390.horizontalOverflowPx <= 0, `${report.width390.horizontalOverflowPx}px`)
  check('prepaid does not overflow at 1440', report.prepaidOverflow1440 <= 0, `${report.prepaidOverflow1440}px`)
  check('settings does not overflow at 1440', report.settingsOverflow1440 <= 0, `${report.settingsOverflow1440}px`)
  check('prepaid does not overflow at 390', report.prepaidOverflow390 <= 0, `${report.prepaidOverflow390}px`)
  check('settings does not overflow at 390', report.settingsOverflow390 <= 0, `${report.settingsOverflow390}px`)
  check('table not clipped at 1440', report.desktopLight.tableClippedPx <= 1, `${report.desktopLight.tableClippedPx}px hidden`)
  check('table not clipped at 1024', report.width1024.tableClippedPx <= 1, `${report.width1024.tableClippedPx}px hidden`)
  check('last table column on screen at 1024', report.width1024.lastColumnRight <= 1024, `right edge ${report.width1024.lastColumnRight}`)
  check('table hidden at 768', report.width768.tableDisplayed === 'none', `display=${report.width768.tableDisplayed}`)
  check('cards used at 768', report.width768.cardsVisible >= 9, `${report.width768.cardsVisible} cards`)
  check('table hidden on a phone', report.width390.tableDisplayed === 'none', `display=${report.width390.tableDisplayed}`)
  check('cards used on a phone', report.width390.cardsVisible >= report.width390.rowsVisible, `${report.width390.cardsVisible} cards vs ${report.width390.rowsVisible} rows`)
  check('phone header leaves room to work', report.width390.headerHeightPx < 420, `${report.width390.headerHeightPx}px of 844px`)
  check('no page copy leaked as code', ['dashboardLight', 'dashboardDark', 'desktopLight', 'desktopDark', 'width1024', 'width768', 'width390']
    .every((key) => report[key].commentMarkersInText === 0),
    ['dashboardLight', 'dashboardDark', 'desktopLight', 'desktopDark', 'width1024', 'width768', 'width390']
      .filter((key) => report[key].commentMarkersInText > 0)
      .map((key) => `${key}: ${report[key].commentMarkersInText}`).join(', '))
  check('no sideways overflow on the dashboard', ['dashboardLight', 'dashboardDark']
    .every((key) => report[key].horizontalOverflowPx <= 0),
    ['dashboardLight', 'dashboardDark'].map((key) => `${key}: ${report[key].horizontalOverflowPx}px`).join(', '))

  const act = report.interaction
  check('select all offers the three bulk actions', act.toolbarButtons.length === 3, act.toolbarButtons.join(','))
  check('mark paid empties the unpaid filter', act.unpaidRowsAfterMarkAllPaid === 0 && act.emptyShown, `${act.unpaidRowsAfterMarkAllPaid} rows left, empty state ${act.emptyShown}`)
  check('payment dropdown moves the job between lists', act.paidRowsAfterDropdown === act.paidRows - 1 && act.unpaidRowsAfterDropdown === 1, `paid ${act.paidRows}→${act.paidRowsAfterDropdown}, unpaid ${act.unpaidRowsAfterDropdown}`)
  check('row count is stable after filters', act.allRowsBack === act.before, `${act.allRowsBack} of ${act.before}`)
  check('unassigned types warn and send nothing', /no B&W printer assigned/.test(act.unassignedWarning ?? '') && /no colour printer assigned/.test(act.unassignedWarning ?? '') && act.queueAfterUnassigned === 0, `warning: ${act.unassignedWarning}; queued ${act.queueAfterUnassigned}`)
  check('test printer reports the last known state', /Counter LaserJet: ready/.test(act.testNote ?? ''), act.testNote)
  check('configuration saves persistently', act.savedSettings?.printerBw === 'Counter LaserJet' && act.savedSettings?.printerColor === 'Colour Duplexer', JSON.stringify(act.savedSettings))
  check('mixed bulk print routes by type', act.queueAfterSend === 7 && /4 B&W to Counter LaserJet/.test(act.printAnnouncement ?? '') && /3 colour to Colour Duplexer/.test(act.printAnnouncement ?? ''), `queued ${act.queueAfterSend}: ${act.printAnnouncement}`)
  check('print button locks while the job is in the queue', act.rowButtonLocked === true, `disabled=${act.rowButtonLocked}`)
  check('duplicate submission is refused', act.queueAfterDuplicate === 7 && /already in the queue/.test(act.duplicateWarning ?? ''), `queued ${act.queueAfterDuplicate}: ${act.duplicateWarning}`)
  check('batch completes with success, not on submission', act.batchSettled && act.batchStatuses.length === 7 && act.batchStatuses.every((s) => s === 'success'), act.batchStatuses?.join(','))
  check('every entry went to the printer for its type', act.routingCorrect === true, 'routing mismatch')
  check('offline printer fails with the reason', act.offlineFailed === true && /offline/.test(act.offlineError ?? ''), `${act.offlineFailed}: ${act.offlineError}`)
  check('retry re-attempts a failed job', act.retryAttempted === true, 'retry did not produce a new attempt')
  check('unpaid cash jobs have no print button', act.unpaidHasNoPrint === true, 'Print offered before payment')
  check('paid cash jobs offer print like prepaid', act.paidHasPrint === true, 'no Print button on a paid job')
  check('cash print routes by type and completes', act.cashPrintRouted === true && act.cashPrintStatus === 'success', `routed=${act.cashPrintRouted}, status=${act.cashPrintStatus}`)
  check('select all skips successfully printed documents', act.selectAllAfterSuccess === 0 && act.selectAllDisabledAfterSuccess === true, `${act.selectAllAfterSuccess} selected, disabled=${act.selectAllDisabledAfterSuccess}`)
  check('failed documents remain selectable', act.selectAllAfterFailure === 1, `${act.selectAllAfterFailure} selected`)
  check('cash select all skips printed jobs', act.cashSelectAllSkipsPrinted === 8, `${act.cashSelectAllSkipsPrinted} selected`)
  check('assignments survive a reload', act.persistedSettings?.printerBw === 'Bill Print' && act.persistedSettings?.printerColor === 'Colour Duplexer', JSON.stringify(act.persistedSettings))
  check('queue history survives a reload', act.persistedQueueLength === 9 && act.dashboardQueueRows === 9, `stored ${act.persistedQueueLength}, rendered ${act.dashboardQueueRows}`)
  check('payment change survives a reload', act.persistedMovedJob === false, `${act.dropdownMovedJobId} paid=${act.persistedMovedJob}`)

  for (const theme of ['dashboardLight', 'dashboardDark', 'desktopLight', 'desktopDark']) {
    for (const item of report[theme].contrasts) {
      if (item.skipped) continue
      const small = parseFloat(item.size) < 18.66
      const needed = small ? 4.5 : 3
      check(`AA contrast ${theme} / ${item.label}`, item.ratio >= needed, `${item.ratio} < ${needed} at ${item.size}`)
    }
  }
  socket.close()
} catch (error) {
  // A probe that dies should still say what it saw on the way down, and must
  // never leave the run reporting success.
  report.error = String(error?.message ?? error)
  failures.push(`probe failed: ${report.error}`)
} finally {
  chrome.kill()
  await new Promise((resolve) => setTimeout(resolve, 300))
  chrome.kill()
}

report.failures = failures
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2))

const line = (key) => {
  const page = report[key]
  if (!page) return
  const contrasts = page.contrasts.filter((item) => !item.skipped)
  const lowest = contrasts.reduce((min, item) => (item.ratio < min.ratio ? item : min), contrasts[0])
  const failed = contrasts.filter((item) => item.ratio < (parseFloat(item.size) < 18.66 ? 4.5 : 3))
  console.log(
    `${key.padEnd(13)} overflow ${String(page.horizontalOverflowPx).padStart(4)}px · clipped ${String(page.tableClippedPx).padStart(4)}px · ` +
      `header ${String(page.headerHeightPx).padStart(3)}px · ` +
      `rows ${page.rowsVisible} / cards ${page.cardsVisible} · lowest contrast ${lowest ? `${lowest.ratio} (${lowest.label})` : 'n/a'}` +
      (failed.length ? ` · ${failed.length} BELOW AA: ${failed.map((f) => `${f.label} ${f.ratio}`).join(', ')}` : ''),
  )
}

for (const key of ['dashboardLight', 'dashboardDark', 'desktopLight', 'desktopDark', 'width1024', 'width768', 'width390']) line(key)

console.log(`\ninteraction  ${JSON.stringify(report.interaction)}`)
console.log(`console      ${report.consoleLines?.length ?? 0} error/warning line(s)${report.consoleLines?.length ? `: ${report.consoleLines.join(' | ')}` : ''}`)
if (report.error) console.log(`probe error  ${report.error}`)
console.log(failures.length === 0 ? '\nALL CHECKS PASSED' : `\n${failures.length} CHECK(S) FAILED\n` + failures.map((f) => `  - ${f}`).join('\n'))
console.log(`screenshots  ${OUT}/`)
process.exit(failures.length)
