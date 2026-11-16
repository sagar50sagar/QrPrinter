import http from 'node:http'
import { config, ensureDirs } from './config.js'
import { migrate, pool } from './db.js'
import { createApp } from './app.js'
import { attachChannel, isOnline } from './services/channels.js'
import { requeueStale, purgePrinted } from './services/queue.js'

async function main() {
  ensureDirs()
  await migrate()

  const app = createApp()
  const server = http.createServer(app)
  attachChannel(server)

  // Return jobs to the queue when their agent went silent, so a dropped socket
  // does not strand a customer's document in "printing" forever. Purge printed
  // documents (and their files) once their grace window has elapsed.
  const sweep = setInterval(() => {
    requeueStale(isOnline).catch(() => {})
    purgePrinted().catch(() => {})
  }, 60_000)
  sweep.unref?.()

  server.listen(config.port, config.host, () => {
    console.log(`QrPrinter server listening on http://${config.host}:${config.port}`)
    console.log(`  public base   ${config.publicBaseUrl}`)
    console.log(`  documents     ${config.uploadDir}`)
    console.log(`  agent channel ${config.publicBaseUrl.replace(/^http/, 'ws')}/agent/channel`)
  })

  const shutdown = async (signal) => {
    console.log(`\n${signal} received, shutting down`)
    clearInterval(sweep)
    server.close()
    await pool.end().catch(() => {})
    process.exit(0)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((error) => {
  console.error('server failed to start:', error.message)
  process.exit(1)
})