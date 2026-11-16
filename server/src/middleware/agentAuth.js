import { one } from '../db.js'
import { sha256Hex } from '../lib/ids.js'
import { unauthorized } from '../lib/errors.js'

/**
 * Authenticate an agent by its device token. The token only ever arrives in the
 * Authorization header (REST) or the websocket handshake header — never a query
 * string. We store and compare its SHA-256, not the raw secret.
 */
export async function deviceFromToken(token) {
  if (!token) return null
  const device = await one(
    'SELECT * FROM devices WHERE token_hash = $1 AND revoked_at IS NULL',
    [sha256Hex(token)],
  )
  return device ?? null
}

export function bearerToken(headerValue) {
  const header = String(headerValue || '')
  if (!header.toLowerCase().startsWith('bearer ')) return null
  return header.slice(7).trim() || null
}

export const requireDevice = (req, res, next) => {
  deviceFromToken(bearerToken(req.headers.authorization))
    .then((device) => {
      if (!device) return next(unauthorized('this device is not paired here'))
      req.device = device
      next()
    })
    .catch(next)
}