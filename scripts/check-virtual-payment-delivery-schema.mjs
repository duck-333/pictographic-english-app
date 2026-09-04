import mysql from 'mysql2/promise'
import { pathToFileURL } from 'node:url'
import { parseVirtualPaymentEnabled } from '../server/virtual-payment-config.mjs'
import { assertDeliverySchema } from '../server/virtual-payment-delivery-schema.mjs'

// Read-only migration acceptance, also run by the standard API startup command.
export async function checkVirtualPaymentDeliverySchema(env = process.env, connect = mysql.createConnection) {
  if (!parseVirtualPaymentEnabled(env.VIRTUAL_PAYMENT_ENABLED)) return
  let connection
  try {
    if (!env.DB_USER || !env.DB_PASSWORD) throw new Error('Missing database configuration')
    connection = await connect({ host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306),
      database: env.DB_NAME || 'baxiaota', user: env.DB_USER, password: env.DB_PASSWORD, timezone: 'Z' })
    await assertDeliverySchema(connection)
  } catch {
    const error = new Error('Payment delivery schema mismatch; controlled manual recovery is required.')
    error.code = 'PAYMENT_DELIVERY_SCHEMA_MISMATCH'
    throw error
  } finally {
    if (connection) {
      try { await connection.end() } catch {
        const error = new Error('Payment delivery schema check cleanup failed.')
        error.code = 'PAYMENT_DELIVERY_SCHEMA_MISMATCH'
        throw error
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await checkVirtualPaymentDeliverySchema() }
  catch { console.error('PAYMENT_DELIVERY_SCHEMA_MISMATCH: controlled manual recovery required.'); process.exitCode = 1 }
}
