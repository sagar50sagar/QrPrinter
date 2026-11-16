import { tooManyRequests } from '../lib/errors.js'

// Fixed-window counters in process memory. The server runs as a single instance
// (one Railway service), so a shared store would add a dependency and a network
// hop for no gain. Windows are short enough that a restart forgives at most one
// window of abuse.
const buckets = new Map()

const prune = setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of buckets) if (bucket.reset <= now) buckets.delete(key)
}, 60_000)
prune.unref?.()

/**
 * Limit a route to `max` requests per `windowMs` per key. The key defaults to the
 * client IP, which is only meaningful behind a proxy when TRUST_PROXY is set —
 * otherwise every customer appears to come from the proxy and one bucket would
 * throttle the whole shop.
 */
export function rateLimit({ name, windowMs, max, key = (req) => req.ip }) {
  return (req, res, next) => {
    const id = `${name}:${key(req) ?? ''}`
    const now = Date.now()
    let bucket = buckets.get(id)
    if (!bucket || bucket.reset <= now) {
      bucket = { count: 0, reset: now + windowMs }
      buckets.set(id, bucket)
    }
    bucket.count += 1
    if (bucket.count > max) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.reset - now) / 1000))))
      return next(tooManyRequests())
    }
    next()
  }
}

export const perMinute = (name, max, key) => rateLimit({ name, windowMs: 60_000, max, key })
export const perHour = (name, max, key) => rateLimit({ name, windowMs: 3_600_000, max, key })