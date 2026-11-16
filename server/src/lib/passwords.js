import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

// scrypt with a per-password salt. Stored as "scrypt$N$salt$hash" (hex) so the
// parameters travel with the hash and can be raised later without a migration.
const KEYLEN = 64
const COST = 16384

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const derived = await scryptAsync(password, salt, KEYLEN, { N: COST })
  return `scrypt$${COST}$${salt.toString('hex')}$${derived.toString('hex')}`
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, costRaw, saltHex, hashHex] = String(stored).split('$')
    if (scheme !== 'scrypt') return false
    const salt = Buffer.from(saltHex, 'hex')
    const expected = Buffer.from(hashHex, 'hex')
    const derived = await scryptAsync(password, salt, expected.length, { N: Number.parseInt(costRaw, 10) })
    return derived.length === expected.length && timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}