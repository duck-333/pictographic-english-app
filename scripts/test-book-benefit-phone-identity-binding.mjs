import assert from 'node:assert/strict'

import {
  createIdentityStore,
  findCurrentCampaignPhoneIdentityInTransaction,
  hashPhone
} from '../server/identity-store.mjs'
import { createCampaignPhoneIdentity } from '../server/book-benefit-foundation.mjs'

const TEST_PHONE = '+86 100 0000 0000'
const OTHER_PHONE = '+86 100 0000 0001'
const TEST_PHONE_SECRET = 'fake-phone-hash-secret-for-tests-only'
const TEST_CAMPAIGN_SECRET = 'fake-campaign-phone-secret-32-bytes-for-tests-only'
const TEST_CAMPAIGN_HASH = Buffer.alloc(32, 0x2a)
const TEST_TIMESTAMP = new Date('2026-08-08T01:02:03.000Z')

function expectCode(action, code) {
  assert.throws(action, (error) => error && error.code === code)
}

function column(Field, Type, overrides = {}) {
  return {
    Field,
    Type,
    Null: 'YES',
    Default: null,
    Extra: '',
    ...overrides
  }
}

function createColumns(phoneOverrides = {}) {
  return {
    users: [
      column('id', 'bigint unsigned', { Null: 'NO', Extra: 'auto_increment' }),
      column('status', 'varchar(32)'),
      column('last_login_at', 'datetime')
    ],
    wechat_user_bindings: [
      column('user_id', 'bigint unsigned'),
      column('openid', 'varchar(128)'),
      column('unionid', 'varchar(128)'),
      column('created_at', 'datetime'),
      column('updated_at', 'datetime')
    ],
    user_phone_bindings: [
      column('id', 'bigint unsigned', { Null: 'NO', Extra: 'auto_increment' }),
      column('user_id', 'bigint unsigned'),
      column('phone_hash', 'char(64)'),
      column('phone_masked', 'varchar(32)'),
      column('hash_version', 'varchar(16)'),
      column('country_code', 'varchar(8)'),
      column('campaign_phone_identity_hash', 'binary(32)'),
      column('campaign_phone_hash_version', 'varchar(16)'),
      column('status', 'varchar(32)'),
      column('bound_at', 'datetime'),
      column('verified_at', 'datetime'),
      column('last_verified_at', 'datetime'),
      column('created_at', 'datetime'),
      column('updated_at', 'datetime')
    ].filter((item) => phoneOverrides[item.Field] !== null).map((item) => ({
      ...item,
      ...(phoneOverrides[item.Field] || {})
    }))
  }
}

function cloneValue(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value)
  if (value instanceof Date) return new Date(value)
  return value
}

function cloneRecord(record) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, cloneValue(value)]))
}

function cloneState(state) {
  return {
    phoneBindings: state.phoneBindings.map(cloneRecord),
    wechatBindings: state.wechatBindings.map(cloneRecord)
  }
}

function parseInsertColumns(sql) {
  const match = sql.match(/\(([^)]+)\)\s+VALUES/i)
  assert(match)
  return [...match[1].matchAll(/`([^`]+)`/g)].map((item) => item[1])
}

function parseUpdateColumns(sql) {
  const match = sql.match(/\sSET\s+(.+)\sWHERE\s/is)
  assert(match)
  return [...match[1].matchAll(/`([^`]+)`\s*=\s*\?/g)].map((item) => item[1])
}

function createState(input = {}) {
  return {
    phoneBindings: (input.phoneBindings || []).map(cloneRecord),
    wechatBindings: (input.wechatBindings || [{
      user_id: '1',
      openid: 'trusted-openid',
      unionid: 'trusted-unionid'
    }]).map(cloneRecord)
  }
}

