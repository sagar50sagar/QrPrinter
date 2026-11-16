import { one, transaction } from '../db.js'

// Razorpay fires both of these for a successful auto-captured payment; either is
// proof the money moved. Everything else (refunds, failures) is ignored here.
const PAID_EVENTS = new Set(['payment.captured', 'order.paid'])

function eventIdOf(event, rzpOrderId, paymentId) {
  return event.id || `${event.event}:${rzpOrderId}:${paymentId || event.created_at || ''}`
}

/**
 * Apply one verified shop payment webhook. Marks the matching order paid + online
 * exactly once. The paid state only moves forward: an already-paid order is never
 * downgraded or re-stamped, so a replay or a second event type is harmless.
 * Returns { handled, duplicate?, orderId?, reason?, rzpOrderId? }.
 */
export async function applyPaymentEvent(shop, event) {
  if (!PAID_EVENTS.has(event?.event)) return { handled: false, reason: 'not a payment event' }
  const payment = event?.payload?.payment?.entity
  const orderEntity = event?.payload?.order?.entity
  const rzpOrderId = payment?.order_id || orderEntity?.id || null
  const paymentId = payment?.id || null
  if (!rzpOrderId) return { handled: false, reason: 'no razorpay order id' }

  const order = await one(
    'SELECT * FROM orders WHERE rzp_order_id = $1 AND shop_id = $2',
    [rzpOrderId, shop.id],
  )
  if (!order) return { handled: false, reason: 'unknown order', rzpOrderId }

  const eventId = eventIdOf(event, rzpOrderId, paymentId)
  return transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO payment_events (event_id, event_type, shop_id, order_id, rzp_order_id, rzp_payment_id, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [eventId, event.event, shop.id, order.id, rzpOrderId, paymentId, event],
    )
    if (rows.length === 0) return { handled: true, duplicate: true, orderId: order.id }

    await client.query(
      `UPDATE orders SET status = 'paid', method = 'online', paid_at = now(),
         rzp_payment_id = COALESCE(rzp_payment_id, $2)
       WHERE id = $1 AND status = 'unpaid'`,
      [order.id, paymentId],
    )
    await client.query('UPDATE payment_events SET processed_at = now() WHERE event_id = $1', [eventId])
    return { handled: true, duplicate: false, orderId: order.id }
  })
}