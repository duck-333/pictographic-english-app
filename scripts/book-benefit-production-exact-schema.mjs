import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import {
  BOOK_BENEFIT_MANIFEST_FORMAT_VERSION,
  BOOK_BENEFIT_SCHEMA_PLACEHOLDER,
  classifyBookBenefitSchemaManifest,
  collectBookBenefitSchemaManifest,
  normalizeBookBenefitSchemaManifest
} from './book-benefit-schema-manifest.mjs'

export const EXACT_SCHEMA_PROTOCOL_VERSION = 1
export const BOOK_BENEFIT_PRODUCTION_SCHEMA = 'baxiaota'
export const BOOK_BENEFIT_EXPECTED_ARTIFACT_URL = new URL(
  './book-benefit-schema-expected.json',
  import.meta.url
)

const EXPECTED_STATES = Object.freeze(['revised-007', 'revised-008'])
const OUTPUT_CLASSIFICATIONS = new Set([
  'exact_revised_007',
  'exact_revised_008',
  'pristine',
  'partial_mismatch',
  'unknown'
])
const SAFETY_ERROR_CATEGORIES = new Set([
  'NONE',
  'ARGUMENT_INVALID',
  'TTY_REQUIRED',
  'CREDENTIAL_INPUT_FAILED',
  'EXPECTED_ARTIFACT_GENERATION_REQUIRED',
  'EXPECTED_ARTIFACT_INVALID',
  'CONNECTION_FAILED',
  'TRANSACTION_FAILED',
  'COLLECTION_FAILED',
  'COLLECTOR_UNKNOWN',
  'CLEANUP_FAILED',
  'INTERRUPTED'
])
const TOP_LEVEL_KEYS = Object.freeze([
  'formatVersion',
  'expectedRevised007',
  'expectedRevised008'
])
const FORBIDDEN_ARTIFACT_PATTERNS = Object.freeze([
  /baxiaota/i,
  /book_benefit_manifest_[a-z]+_[a-f0-9]{12}/i,
  /127\.0\.0\.1|localhost/i,
  /\bsocket\b/i,
  /\b(?:root|schema_audit_ro)\b/i,
  /\bpassword\b/i,
  /[a-z]:[\\/]/i,
  /\/(?:var|run|tmp|home|users?)\//i
])

function fixedError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function hasExactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key, index) => key === keys[index])
}

function normalizeExpectedManifest(value) {
  if (!value || value.formatVersion !== BOOK_BENEFIT_MANIFEST_FORMAT_VERSION) {
    throw fixedError('EXPECTED_ARTIFACT_INVALID')
  }
  if (value.schema !== BOOK_BENEFIT_SCHEMA_PLACEHOLDER) {
    throw fixedError('EXPECTED_ARTIFACT_NOT_SCHEMA_NEUTRAL')
  }
  const normalized = normalizeBookBenefitSchemaManifest(value, {
    schemaName: BOOK_BENEFIT_SCHEMA_PLACEHOLDER
  })
  if (JSON.stringify(value) !== JSON.stringify(normalized)) {
    throw fixedError('EXPECTED_ARTIFACT_NOT_NORMALIZED')
  }
  return normalized
}

export function assertSchemaNeutralExpectedArtifact(value, { forbiddenValues = [] } = {}) {
  if (!hasExactKeys(value, TOP_LEVEL_KEYS) || value.formatVersion !== BOOK_BENEFIT_MANIFEST_FORMAT_VERSION) {
    throw fixedError('EXPECTED_ARTIFACT_INVALID')
  }
  const serializedInput = JSON.stringify(value)
  if (FORBIDDEN_ARTIFACT_PATTERNS.some((pattern) => pattern.test(serializedInput))) {
    throw fixedError('EXPECTED_ARTIFACT_NOT_SCHEMA_NEUTRAL')
  }
  if (!Array.isArray(forbiddenValues) || forbiddenValues.some((item) => typeof item !== 'string')) {
    throw fixedError('EXPECTED_ARTIFACT_INVALID')
  }
  if (forbiddenValues.some((item) => item.length > 0 && serializedInput.includes(item))) {
    throw fixedError('EXPECTED_ARTIFACT_NOT_SCHEMA_NEUTRAL')
  }
  const expectedRevised007 = normalizeExpectedManifest(value.expectedRevised007)
  const expectedRevised008 = normalizeExpectedManifest(value.expectedRevised008)
  return {
    formatVersion: BOOK_BENEFIT_MANIFEST_FORMAT_VERSION,
    expectedRevised007,
    expectedRevised008
  }
}

