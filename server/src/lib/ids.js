import { randomBytes, createHash } from 'node:crypto'

const hex = (bytes) => randomBytes(bytes).toString('hex')

export const shopId = () => `shop_${hex(6)}`
export const userId = () => `usr_${hex(6)}`
export const sessionId = () => hex(16)
export const adminId = () => `adm_${hex(6)}`
export const adminSessionId = () => hex(16)
export const deviceId = () => `dev-${hex(6)}`
export const pairingCodeId = () => `pc_${hex(6)}`
export const fetchKey = () => hex(12)
/** Unguessable stand-in for the sequential order id on public endpoints. */
export const orderToken = () => hex(12)
export const storedName = (ext) => `${hex(16)}${ext}`

/** The long-lived device secret. Returned once at pairing, stored only as a hash. */
export const deviceToken = () => hex(16)
export const sha256Hex = (value) => createHash('sha256').update(value).digest('hex')

// Ambiguous characters (0/O, 1/I/L) are left out so a code read aloud or typed
// from a screenshot does not fail on a glyph that looks like another.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export function pairingCode(length = 6) {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return out
}

/** Order ids come from a Postgres sequence; this only formats them. */
export const orderId = (seq) => `J-${seq}`
export const documentId = (orderIdValue, index) => `${orderIdValue}-${index}`