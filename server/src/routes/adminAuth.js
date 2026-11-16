import { Router } from 'express'
import { one } from '../db.js'
import { verifyPassword } from '../lib/passwords.js'
import { email as validateEmail } from '../lib/validate.js'
import { unauthorized, wrap } from '../lib/errors.js'
import { createAdminSession, destroyAdminSession, requireAdmin } from '../middleware/adminSession.js'

const router = Router()

const publicAdmin = (admin) => ({ id: admin.id, email: admin.email, display_name: admin.display_name })

// No sign-up: admins are seeded with `npm run seed:admin`.
router.post('/login', wrap(async (req, res) => {
  const email = validateEmail(req.body?.email)
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  const admin = await one('SELECT * FROM admins WHERE email = $1', [email])
  if (!admin || !(await verifyPassword(password, admin.password_hash)))
    throw unauthorized('email or password is incorrect')
  await createAdminSession(res, admin.id)
  res.json({ ok: true, admin: publicAdmin(admin) })
}))

router.post('/logout', wrap(async (req, res) => {
  await destroyAdminSession(req, res)
  res.json({ ok: true })
}))

router.get('/me', requireAdmin, wrap(async (req, res) => {
  res.json({ ok: true, admin: publicAdmin(req.admin) })
}))

export default router