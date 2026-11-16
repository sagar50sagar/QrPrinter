// Integration suite for the server. Runs against a THROWAWAY SCHEMA in the same
// database (the app role may create schemas but not databases) and a temp upload
// directory, so a run can never read or mutate live shops, orders or files.
//   npm test          (from server/)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { randomBytes, createHmac } from 'node:crypto'
import assert from 'node:assert/strict'
import pg from 'pg'
import { PDFDocument } from 'pdf-lib'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// config.js reads .env at import time and freezes uploadDir/databaseUrl, so the
// overrides below must be in process.env before any src module is imported.
function databaseUrlFromEnvFile() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const file = path.join(serverRoot, '.env')
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    if (trimmed.slice(0, eq).trim() !== 'DATABASE_URL') continue
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1)
    return value
  }
  throw new Error('DATABASE_URL is not set and server/.env has no DATABASE_URL')
}

const baseUrl = databaseUrlFromEnvFile()
const schema = `qp_test_${randomBytes(4).toString('hex')}`
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-test-'))

const provision = new pg.Client({ connectionString: baseUrl })
await provision.connect()
await provision.query(`CREATE SCHEMA ${schema}`)
await provision.end()

process.env.DATABASE_URL = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${schema}`)}`
process.env.UPLOAD_DIR = uploadDir
process.env.PAYMENTS_ENC_KEY = randomBytes(32).toString('hex')
process.env.NODE_ENV = 'test'

const { migrate, pool, query, one } = await import('../src/db.js')
const { createApp } = await import('../src/app.js')
const { encryptSecret } = await import('../src/lib/crypto.js')
const { sha256Hex } = await import('../src/lib/ids.js')
const { offerPending, requeueStale, applyResult, purgePrinted, purgeAbandoned, purgeOrphanFiles } = await import('../src/services/queue.js')

await migrate()

const server = http.createServer(createApp())
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const api = `http://127.0.0.1:${server.address().port}`

const jars = {}
const cookieOf = (res, jar) => {
  const cookie = (res.headers.getSetCookie?.() || []).find((c) => c.startsWith('qp_session='))
  if (cookie) jars[jar] = cookie.split(';')[0]
}
const call = async (jar, method, url, body, headers = {}) => {
  const init = { method, headers: { ...headers } }
  if (jars[jar]) init.headers.Cookie = jars[jar]
  if (body !== undefined && !(body instanceof FormData)) {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  } else if (body instanceof FormData) init.body = body
  const res = await fetch(api + url, init)
  cookieOf(res, jar)
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* raw body */ }
  return { status: res.status, json, text, headers: res.headers }
}

