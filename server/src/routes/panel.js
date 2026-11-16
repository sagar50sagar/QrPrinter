import { Router } from 'express'
import { config } from '../config.js'
import { many, one, query } from '../db.js'
import { pairingCode, pairingCodeId } from '../lib/ids.js'
import { badRequest, wrap } from '../lib/errors.js'
import { bool, int, paise, rupees, str } from '../lib/validate.js'
import { encryptSecret } from '../lib/crypto.js'
import { requireEntitled, requireSession } from '../middleware/session.js'
import { enqueue } from '../services/queue.js'
import { isOnline } from '../services/channels.js'
import { qrPng, qrSvg, shopLink } from '../services/qr.js'

const router = Router()
router.use(requireSession)

const settingsOf = (shop) => ({
  cafeName: shop.name,
  welcomeMessage: shop.welcome_message,
  rateBw: rupees(shop.price_bw_paise),
  rateColor: rupees(shop.price_color_paise),
  printerBw: shop.printer_bw || '',
  printerColor: shop.printer_color || '',
})

/** Everything the counter needs in one call; the panel polls this. */
router.get('/state', wrap(async (req, res) => {
  const shop = req.shop
  const rows = await many(
    `SELECT d.*, o.customer_name, o.method, o.status AS order_status, o.created_at AS order_at
     FROM documents d JOIN orders o ON o.id = d.order_id
     WHERE d.shop_id = $1
     ORDER BY o.created_at DESC, d.id`,
    [shop.id],
  )
  const jobs = rows.map((d) => ({
    id: d.id, order_id: d.order_id, name: d.customer_name, file: d.file_name,
    pages: d.pages, copies: d.copies, mode: d.mode,
    paid: d.order_status === 'paid', method: d.method, at: d.order_at,
    print_status: d.print_status, printer: d.printer_name || '', error: d.print_detail || '',
    acceptedAt: d.delivered_at, finishedAt: d.finished_at,
  }))

  const devices = await many(
    'SELECT * FROM devices WHERE shop_id = $1 AND revoked_at IS NULL ORDER BY created_at',
    [shop.id],
  )
  const printerMap = new Map()
  for (const device of devices) {
    const online = isOnline(device.id)
    const list = Array.isArray(device.printers) ? device.printers : []
    for (const p of list) {
      const key = p.endpoint || p.name
      const mapped = {
        name: p.name, endpoint: p.endpoint || p.name, kind: p.kind || 'unknown',
        state: p.state || 'unknown', stateReason: p.status_reason || '', port: p.port || '',
        driver: p.driver || '', queueLength: p.queue_length || 0, isDefault: Boolean(p.is_default),
        deviceId: device.id, online,
      }
      const existing = printerMap.get(key)
      if (!existing || (!existing.online && online)) printerMap.set(key, mapped)
    }
  }

  const printerList = [...printerMap.values()]
  // Printed documents are purged after a grace window, so the day's totals come
  // from the orders (which keep completion counters), not from the live jobs.
  const today = await one(
    `SELECT
       coalesce(sum(printed_documents), 0)::int AS prints_today,
       coalesce(sum(printed_sheets), 0)::int AS sheets_today,
       coalesce(sum(amount_paise) FILTER (WHERE status = 'paid'), 0)::bigint AS collected_paise,
       coalesce(sum(amount_paise) FILTER (WHERE status = 'paid' AND method = 'cash'), 0)::bigint AS cash_paise,
       coalesce(sum(amount_paise) FILTER (WHERE status = 'paid' AND method = 'online'), 0)::bigint AS online_paise,
       coalesce(sum(amount_paise) FILTER (WHERE status = 'unpaid'), 0)::bigint AS owed_paise,
       count(*) FILTER (WHERE status = 'unpaid')::int AS owed_count
     FROM orders
     WHERE shop_id = $1 AND created_at >= date_trunc('day', now())`,
    [shop.id],
  )
  const stats = {
    printsToday: today.prints_today,
    printedSheets: today.sheets_today,
    collected: rupees(today.collected_paise),
    cash: rupees(today.cash_paise),
    online: rupees(today.online_paise),
    owed: rupees(today.owed_paise),
    owedCount: today.owed_count,
    readyPrinters: printerList.filter((p) => p.state === 'ready').length,
  }

  res.json({
    ok: true,
    settings: settingsOf(shop),
    stats,
    jobs,
    printers: printerList,
    devices: devices.map((d) => ({
      id: d.id, label: d.label, hostname: d.hostname, agent_version: d.agent_version,
      online: isOnline(d.id), spooler_running: d.spooler_running,
      last_heartbeat_at: d.last_heartbeat_at, queue_depth: d.queue_depth,
    })),
    shop: {
      slug: shop.slug, is_open: shop.is_open, name: shop.name, link: shopLink(shop.slug),
      suspended: Boolean(shop.suspended_at), billing: shop.billing,
    },
  })
}))

/** Mark the orders behind these documents paid or unpaid (cash counter action). */
router.post('/pay', wrap(async (req, res) => {
  const jobIds = Array.isArray(req.body?.jobIds) ? req.body.jobIds.map(String) : []
  const paid = bool(req.body?.paid)
  if (jobIds.length === 0) throw badRequest('choose at least one job')
  const result = await query(
    `UPDATE orders SET status = $2, paid_at = $3
     WHERE shop_id = $1 AND id IN (SELECT order_id FROM documents WHERE id = ANY($4::text[]))`,
    [req.shop.id, paid ? 'paid' : 'unpaid', paid ? new Date() : null, jobIds],
  )
  res.json({ ok: true, updated: result.rowCount })
}))

