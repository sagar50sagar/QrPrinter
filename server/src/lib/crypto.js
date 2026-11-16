import fs from 'node:fs'
import path from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { serverRoot } from '../config.js'

// Shop Razorpay secrets must be reversible (we call Razorpay with them), so they
// are encrypted at rest with AES-256-GCM rather than hashed. The key comes from
// PAYMENTS_ENC_KEY (32 bytes, hex or base64) when set; otherwise a random key is
// generated once and kept in server/var/payments.key. The GCM tag detects tamper.

const KEY_FILE = path.join(serverRoot, 'var', 'payments.key')
let cachedKey = null

function resolveKey() {
  if (cachedKey) return cachedKey
  const fromEnv = process.env.PAYMENTS_ENC_KEY
  if (fromEnv) {
    const buf = /^[0-9a-fA-F]{64}$/.test(fromEnv)
      ? Buffer.from(fromEnv, 'hex')
      : Buffer.from(fromEnv, 'base64')
    if (buf.length !== 32) throw new Error('PAYMENTS_ENC_KEY must be 32 bytes (64 hex chars or base64)')
    cachedKey = buf
    return cachedKey
  }
  if (fs.existsSync(KEY_FILE)) {
    const buf = fs.readFileSync(KEY_FILE)
    if (buf.length !== 32) throw new Error('payments key file must be 32 bytes')
    cachedKey = buf
    return cachedKey
  }
  const buf = randomBytes(32)
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true })
  fs.writeFileSync(KEY_FILE, buf, { mode: 0o600 })
  cachedKey = buf
  return cachedKey
}

/**
 * On an ephemeral host a generated key file dies with the container, and every
 * stored shop secret becomes unreadable on the next deploy. Refuse to boot in
 * that state instead of silently orphaning the shops' Razorpay keys.
 */
export function assertDurablePaymentsKey() {
  if (process.env.PAYMENTS_ENC_KEY || fs.existsSync(KEY_FILE)) return
  throw new Error('PAYMENTS_ENC_KEY is not set and server/var/payments.key does not exist. '
    + 'Set PAYMENTS_ENC_KEY (32 bytes, hex or base64) or mount a persistent volume for server/var.')
}

/** Encrypt a secret for storage. Empty in → empty out (a shop with no keys). */
export function encryptSecret(plaintext) {
  const text = String(plaintext ?? '')
  if (!text) return ''
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', resolveKey(), iv)
  const ct = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return `v1.${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${ct.toString('base64')}`
}

/** Decrypt a stored secret. Empty in → empty out. Throws on a malformed/tampered value. */
export function decryptSecret(stored) {
  const text = String(stored ?? '')
  if (!text) return ''
  const [version, iv, tag, ct] = text.split('.')
  if (version !== 'v1' || !iv || !tag || !ct) throw new Error('malformed encrypted secret')
  const decipher = createDecipheriv('aes-256-gcm', resolveKey(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8')
}