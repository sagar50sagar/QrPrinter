import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Everything the panel knows, in one hook — now backed by the product server.
 *
 * The shape of a job, the queue entry and the settings object are unchanged from
 * the demo, so the views did not have to move. What changed is where they come
 * from: `refresh` reads /api/panel/state, and every action writes to the server
 * then reconciles. The queue is no longer simulated — it is derived from each
 * document's real print_status, which only the connected agent advances.
 *
 * Actions stay synchronous and optimistic (the views use their return values in
 * the same tick), then persist asynchronously and refresh.
 */

const EMPTY_SETTINGS = {
  cafeName: '', welcomeMessage: '', rateBw: 0, rateColor: 0, printerBw: '', printerColor: '',
}

const EMPTY_STATS = {
  printsToday: 0, printedSheets: 0, collected: 0, cash: 0, online: 0, owed: 0, owedCount: 0, readyPrinters: 0,
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = new Error(data.error || 'the server could not complete that')
    error.status = res.status
    error.code = data.code
    throw error
  }
  return data
}

export function usePanel() {
  const [user, setUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [settings, setSettings] = useState(EMPTY_SETTINGS)
  const [jobs, setJobs] = useState([])
  const [printers, setPrinters] = useState([])
  const [devices, setDevices] = useState([])
  const [shop, setShop] = useState(null)
  const [stats, setStats] = useState(EMPTY_STATS)
  const [billing, setBilling] = useState(null)
  const [billingPlan, setBillingPlan] = useState(null)
  const [razorpayConfigured, setRazorpayConfigured] = useState(false)
  const [onlinePayments, setOnlinePayments] = useState(null)
  const [clearedAt, setClearedAt] = useState(0)
  const [error, setError] = useState('')
  const [deactivated, setDeactivated] = useState(false)

  // Refs let the synchronous actions read the latest state without re-binding.
  const settingsRef = useRef(settings)
  const jobsRef = useRef(jobs)
  const shopRef = useRef(shop)
  const settingsDirty = useRef(false)
  settingsRef.current = settings
  jobsRef.current = jobs
  shopRef.current = shop

  const refresh = useCallback(async () => {
    try {
      const data = await api('/api/panel/state')
      setJobs(data.jobs)
      setPrinters(data.printers)
      setDevices(data.devices)
      setShop(data.shop)
      setStats(data.stats)
      setBilling(data.shop?.billing || null)
      // Do not clobber settings the operator is mid-edit on.
      if (!settingsDirty.current) setSettings(data.settings)
      setError('')
    } catch (err) {
      if (err.status === 401) setUser(null)
      else if (err.code === 'account_deactivated') { setUser(null); setDeactivated(true) }
      else setError(err.message)
    }
  }, [])

  // Establish the session once, then poll while signed in.
  useEffect(() => {
    let alive = true
    api('/api/auth/me')
      .then((data) => { if (alive) { setUser(data.user); return refresh() } })
      .catch(() => {})
      .finally(() => { if (alive) setAuthChecked(true) })
    return () => { alive = false }
  }, [refresh])

  useEffect(() => {
    if (!user) return undefined
    const timer = setInterval(refresh, 3000)
    return () => clearInterval(timer)
  }, [user, refresh])

  // ── auth ──────────────────────────────────────────────────────────────────
  const login = useCallback(async (email, password) => {
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: { email, password } })
      setUser(data.user)
      await refresh()
    } catch (err) {
      if (err.code === 'account_deactivated') setDeactivated(true)
      throw err
    }
  }, [refresh])

  const signup = useCallback(async (payload) => {
    const data = await api('/api/auth/signup', { method: 'POST', body: payload })
    setUser(data.user)
    await refresh()
  }, [refresh])

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {})
    setUser(null)
    setDeactivated(false)
    setJobs([]); setPrinters([]); setDevices([]); setShop(null)
    setSettings(EMPTY_SETTINGS)
    setStats(EMPTY_STATS)
    setBilling(null); setBillingPlan(null); setRazorpayConfigured(false)
    setOnlinePayments(null)
  }, [])

  // Leave the locked-out screen for the sign-in form (e.g. to try another account).
  const acknowledgeDeactivation = useCallback(() => setDeactivated(false), [])

  // ── settings ──────────────────────────────────────────────────────────────
  const saveTimer = useRef(null)
  const persistSettings = useCallback(() => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      const s = settingsRef.current
      try {
        const data = await api('/api/panel/settings', {
          method: 'PUT',
          body: { ...s, isOpen: shopRef.current?.is_open ?? true },
        })
        settingsDirty.current = false
        setSettings(data.settings)
        setShop((current) => (current ? { ...current, is_open: data.is_open } : current))
      } catch (err) {
        setError(err.message)
      }
    }, 600)
  }, [])

  const patchSettings = useCallback((patch) => {
    settingsDirty.current = true
    setSettings((current) => ({ ...current, ...patch }))
    persistSettings()
  }, [persistSettings])

  const setOpen = useCallback(async (open) => {
    setShop((current) => (current ? { ...current, is_open: open } : current))
    try {
      const data = await api('/api/panel/settings', {
        method: 'PUT',
        body: { ...settingsRef.current, isOpen: open },
      })
      setShop((current) => (current ? { ...current, is_open: data.is_open } : current))
    } catch (err) {
      setError(err.message)
      await refresh()
    }
  }, [refresh])

  // ── the queue, derived from real document status ──────────────────────────
  const queue = useMemo(() => {
    const entries = jobs.filter((job) => job.print_status && job.print_status !== 'pending').map(toEntry)
    return entries.filter((entry) => isActive(entry) || !entry.finishedAt || Date.parse(entry.finishedAt) >= clearedAt)
  }, [jobs, clearedAt])
  const queueRef = useRef(queue)
  queueRef.current = queue

  // ── counter actions (synchronous + optimistic, then persisted) ────────────
  const markPaid = useCallback((ids, paid) => {
    const chosen = new Set(ids)
    setJobs((current) => current.map((job) => (chosen.has(job.id) ? { ...job, paid } : job)))
    api('/api/panel/pay', { method: 'POST', body: { jobIds: ids, paid } })
      .then(refresh)
      .catch((err) => { setError(err.message); refresh() })
  }, [refresh])

  const enqueuePrint = useCallback((ids) => {
    const chosen = new Set(ids)
    const wanted = jobsRef.current.filter((job) => chosen.has(job.id))
    const active = new Set(queueRef.current.filter(isActive).map((entry) => entry.jobId))
    const s = settingsRef.current
    const unassigned = { bw: 0, color: 0 }
    const fresh = []
    let duplicates = 0

    for (const job of wanted) {
      if (!job.paid) continue // print is gated on payment
      if (active.has(job.id) || job.print_status === 'printed') { duplicates++; continue }
      const printer = job.mode === 'color' ? s.printerColor : s.printerBw
      if (!printer) { unassigned[job.mode]++; continue }
      fresh.push({ ...job, printer })
    }

    if (fresh.length > 0) {
      const freshIds = new Set(fresh.map((job) => job.id))
      setJobs((current) => current.map((job) =>
        freshIds.has(job.id) ? { ...job, print_status: 'queued', printer: job.mode === 'color' ? s.printerColor : s.printerBw, error: '' } : job))
      api('/api/panel/print', { method: 'POST', body: { jobIds: fresh.map((job) => job.id) } })
        .then(refresh)
        .catch((err) => { setError(err.message); refresh() })
    }

    return {
      sent: fresh.length,
      sentIds: fresh.map((job) => job.id),
      sentBw: fresh.filter((job) => job.mode === 'bw').length,
      sentColor: fresh.filter((job) => job.mode === 'color').length,
      duplicates,
      unassigned,
    }
  }, [refresh])

  const retryPrint = useCallback((entryId) => {
    setJobs((current) => current.map((job) =>
      job.id === entryId ? { ...job, print_status: 'queued', error: '' } : job))
    api('/api/panel/retry', { method: 'POST', body: { jobId: entryId } })
      .then(refresh)
      .catch((err) => { setError(err.message); refresh() })
  }, [refresh])

  const clearFinishedPrints = useCallback(() => setClearedAt(Date.now()), [])

  const createPairingCode = useCallback(() => api('/api/panel/pairing-code', { method: 'POST' }), [])

  // ── billing ───────────────────────────────────────────────────────────────
  // The entitlement rides the /state poll (banner + status). The plan and whether
  // online payments are configured come from GET /api/billing, loaded on demand.
  const loadBilling = useCallback(async () => {
    const data = await api('/api/billing')
    setBilling(data.billing)
    setBillingPlan(data.billing?.plan || null)
    setRazorpayConfigured(Boolean(data.razorpay_configured))
    return data
  }, [])

  // Returns Razorpay's hosted checkout URL. Access is granted later by webhook,
  // never by this response, so the caller opens the URL and waits.
  const subscribe = useCallback(async () => {
    const data = await api('/api/billing/subscribe', { method: 'POST' })
    await loadBilling()
    return data
  }, [loadBilling])

  const cancelSubscription = useCallback(async () => {
    const data = await api('/api/billing/cancel', { method: 'POST' })
    await loadBilling()
    await refresh()
    return data
  }, [loadBilling, refresh])

  // ── online payments (the shop's own Razorpay account) ───────────────────────
  // Secrets are write-only: the server returns whether they are set, never them.
  const loadOnlinePayments = useCallback(async () => {
    const data = await api('/api/panel/online-payments')
    setOnlinePayments(data)
    return data
  }, [])

  const saveOnlinePayments = useCallback(async (payload) => {
    const data = await api('/api/panel/online-payments', { method: 'PUT', body: payload })
    setOnlinePayments(data)
    return data
  }, [])

  const removeOnlinePayments = useCallback(async () => {
    const data = await api('/api/panel/online-payments', { method: 'DELETE' })
    setOnlinePayments(data)
    return data
  }, [])

  return {
    user, authChecked, deactivated, login, signup, logout, acknowledgeDeactivation,
    settings, jobs, queue, printers, devices, shop, stats, error,
    billing, billingPlan, razorpayConfigured,
    onlinePayments, loadOnlinePayments, saveOnlinePayments, removeOnlinePayments,
    patchSettings, setOpen, markPaid, enqueuePrint, retryPrint, clearFinishedPrints,
    createPairingCode, loadBilling, subscribe, cancelSubscription, refresh,
    qrPngUrl: '/api/panel/qr.png',
    qrSvgUrl: '/api/panel/qr.svg',
    agentDownloadUrl: '/download/agent',
    amountOf: (job) => amountOf(job, settings),
  }
}

