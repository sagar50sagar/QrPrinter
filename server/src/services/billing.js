import { one, query, transaction } from '../db.js'
import { config } from '../config.js'
import { entitlementFor, RENEWAL_EVENTS } from '../lib/billing.js'

/** The single active plan (one flat ₹299/mo plan for now). */
export const activePlan = () => one('SELECT * FROM plans WHERE active ORDER BY created_at LIMIT 1')

const publicPlan = (plan) => plan && {
  id: plan.id, name: plan.name, amount_paise: plan.amount_paise,
  currency: plan.currency, period: plan.period, interval: plan.interval,
}

/** Entitlement + the plan a shop is on (or would subscribe to). */
export async function billingFor(shop) {
  const plan = shop.plan_id ? await one('SELECT * FROM plans WHERE id = $1', [shop.plan_id]) : await activePlan()
  return { ...entitlementFor(shop), plan: publicPlan(plan) }
}

/**
 * Stable idempotency key. Prefer Razorpay's event id; otherwise compose one from
 * the event type, subscription and the charge's payment id (or event time), so a
 * retried delivery of the same event collapses to the same key.
 */
function eventIdOf(event, sub) {
  return event.id
    || `${event.event}:${sub.id}:${event?.payload?.payment?.entity?.id || event.created_at || ''}`
}

/**
 * Apply one verified subscription webhook to the shop's billing state, exactly
 * once. The paid period only ever moves forward, so an out-of-order or replayed
 * older charge cannot shorten access. Returns { handled, duplicate?, shopId? }.
 */
export async function applySubscriptionEvent(event) {
  const sub = event?.payload?.subscription?.entity
  if (!sub?.id) return { handled: false, reason: 'no subscription entity' }

  let shop = null
  if (sub.notes?.shop_id) shop = await one('SELECT * FROM shops WHERE id = $1', [sub.notes.shop_id])
  if (!shop) shop = await one('SELECT * FROM shops WHERE rzp_subscription_id = $1', [sub.id])
  if (!shop) return { handled: false, reason: 'unknown shop', subscriptionId: sub.id }

  const eventId = eventIdOf(event, sub)
  const extendsPeriod = RENEWAL_EVENTS.has(event.event)
  const periodUnix = extendsPeriod ? (sub.current_end ?? sub.charge_at ?? null) : null
  const periodEnd = periodUnix ? new Date(periodUnix * 1000) : null

  return transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO billing_events (event_id, event_type, shop_id, rzp_subscription_id, payload)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [eventId, event.event, shop.id, sub.id, event],
    )
    if (rows.length === 0) return { handled: true, duplicate: true, shopId: shop.id }

    await client.query(
      `UPDATE shops SET
         rzp_subscription_id = $2,
         plan_id = COALESCE(plan_id, $3),
         subscription_status = $4,
         subscription_period_end = CASE
           WHEN $5::timestamptz IS NULL THEN subscription_period_end
           WHEN subscription_period_end IS NULL OR $5::timestamptz > subscription_period_end THEN $5::timestamptz
           ELSE subscription_period_end
         END,
         billing_updated_at = now()
       WHERE id = $1`,
      [shop.id, sub.id, 'plan_monthly', sub.status || event.event, periodEnd],
    )
    await client.query('UPDATE billing_events SET processed_at = now() WHERE event_id = $1', [eventId])
    return { handled: true, duplicate: false, shopId: shop.id, status: sub.status || event.event }
  })
}

/** Superadmin comp / un-comp: a manual entitlement that bypasses billing. */
export async function setComped(shopId, comped) {
  const shop = await one(
    'UPDATE shops SET comped = $2, billing_updated_at = now() WHERE id = $1 RETURNING *',
    [shopId, Boolean(comped)],
  )
  return shop
}

/** Recent billing events for a shop (admin audit). Never exposes secrets. */
export const recentEvents = (shopId, limit = 20) =>
  query(
    `SELECT event_id, event_type, rzp_subscription_id, received_at, processed_at
     FROM billing_events WHERE shop_id = $1 ORDER BY received_at DESC LIMIT $2`,
    [shopId, limit],
  ).then((r) => r.rows)

export const billingConfig = () => ({
  trialDays: config.billing.trialDays,
  graceDays: config.billing.graceDays,
})