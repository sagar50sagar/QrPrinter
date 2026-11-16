import path from 'node:path'
import multer from 'multer'
import { Router } from 'express'
import { config } from '../config.js'
import { one, query, transaction } from '../db.js'
import { documentId, orderId } from '../lib/ids.js'
import { badRequest, forbidden, notFound, wrap } from '../lib/errors.js'
import { entitlementFor } from '../lib/billing.js'
import { bool, int, mode as validateMode, rupees, str } from '../lib/validate.js'
import {
  analyzeFile, contentTypeFor, extensionOf, newFetchKey, newStoredName,
} from '../services/documents.js'
import { decryptSecret } from '../lib/crypto.js'
import { createShopOrder, verifySignatureWith } from '../services/razorpay.js'
import { applyPaymentEvent } from '../services/shopPayments.js'

const router = Router()

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.uploadDir),
    filename: (req, file, cb) => {
      try { cb(null, newStoredName(file.originalname)) } catch (error) { cb(error) }
    },
  }),
  limits: { fileSize: config.maxDocumentBytes, files: config.maxFilesPerOrder },
  fileFilter: (req, file, cb) => {
    try { extensionOf(file.originalname); cb(null, true) } catch (error) { cb(error) }
  },
})

/** Resolve the shop and enforce open/close before any file is written. */
const loadShop = wrap(async (req, res, next) => {
  const shop = await one('SELECT * FROM shops WHERE slug = $1', [req.params.slug])
  if (!shop) throw notFound('no such shop')
  req.targetShop = shop
  next()
})

const requireOpen = (req, res, next) => {
  const shop = req.targetShop
  // A lapsed subscription looks the same as a suspension to the customer: the
  // shop is simply unavailable. Billing is never exposed on the customer page.
  if (shop.suspended_at || !entitlementFor(shop).entitled)
    return next(forbidden('this shop is unavailable right now — please contact the counter'))
  if (!shop.is_open) return next(forbidden('this shop is closed right now — please come back later'))
  next()
}

router.get('/:slug', loadShop, wrap(async (req, res) => {
  const shop = req.targetShop
  const available = shop.is_open && !shop.suspended_at && entitlementFor(shop).entitled
  res.json({
    ok: true,
    name: shop.name, slug: shop.slug, is_open: available,
    suspended: Boolean(shop.suspended_at),
    welcome_message: shop.welcome_message, currency: shop.currency,
    price_bw: rupees(shop.price_bw_paise), price_color: rupees(shop.price_color_paise),
    online_payments: Boolean(shop.rzp_key_id && shop.rzp_key_secret_enc),
  })
}))

router.post('/:slug/orders', loadShop, requireOpen, upload.array('files'), wrap(async (req, res) => {
  const shop = req.targetShop
  const files = req.files || []
  if (files.length === 0) throw badRequest('add at least one document')

  const customerName = str(req.body?.customer_name, { field: 'your name', max: 80, required: true })
  const customerPhone = str(req.body?.customer_phone, { field: 'phone', max: 24 })
  const note = str(req.body?.note, { field: 'note', max: 300 })

  let items = []
  try { items = req.body?.items ? JSON.parse(req.body.items) : [] } catch { items = [] }
  if (!Array.isArray(items)) items = []

  const priceBw = shop.price_bw_paise
  const priceColor = shop.price_color_paise
  const prepared = []
  let amountPaise = 0

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const item = items[i] || {}
    const ext = extensionOf(file.originalname)
    const contentType = contentTypeFor(ext)
    const copies = int(item.copies, { field: 'copies', min: 1, max: 500, fallback: 1 })
    const mode = validateMode(item.mode)
    const duplex = bool(item.duplex)
    const paper = str(item.paper, { field: 'paper', max: 20 }) || 'A4'
    const pageRange = str(item.page_range, { field: 'page range', max: 40 }) || null
    const { bytes, sha256, pages } = await analyzeFile(file.path, contentType)
    const linePaise = pages * copies * (mode === 'color' ? priceColor : priceBw)
    amountPaise += linePaise
    prepared.push({
      fileName: str(file.originalname, { field: 'file name', max: 200 }) || `document-${i + 1}${ext}`,
      storedPath: file.path, contentType, bytes, sha256, pages, copies, mode, duplex, paper, pageRange, linePaise,
    })
  }

  const created = await transaction(async (client) => {
    const { rows: [seqRow] } = await client.query("SELECT nextval('order_seq') AS seq")
    const id = orderId(seqRow.seq)
    await client.query(
      `INSERT INTO orders (id, shop_id, customer_name, customer_phone, note, method, status, amount_paise, document_count)
       VALUES ($1, $2, $3, $4, $5, 'cash', 'unpaid', $6, $7)`,
      [id, shop.id, customerName, customerPhone, note, amountPaise, prepared.length],
    )
    const documents = []
    for (let i = 0; i < prepared.length; i++) {
      const doc = prepared[i]
      const docId = documentId(id, i + 1)
      await client.query(
        `INSERT INTO documents
         (id, order_id, shop_id, file_name, stored_path, fetch_key, content_type, bytes, sha256,
          pages, copies, mode, duplex, paper, page_range, print_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending')`,
        [docId, id, shop.id, doc.fileName, doc.storedPath, newFetchKey(), doc.contentType, doc.bytes,
         doc.sha256, doc.pages, doc.copies, doc.mode, doc.duplex, doc.paper, doc.pageRange],
      )
      documents.push({
        id: docId, file: doc.fileName, pages: doc.pages, copies: doc.copies,
        mode: doc.mode, amount: rupees(doc.linePaise),
      })
    }
    return { id, documents }
  })

  res.status(201).json({
    ok: true, order_id: created.id, status: 'unpaid', method: 'cash',
    amount: rupees(amountPaise), customer_name: customerName,
    document_count: created.documents.length, printed_documents: 0,
    documents: created.documents,
  })
}))

