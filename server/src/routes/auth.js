import { Router } from 'express'
import { config } from '../config.js'
import { one, query, transaction } from '../db.js'
import { shopId, userId } from '../lib/ids.js'
import { hashPassword, verifyPassword } from '../lib/passwords.js'
import { email as validateEmail, password as validatePassword, str, slug as validateSlug } from '../lib/validate.js'
import { badRequest, conflict, forbidden, unauthorized, wrap } from '../lib/errors.js'
import { createSession, destroySession, requireSession } from '../middleware/session.js'
import { perHour, rateLimit } from '../middleware/rateLimit.js'
import { rupees } from '../lib/validate.js'

const router = Router()

export const publicShop = (shop) => ({
  id: shop.id, slug: shop.slug, name: shop.name, is_open: shop.is_open,
  welcome_message: shop.welcome_message, currency: shop.currency,
  price_bw: rupees(shop.price_bw_paise), price_color: rupees(shop.price_color_paise),
})
const publicUser = (user) => ({ id: user.id, email: user.email, display_name: user.display_name, shop_id: user.shop_id })

function slugify(name) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  return base || 'shop'
}

async function uniqueSlug(desired) {
  let candidate = desired
  for (let n = 2; await one('SELECT 1 FROM shops WHERE slug = $1', [candidate]); n++)
    candidate = `${desired}-${n}`
  return candidate
}

router.post('/signup', perHour('signup', 5), wrap(async (req, res) => {
  const email = validateEmail(req.body?.email)
  const password = validatePassword(req.body?.password)
  const cafeName = str(req.body?.cafeName, { field: 'cafe name', max: 80, required: true })
  if (await one('SELECT 1 FROM users WHERE email = $1', [email]))
    throw conflict('an account with this email already exists')

  const desired = req.body?.slug ? validateSlug(req.body.slug) : slugify(cafeName)
  const slug = await uniqueSlug(desired)

  const passwordHash = await hashPassword(password)
  const trialEndsAt = new Date(Date.now() + config.billing.trialDays * 24 * 60 * 60 * 1000)
  const shop = await transaction(async (client) => {
    const { rows: [shopRow] } = await client.query(
      `INSERT INTO shops (id, slug, name, welcome_message, trial_ends_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [shopId(), slug, cafeName, 'Upload your document, pay at the counter and collect your prints.', trialEndsAt],
    )
    await client.query(
      `INSERT INTO users (id, shop_id, email, password_hash, display_name) VALUES ($1, $2, $3, $4, $5)`,
      [userId(), shopRow.id, email, passwordHash, cafeName],
    )
    return shopRow
  })
  const user = await one('SELECT * FROM users WHERE email = $1', [email])
  await createSession(res, user.id)
  res.status(201).json({ ok: true, user: publicUser(user), shop: publicShop(shop) })
}))

// Two buckets: one per IP stops a script hammering the form, one per email stops
// a distributed guess against a single account from many IPs.
const loginWindow = { windowMs: 15 * 60_000 }
router.post('/login',
  rateLimit({ ...loginWindow, name: 'login-ip', max: 20 }),
  rateLimit({ ...loginWindow, name: 'login-email', max: 10, key: (req) => String(req.body?.email || '').toLowerCase() }),
  wrap(async (req, res) => {
  const email = validateEmail(req.body?.email)
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  const user = await one('SELECT * FROM users WHERE email = $1', [email])
  if (!user || !(await verifyPassword(password, user.password_hash)))
    throw unauthorized('email or password is incorrect')
  const shop = await one('SELECT * FROM shops WHERE id = $1', [user.shop_id])
  if (shop?.suspended_at)
    throw forbidden('This account has been deactivated by the platform. Contact support to reactivate.', 'account_deactivated')
  await createSession(res, user.id)
  res.json({ ok: true, user: publicUser(user), shop: publicShop(shop) })
}))

router.post('/logout', wrap(async (req, res) => {
  await destroySession(req, res)
  res.json({ ok: true })
}))

router.get('/me', requireSession, wrap(async (req, res) => {
  res.json({ ok: true, user: publicUser(req.user), shop: publicShop(req.shop) })
}))

export default router