export function buildBookBenefitExpectedArtifact(expectedRevised007, expectedRevised008, options) {
  return assertSchemaNeutralExpectedArtifact({
    formatVersion: BOOK_BENEFIT_MANIFEST_FORMAT_VERSION,
    expectedRevised007,
    expectedRevised008
  }, options)
}

export function serializeBookBenefitExpectedArtifact(value, options) {
  const artifact = assertSchemaNeutralExpectedArtifact(value, options)
  return `${JSON.stringify(artifact, null, 2)}\n`
}

export function parseBookBenefitExpectedArtifact(text) {
  if (typeof text !== 'string' || text.charCodeAt(0) === 0xfeff || /\r/.test(text) ||
      !text.endsWith('\n') || text.endsWith('\n\n')) {
    throw fixedError('EXPECTED_ARTIFACT_ENCODING_INVALID')
  }
  let value
  try {
    value = JSON.parse(text)
  } catch {
    throw fixedError('EXPECTED_ARTIFACT_INVALID')
  }
  return assertSchemaNeutralExpectedArtifact(value)
}

export async function readBookBenefitExpectedArtifact() {
  let text
  try {
    text = await readFile(BOOK_BENEFIT_EXPECTED_ARTIFACT_URL, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw fixedError('EXPECTED_ARTIFACT_GENERATION_REQUIRED')
    }
    throw fixedError('EXPECTED_ARTIFACT_READ_FAILED')
  }
  return parseBookBenefitExpectedArtifact(text)
}

export function compareBookBenefitExpectedArtifact(generated, committed) {
  const generatedValue = assertSchemaNeutralExpectedArtifact(generated)
  const committedValue = assertSchemaNeutralExpectedArtifact(committed)
  if (JSON.stringify(generatedValue) !== JSON.stringify(committedValue)) {
    throw fixedError('EXPECTED_ARTIFACT_MISMATCH')
  }
}

export function parseExpectedArtifactWriteMode(args) {
  if (!Array.isArray(args) || args.length === 0) return false
  if (args.length === 1 && args[0] === '--write-expected-artifact') return true
  throw fixedError('EXPECTED_ARTIFACT_ARGUMENT_INVALID')
}

export function parseProductionExactSchemaArgs(args) {
  if (!Array.isArray(args)) throw fixedError('ARGUMENT_INVALID')
  const options = {}
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (!value || !['--expected-state', '--socket', '--user'].includes(flag) ||
        Object.prototype.hasOwnProperty.call(options, flag)) {
      throw fixedError('ARGUMENT_INVALID')
    }
    options[flag] = value
  }
  if (!EXPECTED_STATES.includes(options['--expected-state'])) throw fixedError('ARGUMENT_INVALID')
  if (!/^\/(?!.*(?:^|\/)\.\.(?:\/|$))[^\0\r\n]{1,511}$/.test(options['--socket'] || '')) {
    throw fixedError('ARGUMENT_INVALID')
  }
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(options['--user'] || '')) throw fixedError('ARGUMENT_INVALID')
  return {
    expectedState: options['--expected-state'],
    socketPath: options['--socket'],
    user: options['--user']
  }
}

