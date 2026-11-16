import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import { config } from '../config.js'
import { fetchKey, storedName } from '../lib/ids.js'
import { badRequest } from '../lib/errors.js'

const TYPES = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

export const allowedExtensions = Object.keys(TYPES)

export function extensionOf(originalName) {
  const ext = path.extname(String(originalName || '')).toLowerCase()
  if (!TYPES[ext]) throw badRequest('upload a PDF or a PNG / JPG / WEBP image')
  return ext
}

export const contentTypeFor = (ext) => TYPES[ext] || 'application/octet-stream'

/** Multer writes here; the random name means the original name never touches disk. */
export function newStoredName(originalName) {
  return storedName(extensionOf(originalName))
}

/**
 * Hash and page-count a file that multer has already staged. The bytes are read
 * once; nothing here is logged. A PDF we cannot parse falls back to one page
 * rather than refusing the upload — pricing is then confirmed at the counter.
 */
export async function analyzeFile(storedPath, contentType) {
  const bytes = await fs.promises.readFile(storedPath)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  let pages = 1
  if (contentType === 'application/pdf') {
    try {
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
      pages = Math.max(1, pdf.getPageCount())
    } catch {
      pages = 1
    }
  }
  return { bytes: bytes.length, sha256, pages }
}

export const newFetchKey = () => fetchKey()

export function storedPath(name) {
  return path.join(config.uploadDir, name)
}

export async function deleteStored(storedPathValue) {
  try { await fs.promises.unlink(storedPathValue) } catch { /* already gone */ }
}