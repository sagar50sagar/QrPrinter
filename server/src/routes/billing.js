import { Router } from 'express'
import { config } from '../config.js'
import { one, query } from '../db.js'
import { badRequest, wrap } from '../lib/errors.js'
import { requireSession } from '../middleware/session.js'
import {
  activePlan, applySubscriptionEvent, billingFor,
} from '../services/billing.js'
import {
  cancelSubscription, createPlan, createSubscription, razorpayConfigured, verifyWebhookSignature,
} from '../services/razorpay.js'

/**
 * Public Razorpay webhook. Mounted with a RAW body parser before the global JSON
 * parser so the exact bytes are available for signature verification. The only
 * thing that activates or renews a subscription — the browser is never trusted.
 */
export const billingWebhookHandler = wrap(async (req, res) => {
  if (!config.billing.razorpayWebhookSecret)
    return res.status(503).json({ ok: false, error: 'billing webhook is not configured' })

  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('')
  if (!verifyWebhookSignature(raw, req.get('X-Razorpay-Signature')))
    return res.status(400).json({ ok: false, error: 'invalid signature' })

  let event
  try { event = JSON.parse(raw.toString('utf8')) } catch { return res.status(400).json({ ok: false, error: 'invalid json' }) }

  const result = await applySubscriptionEvent(event)
  if (!result.handled) console.warn('[billing] webhook ignored:', result.reason, result.subscriptionId || '')
  // Always 200 for a verified event so Razorpay stops retrying.
  res.json({ ok: true, ...result })
})

const router = Router()
router.use(requireSession)

/** Plan + entitlement for the signed-in shop. */
router.get('/', wrap(async (req, res) => {
  res.json({ ok: true, billing: await billingFor(req.shop), razorpay_configured: razorpayConfigured() })
}))

/**
 * Create a Razorpay subscription server-side and hand back its hosted checkout
 * URL. Access is granted later by the webhook, never by this response.
 */
router.post('/subscribe', wrap(async (req, res) => {
  if (!razorpayConfigured()) throw badRequest('online payments are not set up yet — contact the platform owner')
  const shop = await one('SELECT * FROM shops WHERE id = $1', [req.shop.id])
  if (shop.comped) throw badRequest('this shop is comped — no subscription is needed')
  if (shop.rzp_subscription_id && ['created', 'authenticated', 'active'].includes(shop.subscription_status))
    throw badRequest('this shop already has a subscription — manage it instead')

  const plan = await activePlan()
  if (!plan) throw badRequest('no plan is available')

  let rzpPlanId = plan.rzp_plan_id
  if (!rzpPlanId) {
    const created = await createPlan(plan)
    rzpPlanId = created.id
    await query('UPDATE plans SET rzp_plan_id = $1 WHERE id = $2', [rzpPlanId, plan.id])
  }

  const sub = await createSubscription({ planId: rzpPlanId, shopId: shop.id })
  await query(
    `UPDATE shops SET rzp_subscription_id = $1, plan_id = $2, subscription_status = $3, billing_updated_at = now()
     WHERE id = $4`,
    [sub.id, plan.id, sub.status || 'created', shop.id],
  )
  res.json({ ok: true, subscription_id: sub.id, short_url: sub.short_url, status: sub.status })
}))

/** Cancel at cycle end; the shop keeps access through the period it paid for. */
router.post('/cancel', wrap(async (req, res) => {
  if (!razorpayConfigured()) throw badRequest('online payments are not set up yet — contact the platform owner')
  const shop = await one('SELECT * FROM shops WHERE id = $1', [req.shop.id])
  if (!shop.rzp_subscription_id) throw badRequest('there is no subscription to cancel')
  const result = await cancelSubscription(shop.rzp_subscription_id, true)
  res.json({ ok: true, status: result.status })
}))

export default router