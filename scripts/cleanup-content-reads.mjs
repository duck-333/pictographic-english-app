import mysql from 'mysql2/promise'
import { cleanupContentReads } from '../server/content-read-guard.mjs'

// Explicit connection configuration only. This command never runs migrations.
for (const key of ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) {
  if (!process.env[key]) throw new Error(`${key} is required`)
}
const connection = await mysql.createConnection({ host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD })
try {
  // Bound each invocation; a later invocation continues an accumulated backlog.
  const totals = { words: 0, cooldowns: 0 }
  for (let batch = 0; batch < 100; batch++) {
    const result = await cleanupContentReads(connection)
    totals.words += result.words; totals.cooldowns += result.cooldowns
    if (result.words < 1000 && result.cooldowns < 1000) break
  }
  console.log(totals)
} finally { await connection.end() }
