import readline from 'node:readline'
import { one, pool, query } from '../src/db.js'
import { adminId } from '../src/lib/ids.js'
import { hashPassword } from '../src/lib/passwords.js'
import { email as validateEmail, password as validatePassword, str } from '../src/lib/validate.js'

/**
 * Create (or re-password) the platform superadmin. There is no public sign-up
 * for admins, so this is the only way in. Prefer environment variables so the
 * password never lands in shell history or on screen:
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' npm run seed:admin
 *
 * With no env vars it prompts. Run it after `npm run bootstrap`, so DATABASE_URL
 * exists and the admins table has been migrated.
 */
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer) }))
}

async function main() {
  const email = validateEmail(process.env.ADMIN_EMAIL || await ask('Superadmin email: '))
  const password = validatePassword(process.env.ADMIN_PASSWORD || await ask('Superadmin password (min 8 characters): '))
  const displayName = str(process.env.ADMIN_NAME || 'Platform owner', { field: 'name', max: 80 })
  const passwordHash = await hashPassword(password)

  const existing = await one('SELECT id FROM admins WHERE email = $1', [email])
  if (existing) {
    await query('UPDATE admins SET password_hash = $2, display_name = $3 WHERE id = $1', [existing.id, passwordHash, displayName])
    console.log(`updated superadmin ${email}`)
  } else {
    await query(
      'INSERT INTO admins (id, email, password_hash, display_name) VALUES ($1, $2, $3, $4)',
      [adminId(), email, passwordHash, displayName],
    )
    console.log(`created superadmin ${email}`)
  }
  await pool.end()
  console.log('Sign in at /admin/ with these credentials.')
}

main().catch(async (error) => {
  console.error('seed failed:', error.message)
  await pool.end().catch(() => {})
  process.exit(1)
})