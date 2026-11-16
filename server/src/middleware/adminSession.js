import { config } from '../config.js'
import { one, query } from '../db.js'
import { adminSessionId } from '../lib/ids.js'
import { unauthorized } from '../lib/errors.js'

// A separate cookie from the shop session, so one browser can hold a shop login
// and a platform login without either clobbering the other.
const ADMIN_COOKIE = 'qp_admin'

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isHttps,
  path: '/',
  maxAge: config.sessionDays * 24 * 60 * 60 * 1000,
})

export async function createAdminSession(res, adminId) {
  const id = adminSessionId()
  const expires = new Date(Date.now() + config.sessionDays * 24 * 60 * 60 * 1000)
  await query('INSERT INTO admin_sessions (id, admin_id, expires_at) VALUES ($1, $2, $3)', [id, adminId, expires])
  res.cookie(ADMIN_COOKIE, id, cookieOptions())
}

export async function destroyAdminSession(req, res) {
  const id = req.cookies?.[ADMIN_COOKIE]
  if (id) await query('DELETE FROM admin_sessions WHERE id = $1', [id])
  res.clearCookie(ADMIN_COOKIE, { path: '/' })
}

async function loadAdmin(req) {
  const id = req.cookies?.[ADMIN_COOKIE]
  if (!id) return null
  const row = await one(
    `SELECT a.id AS admin_id, a.email, a.display_name
     FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
     WHERE s.id = $1 AND s.expires_at > now()`,
    [id],
  )
  if (!row) return null
  req.admin = { id: row.admin_id, email: row.email, display_name: row.display_name }
  return req.admin
}

/** Require a signed-in platform superadmin. Attaches req.admin. */
export const requireAdmin = (req, res, next) => {
  loadAdmin(req)
    .then((admin) => (admin ? next() : next(unauthorized())))
    .catch(next)
}