export async function readHiddenPasswordFromTty(stdin = process.stdin) {
  if (!stdin || stdin.isTTY !== true || typeof stdin.setRawMode !== 'function') {
    throw fixedError('TTY_REQUIRED')
  }
  return new Promise((resolve, reject) => {
    let secret = ''
    const wasRaw = Boolean(stdin.isRaw)
    const finish = (error) => {
      stdin.off('data', onData)
      try { stdin.setRawMode(wasRaw) } catch {}
      stdin.pause()
      if (error) reject(error)
      else if (!secret) reject(fixedError('CREDENTIAL_INPUT_FAILED'))
      else resolve(secret)
    }
    const onData = (chunk) => {
      const value = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      for (const character of value) {
        if (character === '\u0003') return finish(fixedError('INTERRUPTED'))
        if (character === '\r' || character === '\n') return finish()
        if (character === '\u007f' || character === '\b') secret = secret.slice(0, -1)
        else if (secret.length < 1024 && character >= ' ') secret += character
      }
    }
    stdin.setRawMode(true)
    stdin.on('data', onData)
    stdin.resume()
  })
}

function safeClassification(value) {
  return OUTPUT_CLASSIFICATIONS.has(value) ? value : value === 'legacy_application' ? 'partial_mismatch' : 'unknown'
}

function expectedClassification(expectedState) {
  return expectedState === 'revised-008' ? 'exact_revised_008' : 'exact_revised_007'
}

function registerSigint(handler) {
  process.once('SIGINT', handler)
  return () => process.removeListener('SIGINT', handler)
}

function baseResult(expectedState = 'revised-007') {
  return {
    expectedState: EXPECTED_STATES.includes(expectedState) ? expectedState : 'revised-007',
    actualClassification: 'unknown',
    collectorState: 'unknown',
    pass: false,
    safetyErrorCategory: 'NONE'
  }
}

