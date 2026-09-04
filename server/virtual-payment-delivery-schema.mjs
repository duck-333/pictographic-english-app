import { readFile } from 'node:fs/promises'

const migrationUrl = new URL('./migrations/010_create_virtual_payment_delivery_attempts.sql', import.meta.url)
const TABLES = ['virtual_payment_delivery_attempts', 'virtual_payment_delivery_queries']
function mismatch() {
  const error = new Error('Payment delivery schema mismatch; controlled manual recovery is required.')
  error.code = 'PAYMENT_DELIVERY_SCHEMA_MISMATCH'
  return error
}
function expression(value) {
  const sql = String(value || '')
  const tokens = []
  for (let i = 0; i < sql.length;) {
    if (/\s/.test(sql[i])) { i++; continue }
    // INFORMATION_SCHEMA on MySQL 8 may escape the literal delimiters too.
    // Decode those delimiters only, never whitespace/case inside the literal.
    if (sql[i] === '\\' && sql[i + 1] === "'") {
      i += 2
      let literal = "'", closed = false
      while (i < sql.length) {
        if (sql[i] === '\\' && sql[i + 1] === "'") {
          i += 2
          literal += "'"
          closed = true
          break
        }
        literal += sql[i++]
      }
      if (!closed) throw mismatch()
      tokens.push(literal)
      continue
    }
    const quote = sql[i]
    if (quote === "'" || quote === '`' || quote === '"') {
      const start = i++
      let closed = false
      while (i < sql.length) {
        if (sql[i] === '\\' && quote !== '`') { i += 2; continue }
        if (sql[i++] === quote) {
          if (sql[i] === quote) { i++; continue }
          closed = true
          break
        }
      }
      if (!closed) throw mismatch()
      // Preserve quoted contents, casing and escape spelling exactly.
      tokens.push(sql.slice(start, i))
    } else {
      const word = sql.slice(i).match(/^[A-Za-z_][A-Za-z_0-9]*/)?.[0]
      if (word) {
        i += word.length
        // MySQL adds this introducer to literals in INFORMATION_SCHEMA.
        if (word.toLowerCase() === '_utf8mb4' && /^\s*(?:\\)?'/.test(sql.slice(i))) continue
        tokens.push(word.toLowerCase())
      } else tokens.push(sql[i++])
    }
  }
  const unwrap = (parts) => {
    while (parts[0] === '(' && parts.at(-1) === ')') {
      let depth = 0
      if (parts.some((token, index) => {
        if (token === '(') depth++
        if (token === ')') depth--
        return depth === 0 && index < parts.length - 1
      })) break
      parts = parts.slice(1, -1)
    }
    return parts
  }
  const parts = unwrap(tokens)
  // Only redundant wrappers around the complete CASE predicate are removed;
  // IN-list parentheses and every other token remain significant.
  const when = parts.indexOf('when'), then = parts.indexOf('then')
  if (parts[0] === 'case' && when === 1 && then > when) {
    parts.splice(when + 1, then - when - 1, ...unwrap(parts.slice(when + 1, then)))
  }
  return JSON.stringify(parts)
}
const columnType = (value) => value.toLowerCase().replace(/,\s+/g, ',')
const defaultValue = (value) => value === null || value === undefined || String(value).toLowerCase() === 'null'
  ? null : String(value).replace(/^'|'$/g, '').replace(/\(\)$/, '').toLowerCase()

export async function readDeliverySchemaContract() {
  const bytes = await readFile(migrationUrl)
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw mismatch()
  const sql = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const result = []
  for (const table of TABLES) {
    const statement = sql.match(new RegExp('CREATE TABLE IF NOT EXISTS `' + table + '` \\(([\\s\\S]*?)\\) ENGINE=InnoDB[^;]*;'))?.[0]
    if (!statement) throw mismatch()
    const columns = []
    for (const match of statement.matchAll(/^  `([^`]+)` (.+)$/gm)) {
      const name = match[1]
      const definition = match[2]
      const type = definition.match(/^(ENUM\([^)]*\)|[A-Z]+(?:\(\d+\))?(?: UNSIGNED)?)/)?.[0]
      if (!type) throw mismatch()
      const generated = definition.includes('GENERATED ALWAYS')
        ? statement.slice(match.index).match(/GENERATED ALWAYS AS \(([\s\S]*?)\) STORED/)?.[1] : ''
      columns.push({
        name, type: columnType(type), nullable: !definition.includes('NOT NULL'),
        default: defaultValue(definition.match(/DEFAULT (NULL|CURRENT_TIMESTAMP|'[^']*'|\d+)/)?.[1]),
        auto: definition.includes('AUTO_INCREMENT'), update: definition.includes('ON UPDATE CURRENT_TIMESTAMP'),
        generated: expression(generated), stored: Boolean(generated), collation: /^(VARCHAR|CHAR|ENUM)/.test(type) ? 'utf8mb4_unicode_ci' : null
      })
    }
    const indexes = [...statement.matchAll(/^  (PRIMARY KEY|UNIQUE KEY `([^`]+)`|KEY `([^`]+)`) \(([^)]+)\)/gm)]
      .map((m) => ({ name: m[1] === 'PRIMARY KEY' ? 'PRIMARY' : m[2] || m[3], unique: !m[1].startsWith('KEY '), columns: [...m[4].matchAll(/`([^`]+)`/g)].map((x) => x[1]) }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const foreignKeys = [...statement.matchAll(/CONSTRAINT `([^`]+)`\s+FOREIGN KEY \(`([^`]+)`\) REFERENCES `([^`]+)` \(`([^`]+)`\) ON UPDATE (\w+) ON DELETE (\w+)/g)]
      .map((m) => ({ name: m[1], column: m[2], table: m[3], referencedColumn: m[4], update: m[5], delete: m[6] }))
      .sort((a, b) => a.name.localeCompare(b.name))
    result.push({ table, statement, columns, indexes, foreignKeys })
  }
  return result
}

