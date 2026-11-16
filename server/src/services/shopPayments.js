import { one, query, transaction } from '../db.js'

// Razorpay fires both of these for a successful auto-captured payment; either is
// proof the money moved.
const PAID_EVENTS = new Set(['payment.captured', 'order.paid'])
// Money going back, or a claim on it. A reversed order stops being printable but
// keeps its paid history — the sheets may already be out, so this is about
// blocking a reprint and leaving a record, not about un-printing anything.
const REVERSE_EVENTS = new Set([
  'refund.processed', 'payment.refunded',
  'payment.dispute.created', 'payment.dispute.lost',
])
const RESTORE_EVENTS = new Set(['payment.dispute.won'])

function eventIdOf(event, rzpOrderId, paymentId) {
  return event.id || `${event.event}:${rzpOrderId}:${paymentId || event.created_at || ''}`
}

const logPayment = (run, shop, order, event, method, amountPaise, actor, detail, paymentId) => run(
  `INSERT INTO payment_log (shop_id, order_id, event, method, amount_paise, actor, detail, rzp_payment_id)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
  [shop.id, order.id, event, method, amountPaise, actor, detail, paymentId],
)

function reverseReason(type, refund, dispute) {
  if (type.startsWith('refund.')) return `refunded ${refund?.id || ''}`.trim()
  if (type === 'payment.refunded') return 'payment refunded'
  return `dispute ${dispute?.status || ''} ${dispute?.id || ''}`.trim()
}

/**
 * Apply one verified shop payment webhook. Marks the matching order paid exactly
 * once, and records every reversal. The paid state only moves forward: an
 * already-paid order is never re-stamped, so a replay or a second event type is
 * harmless. The amount and currency are checked against our own order — a
 * webhook is proof the money moved, not proof the right amount moved.
 * Returns { handled, duplicate?, orderId?, reason?, rzpOrderId? }.
 */
export async function applyPaymentEvent(shop, event) {
  const type = event?.event
  const paid = PAID_EVENTS.has(type)
  const reverse = REVERSE_EVENTS.has(type)
  const restore = RESTORE_EVENTS.has(type)
  if (!paid && !reverse && !restore) return { handled: false, reason: 'not a payment event' }

  const payment = event?.payload?.payment?.entity
  const orderEntity = event?.payload?.order?.entity
  const refund = event?.payload?.refund?.entity
  const dispute = event?.payload?.payment?.dispute?.entity
  const rzpOrderId = payment?.order_id || orderEntity?.id || null
  const paymentId = payment?.id || refund?.payment_id || dispute?.payment_id || null

  // A refund or dispute names the payment, not necessarily the Razorpay order.
  let order = rzpOrderId
    ? await one('SELECT * FROM orders WHERE rzp_order_id = $1 AND shop_id = $2', [rzpOrderId, shop.id])
    : null
  if (!order && paymentId)
    order = await one('SELECT * FROM orders WHERE rzp_payment_id = $1 AND shop_id = $2', [paymentId, shop.id])
  if (!order) return { handled: false, reason: 'unknown order', rzpOrderId }

  if (paid) {
    const amount = Number(payment?.amount ?? orderEntity?.amount)
    const currency = payment?.currency || orderEntity?.currency || ''
    const mismatch = !Number.isFinite(amount) || amount !== order.amount_paise
      ? `expected ${order.amount_paise} paise, webhook said ${payment?.amount ?? orderEntity?.amount ?? 'nothing'}`
      : (currency && currency !== shop.currency ? `expected ${shop.currency}, webhook said ${currency}` : '')
    if (mismatch) {
      // Rejected, but recorded: this is the signal that someone tried to pay a
      // different amount than the order they are collecting.
      await logPayment(query, shop, order, 'rejected', 'online', order.amount_paise, 'webhook', `${type}: ${mismatch}`, paymentId)
      return { handled: false, reason: mismatch, orderId: order.id, rzpOrderId }
    }
  }

  const eventId = eventIdOf(event, rzpOrderId, paymentId)
  return transaction(async (client) => {
    const run = (text, params) => client.query(text, params)
    const { rows } = await client.query(
      `INSERT INTO payment_events (event_id, event_type, shop_id, order_id, rzp_order_id, rzp_payment_id, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [eventId, type, shop.id, order.id, rzpOrderId, paymentId, event],
    )
    if (rows.length === 0) return { handled: true, duplicate: true, orderId: order.id }

    if (paid) {
      const changed = await client.query(
        `UPDATE orders SET status = 'paid', method = 'online', paid_at = now(),
           rzp_payment_id = COALESCE(rzp_payment_id, $2)
         WHERE id = $1 AND status = 'unpaid'`,
        [order.id, paymentId],
      )
      if (changed.rowCount > 0)
        await logPayment(run, shop, order, 'paid', 'online', order.amount_paise, 'webhook', type, paymentId)
    } else if (reverse) {
      const changed = await client.query(
        `UPDATE orders SET reversed_at = now(), reverse_reason = $2
         WHERE id = $1 AND reversed_at IS NULL`,
        [order.id, reverseReason(type, refund, dispute)],
      )
      if (changed.rowCount > 0) {
        const amount = Number(refund?.amount ?? dispute?.amount ?? order.amount_paise)
        await logPayment(run, shop, order, 'reversed', order.method,
          Number.isFinite(amount) ? amount : order.amount_paise, 'webhook', type, paymentId)
      }
    } else {
      const changed = await client.query(
        `UPDATE orders SET reversed_at = NULL, reverse_reason = ''
         WHERE id = $1 AND reversed_at IS NOT NULL`,
        [order.id],
      )
      if (changed.rowCount > 0)
        await logPayment(run, shop, order, 'restored', order.method, order.amount_paise, 'webhook', type, paymentId)
    }

    await client.query('UPDATE payment_events SET processed_at = now() WHERE event_id = $1', [eventId])
    return { handled: true, duplicate: false, orderId: order.id }
  })
}