router.post('/print', requireEntitled, wrap(async (req, res) => {
  const jobIds = Array.isArray(req.body?.jobIds) ? req.body.jobIds.map(String) : []
  res.json({ ok: true, ...(await enqueue(req.shop, jobIds)) })
}))

router.post('/retry', requireEntitled, wrap(async (req, res) => {
  const jobId = str(req.body?.jobId, { field: 'job', max: 64, required: true })
  res.json({ ok: true, ...(await enqueue(req.shop, [jobId])) })
}))

router.put('/settings', wrap(async (req, res) => {
  const body = req.body || {}
  const name = str(body.cafeName, { field: 'cafe name', max: 80, required: true })
  const welcome = str(body.welcomeMessage, { field: 'welcome message', max: 300 })
  const rateBw = paise(body.rateBw, 'B&W rate')
  const rateColor = paise(body.rateColor, 'colour rate')
  const printerBw = str(body.printerBw, { field: 'B&W printer', max: 200 })
  const printerColor = str(body.printerColor, { field: 'colour printer', max: 200 })
  const isOpen = bool(body.isOpen, req.shop.is_open)
  await query(
    `UPDATE shops SET name=$2, welcome_message=$3, price_bw_paise=$4, price_color_paise=$5,
     printer_bw=$6, printer_color=$7, is_open=$8 WHERE id=$1`,
    [req.shop.id, name, welcome, rateBw, rateColor, printerBw || null, printerColor || null, isOpen],
  )
  const shop = await one('SELECT * FROM shops WHERE id = $1', [req.shop.id])
  res.json({ ok: true, settings: settingsOf(shop), is_open: shop.is_open })
}))

// ── online payments (the shop's own Razorpay account) ─────────────────────────
// Secrets are write-only: GET reports whether they are set, never their value.
const onlinePaymentsOf = (shop) => ({
  key_id: shop.rzp_key_id || '',
  has_secret: Boolean(shop.rzp_key_secret_enc),
  has_webhook_secret: Boolean(shop.rzp_webhook_secret_enc),
  configured: Boolean(shop.rzp_key_id && shop.rzp_key_secret_enc),
  webhook_url: `${config.publicBaseUrl}/api/shop/${shop.slug}/pay/webhook`,
})

router.get('/online-payments', wrap(async (req, res) => {
  const shop = await one('SELECT * FROM shops WHERE id = $1', [req.shop.id])
  res.json({ ok: true, ...onlinePaymentsOf(shop) })
}))

router.put('/online-payments', wrap(async (req, res) => {
  const body = req.body || {}
  const keyId = str(body.keyId, { field: 'Razorpay Key ID', max: 60 })
  if (keyId && !/^rzp_(test|live)_[A-Za-z0-9]+$/.test(keyId))
    throw badRequest('Razorpay Key ID looks wrong — it should start with rzp_test_ or rzp_live_')
  const keySecret = str(body.keySecret, { field: 'Razorpay Key Secret', max: 200 })
  const webhookSecret = str(body.webhookSecret, { field: 'webhook secret', max: 200 })
  const shop = await one('SELECT * FROM shops WHERE id = $1', [req.shop.id])
  // A blank secret field keeps the stored one, so the Key ID can be updated
  // without re-entering secrets the operator cannot see.
  const secretEnc = keySecret ? encryptSecret(keySecret) : shop.rzp_key_secret_enc
  const webhookEnc = webhookSecret ? encryptSecret(webhookSecret) : shop.rzp_webhook_secret_enc
  const updated = await one(
    `UPDATE shops SET rzp_key_id = $2, rzp_key_secret_enc = $3, rzp_webhook_secret_enc = $4
     WHERE id = $1 RETURNING *`,
    [req.shop.id, keyId, secretEnc, webhookEnc],
  )
  res.json({ ok: true, ...onlinePaymentsOf(updated) })
}))

router.delete('/online-payments', wrap(async (req, res) => {
  const updated = await one(
    `UPDATE shops SET rzp_key_id = '', rzp_key_secret_enc = '', rzp_webhook_secret_enc = ''
     WHERE id = $1 RETURNING *`,
    [req.shop.id],
  )
  res.json({ ok: true, ...onlinePaymentsOf(updated) })
}))

/** Mint a single-use, short-lived pairing code for this shop. */
router.post('/pairing-code', wrap(async (req, res) => {
  let code = pairingCode()
  for (let i = 0; i < 5 && await one('SELECT 1 FROM pairing_codes WHERE code=$1 AND used_at IS NULL', [code]); i++)
    code = pairingCode()
  const expires = new Date(Date.now() + config.pairingCodeMinutes * 60 * 1000)
  await query(
    'INSERT INTO pairing_codes (id, shop_id, code, expires_at) VALUES ($1,$2,$3,$4)',
    [pairingCodeId(), req.shop.id, code, expires],
  )
  res.json({ ok: true, code, expires_at: expires })
}))

router.get('/qr.png', wrap(async (req, res) => {
  res.type('png').setHeader('Cache-Control', 'no-store')
  res.send(await qrPng(req.shop.slug))
}))

router.get('/qr.svg', wrap(async (req, res) => {
  res.type('svg').setHeader('Cache-Control', 'no-store')
  res.send(await qrSvg(req.shop.slug))
}))

export default router