import { Router } from 'express'
import { many, one } from '../db.js'
import { bool, paise, rupees, str } from '../lib/validate.js'
import { notFound, wrap } from '../lib/errors.js'
import { requireAdmin } from '../middleware/adminSession.js'
import { isOnline } from '../services/channels.js'
import { shopLink } from '../services/qr.js'
import { entitlementFor } from '../lib/billing.js'
import { activePlan, billingFor, recentEvents, setComped } from '../services/billing.js'

const router = Router()
router.use(requireAdmin)

const round2 = (value) => Math.round(value * 100) / 100

/** Per-shop aggregates in one round trip; no N+1 across the tenant list. */
const SHOP_STATS = `
  SELECT sh.id, sh.slug, sh.name, sh.is_open, sh.suspended_at, sh.created_at,
    sh.trial_ends_at, sh.comped, sh.subscription_status, sh.subscription_period_end, sh.plan_id,
    (SELECT u.email FROM users u WHERE u.shop_id = sh.id ORDER BY u.created_at LIMIT 1) AS owner_email,
    (SELECT count(*) FROM orders o WHERE o.shop_id = sh.id)::int AS order_count,
    (SELECT coalesce(sum(o.document_count), 0) FROM orders o WHERE o.shop_id = sh.id)::int AS document_count,
    (SELECT count(*) FROM devices dv WHERE dv.shop_id = sh.id AND dv.revoked_at IS NULL)::int AS device_count,
    (SELECT coalesce(sum(o.amount_paise), 0) FROM orders o WHERE o.shop_id = sh.id AND o.status = 'paid')::bigint AS collected_paise,
    (SELECT coalesce(sum(o.printed_documents), 0) FROM orders o WHERE o.shop_id = sh.id
       AND o.created_at >= date_trunc('day', now()))::int AS prints_today
  FROM shops sh
  ORDER BY sh.created_at DESC`

async function onlineByShop() {
  const devices = await many('SELECT id, shop_id FROM devices WHERE revoked_at IS NULL')
  const counts = new Map()
  for (const device of devices)
    if (isOnline(device.id)) counts.set(device.shop_id, (counts.get(device.shop_id) || 0) + 1)
  return counts
}

/** Platform totals plus every shop, for the operator's overview. */
router.get('/overview', wrap(async (req, res) => {
  const rows = await many(SHOP_STATS)
  const online = await onlineByShop()
  const plan = await activePlan()
  const planPaise = plan?.amount_paise || 0
  const shops = rows.map((s) => {
    const billing = entitlementFor(s)
    return {
      id: s.id, slug: s.slug, name: s.name, owner_email: s.owner_email || '',
      is_open: s.is_open, suspended: Boolean(s.suspended_at), suspended_at: s.suspended_at,
      created_at: s.created_at, link: shopLink(s.slug),
      orders: s.order_count, documents: s.document_count, devices: s.device_count,
      agents_online: online.get(s.id) || 0,
      collected: rupees(s.collected_paise), prints_today: s.prints_today,
      billing: {
        state: billing.state, entitled: billing.entitled, comped: billing.comped,
        subscription_status: billing.subscription_status,
        trial_ends_at: billing.trial_ends_at, period_end: billing.period_end, days_left: billing.days_left,
      },
    }
  })
  const paying = shops.filter((s) => s.billing.state === 'active').length
  const totals = {
    shops: shops.length,
    open: shops.filter((s) => s.is_open && !s.suspended).length,
    suspended: shops.filter((s) => s.suspended).length,
    orders: shops.reduce((n, s) => n + s.orders, 0),
    documents: shops.reduce((n, s) => n + s.documents, 0),
    collected: round2(shops.reduce((n, s) => n + s.collected, 0)),
    prints_today: shops.reduce((n, s) => n + s.prints_today, 0),
    agents_online: shops.reduce((n, s) => n + s.agents_online, 0),
    paying,
    trialing: shops.filter((s) => s.billing.state === 'trial').length,
    comped: shops.filter((s) => s.billing.state === 'comped').length,
    lapsed: shops.filter((s) => !s.billing.entitled).length,
    mrr: rupees(paying * planPaise),
  }
  res.json({
    ok: true, totals, shops,
    plan: plan ? {
      id: plan.id, name: plan.name, amount_paise: plan.amount_paise,
      currency: plan.currency, period: plan.period, interval: plan.interval,
    } : null,
  })
}))

