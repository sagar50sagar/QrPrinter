import fs from 'node:fs'
import { timingSafeEqual } from 'node:crypto'
import { Router } from 'express'
import { one } from '../db.js'
import { notFound, wrap } from '../lib/errors.js'

const router = Router()

function keyMatches(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * Serve one document to the agent. The agent's DocumentFetcher sends no
 * Authorization header, so authorisation is the unguessable fetch_key in the
 * path — a capability for this one file, not the device token. The stored path
 * comes from our own database and is never logged.
 */
router.get('/:id/:key', wrap(async (req, res) => {
  const doc = await one('SELECT * FROM documents WHERE id = $1', [req.params.id])
  if (!doc || !keyMatches(doc.fetch_key, req.params.key)) throw notFound('no such document')
  if (!fs.existsSync(doc.stored_path)) throw notFound('no such document')

  res.setHeader('Content-Type', doc.content_type)
  res.setHeader('Content-Length', String(doc.bytes))
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  fs.createReadStream(doc.stored_path).pipe(res)
}))

export default router