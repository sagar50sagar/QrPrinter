import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const serverRoot = path.resolve(here, '..')

// A tiny .env reader so the server has no dotenv dependency. Real environment
// variables always win over the file, which is what a service manager expects.
function readEnvFile() {
  const file = path.join(serverRoot, '.env')
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1)
    if (process.env[key] === undefined) process.env[key] = value
  }
}
readEnvFile()

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set. Copy server/.env.example to server/.env or run "npm run bootstrap".`)
  return value
}

function int(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number.parseInt(raw, 10)
  if (Number.isNaN(value)) throw new Error(`${name} must be a whole number, got "${raw}"`)
  return value
}

const publicBaseUrl = (process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '')
const uploadDir = path.resolve(serverRoot, process.env.UPLOAD_DIR || './var/documents')

export const config = {
  databaseUrl: required('DATABASE_URL'),
  port: int('PORT', 8787),
  host: process.env.HOST || '127.0.0.1',
  publicBaseUrl,
  isHttps: publicBaseUrl.startsWith('https://'),
  uploadDir,
  sessionDays: int('SESSION_DAYS', 14),
  pairingCodeMinutes: int('PAIRING_CODE_MINUTES', 30),
  // A printed document (and its file) is kept this long so the counter and the
  // customer can see "Printed", then purged. Accounting lives on the order.
  printedRetentionMinutes: int('PRINTED_RETENTION_MINUTES', 10),
  // The agent streams documents with a 64 MB cap; refuse anything larger here
  // so an oversized upload never reaches the shop PC.
  maxDocumentBytes: 64 * 1024 * 1024,
  maxFilesPerOrder: 20,
  sessionCookie: 'qp_session',
  billing: {
    trialDays: int('BILLING_TRIAL_DAYS', 14),
    graceDays: int('BILLING_GRACE_DAYS', 3),
    // Optional: the server runs without Razorpay keys (billing stays in
    // trial/comp). The webhook refuses every delivery until a secret is set,
    // so an unverified event can never grant access.
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || '',
    razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  },
}

export function ensureDirs() {
  fs.mkdirSync(config.uploadDir, { recursive: true })
}