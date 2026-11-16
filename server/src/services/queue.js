import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { many, one, query, transaction } from '../db.js'
import { buildOffer, RESULT_STATUSES } from '../lib/wire.js'
import { badRequest, notFound } from '../lib/errors.js'
import { pushToDevice, onlineDeviceIds } from './channels.js'
import { deleteStored } from './documents.js'

export const printerFor = (shop, mode) => (mode === 'color' ? shop.printer_color : shop.printer_bw) || ''

const ACTIVE = ['queued', 'printing']

// Past this many deliveries a silent agent is treated as a failed print rather
// than retried forever: the job may already have reached the paper.
const MAX_DELIVERY_ATTEMPTS = 3

/**
 * Queue documents for printing. Payment is enforced here, not only in the UI:
 * a document whose order is unpaid is never offered to an agent. Routing is by
 * print type; a type with no printer assigned is reported back, never guessed.
 * Returns the same shape the panel's enqueuePrint already understands.
 */
export async function enqueue(shop, jobIds) {
  const ids = [...new Set(jobIds)]
  const unassigned = { bw: 0, color: 0 }
  let duplicates = 0
  if (ids.length === 0) return { sent: 0, sentIds: [], sentBw: 0, sentColor: 0, duplicates, unassigned }

  const docs = await many(
    `SELECT d.*, o.status AS order_status, o.reversed_at AS order_reversed_at
     FROM documents d JOIN orders o ON o.id = d.order_id
     WHERE d.shop_id = $1 AND d.id = ANY($2::text[])`,
    [shop.id, ids],
  )
  const byId = new Map(docs.map((d) => [d.id, d]))
  const fresh = []

  for (const id of ids) {
    const doc = byId.get(id)
    if (!doc) continue
    if (doc.order_status !== 'paid' || doc.order_reversed_at) continue // print is gated on payment, and on it not being reversed
    if (ACTIVE.includes(doc.print_status) || doc.print_status === 'printed') { duplicates++; continue }
    const printer = printerFor(shop, doc.mode)
    if (!printer) { unassigned[doc.mode]++; continue }
    fresh.push({ ...doc, printer_name: printer })
  }

  const queued = []
  if (fresh.length > 0) {
    await transaction(async (client) => {
      for (const doc of fresh) {
        const { rows } = await client.query(
          `UPDATE documents
           SET print_status = 'queued', printer_name = $2, print_stage = '', print_detail = '',
               copies_printed = NULL, finished_at = NULL, device_id = NULL, delivered_at = NULL,
               print_attempts = 0
           WHERE id = $1 AND print_status NOT IN ('queued', 'printing', 'printed')
           RETURNING id`,
          [doc.id, doc.printer_name],
        )
        if (rows.length > 0) queued.push(doc)
        else duplicates++
      }
    })
    await dispatch(shop.id, queued)
  }

  return {
    sent: queued.length,
    sentIds: queued.map((d) => d.id),
    sentBw: queued.filter((d) => d.mode === 'bw').length,
    sentColor: queued.filter((d) => d.mode === 'color').length,
    duplicates,
    unassigned,
  }
}

/**
 * Take a queued job for one device. The guard is the whole point: the websocket
 * push, the agent's poll and a second counter click all race for the same row,
 * and only the UPDATE that actually flips queued → printing may deliver it.
 */
const CLAIM_SQL = `UPDATE documents
   SET print_status = 'printing', device_id = $2, delivered_at = now(),
       print_attempts = print_attempts + 1
   WHERE id = $1 AND print_status = 'queued'
   RETURNING id`

async function claim(run, jobId, deviceId) {
  const { rows } = await run(CLAIM_SQL, [jobId, deviceId])
  return rows.length > 0
}

/** Push freshly queued jobs to one connected agent (never two — that double-prints). */
async function dispatch(shopId, docs) {
  const [deviceId] = onlineDeviceIds(shopId)
  if (!deviceId) return // no agent online: the poll path will offer these
  for (const doc of docs) {
    if (await claim(query, doc.id, deviceId))
      pushToDevice(deviceId, { type: 'job_new', job: buildOffer(doc) })
  }
}

