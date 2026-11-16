import http from 'node:http'
import { config, ensureDirs, isProduction } from './config.js'
import { migrate, pool } from './db.js'
import { createApp } from './app.js'
import { assertDurablePaymentsKey } from './lib/crypto.js'
import { attachChannel, isOnline, shutdownChannels } from './services/channels.js'
import { requeueStale, purgePrinted, purgeAbandoned, purgeOrphanFiles } from './services/queue.js'

function assertProductionConfig() {
  if (!config.isHttps)
    throw new Error('PUBLIC_BASE_URL must be https in production: session cookies are only marked Secure on https, and the agent refuses documents whose host differs from it.')
  assertDurablePaymentsKey()
  if (config.trustProxy === 0)
    console.warn('[config] TRUST_PROXY is 0. Behind a proxy every client appears as the proxy IP and shares one rate-limit bucket; set it to the number of proxy hops (1 on Railway).')
  if (!config.billing.razorpayKeyId || !config.billing.razorpayKeySecret)
    console.warn('[config] platform Razorpay keys are not set: shops stay on trial/comp and cannot subscribe.')
}

async function main() {
  if (isProduction) assertProductionConfig()
  ensureDirs()
  await migrate()

  const app = createApp()
  const server = http.createServer(app)
  const wss = attachChannel(server)

  // Return jobs to the queue when their agent went silent, so a dropped socket
  // does not strand a customer's document in "printing" forever. Purge printed
  // documents (and their files) once their grace window has elapsed, abandoned
  // unpaid uploads after a day, and staged files no order ever claimed.
  const sweep = setInterval(() => {
    requeueStale(isOnline).catch(() => {})
    purgePrinted().catch(() => {})
    purgeAbandoned().catch(() => {})
    purgeOrphanFiles().catch(() => {})
  }, 60_000)
  sweep.unref?.()

  server.listen(config.port, config.host, () => {
    console.log(`QrPrinter server listening on http://${config.host}:${config.port}`)
    console.log(`  public base   ${config.publicBaseUrl}`)
    console.log(`  documents     ${config.uploadDir}`)
    console.log(`  agent channel ${config.publicBaseUrl.replace(/^http/, 'ws')}/agent/channel`)
  })

  let shuttingDown = false
  const shutdown = (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`\n${signal} received, shutting down`)
    clearInterval(sweep)
    shutdownChannels()
    wss.close()
    server.closeIdleConnections?.()
    // A stuck keep-alive or websocket must not hold a deploy hostage.
    const force = setTimeout(() => process.exit(0), 5000)
    force.unref?.()
    server.close(() => {
      pool.end().catch(() => {}).finally(() => process.exit(0))
    })
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  // Express 4 does not catch async rejections; without this a stray one would
  // kill the process mid-request with no chance to close sockets or the pool.
  process.on('unhandledRejection', (reason) => {
    console.error('[fatal] unhandled promise rejection', reason)
    shutdown('unhandledRejection')
  })
  process.on('uncaughtException', (error) => {
    console.error('[fatal] uncaught exception', error)
    shutdown('uncaughtException')
  })
}

main().catch((error) => {
  console.error('server failed to start:', error.message)
  process.exit(1)
})