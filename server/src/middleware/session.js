import { config } from '../config.js'
import { one, query } from '../db.js'
import { sessionId } from '../lib/ids.js'
import { entitlementFor } from '../lib/billing.js'
import { forbidden, unauthorized } from '../lib/errors.js'

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isHttps,
  path: '/',
  maxAge: config.sessionDays * 24 * 60 * 60 * 1000,
})

export async function createSession(res, userId) {
  const id = sessionId()
  const expires = new Date(Date.now() + config.sessionDays * 24 * 60 * 60 * 1000)
  await query('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)', [id, userId, expires])
  res.cookie(config.sessionCookie, id, cookieOptions())
}

export async function destroySession(req, res) {
  const id = req.cookies?.[config.sessionCookie]
  if (id) await query('DELETE FROM sessions WHERE id = $1', [id])
  res.clearCookie(config.sessionCookie, { path: '/' })
}

async function loadSession(req) {
  const id = req.cookies?.[config.sessionCookie]
  if (!id) return null
  const row = await one(
    `SELECT s.id AS session_id, s.expires_at,
            u.id AS user_id, u.email, u.display_name, u.shop_id,
            sh.*
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN shops sh ON sh.id = u.shop_id
     WHERE s.id = $1 AND s.expires_at > now()`,
    [id],
  )
  if (!row) return null
  req.user = { id: row.user_id, email: row.email, display_name: row.display_name, shop_id: row.shop_id }
  req.shop = {
    id: row.id, slug: row.slug, name: row.name, is_open: row.is_open,
    welcome_message: row.welcome_message, currency: row.currency,
    price_bw_paise: row.price_bw_paise, price_color_paise: row.price_color_paise,
    printer_bw: row.printer_bw, printer_color: row.printer_color, created_at: row.created_at,
    suspended_at: row.suspended_at,
    trial_ends_at: row.trial_ends_at, comped: row.comped, plan_id: row.plan_id,
    rzp_subscription_id: row.rzp_subscription_id, subscription_status: row.subscription_status,
    subscription_period_end: row.subscription_period_end, billing_updated_at: row.billing_updated_at,
  }
  req.shop.billing = entitlementFor(row)
  return req.user
}

/** Require a signed-in shop admin. Attaches req.user and req.shop. */
export const requireSession = (req, res, next) => {
  loadSession(req)
    .then((user) => {
      if (!user) return next(unauthorized())
      // A deactivated account is locked out of the whole app, not just uploads.
      if (req.shop?.suspended_at)
        return next(forbidden('This account has been deactivated by the platform. Contact support to reactivate.', 'account_deactivated'))
      next()
    })
    .catch(next)
}

/**
 * Require an entitled shop (comped, in trial, paid, or within grace). Gates the
 * actions that deliver service — printing — while leaving the panel reachable so
 * the shop can still sign in and pay. Mirrors the platform suspension gate.
 */
export const requireEntitled = (req, res, next) => {
  const billing = req.shop?.billing ?? entitlementFor(req.shop ?? {})
  if (!billing.entitled)
    return next(forbidden('an active subscription is required to print — open Billing to subscribe', 'subscription_required'))
  next()
}

/** Attach the session if present, but do not require it (public pages). */
export const optionalSession = (req, res, next) => {
  loadSession(req).then(() => next()).catch(next)
}