export async function assertDeliverySchema(connection, { allowPartial = false } = {}) {
  try {
    const contract = await readDeliverySchemaContract()
    const present = []
    for (const expected of contract) {
      const [tables] = await connection.execute('SELECT ENGINE, TABLE_COLLATION FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [expected.table])
      if (tables.length === 0 && allowPartial) continue
      if (tables.length !== 1 || tables[0].ENGINE !== 'InnoDB' || tables[0].TABLE_COLLATION !== 'utf8mb4_unicode_ci') throw mismatch()
      const [rows] = await connection.execute('SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, GENERATION_EXPRESSION, COLLATION_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION', [expected.table])
      const actual = rows.map((r) => ({ name: r.COLUMN_NAME, type: columnType(r.COLUMN_TYPE), nullable: r.IS_NULLABLE === 'YES', default: defaultValue(r.COLUMN_DEFAULT), auto: r.EXTRA.includes('auto_increment'), update: r.EXTRA.toLowerCase().includes('on update'), generated: expression(r.GENERATION_EXPRESSION), stored: r.EXTRA.includes('STORED GENERATED'), collation: r.COLLATION_NAME }))
      if (JSON.stringify(actual) !== JSON.stringify(expected.columns)) throw mismatch()
      const [indexRows] = await connection.execute('SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX, SUB_PART, INDEX_TYPE, IS_VISIBLE, COLLATION FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX', [expected.table])
      const byName = new Map()
      for (const row of indexRows) {
        if (row.SUB_PART !== null || row.INDEX_TYPE !== 'BTREE' || row.IS_VISIBLE !== 'YES' || row.COLLATION !== 'A') throw mismatch()
        if (!byName.has(row.INDEX_NAME)) byName.set(row.INDEX_NAME, { name: row.INDEX_NAME, unique: row.NON_UNIQUE === 0, columns: [] })
        byName.get(row.INDEX_NAME).columns.push(row.COLUMN_NAME)
      }
      const indexes = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
      if (JSON.stringify(indexes) !== JSON.stringify(expected.indexes)) throw mismatch()
      const [fkRows] = await connection.execute(`SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, k.REFERENCED_TABLE_SCHEMA,
          r.UPDATE_RULE, r.DELETE_RULE FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
          JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
          WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL`, [expected.table])
      const [[database]] = await connection.execute('SELECT DATABASE() AS schema_name')
      if (fkRows.some((r) => r.REFERENCED_TABLE_SCHEMA !== database.schema_name)) throw mismatch()
      const foreignKeys = fkRows.map((r) => ({ name: r.CONSTRAINT_NAME, column: r.COLUMN_NAME, table: r.REFERENCED_TABLE_NAME, referencedColumn: r.REFERENCED_COLUMN_NAME, update: r.UPDATE_RULE, delete: r.DELETE_RULE })).sort((a, b) => a.name.localeCompare(b.name))
      if (JSON.stringify(foreignKeys) !== JSON.stringify(expected.foreignKeys)) throw mismatch()
      present.push(expected.table)
    }
    return present
  } catch { throw mismatch() }
}

// The only supported batch-7 migration acceptance path: exact existing tables may
// resume, mismatched existing tables are never altered or dropped automatically.
export async function applyDeliveryMigration(connection) {
  const present = await assertDeliverySchema(connection, { allowPartial: true })
  for (const expected of await readDeliverySchemaContract()) {
    if (!present.includes(expected.table)) await connection.query(expected.statement)
  }
  await assertDeliverySchema(connection)
}