const pdfBytes = async (pages) => {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([200, 200])
  return doc.save()
}
const upload = async (jar, slug, { pages = 2, copies = 2, mode = 'bw', name = 'test.pdf' } = {}) => {
  const form = new FormData()
  form.append('customer_name', 'Test Customer')
  form.append('items', JSON.stringify([{ copies, mode }]))
  form.append('files', new Blob([await pdfBytes(pages)], { type: 'application/pdf' }), name)
  return call(jar, 'POST', `/api/shop/${slug}/orders`, form)
}
// The HMAC must cover the exact bytes sent, so the body is a raw string.
const postWebhook = async (slug, event, secret) => {
  const raw = JSON.stringify(event)
  const res = await fetch(`${api}/api/shop/${slug}/pay/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': createHmac('sha256', secret).update(raw).digest('hex') },
    body: raw,
  })
  return { status: res.status, json: await res.json() }
}

let failures = 0
const check = async (name, fn) => {
  try {
    await fn()
    console.log(`PASS  ${name}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL  ${name}\n      ${error.message}`)
  }
}

const state = {}

await check('signup creates a shop, a user and a session', async () => {
  const res = await call('shop1', 'POST', '/api/auth/signup', { email: 'owner@test.local', password: 'correct-horse-9', cafeName: 'Test Cafe' })
  assert.equal(res.status, 201)
  assert.ok(jars.shop1, 'session cookie set')
  state.slug = res.json.shop.slug
  state.shopId = res.json.shop.id
})

await check('login refuses a wrong password and accepts the right one', async () => {
  assert.equal((await call(null, 'POST', '/api/auth/login', { email: 'owner@test.local', password: 'nope-nope-nope' })).status, 401)
  const ok = await call('shop1', 'POST', '/api/auth/login', { email: 'owner@test.local', password: 'correct-horse-9' })
  assert.equal(ok.status, 200)
})

await check('settings assign printers and rates', async () => {
  const res = await call('shop1', 'PUT', '/api/panel/settings', {
    cafeName: 'Test Cafe', welcomeMessage: 'hello', rateBw: 2, rateColor: 10,
    printerBw: 'Test BW', printerColor: 'Test Colour', isOpen: true,
  })
  assert.equal(res.status, 200)
  assert.equal(res.json.settings.printerBw, 'Test BW')
})

await check('upload counts pages and returns an opaque token', async () => {
  const res = await upload('shop1', state.slug)
  assert.equal(res.status, 201)
  assert.equal(res.json.order_id, 'J-1000')
  assert.match(res.json.order_token, /^[0-9a-f]{24}$/)
  assert.equal(res.json.amount, 8) // 2 pages x 2 copies x Rs 2
  state.order1 = res.json.order_id
  state.token1 = res.json.order_token
  state.doc1 = res.json.documents[0].id
})

await check('public status refuses the sequential id, accepts the token', async () => {
  assert.equal((await call(null, 'GET', `/api/shop/${state.slug}/orders/${state.order1}`)).status, 404)
  const res = await call(null, 'GET', `/api/shop/${state.slug}/orders/${state.token1}`)
  assert.equal(res.status, 200)
  assert.equal(res.json.order_token, state.token1) // the poll replaces its order object with this body
})

await check("another shop's token is not found here", async () => {
  const second = await call('shop2', 'POST', '/api/auth/signup', { email: 'other@test.local', password: 'correct-horse-9', cafeName: 'Other Cafe' })
  assert.equal(second.status, 201)
  state.slug2 = second.json.shop.slug
  assert.equal((await call(null, 'GET', `/api/shop/${state.slug2}/orders/${state.token1}`)).status, 404)
})

await check('printing is refused while the order is unpaid', async () => {
  const res = await call('shop1', 'POST', '/api/panel/print', { jobIds: [state.doc1] })
  assert.equal(res.status, 200)
  assert.equal(res.json.sent, 0)
})

await check('counter marking paid is appended to the payment log', async () => {
  const res = await call('shop1', 'POST', '/api/panel/pay', { jobIds: [state.doc1], paid: true })
  assert.equal(res.json.updated, 1)
  const log = await one('SELECT event, actor FROM payment_log WHERE order_id = $1', [state.order1])
  assert.equal(log.event, 'paid')
  assert.match(log.actor, /^counter:/)
})

await check('a paid job queues once; a second enqueue is a duplicate', async () => {
  const first = await call('shop1', 'POST', '/api/panel/print', { jobIds: [state.doc1] })
  assert.equal(first.json.sent, 1)
  const again = await call('shop1', 'POST', '/api/panel/print', { jobIds: [state.doc1] })
  assert.equal(again.json.sent, 0)
  assert.equal(again.json.duplicates, 1)
})

await check('two agents racing for one job get exactly one offer', async () => {
  // documents.device_id is a real foreign key, so the racing agents must exist.
  for (const id of ['dev-a', 'dev-b'])
    await query('INSERT INTO devices (id, shop_id, token_hash, hostname, machine_key, agent_version) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, state.shopId, sha256Hex(id), id, id, 'test'])
  const device = (id) => ({ id, shop_id: state.shopId })
  const [a, b] = await Promise.all([offerPending(device('dev-a')), offerPending(device('dev-b'))])
  assert.equal(a.length + b.length, 1)
  const doc = await one('SELECT print_status, print_attempts FROM documents WHERE id = $1', [state.doc1])
  assert.equal(doc.print_status, 'printing')
  assert.equal(doc.print_attempts, 1)
})

await check('a printed result counts once even when repeated', async () => {
  const device = { id: 'dev-a', shop_id: state.shopId }
  await applyResult(device, state.doc1, { status: 'printed', copies_printed: 2 })
  await applyResult(device, state.doc1, { status: 'printed', copies_printed: 2 })
  const order = await one('SELECT printed_documents, printed_sheets FROM orders WHERE id = $1', [state.order1])
  assert.equal(order.printed_documents, 1)
  assert.equal(order.printed_sheets, 4)
})

await check('a silent agent is retried, then failed at the attempt cap', async () => {
  const age = "UPDATE documents SET print_status = 'printing', device_id = 'dev-a', delivered_at = now() - interval '6 minutes', print_attempts = $2 WHERE id = $1"
  await query(age, [state.doc1, 2])
  await requeueStale(() => false)
  assert.equal((await one('SELECT print_status FROM documents WHERE id = $1', [state.doc1])).print_status, 'queued')
  await query(age, [state.doc1, 3])
  await requeueStale(() => false)
  const doc = await one('SELECT print_status, print_stage FROM documents WHERE id = $1', [state.doc1])
  assert.equal(doc.print_status, 'failed')
  assert.equal(doc.print_stage, 'gave-up')
})

await check('retry puts a failed job back on the queue with a fresh counter', async () => {
  const res = await call('shop1', 'POST', '/api/panel/retry', { jobId: state.doc1 })
  assert.equal(res.json.sent, 1)
  const doc = await one('SELECT print_status, print_attempts FROM documents WHERE id = $1', [state.doc1])
  assert.equal(doc.print_status, 'queued')
  assert.equal(doc.print_attempts, 0)
})

// ── the shop's own Razorpay webhook ──────────────────────────────────────────
const WEBHOOK_SECRET = 'whsec_test'
await check('shop webhook secrets are stored encrypted', async () => {
  await query('UPDATE shops SET rzp_key_id = $2, rzp_key_secret_enc = $3, rzp_webhook_secret_enc = $4 WHERE id = $1',
    [state.shopId, 'rzp_test_key', encryptSecret('rzp_test_secret'), encryptSecret(WEBHOOK_SECRET)])
  const shop = await one('SELECT rzp_key_secret_enc FROM shops WHERE id = $1', [state.shopId])
  assert.ok(shop.rzp_key_secret_enc.startsWith('v1.'))
  assert.ok(!shop.rzp_key_secret_enc.includes('rzp_test_secret'))
})

await check('a second upload gives the webhook something to pay for', async () => {
  const res = await upload('shop1', state.slug, { pages: 1, copies: 1 })
  state.order2 = res.json.order_id
  state.doc2 = res.json.documents[0].id
  state.amount2 = res.json.amount * 100
  await query('UPDATE orders SET rzp_order_id = $2 WHERE id = $1', [state.order2, 'order_test_1'])
})

await check('a webhook with the wrong amount is rejected and logged', async () => {
  const res = await postWebhook(state.slug, {
    id: 'evt_bad', event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_1', order_id: 'order_test_1', amount: 1, currency: 'INR' } } },
  }, WEBHOOK_SECRET)
  assert.equal(res.status, 200)
  assert.equal(res.json.handled, false)
  assert.equal((await one('SELECT status FROM orders WHERE id = $1', [state.order2])).status, 'unpaid')
  const log = await one("SELECT event FROM payment_log WHERE order_id = $1 AND event = 'rejected'", [state.order2])
  assert.ok(log)
})

await check('a webhook with a bad signature is refused', async () => {
  const raw = JSON.stringify({ id: 'evt_x', event: 'payment.captured', payload: {} })
  const res = await fetch(`${api}/api/shop/${state.slug}/pay/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': 'deadbeef' }, body: raw,
  })
  assert.equal(res.status, 400)
})

