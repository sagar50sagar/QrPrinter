import { config } from '../config.js'

const DAY = 24 * 60 * 60 * 1000

/**
 * Subscription events that extend a shop's paid period. Everything else
 * (pending, halted, cancelled, completed, paused, updated) only changes the
 * displayed status; access then runs out from the last paid period end + grace.
 */
export const RENEWAL_EVENTS = new Set([
  'subscription.authenticated',
  'subscription.activated',
  'subscription.charged',
  'subscription.resumed',
])

/**
 * Pure entitlement from a shop's billing columns. No DB and no hidden clock:
 * `now` is injected so the whole lifecycle is testable without waiting days.
 *
 * Precedence: comped > active paid period > free trial > grace > lapsed/none.
 * Access is always time-gated, so a stale "active" status whose period has
 * expired (plus grace) does not grant access — the webhook cannot over-grant.
 */
export function entitlementFor(shop, now = new Date(), opts = config.billing) {
  const t = now instanceof Date ? now.getTime() : Number(now)
  const trialEnd = shop.trial_ends_at ? new Date(shop.trial_ends_at).getTime() : null
  const periodEnd = shop.subscription_period_end ? new Date(shop.subscription_period_end).getTime() : null
  const graceEnd = periodEnd != null ? periodEnd + opts.graceDays * DAY : null

  let state
  let entitled
  if (shop.comped) { state = 'comped'; entitled = true }
  else if (periodEnd != null && t < periodEnd) { state = 'active'; entitled = true }
  else if (trialEnd != null && t < trialEnd) { state = 'trial'; entitled = true }
  else if (graceEnd != null && t < graceEnd) { state = 'grace'; entitled = true }
  else if (periodEnd != null) { state = 'lapsed'; entitled = false }
  else { state = 'none'; entitled = false }

  const accessEnd = state === 'trial' ? trialEnd : graceEnd
  const daysLeft = entitled && accessEnd != null ? Math.max(0, Math.ceil((accessEnd - t) / DAY)) : 0

  return {
    entitled,
    state,
    comped: Boolean(shop.comped),
    subscription_status: shop.subscription_status || 'none',
    plan_id: shop.plan_id || null,
    trial_ends_at: trialEnd != null ? new Date(trialEnd).toISOString() : null,
    period_end: periodEnd != null ? new Date(periodEnd).toISOString() : null,
    grace_ends_at: graceEnd != null ? new Date(graceEnd).toISOString() : null,
    trial_days_left: trialEnd != null ? Math.max(0, Math.ceil((trialEnd - t) / DAY)) : 0,
    days_left: state === 'comped' ? null : daysLeft,
  }
}