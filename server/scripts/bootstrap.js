import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import readline from 'node:readline'
import pg from 'pg'

const here = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(here, '..')

const HOST = process.env.PGHOST || '127.0.0.1'
const PORT = Number.parseInt(process.env.PGPORT || '5432', 10)
const SUPER_USER = process.env.PG_SUPER_USER || 'postgres'
const APP_ROLE = 'qrprinter'
const APP_DB = 'qrprinter'

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer) }))
}

async function superPassword() {
  if (process.env.PG_SUPER_PASSWORD) return process.env.PG_SUPER_PASSWORD
  if (process.env.PGPASSWORD) return process.env.PGPASSWORD
  return ask(`Password for PostgreSQL superuser "${SUPER_USER}" at ${HOST}:${PORT}: `)
}

function mergeEnv(databaseUrl) {
  const file = path.join(serverRoot, '.env')
  const existing = {}
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const eq = line.indexOf('=')
      if (line.trim() && !line.trim().startsWith('#') && eq > 0)
        existing[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
    }
  }
  const merged = {
    DATABASE_URL: databaseUrl,
    PORT: '8787',
    HOST: '127.0.0.1',
    PUBLIC_BASE_URL: 'http://127.0.0.1:8787',
    UPLOAD_DIR: './var/documents',
    SESSION_DAYS: '14',
    PAIRING_CODE_MINUTES: '30',
    ...existing,
    DATABASE_URL: databaseUrl, // always point at the role we just provisioned
  }
  const body = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'
  fs.writeFileSync(file, body)
}

async function main() {
  const password = await superPassword()
  const admin = new pg.Client({ host: HOST, port: PORT, user: SUPER_USER, password, database: 'postgres', connectionTimeoutMillis: 8000 })
  await admin.connect()
  console.log(`connected to PostgreSQL as ${SUPER_USER}`)

  const appPassword = randomBytes(24).toString('hex')
  const roleExists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [APP_ROLE])
  if (roleExists.rowCount === 0) {
    await admin.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${appPassword}'`)
    console.log(`created role ${APP_ROLE}`)
  } else {
    await admin.query(`ALTER ROLE ${APP_ROLE} LOGIN PASSWORD '${appPassword}'`)
    console.log(`updated role ${APP_ROLE}`)
  }

  const dbExists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [APP_DB])
  if (dbExists.rowCount === 0) {
    await admin.query(`CREATE DATABASE ${APP_DB} OWNER ${APP_ROLE}`)
    console.log(`created database ${APP_DB}`)
  } else {
    console.log(`database ${APP_DB} already exists`)
  }
  await admin.end()

  const databaseUrl = `postgres://${APP_ROLE}:${appPassword}@${HOST}:${PORT}/${APP_DB}`
  mergeEnv(databaseUrl)
  console.log('wrote server/.env')

  const migrated = spawnSync(process.execPath, [path.join(here, 'migrate.js')], { cwd: serverRoot, stdio: 'inherit' })
  if (migrated.status !== 0) process.exit(migrated.status ?? 1)

  console.log('\nDone. Start the server with:  npm start   (from the server folder)')
}

main().catch((error) => {
  console.error('bootstrap failed:', error.message)
  process.exit(1)
})