export async function executeProductionExactSchema(options, dependencies = {}) {
  const result = baseResult(options && options.expectedState)
  let artifact
  try {
    artifact = await (dependencies.loadExpectedArtifact || readBookBenefitExpectedArtifact)()
    artifact = assertSchemaNeutralExpectedArtifact(artifact)
  } catch (error) {
    result.safetyErrorCategory = error && error.code === 'EXPECTED_ARTIFACT_GENERATION_REQUIRED'
      ? 'EXPECTED_ARTIFACT_GENERATION_REQUIRED'
      : 'EXPECTED_ARTIFACT_INVALID'
    return result
  }

  if (!options || !EXPECTED_STATES.includes(options.expectedState) ||
      !/^\/(?!.*(?:^|\/)\.\.(?:\/|$))[^\0\r\n]{1,511}$/.test(options.socketPath || '') ||
      !/^[A-Za-z0-9_.-]{1,64}$/.test(options.user || '')) {
    result.safetyErrorCategory = 'ARGUMENT_INVALID'
    return result
  }
  if ((dependencies.stdinIsTTY ?? process.stdin.isTTY) !== true) {
    result.safetyErrorCategory = 'TTY_REQUIRED'
    return result
  }

  let password = null
  let connection = null
  let transactionStarted = false
  let cleanupPromise = null
  let interrupted = false
  let phase = 'credential'
  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise
    cleanupPromise = (async () => {
      let failed = false
      if (connection && transactionStarted) {
        try { await connection.query('ROLLBACK') } catch { failed = true }
        transactionStarted = false
      }
      if (connection) {
        try { await connection.end() } catch { failed = true }
        connection = null
      }
      if (failed) throw fixedError('CLEANUP_FAILED')
    })()
    return cleanupPromise
  }
  const onSigint = () => {
    interrupted = true
    password = null
    if (connection) void cleanup().catch(() => {})
  }
  const unregister = (dependencies.registerSigint || registerSigint)(onSigint)

  try {
    password = await (dependencies.readPassword || readHiddenPasswordFromTty)()
    if (!password || typeof password !== 'string') throw fixedError('CREDENTIAL_INPUT_FAILED')
    if (interrupted) throw fixedError('INTERRUPTED')
    phase = 'connection'
    const createConnection = dependencies.createConnection || (async (config) => {
      const mysql = await import('mysql2/promise')
      return mysql.default.createConnection(config)
    })
    connection = await createConnection({
      socketPath: options.socketPath,
      user: options.user,
      password,
      database: BOOK_BENEFIT_PRODUCTION_SCHEMA,
      charset: 'utf8mb4',
      timezone: 'Z'
    })
    password = null
    if (interrupted) throw fixedError('INTERRUPTED')
    phase = 'transaction'
    await connection.query('START TRANSACTION READ ONLY')
    transactionStarted = true
    if (interrupted) throw fixedError('INTERRUPTED')
    phase = 'collection'
    const collect = dependencies.collectManifest || collectBookBenefitSchemaManifest
    const actual = await collect(connection, { schemaName: BOOK_BENEFIT_PRODUCTION_SCHEMA })
    if (interrupted) throw fixedError('INTERRUPTED')
    result.collectorState = actual && actual.collectionState === 'unknown' ? 'unknown' : 'ready'
    const classify = dependencies.classifyManifest || classifyBookBenefitSchemaManifest
    result.actualClassification = safeClassification(classify(
      actual,
      artifact.expectedRevised007,
      artifact.expectedRevised008
    ))
    result.pass = result.collectorState === 'ready' &&
      result.actualClassification === expectedClassification(options.expectedState)
    result.safetyErrorCategory = result.collectorState === 'unknown' ? 'COLLECTOR_UNKNOWN' : 'NONE'
  } catch (error) {
    result.pass = false
    if (interrupted || (error && error.code === 'INTERRUPTED')) result.safetyErrorCategory = 'INTERRUPTED'
    else if (phase === 'credential') result.safetyErrorCategory = 'CREDENTIAL_INPUT_FAILED'
    else if (phase === 'connection') result.safetyErrorCategory = 'CONNECTION_FAILED'
    else if (phase === 'transaction') result.safetyErrorCategory = 'TRANSACTION_FAILED'
    else result.safetyErrorCategory = 'COLLECTION_FAILED'
  } finally {
    password = null
    if (typeof unregister === 'function') unregister()
    try {
      await cleanup()
    } catch {
      result.pass = false
      result.safetyErrorCategory = 'CLEANUP_FAILED'
    }
  }
  return result
}

export function formatProductionExactSchemaOutput(result) {
  const expectedState = EXPECTED_STATES.includes(result.expectedState) ? result.expectedState : 'revised-007'
  const classification = safeClassification(result.actualClassification)
  const collectorState = result.collectorState === 'ready' ? 'ready' : 'unknown'
  const category = SAFETY_ERROR_CATEGORIES.has(result.safetyErrorCategory)
    ? result.safetyErrorCategory
    : 'ARGUMENT_INVALID'
  return [
    `EXACT_SCHEMA_PROTOCOL_VERSION=${EXACT_SCHEMA_PROTOCOL_VERSION}`,
    `EXPECTED_STATE=${expectedState}`,
    `ACTUAL_CLASSIFICATION=${classification}`,
    `COLLECTOR_STATE=${collectorState}`,
    `EXACT_SCHEMA_PASS=${result.pass === true ? 'true' : 'false'}`,
    `SAFETY_ERROR_CATEGORY=${category}`
  ].join('\n') + '\n'
}

export async function runProductionExactSchemaCli(args = process.argv.slice(2), dependencies = {}) {
  let options
  let result
  try {
    options = parseProductionExactSchemaArgs(args)
    result = await executeProductionExactSchema(options, dependencies)
  } catch {
    result = baseResult(args.includes('revised-008') ? 'revised-008' : 'revised-007')
    result.safetyErrorCategory = 'ARGUMENT_INVALID'
  }
  const output = formatProductionExactSchemaOutput(result)
  ;(dependencies.stdout || process.stdout).write(output)
  return result.pass ? 0 : 1
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) process.exitCode = await runProductionExactSchemaCli()