/** One shop in full: owner, connected agents, recent orders and counts. */
router.get('/shops/:id', wrap(async (req, res) => {
  const shop = await one('SELECT * FROM shops WHERE id = $1', [req.params.id])
  if (!shop) throw notFound('no such shop')
  const owner = await one(
    'SELECT email, display_name, created_at FROM users WHERE shop_id = $1 ORDER BY created_at LIMIT 1',
    [shop.id],
  )
  // Device columns only — the token hash is never selected, let alone returned.
  const devices = await many(
    `SELECT id, label, hostname, agent_version, spooler_running, queue_depth, last_heartbeat_at, created_at
     FROM devices WHERE shop_id = $1 AND revoked_at IS NULL ORDER BY created_at`,
    [shop.id],
  )
  const orders = await many(
    `SELECT o.id, o.customer_name, o.method, o.status, o.amount_paise, o.created_at, o.paid_at,
       (SELECT count(*) FROM documents d WHERE d.order_id = o.id)::int AS document_count
     FROM orders o WHERE o.shop_id = $1 ORDER BY o.created_at DESC LIMIT 25`,
    [shop.id],
  )
  const counts = await one(
    `SELECT
       (SELECT count(*) FROM orders WHERE shop_id = $1)::int AS orders,
       (SELECT coalesce(sum(document_count), 0) FROM orders WHERE shop_id = $1)::int AS documents,
       (SELECT coalesce(sum(printed_documents), 0) FROM orders WHERE shop_id = $1)::int AS printed,
       (SELECT count(*) FROM documents WHERE shop_id = $1 AND print_status IN ('failed','rejected','uncertain'))::int AS failed,
       (SELECT coalesce(sum(amount_paise), 0) FROM orders WHERE shop_id = $1 AND status = 'paid')::bigint AS collected_paise`,
    [shop.id],
  )
  const billing = await billingFor(shop)
  const events = await recentEvents(shop.id)
  res.json({
    ok: true,
    billing,
    billing_events: events,
    shop: {
      id: shop.id, slug: shop.slug, name: shop.name, is_open: shop.is_open,
      suspended: Boolean(shop.suspended_at), suspended_at: shop.suspended_at,
      created_at: shop.created_at, link: shopLink(shop.slug),
      welcome_message: shop.welcome_message,
      rate_bw: rupees(shop.price_bw_paise), rate_color: rupees(shop.price_color_paise),
      printer_bw: shop.printer_bw || '', printer_color: shop.printer_color || '',
    },
    owner: owner ? { email: owner.email, display_name: owner.display_name, created_at: owner.created_at } : null,
    devices: devices.map((d) => ({ ...d, online: isOnline(d.id) })),
    orders: orders.map((o) => ({
      id: o.id, customer_name: o.customer_name, method: o.method, status: o.status,
      amount: rupees(o.amount_paise), created_at: o.created_at, paid_at: o.paid_at,
      documents: o.document_count,
    })),
    counts: {
      orders: counts.orders, documents: counts.documents, printed: counts.printed,
      failed: counts.failed, collected: rupees(counts.collected_paise),
    },
  })
}))

/**
 * Suspend or reactivate a shop. Reversible; never deletes data. A suspended shop
 * cannot take customer uploads (enforced in the customer route), and the shop
 * cannot lift the suspension itself — only the platform can.
 */
router.post('/shops/:id/suspend', wrap(async (req, res) => {
  const suspended = bool(req.body?.suspended)
  const exists = await one('SELECT id FROM shops WHERE id = $1', [req.params.id])
  if (!exists) throw notFound('no such shop')
  const shop = await one(
    'UPDATE shops SET suspended_at = $2 WHERE id = $1 RETURNING id, slug, name, is_open, suspended_at',
    [exists.id, suspended ? new Date() : null],
  )
  res.json({
    ok: true,
    shop: {
      id: shop.id, slug: shop.slug, name: shop.name, is_open: shop.is_open,
      suspended: Boolean(shop.suspended_at), suspended_at: shop.suspended_at,
    },
  })
}))

/**
 * Comp or un-comp a shop: a manual entitlement that bypasses billing, used to
 * grandfather early cafes or grant support goodwill. Reversible; never deletes
 * data and never touches the shop's Razorpay subscription.
 */
router.post('/shops/:id/comp', wrap(async (req, res) => {
  const comped = bool(req.body?.comped)
  const exists = await one('SELECT id FROM shops WHERE id = $1', [req.params.id])
  if (!exists) throw notFound('no such shop')
  const shop = await setComped(exists.id, comped)
  res.json({ ok: true, shop: { id: shop.id, comped: shop.comped }, billing: entitlementFor(shop) })
}))

/**
 * Set the platform subscription price (the plan every shop pays), on the
 * superadmin's behalf. Money is rupees in, integer paise stored. Razorpay plans
 * are immutable in amount, so a price or name change clears the cached
 * rzp_plan_id — the next subscribe lazily creates a fresh Razorpay plan at the
 * new price. Existing subscriptions keep their old price until they re-subscribe.
 */
router.post('/plan', wrap(async (req, res) => {
  const amount = paise(req.body?.amount, 'subscription price')
  const name = str(req.body?.name, { field: 'plan name', max: 80 })
  const plan = await activePlan()
  if (!plan) throw notFound('no active plan')
  const updated = await one(
    `UPDATE plans SET
       amount_paise = $2,
       name = COALESCE($3, name),
       rzp_plan_id = CASE WHEN amount_paise <> $2 OR name <> COALESCE($3, name) THEN NULL ELSE rzp_plan_id END
     WHERE id = $1 RETURNING *`,
    [plan.id, amount, name || null],
  )
  res.json({
    ok: true,
    plan: {
      id: updated.id, name: updated.name, amount_paise: updated.amount_paise,
      currency: updated.currency, period: updated.period, interval: updated.interval,
    },
  })
}))

export default router