await check('a verified webhook marks paid exactly once', async () => {
  const event = {
    id: 'evt_paid', event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_1', order_id: 'order_test_1', amount: state.amount2, currency: 'INR' } } },
  }
  const first = await postWebhook(state.slug, event, WEBHOOK_SECRET)
  assert.equal(first.json.handled, true)
  assert.equal(first.json.duplicate, false)
  const replay = await postWebhook(state.slug, event, WEBHOOK_SECRET)
  assert.equal(replay.json.duplicate, true)
  const order = await one('SELECT status, method FROM orders WHERE id = $1', [state.order2])
  assert.equal(order.status, 'paid')
  assert.equal(order.method, 'online')
  const { rows } = await query("SELECT count(*)::int AS n FROM payment_log WHERE order_id = $1 AND event = 'paid'", [state.order2])
  assert.equal(rows[0].n, 1)
})

await check('a refund reverses the order and blocks printing', async () => {
  const res = await postWebhook(state.slug, {
    id: 'evt_refund', event: 'refund.processed',
    payload: { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1', amount: state.amount2 } } },
  }, WEBHOOK_SECRET)
  assert.equal(res.json.handled, true)
  assert.ok((await one('SELECT reversed_at FROM orders WHERE id = $1', [state.order2])).reversed_at)
  const print = await call('shop1', 'POST', '/api/panel/print', { jobIds: [state.doc2] })
  assert.equal(print.json.sent, 0)
})

await check('a won dispute restores the order', async () => {
  const res = await postWebhook(state.slug, {
    id: 'evt_won', event: 'payment.dispute.won',
    payload: { payment: { entity: { id: 'pay_1', order_id: 'order_test_1' }, dispute: { entity: { id: 'disp_1', payment_id: 'pay_1', status: 'won' } } } },
  }, WEBHOOK_SECRET)
  assert.equal(res.json.handled, true)
  assert.equal((await one('SELECT reversed_at FROM orders WHERE id = $1', [state.order2])).reversed_at, null)
  const log = await one("SELECT event FROM payment_log WHERE order_id = $1 AND event = 'restored'", [state.order2])
  assert.ok(log)
})

await check('a refused upload leaves no staged file behind', async () => {
  const before = fs.readdirSync(uploadDir).length
  const form = new FormData()
  form.append('customer_name', 'Test Customer')
  form.append('items', JSON.stringify([{ copies: 1, mode: 'sepia' }]))
  form.append('files', new Blob([await pdfBytes(1)], { type: 'application/pdf' }), 'bad.pdf')
  const res = await call('shop1', 'POST', `/api/shop/${state.slug}/orders`, form)
  assert.equal(res.status, 400)
  assert.equal(fs.readdirSync(uploadDir).length, before)
})

await check('the document capability link serves bytes, a wrong key does not', async () => {
  const doc = await one('SELECT fetch_key, stored_path FROM documents WHERE id = $1', [state.doc2])
  const ok = await fetch(`${api}/documents/${state.doc2}/${doc.fetch_key}`)
  assert.equal(ok.status, 200)
  assert.equal((await fetch(`${api}/documents/${state.doc2}/${'0'.repeat(24)}`)).status, 404)
  state.doc2Path = doc.stored_path
})

await check('abandoned unpaid uploads are purged, the order row stays', async () => {
  const res = await upload('shop1', state.slug, { pages: 1, copies: 1 })
  const abandoned = res.json.order_id
  const doc = await one('SELECT id, stored_path FROM documents WHERE order_id = $1', [abandoned])
  await query("UPDATE orders SET created_at = now() - interval '25 hours' WHERE id = $1", [abandoned])
  assert.equal(await purgeAbandoned(), 1)
  assert.equal(await one('SELECT 1 AS x FROM documents WHERE id = $1', [doc.id]), null)
  assert.equal(fs.existsSync(doc.stored_path), false)
  assert.ok(await one('SELECT 1 AS x FROM orders WHERE id = $1', [abandoned]))
})

await check('orphan staged files go, claimed files stay', async () => {
  const stray = path.join(uploadDir, 'stray.pdf')
  fs.writeFileSync(stray, 'x')
  const past = new Date(Date.now() - 2 * 3_600_000)
  fs.utimesSync(stray, past, past)
  assert.equal(await purgeOrphanFiles(), 1)
  assert.equal(fs.existsSync(stray), false)
  assert.equal(fs.existsSync(state.doc2Path), true)
})

await check('printed files are purged after the grace window', async () => {
  const doc = await one('SELECT stored_path FROM documents WHERE id = $1', [state.doc1])
  // The retry check left this job queued; put it back in the printed state the
  // sweep is meant to reap.
  await query("UPDATE documents SET print_status = 'printed', finished_at = now() - interval '11 minutes' WHERE id = $1", [state.doc1])
  assert.equal(await purgePrinted(), 1)
  assert.equal(fs.existsSync(doc.stored_path), false)
})

await check('login rate limit trips per email', async () => {
  let last
  for (let i = 0; i < 11; i++)
    last = await call(null, 'POST', '/api/auth/login', { email: 'brute@test.local', password: 'nope-nope-nope' })
  assert.equal(last.status, 429)
  assert.ok(last.headers.get('retry-after'))
})

await check('the agent health probe answers', async () => {
  const res = await call(null, 'GET', '/api/agent/health')
  assert.equal(res.status, 200)
  assert.equal(res.json.ok, true)
})

server.close()
await pool.end()
const cleanup = new pg.Client({ connectionString: baseUrl })
await cleanup.connect()
await cleanup.query(`DROP SCHEMA ${schema} CASCADE`)
await cleanup.end()
fs.rmSync(uploadDir, { recursive: true, force: true })

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)