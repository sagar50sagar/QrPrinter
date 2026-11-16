import { config } from '../config.js'

// The agent speaks snake_case and omits nulls (System.Text.Json SnakeCaseLower,
// WhenWritingNull). These builders emit exactly that shape — see
// agent/src/QrPrinter.Agent/Net/Wire.cs. Do not rename these keys.

/**
 * One JobOffer. document_url is a capability URL: the agent's DocumentFetcher
 * sends no Authorization header, so the unguessable fetch_key in the path is
 * what authorises this one document. It is NOT the device token.
 */
export function buildOffer(doc) {
  const offer = {
    job_id: doc.id,
    document_url: `${config.publicBaseUrl}/documents/${doc.id}/${doc.fetch_key}`,
    printer: doc.printer_name,
    copies: doc.copies,
    duplex: doc.duplex,
    colour: doc.mode === 'color',
    paper: doc.paper,
    sha256: doc.sha256,
  }
  if (doc.page_range) offer.page_range = doc.page_range
  return offer
}

export const RESULT_STATUSES = new Set(['printed', 'uncertain', 'rejected', 'failed'])

export const heartbeatResponse = (pollIntervalSeconds = 5) => ({
  ok: true,
  poll_interval_seconds: pollIntervalSeconds,
  server_time: new Date().toISOString(),
})

export const resultAck = (jobId) => ({ ok: true, job_id: jobId })