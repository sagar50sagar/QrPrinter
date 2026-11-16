import { Router } from 'express'
import { one, query, transaction } from '../db.js'
import { deviceId, deviceToken, sha256Hex } from '../lib/ids.js'
import { str } from '../lib/validate.js'
import { unauthorized, wrap } from '../lib/errors.js'
import { requireDevice } from '../middleware/agentAuth.js'
import { heartbeatResponse } from '../lib/wire.js'
import { offerPending, applyResult } from '../services/queue.js'

const router = Router()

/**
 * Burn a single-use pairing code and mint a device token. The product server
 * burns codes for real (the mock allows reuse on purpose): a code that has been
 * used, expired, or never existed is refused without revealing which.
 */
router.post('/pair', wrap(async (req, res) => {
  const code = str(req.body?.pairing_code, { field: 'pairing code', max: 32 }).toUpperCase()
  const machineKey = str(req.body?.machine_key, { field: 'machine key', max: 128 })
  const hostname = str(req.body?.hostname, { field: 'hostname', max: 128 })
  const agentVersion = str(req.body?.agent_version, { field: 'agent version', max: 32 })
  if (!code) throw unauthorized('that pairing code is not valid here')

  const token = deviceToken()
  const id = deviceId()

  const shop = await transaction(async (client) => {
    const { rows: [codeRow] } = await client.query(
      `SELECT * FROM pairing_codes
       WHERE code = $1 AND used_at IS NULL AND expires_at > now()
       FOR UPDATE`,
      [code],
    )
    if (!codeRow) return null
    const { rows: [shopRow] } = await client.query('SELECT * FROM shops WHERE id = $1', [codeRow.shop_id])
    if (!shopRow) return null
    await client.query(
      `INSERT INTO devices (id, shop_id, token_hash, hostname, machine_key, agent_version)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, shopRow.id, sha256Hex(token), hostname, machineKey, agentVersion],
    )
    await client.query(
      'UPDATE pairing_codes SET used_at = now(), used_by_device = $2 WHERE id = $1',
      [codeRow.id, id],
    )
    return shopRow
  })

  if (!shop) throw unauthorized('that pairing code is not valid here')
  res.json({ device_id: id, token, shop_name: shop.name, label: '' })
}))

router.post('/heartbeat', requireDevice, wrap(async (req, res) => {
  const body = req.body || {}
  const printers = Array.isArray(body.printers) ? body.printers : []
  await query(
    `UPDATE devices
     SET last_heartbeat_at = now(), spooler_running = $2, printers = $3::jsonb,
         agent_version = $4, hostname = $5, machine_key = $6, queue_depth = $7
     WHERE id = $1`,
    [req.device.id, Boolean(body.spooler_running), JSON.stringify(printers),
     str(body.agent_version, { max: 32 }), str(body.hostname, { max: 128 }),
     str(body.machine_key, { max: 128 }), Number.isInteger(body.queue_depth) ? body.queue_depth : 0],
  )
  res.json(heartbeatResponse(5))
}))

router.get('/jobs/pending', requireDevice, wrap(async (req, res) => {
  const jobs = await offerPending(req.device)
  res.json({ jobs })
}))

router.post('/jobs/:jobId/result', requireDevice, wrap(async (req, res) => {
  res.json(await applyResult(req.device, req.params.jobId, req.body))
}))

export default router