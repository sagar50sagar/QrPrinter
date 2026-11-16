import { migrate, pool } from '../src/db.js'

migrate()
  .then(() => pool.end())
  .then(() => console.log('database is up to date'))
  .catch((error) => {
    console.error('migration failed:', error.message)
    process.exit(1)
  })