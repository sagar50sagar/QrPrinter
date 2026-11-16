import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'

const API = 'https://api.razorpay.com/v1'

/** True once both API keys are present. Billing UI degrades gracefully without them. */
export const razorpayConfigured = () =>
  Boolean(config.billing.razorpayKeyId && config.billing.razorpayKeySecret)

/**
 * Verify Razorpay's X-Razorpay-Signature: HMAC-SHA256 of the RAW request body,
 * keyed with the webhook secret, hex-encoded. Constant-time compare so a timing
 * side channel cannot leak the expected digest. Fails closed without a secret.
 */
export function verifySignatureWith(rawBody, signature, secret) {
  if (!secret || !signature) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const given = Buffer.from(String(signature))
  const want = Buffer.from(expected)
  if (given.length !== want.length) return false
  return timingSafeEqual(given, want)
}

/** The platform subscription webhook uses the server-wide secret. */
export const verifyWebhookSignature = (rawBody, signature) =>
  verifySignatureWith(rawBody, signature, config.billing.razorpayWebhookSecret)

const basicAuth = (keyId, keySecret) =>
  'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64')

const authHeader = () => basicAuth(config.billing.razorpayKeyId, config.billing.razorpayKeySecret)

async function rzpFetchAuth(authorization, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : {} } catch { json = {} }
  if (!res.ok) {
    const error = new Error(json?.error?.description || `Razorpay request failed (${res.status})`)
    error.status = 502
    throw error
  }
  return json
}

async function rzpFetch(path, opts = {}) {
  if (!razorpayConfigured()) {
    const error = new Error('Razorpay keys are not configured')
    error.status = 503
    throw error
  }
  return rzpFetchAuth(authHeader(), path, opts)
}

/**
 * Create a one-time order on the SHOP's own Razorpay account, so the customer's
 * payment settles straight to the shop. payment_capture:1 auto-captures; notes
 * carry our ids so the webhook can be tied back to the right order.
 */
export const createShopOrder = ({ keyId, keySecret, amountPaise, currency = 'INR', receipt, notes }) =>
  rzpFetchAuth(basicAuth(keyId, keySecret), '/orders', {
    method: 'POST',
    body: { amount: amountPaise, currency, receipt, notes, payment_capture: 1 },
  })

/** Create the Razorpay plan once; its id is cached on our plans row. */
export const createPlan = (plan) =>
  rzpFetch('/plans', {
    method: 'POST',
    body: { period: plan.period, interval: plan.interval, item: { name: plan.name, amount: plan.amount_paise, currency: plan.currency } },
  })

/**
 * Create a subscription for a shop. notes.shop_id is echoed back in every
 * webhook, which is how an event is tied to the right shop. total_count is the
 * number of billing cycles (120 months ≈ 10 years); the shop cancels to stop.
 */
export const createSubscription = ({ planId, shopId, totalCount = 120 }) =>
  rzpFetch('/subscriptions', {
    method: 'POST',
    body: { plan_id: planId, total_count: totalCount, quantity: 1, customer_notify: 1, notes: { shop_id: shopId } },
  })

export const fetchSubscription = (id) => rzpFetch(`/subscriptions/${id}`)

/** Cancel at cycle end by default, so the shop keeps access it already paid for. */
export const cancelSubscription = (id, atCycleEnd = true) =>
  rzpFetch(`/subscriptions/${id}/cancel`, { method: 'POST', body: { cancel_at_cycle_end: atCycleEnd ? 1 : 0 } })