// ── document status → queue entry ───────────────────────────────────────────

const STATUS_MAP = {
  queued: 'pending', printing: 'printing', printed: 'success',
  failed: 'failed', rejected: 'failed', uncertain: 'failed',
}

function toEntry(job) {
  const status = STATUS_MAP[job.print_status] || 'pending'
  const error = job.print_status === 'uncertain'
    ? `Uncertain: ${job.error || 'the agent could not confirm whether this printed'}`
    : (job.error || '')
  return {
    id: job.id, jobId: job.id, name: job.name, file: job.file, mode: job.mode,
    pages: job.pages, copies: job.copies, printer: job.printer || '', status, error,
    at: job.at, acceptedAt: job.acceptedAt, finishedAt: job.finishedAt,
  }
}

// ── money and labels ────────────────────────────────────────────────────────

const rupees = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2,
})

export function money(value) {
  return rupees.format(Number.isFinite(value) ? value : 0)
}

/** What a job costs: every sheet, not every page. */
export function amountOf(job, settings) {
  if (!job) return 0
  const per = job.mode === 'color' ? settings.rateColor : settings.rateBw
  return toMoney(job.pages * job.copies * per)
}

function toMoney(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0
}

export const modeLabel = (mode) => (mode === 'color' ? 'Colour' : 'B&W')

export function clockTime(iso) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? '--:--'
    : date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function isToday(iso, now = new Date()) {
  const date = new Date(iso)
  return (
    !Number.isNaN(date.getTime()) &&
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  )
}

// ── the printing queue ──────────────────────────────────────────────────────

export const isActive = (entry) => entry.status === 'pending' || entry.status === 'printing'

export const queueStatusLabel = (status) =>
  ({ pending: 'Pending', printing: 'Printing', success: 'Success', failed: 'Failed' })[status] ?? status

/** Which printer a print type routes to, or '' when nothing is assigned. */
export const printerFor = (mode, settings) => (mode === 'color' ? settings.printerColor : settings.printerBw)