router.get('/:slug/orders/:orderId', loadShop, wrap(async (req, res) => {
  const order = await one(
    'SELECT * FROM orders WHERE id = $1 AND shop_id = $2',
    [req.params.orderId, req.targetShop.id],
  )
  if (!order) throw notFound('no such order')
  const documents = await query(
    `SELECT id, file_name, pages, copies, mode, print_status, print_detail
     FROM documents WHERE order_id = $1 ORDER BY id`,
    [order.id],
  ).then((r) => r.rows)
  res.json({
    ok: true, order_id: order.id, status: order.status, method: order.method,
    amount: rupees(order.amount_paise), customer_name: order.customer_name,
    created_at: order.created_at,
    document_count: order.document_count, printed_documents: order.printed_documents,
    completed_at: order.completed_at,
    documents: documents.map((d) => ({
      id: d.id, file: d.file_name, pages: d.pages, copies: d.copies, mode: d.mode,
      print_status: d.print_status, print_detail: d.print_detail,
    })),
  })
}))

/**
 * Start an online payment for an existing unpaid order, on the shop's own
 * Razorpay account. Returns the public key id + Razorpay order id the browser
 * needs to open checkout. The order is NOT marked paid here — only the verified
 * webhook does that. The Razorpay order is reused on repeat clicks.
 */
router.post('/:slug/orders/:orderId/pay', loadShop, wrap(async (req, res) => {
  const shop = req.targetShop
  if (shop.suspended_at || !entitlementFor(shop).entitled)
    throw forbidden('this shop is unavailable right now — please contact the counter')
  const order = await one('SELECT * FROM orders WHERE id = $1 AND shop_id = $2', [req.params.orderId, shop.id])
  if (!order) throw notFound('no such order')
  if (order.status === 'paid') throw badRequest('this order is already paid')
  if (!shop.rzp_key_id || !shop.rzp_key_secret_enc)
    throw badRequest('online payments are not set up for this shop — please pay at the counter')

  let rzpOrderId = order.rzp_order_id
  if (!rzpOrderId) {
    const rzpOrder = await createShopOrder({
      keyId: shop.rzp_key_id, keySecret: decryptSecret(shop.rzp_key_secret_enc),
      amountPaise: order.amount_paise, currency: shop.currency, receipt: order.id,
      notes: { shop_id: shop.id, order_id: order.id },
    })
    rzpOrderId = rzpOrder.id
    await query('UPDATE orders SET rzp_order_id = $1 WHERE id = $2', [rzpOrderId, order.id])
  }
  res.json({
    ok: true, order_id: order.id, key_id: shop.rzp_key_id, rzp_order_id: rzpOrderId,
    amount_paise: order.amount_paise, currency: shop.currency,
  })
}))

/**
 * Public Razorpay webhook for one shop's print payments. Mounted with a RAW body
 * parser before the global JSON parser (see app.js) so the exact bytes can be
 * signature-checked against THIS shop's webhook secret. The only thing that marks
 * an order paid online — the browser is never trusted.
 */
export const shopPaymentWebhookHandler = wrap(async (req, res) => {
  const shop = await one('SELECT * FROM shops WHERE slug = $1', [req.params.slug])
  if (!shop) return res.status(404).json({ ok: false, error: 'no such shop' })
  const secret = shop.rzp_webhook_secret_enc ? decryptSecret(shop.rzp_webhook_secret_enc) : ''
  if (!secret) return res.status(503).json({ ok: false, error: 'payment webhook is not configured' })

  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('')
  if (!verifySignatureWith(raw, req.get('X-Razorpay-Signature'), secret))
    return res.status(400).json({ ok: false, error: 'invalid signature' })

  let event
  try { event = JSON.parse(raw.toString('utf8')) } catch { return res.status(400).json({ ok: false, error: 'invalid json' }) }

  const result = await applyPaymentEvent(shop, event)
  if (!result.handled) console.warn('[shop-pay] webhook ignored:', result.reason, result.rzpOrderId || '')
  // Always 200 for a verified event so Razorpay stops retrying.
  res.json({ ok: true, ...result })
})

export default router