/** The poll fallback: offer everything still queued for this device's shop. */
export async function offerPending(device) {
  return transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT d.* FROM documents d JOIN orders o ON o.id = d.order_id
       WHERE d.shop_id = $1 AND d.print_status = 'queued' AND o.status = 'paid'
         AND o.reversed_at IS NULL
       ORDER BY d.created_at
       FOR UPDATE OF d SKIP LOCKED`,
      [device.shop_id],
    )
    const offers = []
    for (const doc of rows) {
      if (await claim((text, params) => client.query(text, params), doc.id, device.id))
        offers.push(buildOffer(doc))
    }
    return offers
  })
}

/**
 * Record the agent's verdict. A confirmed print bumps the order's counters
 * exactly once — the guarded UPDATE only fires for a document not already
 * printed, so an outbox retry (or a retry after the row was purged) is harmless.
 * The document and its file are kept for a grace window, then purgePrinted
 * removes them; failed/rejected/uncertain rows stay so the counter can retry.
 */
export async function applyResult(device, jobId, body) {
  const status = String(body?.status || '').toLowerCase()
  if (!RESULT_STATUSES.has(status)) throw badRequest('unknown print status')

  const copiesPrinted = Number.isInteger(body?.copies_printed) ? body.copies_printed : null
  const parsed = body?.finished_at ? new Date(body.finished_at) : new Date()
  const finishedAt = Number.isNaN(parsed.getTime()) ? new Date() : parsed
  const stage = String(body?.stage || '')
  const detail = String(body?.detail || '')

  if (status === 'printed') {
    await transaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE documents
         SET print_status = 'printed', print_stage = $2, print_detail = $3,
             copies_printed = $4, finished_at = $5, device_id = $6
         WHERE id = $1 AND shop_id = $7 AND print_status <> 'printed'
         RETURNING order_id, pages, copies`,
        [jobId, stage, detail, copiesPrinted, finishedAt, device.id, device.shop_id],
      )
      if (rows.length === 0) return
      const doc = rows[0]
      await client.query(
        `UPDATE orders
         SET printed_documents = printed_documents + 1,
             printed_sheets = printed_sheets + $2,
             completed_at = CASE WHEN printed_documents + 1 >= document_count THEN now() ELSE completed_at END
         WHERE id = $1`,
        [doc.order_id, doc.pages * doc.copies],
      )
    })
    return { ok: true, job_id: jobId }
  }

  const doc = await one('SELECT id FROM documents WHERE id = $1 AND shop_id = $2', [jobId, device.shop_id])
  if (!doc) throw notFound('no such job for this device')
  await query(
    `UPDATE documents
     SET print_status = $2, print_stage = $3, print_detail = $4, copies_printed = $5,
         finished_at = $6, device_id = $7
     WHERE id = $1`,
    [jobId, status, stage, detail, copiesPrinted, finishedAt, device.id],
  )
  return { ok: true, job_id: jobId }
}

/**
 * Remove printed documents once their grace window has elapsed: the row and the
 * stored file both go. Accounting already lives on the order, so the counter's
 * daily totals are unaffected. Returns how many documents were purged.
 */
export async function purgePrinted() {
  const { rows } = await query(
    `DELETE FROM documents
     WHERE print_status = 'printed' AND finished_at < now() - ($1::int * interval '1 minute')
     RETURNING stored_path`,
    [config.printedRetentionMinutes],
  )
  for (const row of rows) await deleteStored(row.stored_path)
  return rows.length
}

/**
 * Abandoned uploads. An order nobody paid for keeps its files for a day so the
 * customer can still settle at the counter, then the documents and files go.
 * The order row stays: owed totals are accounting, not storage. Jobs still in
 * flight are left alone even if the counter flipped the order back to unpaid.
 */
export async function purgeAbandoned() {
  const { rows } = await query(
    `DELETE FROM documents d
     USING orders o
     WHERE o.id = d.order_id AND o.status = 'unpaid'
       AND o.created_at < now() - ($1::int * interval '1 hour')
       AND d.print_status NOT IN ('queued', 'printing')
     RETURNING d.stored_path`,
    [config.unpaidRetentionHours],
  )
  for (const row of rows) await deleteStored(row.stored_path)
  return rows.length
}

/**
 * Staged files no document row ever claimed: an upload that died mid-request
 * (client disconnect, a crash between multer and the insert). Nothing references
 * them, so once they are older than the grace window they are safe to remove.
 */
export async function purgeOrphanFiles() {
  const { rows } = await query('SELECT stored_path FROM documents')
  const claimed = new Set(rows.map((r) => path.basename(r.stored_path)))
  const cutoff = Date.now() - config.orphanFileMinutes * 60_000
  let removed = 0
  for (const entry of await fs.promises.readdir(config.uploadDir, { withFileTypes: true })) {
    if (!entry.isFile() || claimed.has(entry.name)) continue
    const full = path.join(config.uploadDir, entry.name)
    const stat = await fs.promises.stat(full).catch(() => null)
    if (!stat || stat.mtimeMs > cutoff) continue
    await deleteStored(full)
    removed += 1
  }
  return removed
}

/**
 * A job offered to an agent that then went silent must not hang forever. If the
 * device is offline and the offer is old, return it to the queue for another
 * agent (or the same one when it reconnects) — up to MAX_DELIVERY_ATTEMPTS,
 * after which it is failed so the counter decides whether to send it again.
 *
 * 'uncertain' is deliberately not swept: the agent could not tell whether the
 * sheets came out, so re-offering it automatically is how a job prints twice.
 * That one waits for a human Retry.
 */
export async function requeueStale(isDeviceOnline) {
  const stale = await many(
    `SELECT id, device_id, print_attempts FROM documents
     WHERE print_status = 'printing' AND delivered_at < now() - interval '5 minutes'`,
  )
  for (const doc of stale) {
    if (doc.device_id && isDeviceOnline(doc.device_id)) continue
    if (doc.print_attempts >= MAX_DELIVERY_ATTEMPTS) {
      await query(
        `UPDATE documents
         SET print_status = 'failed', device_id = NULL, finished_at = now(),
             print_stage = 'gave-up', print_detail = $2
         WHERE id = $1 AND print_status = 'printing'`,
        [doc.id, `the agent stopped responding after ${doc.print_attempts} attempts — check the printer, then press Retry`],
      )
      continue
    }
    await query(
      `UPDATE documents SET print_status = 'queued', device_id = NULL, delivered_at = NULL
       WHERE id = $1 AND print_status = 'printing'`,
      [doc.id],
    )
  }
}