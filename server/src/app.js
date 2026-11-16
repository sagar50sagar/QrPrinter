import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import cookieParser from 'cookie-parser'
import { config, serverRoot } from './config.js'
import { query } from './db.js'
import { errorHandler } from './lib/errors.js'
import authRouter from './routes/auth.js'
import customerRouter, { shopPaymentWebhookHandler } from './routes/customer.js'
import panelRouter from './routes/panel.js'
import agentRouter from './routes/agent.js'
import docsRouter from './routes/docs.js'
import adminAuthRouter from './routes/adminAuth.js'
import adminRouter from './routes/admin.js'
import billingRouter, { billingWebhookHandler } from './routes/billing.js'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use(cookieParser())
  // Razorpay's webhooks are verified against the exact raw bytes, so they are
  // parsed and mounted before the global JSON parser (which would consume the
  // body). Each shop's print-payment webhook uses that shop's own secret.
  app.post('/api/billing/webhook', express.raw({ type: '*/*' }), billingWebhookHandler)
  app.post('/api/shop/:slug/pay/webhook', express.raw({ type: '*/*' }), shopPaymentWebhookHandler)
  // JSON bodies (agent, panel, auth) are small; uploads go through multer.
  app.use(express.json({ limit: '1mb' }))

  // The agent's doctor probes this before pairing.
  app.get('/api/agent/health', async (req, res) => {
    const { rows } = await query('SELECT count(*)::int AS devices FROM devices WHERE revoked_at IS NULL')
    res.json({ ok: true, name: 'QrPrinter', devices: rows[0].devices })
  })

  app.use('/api/auth', authRouter)
  app.use('/api/shop', customerRouter)
  app.use('/api/panel', panelRouter)
  app.use('/api/admin/auth', adminAuthRouter)
  app.use('/api/admin', adminRouter)
  app.use('/api/billing', billingRouter)
  app.use('/agent', agentRouter)
  app.use('/documents', docsRouter)

  app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'not found' }))

  // The agent zip is built by agent/tools/package-agent.ps1, not by the frontend
  // build, so it lives outside dist/ and survives a rebuild of the screens.
  const agentZip = path.join(serverRoot, 'var', 'agent', 'QrPrinterAgent.zip')
  app.get('/download/agent', (req, res) => {
    if (!fs.existsSync(agentZip))
      return res.status(404).json({ ok: false, error: 'the agent download is not available yet' })
    res.download(agentZip, 'QrPrinterAgent.zip')
  })

  // In production the built frontend is served from here; in dev, Vite serves
  // it on 5173 and proxies the API to this server.
  const dist = path.resolve(serverRoot, '..', 'dist')
  if (fs.existsSync(dist)) {
    app.use(express.static(dist))
    app.get('/admin/*', (req, res) => res.sendFile(path.join(dist, 'admin', 'index.html')))
    app.get('/panel/*', (req, res) => res.sendFile(path.join(dist, 'panel', 'index.html')))
    app.get('/s/*', (req, res) => res.sendFile(path.join(dist, 'customer.html')))
    app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')))
  }

  app.use(errorHandler)
  return app
}