function createFakeConnection(sharedState, options = {}) {
  let transactionState = null
  const calls = []
  const counters = {
    begin: 0,
    commit: 0,
    rollback: 0,
    release: 0
  }
  const columns = options.columns || createColumns()
  const activeState = () => transactionState || sharedState

  return {
    calls,
    counters,
    async beginTransaction() {
      counters.begin += 1
      transactionState = cloneState(sharedState)
    },
    async commit() {
      counters.commit += 1
      sharedState.phoneBindings = transactionState.phoneBindings
      sharedState.wechatBindings = transactionState.wechatBindings
      transactionState = null
    },
    async rollback() {
      counters.rollback += 1
      transactionState = null
    },
    release() {
      counters.release += 1
    },
    async query(sql) {
      calls.push({ type: 'query', sql })
      const tableMatch = sql.match(/SHOW COLUMNS FROM `([^`]+)`/i)
      assert(tableMatch)
      return [columns[tableMatch[1]] || []]
    },
    async execute(sql, values = []) {
      calls.push({ type: 'execute', sql, values: values.map(cloneValue) })
      const compactSql = sql.replace(/\s+/g, ' ').trim()
      const state = activeState()

      if (/SELECT user_id, openid, unionid FROM `wechat_user_bindings`/i.test(compactSql)) {
        const row = state.wechatBindings.find((binding) => binding.openid === values[0])
        return [row ? [cloneRecord(row)] : []]
      }
      if (/SELECT user_id, phone_hash, phone_masked/i.test(compactSql)) {
        const row = state.phoneBindings.find((binding) => binding.phone_hash === values[0])
        return [row ? [cloneRecord(row)] : []]
      }
      if (/UPDATE `users`/i.test(compactSql) || /UPDATE `wechat_user_bindings`/i.test(compactSql)) {
        return [{ affectedRows: 1 }]
      }
      if (/UPDATE `user_phone_bindings`/i.test(compactSql)) {
        if (options.failPhoneWrite === 'update') throw new Error('fake phone update failure')
        const phoneHash = values.at(-1)
        const row = state.phoneBindings.find((binding) => binding.phone_hash === phoneHash)
        assert(row)
        const updateColumns = parseUpdateColumns(compactSql)
        updateColumns.forEach((name, index) => {
          row[name] = cloneValue(values[index])
        })
        return [{ affectedRows: 1 }]
      }
      if (/INSERT INTO `user_phone_bindings`/i.test(compactSql)) {
        if (options.failPhoneWrite === 'insert' || options.duplicatePhoneInsert) {
          const error = new Error('fake duplicate or insert failure')
          if (options.duplicatePhoneInsert) error.code = 'ER_DUP_ENTRY'
          throw error
        }
        const insertColumns = parseInsertColumns(compactSql)
        const row = Object.fromEntries(insertColumns.map((name, index) => [name, cloneValue(values[index])]))
        row.id = String(state.phoneBindings.length + 1)
        state.phoneBindings.push(row)
        return [{ insertId: row.id, affectedRows: 1 }]
      }

      throw new Error(`Unexpected fake SQL operation: ${compactSql.slice(0, 80)}`)
    }
  }
}

function createPool(connections, onGetConnection) {
  let callCount = 0
  return {
    get callCount() {
      return callCount
    },
    async getConnection() {
      callCount += 1
      if (onGetConnection) onGetConnection(callCount)
      const connection = connections[callCount - 1]
      assert(connection, `Missing fake connection for call ${callCount}`)
      return connection
    }
  }
}

function createStore(pool, overrides = {}) {
  return createIdentityStore({
    pool,
    now: () => new Date(TEST_TIMESTAMP),
    phoneHashSecret: TEST_PHONE_SECRET,
    campaignPhoneIdentityHashSecret: TEST_CAMPAIGN_SECRET,
    campaignPhoneIdentityEnv: {},
    campaignPhoneIdentityFactory: async () => ({
      campaignPhoneIdentityHash: Buffer.from(TEST_CAMPAIGN_HASH),
      hashVersion: 'v1'
    }),
    ...overrides
  })
}

function trustedIdentity(phone = TEST_PHONE) {
  return {
    openid: 'trusted-openid',
    unionid: 'trusted-unionid',
    phone: {
      phoneNumber: phone,
      purePhoneNumber: phone,
      countryCode: '86'
    }
  }
}

function phoneHash(phone) {
  return hashPhone(phone, { secret: TEST_PHONE_SECRET }).phoneHash
}

async function expectReject(action, predicate) {
  await assert.rejects(action, predicate)
}

function testCampaignIdentityFoundation() {
  const first = createCampaignPhoneIdentity(TEST_PHONE, {
    secret: TEST_CAMPAIGN_SECRET,
    env: {}
  })
  const equivalent = createCampaignPhoneIdentity('8610000000000', {
    secret: TEST_CAMPAIGN_SECRET,
    env: {}
  })
  assert(Buffer.isBuffer(first.campaignPhoneIdentityHash))
  assert.equal(first.campaignPhoneIdentityHash.length, 32)
  assert.equal(first.hashVersion, 'v1')
  assert.deepEqual(first.campaignPhoneIdentityHash, equivalent.campaignPhoneIdentityHash)

  for (const invalidPhone of ['', '100****0000', 'not-a-phone']) {
    assert.throws(() => createCampaignPhoneIdentity(invalidPhone, {
      secret: TEST_CAMPAIGN_SECRET,
      env: {}
    }))
  }
  expectCode(
    () => createCampaignPhoneIdentity(TEST_PHONE, { env: {} }),
    'CAMPAIGN_PHONE_IDENTITY_HASH_SECRET_MISSING'
  )
  expectCode(
    () => createCampaignPhoneIdentity(TEST_PHONE, { secret: 'too-short', env: {} }),
    'CAMPAIGN_PHONE_IDENTITY_HASH_SECRET_TOO_SHORT'
  )
  for (const secretName of [
    'PHONE_HASH_SECRET',
    'JWT_SECRET',
    'ADMIN_API_TOKEN',
    'REDEMPTION_CODE_HASH_SECRET',
    'BOOK_ORDER_CLAIM_HASH_SECRET',
    'WECHAT_MINIAPP_SECRET'
  ]) {
    expectCode(
      () => createCampaignPhoneIdentity(TEST_PHONE, {
        secret: TEST_CAMPAIGN_SECRET,
        env: { [secretName]: TEST_CAMPAIGN_SECRET }
      }),
      'CAMPAIGN_PHONE_IDENTITY_HASH_SECRET_REUSED'
    )
  }
}

async function testHmacBeforeConnectionAndTrustedInput() {
  const state = createState()
  const connection = createFakeConnection(state)
  const pool = createPool([connection])
  const hmacFailure = new Error('fake campaign identity failure')
  const failingStore = createStore(pool, {
    campaignPhoneIdentityFactory: async () => {
      throw hmacFailure
    }
  })
  await expectReject(
    () => failingStore.resolveWechatPhoneIdentity(trustedIdentity()),
    (error) => error !== hmacFailure && error && error.code === 'IDENTITY_STORE_ERROR'
  )
  assert.equal(pool.callCount, 0)
  assert.equal(connection.calls.length, 0)

  const invalidOutputStore = createStore(pool, {
    campaignPhoneIdentityFactory: async () => ({
      campaignPhoneIdentityHash: Buffer.alloc(31),
      hashVersion: 'v1'
    })
  })
  await expectReject(
    () => invalidOutputStore.resolveWechatPhoneIdentity(trustedIdentity()),
    (error) => error && error.code === 'IDENTITY_STORE_ERROR'
  )
  assert.equal(pool.callCount, 0)
  assert.equal(connection.calls.length, 0)

  let factoryPhone = null
  const trustedStore = createStore(pool, {
    campaignPhoneIdentityFactory: async (phone) => {
      factoryPhone = phone
      return {
        campaignPhoneIdentityHash: Buffer.from(TEST_CAMPAIGN_HASH),
        hashVersion: 'v1'
      }
    }
  })
  const input = {
    ...trustedIdentity(),
    phoneNumber: OTHER_PHONE,
    purePhoneNumber: OTHER_PHONE,
    phoneHash: 'client-phone-hash-must-be-ignored',
    campaignPhoneIdentityHash: Buffer.alloc(32, 0xff),
    campaignPhoneHashVersion: 'client-version-must-be-ignored'
  }
  await trustedStore.resolveWechatPhoneIdentity(input)
  assert.equal(factoryPhone, '+8610000000000')
}

async function testDefaultFactoryIntegration() {
  const state = createState()
  const connection = createFakeConnection(state)
  const store = createIdentityStore({
    pool: createPool([connection]),
    now: () => new Date(TEST_TIMESTAMP),
    phoneHashSecret: TEST_PHONE_SECRET,
    campaignPhoneIdentityHashSecret: TEST_CAMPAIGN_SECRET,
    campaignPhoneIdentityEnv: {
      WECHAT_MINIAPP_SECRET: 'different-fake-wechat-secret-32-bytes-for-tests'
    }
  })
  await store.resolveWechatPhoneIdentity(trustedIdentity())
  const expected = createCampaignPhoneIdentity(TEST_PHONE, {
    secret: TEST_CAMPAIGN_SECRET,
    env: {
      WECHAT_MINIAPP_SECRET: 'different-fake-wechat-secret-32-bytes-for-tests'
    }
  })
  assert.deepEqual(
    state.phoneBindings[0].campaign_phone_identity_hash,
    expected.campaignPhoneIdentityHash
  )
  assert.equal(state.phoneBindings[0].campaign_phone_hash_version, 'v1')
}

async function testDefaultFactoryPreservesConfigurationErrorCodes() {
  const cases = [
    {
      expectedCode: 'CAMPAIGN_PHONE_IDENTITY_HASH_SECRET_MISSING',
      secret: '',
      env: { NODE_ENV: 'production' }
    },
    {
      expectedCode: 'CAMPAIGN_PHONE_IDENTITY_HASH_SECRET_TOO_SHORT',
      secret: 'too-short',
      env: { NODE_ENV: 'production' }
    },
    {
      expectedCode: 'CAMPAIGN_PHONE_IDENTITY_HASH_SECRET_REUSED',
      secret: TEST_CAMPAIGN_SECRET,
      env: { JWT_SECRET: TEST_CAMPAIGN_SECRET }
    }
  ]

  for (const testCase of cases) {
    const state = createState()
    const connection = createFakeConnection(state)
    const pool = createPool([connection])
    const store = createStore(pool, {
      campaignPhoneIdentityFactory: undefined,
      campaignPhoneIdentityHashSecret: testCase.secret,
      campaignPhoneIdentityEnv: testCase.env
    })

    await expectReject(
      () => store.resolveWechatPhoneIdentity(trustedIdentity()),
      (error) => error &&
        error.code === testCase.expectedCode &&
        error.statusCode === 503 &&
        error.message === 'Campaign phone identity is unavailable.'
    )
    assert.equal(pool.callCount, 0)
    assert.equal(connection.calls.length, 0)
  }
}

async function testNewBindingAndPrivacy() {
  const state = createState()
  const connection = createFakeConnection(state)
  const result = await createStore(createPool([connection])).resolveWechatPhoneIdentity(trustedIdentity())
  assert.equal(connection.counters.commit, 1)
  assert.equal(connection.counters.rollback, 0)
  assert.equal(connection.counters.release, 1)
  assert.equal(state.phoneBindings.length, 1)
  const binding = state.phoneBindings[0]
  assert(Buffer.isBuffer(binding.campaign_phone_identity_hash))
  assert.deepEqual(binding.campaign_phone_identity_hash, TEST_CAMPAIGN_HASH)
  assert.equal(binding.campaign_phone_hash_version, 'v1')
  assert.equal(binding.phone_hash, phoneHash(TEST_PHONE))
  assert.deepEqual(Object.keys(result).sort(), [
    'hasPhoneBinding',
    'hasWechatBinding',
    'id',
    'isNew',
    'phoneMasked'
  ])
  assert.equal(JSON.stringify(result).includes(binding.phone_hash), false)
  assert.equal(JSON.stringify(result).includes(TEST_CAMPAIGN_HASH.toString('hex')), false)
  assert.equal(JSON.stringify(result).includes(TEST_CAMPAIGN_SECRET), false)
}

async function testSamePhoneRefreshesCampaignIdentity() {
  const existingHash = phoneHash(TEST_PHONE)
  const state = createState({
    phoneBindings: [{
      id: '7',
      user_id: '1',
      phone_hash: existingHash,
      phone_masked: '100****0000',
      hash_version: 'v1',
      country_code: '86',
      campaign_phone_identity_hash: null,
      campaign_phone_hash_version: null,
      status: 'active',
      verified_at: new Date('2026-01-01T00:00:00.000Z'),
      last_verified_at: new Date('2026-01-01T00:00:00.000Z')
    }]
  })
  const connection = createFakeConnection(state)
  await createStore(createPool([connection])).resolveWechatPhoneIdentity(trustedIdentity())
  assert.equal(state.phoneBindings.length, 1)
  assert.deepEqual(state.phoneBindings[0].campaign_phone_identity_hash, TEST_CAMPAIGN_HASH)
  assert.equal(state.phoneBindings[0].campaign_phone_hash_version, 'v1')
  assert.deepEqual(state.phoneBindings[0].last_verified_at, TEST_TIMESTAMP)
}

async function testNewPhonePreservesOldBinding() {
  const oldBinding = {
    id: '8',
    user_id: '1',
    phone_hash: phoneHash(OTHER_PHONE),
    phone_masked: '100****0001',
    hash_version: 'v1',
    country_code: '86',
    campaign_phone_identity_hash: Buffer.alloc(32, 0x11),
    campaign_phone_hash_version: 'v1',
    status: 'active',
    last_verified_at: new Date('2026-01-01T00:00:00.000Z')
  }
  const state = createState({ phoneBindings: [oldBinding] })
  const before = cloneRecord(state.phoneBindings[0])
  const connection = createFakeConnection(state)
  await createStore(createPool([connection])).resolveWechatPhoneIdentity(trustedIdentity())
  assert.equal(state.phoneBindings.length, 2)
  assert.deepEqual(state.phoneBindings[0], before)
  assert.equal(state.phoneBindings[1].phone_hash, phoneHash(TEST_PHONE))
}

async function testConflictAndWriteFailuresRollback() {
  const conflictingState = createState({
    phoneBindings: [{
      id: '9',
      user_id: '2',
      phone_hash: phoneHash(TEST_PHONE),
      phone_masked: '100****0000',
      hash_version: 'v1',
      country_code: '86',
      status: 'active'
    }]
  })
  const conflictConnection = createFakeConnection(conflictingState)
  await expectReject(
    () => createStore(createPool([conflictConnection])).resolveWechatPhoneIdentity(trustedIdentity()),
    (error) => error && error.code === 'IDENTITY_CONFLICT'
  )
  assert.equal(conflictConnection.counters.rollback, 1)
  assert.equal(conflictingState.phoneBindings.length, 1)

  for (const failPhoneWrite of ['insert', 'update']) {
    const existing = failPhoneWrite === 'update' ? [{
      id: '10',
      user_id: '1',
      phone_hash: phoneHash(TEST_PHONE),
      phone_masked: '100****0000',
      hash_version: 'v1',
      country_code: '86',
      campaign_phone_identity_hash: null,
      campaign_phone_hash_version: null,
      status: 'active'
    }] : []
    const state = createState({ phoneBindings: existing })
    const before = cloneState(state)
    const connection = createFakeConnection(state, { failPhoneWrite })
    await assert.rejects(
      () => createStore(createPool([connection])).resolveWechatPhoneIdentity(trustedIdentity())
    )
    assert.equal(connection.counters.rollback, 1)
    assert.equal(connection.counters.commit, 0)
    assert.deepEqual(state, before)
  }
}

async function testSchemaFailureClosesTransaction() {
  const schemaVariants = [
    { campaign_phone_identity_hash: null, campaign_phone_hash_version: null },
    { campaign_phone_hash_version: null },
    { campaign_phone_identity_hash: { Type: 'binary(16)' } },
    { campaign_phone_hash_version: { Type: 'varchar(8)' } },
    { campaign_phone_identity_hash: { Extra: 'STORED GENERATED' } }
  ]
  for (const phoneOverrides of schemaVariants) {
    const state = createState()
    const before = cloneState(state)
    const connection = createFakeConnection(state, {
      columns: createColumns(phoneOverrides)
    })
    await expectReject(
      () => createStore(createPool([connection])).resolveWechatPhoneIdentity(trustedIdentity()),
      (error) => error && error.code === 'IDENTITY_STORE_ERROR'
    )
    assert.equal(connection.counters.rollback, 1)
    assert.equal(connection.counters.commit, 0)
    assert.deepEqual(state, before)
  }
}

async function testDuplicateRetryReusesCampaignIdentity() {
  const state = createState()
  const firstConnection = createFakeConnection(state, { duplicatePhoneInsert: true })
  const secondConnection = createFakeConnection(state)
  let factoryCalls = 0
  const expectedPhoneHash = phoneHash(TEST_PHONE)
  const pool = createPool([firstConnection, secondConnection], (callCount) => {
    if (callCount === 2) {
      state.phoneBindings.push({
        id: '12',
        user_id: '1',
        phone_hash: expectedPhoneHash,
        phone_masked: '100****0000',
        hash_version: 'v1',
        country_code: '86',
        campaign_phone_identity_hash: null,
        campaign_phone_hash_version: null,
        status: 'active'
      })
    }
  })
  const store = createStore(pool, {
    campaignPhoneIdentityFactory: async () => {
      factoryCalls += 1
      return {
        campaignPhoneIdentityHash: Buffer.from(TEST_CAMPAIGN_HASH),
        hashVersion: 'v1'
      }
    }
  })
  const result = await store.resolveWechatPhoneIdentity(trustedIdentity())
  assert.equal(result.isNew, false)
  assert.equal(factoryCalls, 1)
  assert.equal(pool.callCount, 2)
  assert.equal(firstConnection.counters.rollback, 1)
  assert.equal(secondConnection.counters.commit, 1)
  assert.deepEqual(state.phoneBindings[0].campaign_phone_identity_hash, TEST_CAMPAIGN_HASH)
  assert.equal(state.phoneBindings[0].campaign_phone_hash_version, 'v1')
}

async function testTransactionReadHelper() {
  const calls = []
  const connection = {
    async execute(sql, values) {
      calls.push({ sql, values })
      return [[{
        campaign_phone_identity_hash: Buffer.from(TEST_CAMPAIGN_HASH),
        campaign_phone_hash_version: 'v1'
      }]]
    },
    getConnection() {
      throw new Error('helper must not get a connection')
    },
    beginTransaction() {
      throw new Error('helper must not begin a transaction')
    },
    commit() {
      throw new Error('helper must not commit')
    },
    rollback() {
      throw new Error('helper must not rollback')
    },
    release() {
      throw new Error('helper must not release')
    }
  }
  const result = await findCurrentCampaignPhoneIdentityInTransaction(connection, '42')
  assert.deepEqual(result.campaignPhoneIdentityHash, TEST_CAMPAIGN_HASH)
  assert.equal(result.campaignPhoneHashVersion, 'v1')
  assert.match(calls[0].sql, /status = 'active'/)
  assert.match(calls[0].sql, /ORDER BY last_verified_at DESC, id DESC/)
  assert.doesNotMatch(calls[0].sql, /FOR UPDATE/)
  assert.deepEqual(calls[0].values, ['42'])

  calls.length = 0
  await findCurrentCampaignPhoneIdentityInTransaction(connection, '42', { forUpdate: true })
  assert.match(calls[0].sql, /FOR UPDATE$/)

  const noRowConnection = { execute: async () => [[]] }
  assert.equal(await findCurrentCampaignPhoneIdentityInTransaction(noRowConnection, '42'), null)
  const missingIdentityConnection = {
    execute: async () => [[{
      campaign_phone_identity_hash: null,
      campaign_phone_hash_version: null
    }]]
  }
  assert.equal(
    await findCurrentCampaignPhoneIdentityInTransaction(missingIdentityConnection, '42'),
    null
  )
  for (const row of [
    { campaign_phone_identity_hash: Buffer.alloc(31), campaign_phone_hash_version: 'v1' },
    { campaign_phone_identity_hash: Buffer.alloc(32), campaign_phone_hash_version: 'v2' },
    { campaign_phone_identity_hash: new Uint8Array(32), campaign_phone_hash_version: 'v1' }
  ]) {
    await expectReject(
      () => findCurrentCampaignPhoneIdentityInTransaction({ execute: async () => [[row]] }, '42'),
      (error) => error && error.code === 'IDENTITY_STORE_ERROR'
    )
  }
}

async function testNoSensitiveLogging() {
  const captured = []
  const originalLog = console.log
  const originalError = console.error
  const originalInfo = console.info
  const originalWarn = console.warn
  console.log = (...values) => captured.push(values.join(' '))
  console.error = (...values) => captured.push(values.join(' '))
  console.info = (...values) => captured.push(values.join(' '))
  console.warn = (...values) => captured.push(values.join(' '))
  try {
    const state = createState()
    const connection = createFakeConnection(state)
    await createStore(createPool([connection])).resolveWechatPhoneIdentity(trustedIdentity())
  } finally {
    console.log = originalLog
    console.error = originalError
    console.info = originalInfo
    console.warn = originalWarn
  }
  const output = captured.join('\n')
  assert.equal(output.includes('10000000000'), false)
  assert.equal(output.includes(TEST_CAMPAIGN_HASH.toString('hex')), false)
  assert.equal(output.includes(TEST_CAMPAIGN_SECRET), false)
}

testCampaignIdentityFoundation()
await testHmacBeforeConnectionAndTrustedInput()
await testDefaultFactoryIntegration()
await testDefaultFactoryPreservesConfigurationErrorCodes()
await testNewBindingAndPrivacy()
await testSamePhoneRefreshesCampaignIdentity()
await testNewPhonePreservesOldBinding()
await testConflictAndWriteFailuresRollback()
await testSchemaFailureClosesTransaction()
await testDuplicateRetryReusesCampaignIdentity()
await testTransactionReadHelper()
await testNoSensitiveLogging()

console.log('book-benefit trusted phone identity binding tests passed')
