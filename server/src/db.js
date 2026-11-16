import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { config } from './config.js'

const here = path.dirname(fileURLToPath(import.meta.url))

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 8_000,
})

pool.on('error', (error) => {
  // An idle client dropping is not a request failure; log and let the pool
  // replace it rather than crashing the process.
  console.error('[db] idle client error:', error.message)
})

export const query = (text, params) => pool.query(text, params)

export async function one(text, params) {
  const result = await pool.query(text, params)
  return result.rows[0] ?? null
}

export async function many(text, params) {
  const result = await pool.query(text, params)
  return result.rows
}

/** Run fn inside a transaction with a dedicated client. */
export async function transaction(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const value = await fn(client)
    await client.query('COMMIT')
    return value
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/**
 * Apply every migrations/*.sql once, in name order, tracked in schema_migrations.
 * Each file runs in its own transaction so a failure leaves the database at the
 * last good migration rather than half-applied.
 */
export async function migrate() {
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`)
  const dir = path.join(here, 'migrations')
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  const applied = new Set((await many('SELECT name FROM schema_migrations')).map((r) => r.name))
  for (const file of files) {
    if (applied.has(file)) continue
    const sql = fs.readFileSync(path.join(dir, file), 'utf8')
    await transaction(async (client) => {
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
    })
    console.log(`[db] applied migration ${file}`)
  }
}